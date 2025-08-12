<script>
	import { onMount } from 'svelte';
	
	// Accept but ignore SvelteKit props to prevent warnings
	export let data = undefined;
	export let params = undefined;
	export let url = undefined;
	export let route = undefined;
	
	// Silence unused variable warnings
	$: void (data, params, url, route);
	
	let apps = [];
	let selectedApps = new Set();
	let connectionStatus = null;
	let loading = false;
	let searchTerm = '';
	let hideSystemApps = true; // Default to hiding system apps
	let error = null;
	let toast = null; // Toast notification state
	let stopRequested = false; // For halting batch processing
	let showUninstallModal = false; // For DaisyUI confirmation modal
	let showClearCacheModal = false; // For clear cache confirmation modal
	let showFailedUninstallsModal = false; // For failed uninstalls modal
	let failedUninstalls = []; // Track failed uninstall attempts
	let selectedDeviceSerial = null; // Currently selected device (fake for now)
	let shiftSelectAnchor = null; // For shift-click range selection
	let batchStartTime = null; // For time estimation
	let avgBatchTime = 0; // Average time per batch
	let currentBatchController = null; // AbortController for current batch request
	
	// Pagination state
	let pageSize = "50"; // Default to 50 apps per page (string to match option values)
	let currentPage = 1;
	
	// Table sorting
	let sortColumn = 'displayName';
	let sortDirection = 'asc';
	
	// Loading progress
	let loadingProgress = {
		current: 0,
		total: 0,
		percentage: 0,
		cached: 0,
		expectedTotal: 0, // Track expected total for batch processing
		estimatedSeconds: 0 // Time estimate
	};
	
	// No categories - removed per user request
	
	/**
	 * Check ADB connection status on component mount
	 */
	onMount(async () => {
		await checkConnection();
	});
	
	/**
	 * Check if device is connected via ADB
	 */
	async function checkConnection() {
		try {
			const response = await fetch('/api/adb/status');
			connectionStatus = await response.json();
			
			// Set default selected device (smart selection logic)
			if (connectionStatus?.deviceConnected && !selectedDeviceSerial) {
				selectedDeviceSerial = connectionStatus.targetDevice;
			}
		} catch (err) {
			error = 'Failed to check ADB connection';
			console.error('Connection check failed:', err);
		}
	}
	
	/**
	 * Switch to a different connected device (UI only for now)
	 */
	function switchDevice(deviceSerial) {
		selectedDeviceSerial = deviceSerial;
		console.log(`[DEVICE-SWITCH] Selected device: ${deviceSerial} (UI only - not wired up yet)`);
		// TODO: Implement actual device switching in backend
	}
	
	/**
	 * Load app list from device - uses bulk loading for instant cache performance
	 */
	async function loadApps() {
		if (!connectionStatus?.deviceConnected) {
			error = `Device not connected. Please connect your ${connectionStatus?.deviceInfo?.model || 'Android device'} via USB.`;
			return;
		}
		
		loading = true;
		error = null;
		stopRequested = false;
		apps = []; // Clear existing apps
		loadingProgress = { current: 0, total: 0, percentage: 0, cached: 0, expectedTotal: 0, estimatedSeconds: 0 };
		
		try {
			// Get app list or cached data
			const response = await fetch('/api/apps/list');
			const data = await response.json();
			
			if (!data.success) {
				error = data.error || 'Failed to get app list';
				return;
			}
			
			if (data.cached) {
				// Cached data - instant load
				loadingProgress.total = data.apps.length;
				loadingProgress.current = data.apps.length;
				loadingProgress.percentage = 100;
				loadingProgress.cached = data.apps.length;
				
				apps = data.apps;
				console.log(`[BULK-CACHE] Loaded ${apps.length} apps instantly from cache`);
			} else if (data.requiresBatching) {
				// Fresh data - process in frontend-controlled batches
				await processBatchesWithProgress(data.packageList, data.deviceSerial, data.totalUserApps);
			} else {
				// Fallback: data already processed
				apps = data.apps;
				console.log(`[FALLBACK] Received ${apps.length} apps`);
			}
			
			selectedApps.clear();
			selectedApps = selectedApps; // Trigger reactivity
			
		} catch (err) {
			error = 'Network error loading apps';
			console.error('Load apps failed:', err);
		} 		finally {
			loading = false;
			// Keep progress visible briefly to show completion
			setTimeout(() => {
				loadingProgress = { current: 0, total: 0, percentage: 0, cached: 0, expectedTotal: 0, estimatedSeconds: 0 };
			}, 1000);
		}
	}
	
	/**
	 * Process app batches with real-time progress updates
	 */
	async function processBatchesWithProgress(packageList, deviceSerial, totalApps) {
		const BATCH_SIZE = 5;
		const totalBatches = Math.ceil(packageList.length / BATCH_SIZE);
		
		// Reset stop state for new batch processing
		stopRequested = false;
		currentBatchController = null;
		
		// Initialize progress tracking
		loadingProgress.expectedTotal = totalApps;
		loadingProgress.total = totalApps;
		loadingProgress.current = 0;
		loadingProgress.percentage = 0;
		batchStartTime = Date.now();
		avgBatchTime = 0;
		
		console.log(`[BATCH-START] Processing ${totalApps} apps in ${totalBatches} batches of ${BATCH_SIZE}`);
		
		for (let i = 0; i < packageList.length; i += BATCH_SIZE) {
			// Check if stop was requested
			if (stopRequested) {
				console.log(`[BATCH-STOPPED] Processing halted at ${apps.length}/${totalApps} apps`);
				break;
			}
			
			const batch = packageList.slice(i, i + BATCH_SIZE);
			const batchNumber = Math.floor(i / BATCH_SIZE) + 1;
			const currentBatchStart = Date.now();
			
			try {
				// Create abort controller for this batch
				currentBatchController = new AbortController();
				
				const batchResponse = await fetch('/api/apps/list-batch', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						packageNames: batch,
						deviceSerial,
						batchNumber,
						totalBatches
					}),
					signal: currentBatchController.signal
				});
				
				const batchData = await batchResponse.json();
				
				// Clean up controller after successful request
				currentBatchController = null;
				
				if (batchData.success) {
					// Add new apps to the list
					apps = [...apps, ...batchData.apps];
					
					// Update progress
					loadingProgress.current = apps.length;
					loadingProgress.percentage = Math.round((apps.length / totalApps) * 100);
					
					// Calculate time estimates
					const batchTime = Date.now() - currentBatchStart;
					avgBatchTime = ((avgBatchTime * (batchNumber - 1)) + batchTime) / batchNumber;
					const remainingBatches = totalBatches - batchNumber;
					const estimatedTimeRemaining = Math.round((remainingBatches * avgBatchTime) / 1000);
					loadingProgress.estimatedSeconds = estimatedTimeRemaining;
					
					console.log(`[BATCH-${batchNumber}] Completed: ${apps.length}/${totalApps} apps (${loadingProgress.percentage}%)`);
					
					// Force reactivity update
					apps = apps;
				} else {
					console.error(`[BATCH-${batchNumber}] Failed:`, batchData.error);
				}
			} catch (batchError) {
				if (batchError.name === 'AbortError') {
					console.log(`[BATCH-${batchNumber}] Aborted by user`);
					break; // Exit the batch processing loop
				} else {
					console.error(`[BATCH-${batchNumber}] Network error:`, batchError);
				}
			}
		}
		
		// Save to cache after all batches complete
		try {
			const cacheResponse = await fetch('/api/cache/save', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					deviceSerial,
					apps: apps
				})
			});
			const cacheData = await cacheResponse.json();
			if (cacheData.success) {
				console.log(`[BATCH-COMPLETE] Cached ${apps.length} apps for future loads`);
			}
		} catch (cacheError) {
			console.warn('[BATCH-COMPLETE] Failed to cache results:', cacheError);
		}
		
		console.log(`[BATCH-COMPLETE] Processed ${apps.length} apps total`);
	}

	/**
	 * Uninstall selected apps
	 */
	async function uninstallSelected() {
		if (selectedApps.size === 0) {
			error = 'No apps selected for uninstall';
			return;
		}
		
		loading = true;
		error = null;
		
		try {
			const response = await fetch('/api/apps/uninstall', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ packageNames: Array.from(selectedApps) })
			});
			
			const data = await response.json();
			
			if (data.success) {
				// Remove successfully uninstalled apps from list
				const successfulUninstalls = data.results
					.filter(r => r.success)
					.map(r => r.packageName);
				
				apps = apps.filter(app => !successfulUninstalls.includes(app.packageName));
				selectedApps.clear();
				selectedApps = selectedApps; // Trigger reactivity
				
				// Track failed uninstalls
				const currentFailures = data.results
					.filter(r => !r.success)
					.map(r => ({
						...r,
						displayName: apps.find(app => app.packageName === r.packageName)?.displayName || r.packageName,
						timestamp: new Date().toISOString()
					}));
				
				// Add to failed uninstalls list (keeping most recent at top)
				failedUninstalls = [...currentFailures, ...failedUninstalls];
				
				// Show results summary
				const message = `Uninstall complete: ${data.successCount} successful, ${data.failureCount} failed`;
				showToast(message, data.failureCount > 0 ? 'warning' : 'success');
			} else {
				error = data.error || 'Uninstall failed';
			}
		} catch (err) {
			error = 'Network error during uninstall';
			console.error('Uninstall failed:', err);
		} finally {
			loading = false;
		}
	}
	
	/**
	 * Toggle app selection with shift-click range support and smart trimming
	 */
	function toggleAppSelection(packageName, event = null) {
		// Handle shift-click range selection
		if (event && event.shiftKey && shiftSelectAnchor) {
			selectRange(shiftSelectAnchor, packageName);
			return;
		}
		
		// Handle smart range trimming: clicking within a selection trims to that point
		if (selectedApps.has(packageName) && selectedApps.size > 1) {
			const trimmed = trimSelectionToPoint(packageName);
			if (trimmed) {
				return; // Trimming happened, we're done
			}
		}
		
		// Normal toggle behavior
		if (selectedApps.has(packageName)) {
			selectedApps.delete(packageName);
		} else {
			selectedApps.add(packageName);
			// Set as anchor for future shift-clicks
			shiftSelectAnchor = packageName;
		}
		selectedApps = selectedApps; // Trigger reactivity
	}

	/**
	 * Smart trimming: if clicking within a contiguous selection, trim to that point
	 */
	function trimSelectionToPoint(packageName) {
		const clickedIndex = filteredApps.findIndex(app => app.packageName === packageName);
		if (clickedIndex === -1) return false;
		
		// Get all selected indices and sort them
		const selectedIndices = filteredApps
			.map((app, index) => selectedApps.has(app.packageName) ? index : -1)
			.filter(index => index !== -1)
			.sort((a, b) => a - b);
		
		if (selectedIndices.length < 2) return false;
		
		// Find the contiguous range that includes the clicked index
		let rangeStart = -1;
		let rangeEnd = -1;
		
		for (let i = 0; i < selectedIndices.length; i++) {
			const currentIndex = selectedIndices[i];
			
			// Check if this starts a contiguous range that includes our clicked index
			if (currentIndex <= clickedIndex) {
				rangeStart = currentIndex;
				rangeEnd = currentIndex;
				
				// Extend the range as far as it's contiguous
				for (let j = i + 1; j < selectedIndices.length; j++) {
					if (selectedIndices[j] === rangeEnd + 1) {
						rangeEnd = selectedIndices[j];
					} else {
						break;
					}
				}
				
				// If our clicked index is within this contiguous range, we can trim
				if (clickedIndex >= rangeStart && clickedIndex <= rangeEnd && rangeEnd > clickedIndex) {
					// Clear current selection
					selectedApps.clear();
					
					// Re-select from range start to clicked point
					for (let k = rangeStart; k <= clickedIndex; k++) {
						selectedApps.add(filteredApps[k].packageName);
					}
					
					// Update anchor to the clicked item
					shiftSelectAnchor = packageName;
					selectedApps = selectedApps; // Trigger reactivity
					return true;
				}
			}
		}
		
		return false;
	}

	/**
	 * Select a range of apps from anchor to target
	 */
	function selectRange(anchorPackage, targetPackage) {
		const anchorIndex = filteredApps.findIndex(app => app.packageName === anchorPackage);
		const targetIndex = filteredApps.findIndex(app => app.packageName === targetPackage);
		
		if (anchorIndex === -1 || targetIndex === -1) return;
		
		// Determine range (could be forwards or backwards)
		const startIndex = Math.min(anchorIndex, targetIndex);
		const endIndex = Math.max(anchorIndex, targetIndex);
		
		// Select all apps in the range
		for (let i = startIndex; i <= endIndex; i++) {
			selectedApps.add(filteredApps[i].packageName);
		}
		
		selectedApps = selectedApps; // Trigger reactivity
	}

	/**
	 * Handle clicking on table rows for selection (including shift-click)
	 */
	function handleRowClick(packageName, event) {
		// Don't interfere with checkbox, button, or link clicks
		if (event.target.type === 'checkbox' || 
		    event.target.tagName === 'BUTTON' || 
		    event.target.tagName === 'A' || 
		    event.target.closest('button') || 
		    event.target.closest('a')) {
			return;
		}
		
		// Prevent text selection during shift-click
		if (event.shiftKey) {
			event.preventDefault();
		}
		
		toggleAppSelection(packageName, event);
	}
	
	/**
	 * Sort apps by column
	 */
	function sortBy(column) {
		if (sortColumn === column) {
			sortDirection = sortDirection === 'asc' ? 'desc' : 'asc';
		} else {
			sortColumn = column;
			sortDirection = 'asc';
		}
	}
	
	/**
	 * Handle select all checkbox
	 */
	function handleSelectAll(event) {
		if (event.target.checked) {
			filteredApps.forEach(app => selectedApps.add(app.packageName));
		} else {
			selectedApps.clear();
		}
		selectedApps = selectedApps; // Trigger reactivity
		shiftSelectAnchor = null; // Reset shift-select anchor
	}
	
	/**
	 * Clear all selections
	 */
	function clearSelection() {
		selectedApps.clear();
		selectedApps = selectedApps;
		shiftSelectAnchor = null; // Reset shift-select anchor
	}
	
	/**
	 * Bulk uninstall selected apps
	 */
	async function bulkUninstall() {
		if (selectedApps.size === 0) return;
		
		// Show DaisyUI modal instead of browser confirm
		showUninstallModal = true;
	}

	/**
	 * Confirm and execute uninstall
	 */
	async function confirmUninstall() {
		showUninstallModal = false;
		await uninstallSelected();
	}

	/**
	 * Cancel uninstall
	 */
	function cancelUninstall() {
		showUninstallModal = false;
	}

	/**
	 * Show clear cache confirmation modal
	 */
	function clearCache() {
		showClearCacheModal = true;
	}

	/**
	 * Confirm and execute cache clear with UI reset
	 */
	async function confirmClearCache() {
		showClearCacheModal = false;
		
		try {
			const response = await fetch('/api/cache/clear', { method: 'POST' });
			const data = await response.json();
			
			if (data.success) {
				// Reset UI to initial empty state
				apps = [];
				selectedApps.clear();
				selectedApps = selectedApps;
				shiftSelectAnchor = null;
				error = null;
				loading = false;
				searchTerm = '';
				hideSystemApps = true;
				failedUninstalls = []; // Clear failed uninstalls history
				currentPage = 1; // Reset pagination
				
				// Reset progress
				loadingProgress = { current: 0, total: 0, percentage: 0, cached: 0, expectedTotal: 0, estimatedSeconds: 0 };
				
				showToast('Cache cleared! Click "Load Apps" to fetch fresh data.', 'success');
			} else {
				error = data.error || 'Failed to clear cache';
			}
		} catch (err) {
			error = 'Network error clearing cache';
			console.error('Clear cache failed:', err);
		}
	}

	/**
	 * Cancel cache clear
	 */
	function cancelClearCache() {
		showClearCacheModal = false;
	}

	/**
	 * Show failed uninstalls modal
	 */
	function showFailedUninstalls() {
		showFailedUninstallsModal = true;
	}

	/**
	 * Close failed uninstalls modal
	 */
	function closeFailedUninstalls() {
		showFailedUninstallsModal = false;
	}

	/**
	 * Clear failed uninstalls history
	 */
	function clearFailedUninstalls() {
		failedUninstalls = [];
		showFailedUninstallsModal = false;
		showToast('Failed uninstalls history cleared.', 'success');
	}

	/**
	 * Generate store URL based on install source and package name
	 */
	function getStoreUrl(app) {
		switch (app.installSource) {
			case 'Play Store':
				return `https://play.google.com/store/apps/details?id=${app.packageName}`;
			case 'Samsung Store':
				return `https://galaxystore.samsung.com/detail/${app.packageName}`;
			default:
				return null;
		}
	}

	/**
	 * Convert size string to bytes for numeric comparison
	 */
	function sizeToBytes(sizeStr) {
		if (!sizeStr || sizeStr === 'Unknown') return 0;
		
		const match = sizeStr.match(/^(\d+(?:\.\d+)?)\s*([KMGT]?)B?$/i);
		if (!match) return 0;
		
		const [, value, unit] = match;
		const num = parseFloat(value);
		
		const multipliers = {
			'': 1,
			'K': 1024,
			'M': 1024 * 1024,
			'G': 1024 * 1024 * 1024,
			'T': 1024 * 1024 * 1024 * 1024
		};
		
		return num * (multipliers[unit.toUpperCase()] || 1);
	}

	/**
	 * Filter and sort apps based on search and system filter only
	 */
	$: filteredApps = apps
		.filter(app => {
			const matchesSearch = app.displayName.toLowerCase().includes(searchTerm.toLowerCase()) ||
			                     app.packageName.toLowerCase().includes(searchTerm.toLowerCase());
			const matchesSystemFilter = !hideSystemApps || app.type !== 'system';
			return matchesSearch && matchesSystemFilter;
		})
		.sort((a, b) => {
			let aVal = a[sortColumn];
			let bVal = b[sortColumn];
			
			// Handle different column types for proper sorting
			if (sortColumn === 'size' || sortColumn === 'dataSize') {
				// Convert size strings to bytes for numeric comparison
				aVal = sizeToBytes(aVal);
				bVal = sizeToBytes(bVal);
			} else if (sortColumn === 'targetSdk') {
				// Handle numeric SDK values
				aVal = aVal || 0;
				bVal = bVal || 0;
			} else if (sortColumn === 'isEnabled') {
				// Handle boolean values (enabled first)
				aVal = aVal ? 1 : 0;
				bVal = bVal ? 1 : 0;
			} else if (sortColumn === 'installDate' || sortColumn === 'lastUsed') {
				// Handle date strings
				aVal = new Date(aVal || 0).getTime();
				bVal = new Date(bVal || 0).getTime();
			} else if (typeof aVal === 'string' && typeof bVal === 'string') {
				// Handle string comparisons (case-insensitive)
				aVal = aVal.toLowerCase();
				bVal = bVal.toLowerCase();
			}
			
			const result = aVal < bVal ? -1 : aVal > bVal ? 1 : 0;
			return sortDirection === 'asc' ? result : -result;
		});
	
	/**
	 * Calculate total pages and paginated apps
	 */
	$: totalPages = pageSize === 'all' ? 1 : Math.ceil(filteredApps.length / parseInt(pageSize));
	
	/**
	 * Reset current page when filters change or page size changes
	 */
	$: if (filteredApps) {
		currentPage = Math.min(currentPage, totalPages || 1);
	}
	
	/**
	 * Get apps for current page
	 */
	$: paginatedApps = pageSize === 'all' 
		? filteredApps
		: filteredApps.slice((currentPage - 1) * parseInt(pageSize), currentPage * parseInt(pageSize));
		
	/**
	 * Check if all visible apps on current page are selected
	 */
	$: selectAll = paginatedApps.length > 0 && paginatedApps.every(app => selectedApps.has(app.packageName));
	
	/**
	 * Pagination controls
	 */
	function goToPage(page) {
		if (page >= 1 && page <= totalPages) {
			currentPage = page;
		}
	}
	
	function previousPage() {
		if (currentPage > 1) {
			currentPage--;
		}
	}
	
	function nextPage() {
		if (currentPage < totalPages) {
			currentPage++;
		}
	}
	
	function changePageSize(newSize) {
		pageSize = newSize; // Keep as string to match option values
		currentPage = 1; // Reset to first page when changing page size
	}

	/**
	 * Show toast notification
	 */
	function showToast(message, type = 'success') {
		toast = { message, type };
		// Auto-hide after 3 seconds
		setTimeout(() => {
			toast = null;
		}, 3000);
	}
	
	/**
	 * Stop batch processing immediately
	 */
	function stopBatchProcessing() {
		stopRequested = true;
		
		// Abort any current batch request
		if (currentBatchController) {
			currentBatchController.abort();
			currentBatchController = null;
		}
		
		// Immediately stop loading state
		loading = false;
		
		console.log(`[BATCH-STOP] Processing stopped immediately at ${apps.length} apps`);
		
		// Clear progress after a brief moment to show final count
		setTimeout(() => {
			loadingProgress = { current: 0, total: 0, percentage: 0, cached: 0, expectedTotal: 0, estimatedSeconds: 0 };
		}, 1000);
	}
	
	/**
	 * Format time estimate in minutes and seconds
	 */
	function formatTimeEstimate(seconds) {
		if (seconds <= 0) return '';
		const minutes = Math.floor(seconds / 60);
		const remainingSeconds = seconds % 60;
		if (minutes > 0) {
			return remainingSeconds > 0 ? `${minutes}m ${remainingSeconds}s` : `${minutes}m`;
		}
		return `${remainingSeconds}s`;
	}
	
	/**
	 * Format date from YYYY-MM-DD to MM/DD/YYYY
	 */
	function formatDate(dateString) {
		if (!dateString || dateString === 'Unknown') return dateString;
		try {
			const parts = dateString.split('-');
			if (parts.length === 3) {
				const [year, month, day] = parts;
				return `${month.padStart(2, '0')}/${day.padStart(2, '0')}/${year}`;
			}
		} catch (error) {
			console.warn('Date formatting error:', error);
		}
		return dateString;
	}
</script>

<svelte:head>
	<title>Android Cleaner - Samsung Fold 5 App Manager</title>
</svelte:head>

<div class="min-h-screen bg-base-100">
	<!-- Header -->
	<div class="navbar bg-base-300 shadow-lg">
		<div class="navbar-start">
			<div class="flex flex-col">
				<div class="flex items-center">
					<h1 class="text-xl font-bold">📱 Android Cleaner</h1>
					<button 
						class="btn btn-square btn-ghost btn-sm ml-2" 
						on:click={checkConnection}
						title="Check ADB connection status"
					>
						🔄
					</button>
				</div>
				{#if connectionStatus?.allDevices && connectionStatus.allDevices.length > 1}
					<!-- Multiple devices - show dropdown under title -->
					<div class="dropdown dropdown-bottom">
											<div tabindex="0" role="button" class="btn btn-xs btn-ghost mt-1">
						{connectionStatus?.deviceInfo?.displayName || 'Select Device'}
						<svg class="w-3 h-3 ml-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path>
						</svg>
					</div>
						<ul tabindex="0" class="dropdown-content menu bg-base-100 rounded-box z-[999] w-64 p-2 shadow-xl border">
							{#each connectionStatus.allDevices as device}
								<li>
									<button 
										class="text-left {device.serial === selectedDeviceSerial ? 'active' : ''}"
										on:click={() => switchDevice(device.serial)}
									>
										<div class="flex items-center gap-2">
											{#if device.serial === selectedDeviceSerial}
												<span class="text-primary">●</span>
											{:else}
												<span class="text-base-content/30">○</span>
											{/if}
										<div>
											<div class="font-medium">{device.displayName || device.serial}</div>
											<div class="text-xs font-mono">{device.serial}</div>
										</div>
										</div>
									</button>
								</li>
							{/each}
							<li><hr class="my-1" /></li>
							<li class="text-xs text-base-content/60 px-3 py-1">
								🚧 Device switching coming soon
							</li>
						</ul>
					</div>
				{/if}
			</div>
			
			<!-- Inline Stats -->
			<div class="divider divider-horizontal"></div>
			<div class="flex items-center gap-4 text-sm">
				<div class="flex items-center gap-1">
					<span class="font-medium">Status:</span>
					<span class="{connectionStatus?.deviceConnected ? 'text-success' : 'text-error'}">
						{connectionStatus?.deviceConnected ? '✅ Connected' : '❌ Disconnected'}
					</span>
				</div>
				<div class="flex items-center gap-1">
					<span class="font-medium">Apps:</span>
					<span class="badge badge-primary badge-sm">{apps.length}</span>
				</div>
				<div class="flex items-center gap-1">
					<span class="font-medium">Selected:</span>
					<span class="badge badge-secondary badge-sm">{selectedApps.size}</span>
				</div>
			</div>
			
			<!-- Search & Filter - only show when apps are loaded -->
			{#if apps.length > 0}
				<div class="divider divider-horizontal"></div>
				<div class="flex items-center gap-3">
					<input 
						type="text" 
						placeholder="Search apps..." 
						class="input input-bordered input-sm w-48"
						bind:value={searchTerm}
					/>
					
					<div class="form-control">
						<label class="label cursor-pointer gap-2">
							<span class="label-text text-xs">Hide System Apps</span>
							<input 
								type="checkbox" 
								class="toggle toggle-primary toggle-sm" 
								bind:checked={hideSystemApps} 
							/>
						</label>
					</div>
					
					<!-- Compact Page Size Selector -->
					<select class="select select-sm select-bordered" 
						value={pageSize} 
						on:change={(e) => changePageSize(e.target.value)}>
						<option value="50">50/page</option>
						<option value="100">100/page</option>
						<option value="all">All</option>
					</select>
				</div>
			{/if}
		</div>
		
		<div class="navbar-end gap-2">
			<!-- Action Buttons -->
			{#if failedUninstalls.length > 0}
				<button 
					class="btn btn-error btn-outline"
					on:click={showFailedUninstalls}
					title="View apps that failed to uninstall"
				>
					❌ Failed ({failedUninstalls.length})
				</button>
			{/if}
			
			<button 
				class="btn btn-warning"
				disabled={loading}
				on:click={clearCache}
				title="Clear cache to force fresh data"
			>
				🗑️ Clear Cache
			</button>
			
			<button 
				class="btn btn-error"
				disabled={selectedApps.size === 0 || loading}
				on:click={uninstallSelected}
				title="Uninstall selected apps"
			>
				❌ Uninstall ({selectedApps.size})
			</button>
		</div>
	</div>

	<div class="w-full px-4 py-4">
		<!-- Bulk Actions Bar -->
		{#if selectedApps.size > 0}
			<div class="fixed bottom-4 left-1/2 transform -translate-x-1/2 bg-base-100 shadow-xl border rounded-lg p-4 flex items-center gap-4 z-50">
				<span class="text-sm font-medium">{selectedApps.size} apps selected</span>
				<button class="btn btn-sm btn-error" on:click={bulkUninstall}>
					🗑️ Uninstall ({selectedApps.size})
				</button>
				<button class="btn btn-sm btn-ghost" on:click={clearSelection}>
					Clear
				</button>
			</div>
		{/if}

		<!-- Error Alert -->
		{#if error}
			<div class="alert alert-error mb-4">
				<svg xmlns="http://www.w3.org/2000/svg" class="stroke-current shrink-0 h-6 w-6" fill="none" viewBox="0 0 24 24">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" />
				</svg>
				<span>{error}</span>
				<button class="btn btn-sm" on:click={() => error = null}>✕</button>
			</div>
		{/if}



		<!-- Apps Table -->
		{#if loading && apps.length === 0}
			<div class="overflow-x-auto">
				<div class="flex flex-col gap-4 p-8 text-center">
					<div>
						<p class="text-lg font-medium">Loading apps...</p>
						<p class="text-xs text-base-content/60">
							{#if loadingProgress.expectedTotal === 0}
								⚡ Checking cache or starting fresh scan
							{/if}
						</p>
					</div>
					
					{#if loadingProgress.expectedTotal > 0}
						<progress class="progress progress-primary w-full max-w-md mx-auto" 
							value={loadingProgress.current} 
							max={loadingProgress.expectedTotal}></progress>
						<p class="text-sm text-center mt-2 text-base-content/70">
							{loadingProgress.current}/{loadingProgress.expectedTotal} apps processed
							{#if loadingProgress.estimatedSeconds > 0}
								• ~{formatTimeEstimate(loadingProgress.estimatedSeconds)} remaining
							{/if}
						</p>
					{:else}
						<progress class="progress progress-primary w-full max-w-md mx-auto"></progress>
					{/if}
					
					{#if loadingProgress.expectedTotal > 0}
						<div class="mt-4">
							<button 
								class="btn btn-error"
								on:click={stopBatchProcessing}
							>
								⏹️ Stop
							</button>
						</div>
					{/if}
				</div>
			</div>
		{:else if filteredApps.length > 0 || (loading && apps.length > 0)}
							<!-- Show table with apps, disabled during loading -->
				<div class="overflow-x-auto {loading ? 'pointer-events-none opacity-75' : ''} min-w-full px-16 py-8">
				{#if loading}
					<!-- Loading progress overlay -->
					<div class="bg-base-200 p-4 mb-4 rounded-lg text-center">
						<progress class="progress progress-primary w-full max-w-md mx-auto" 
							value={loadingProgress.current} 
							max={loadingProgress.expectedTotal}></progress>
						<p class="text-sm mt-2 text-base-content/70">
							{loadingProgress.current}/{loadingProgress.expectedTotal} apps processed
							{#if loadingProgress.estimatedSeconds > 0}
								• ~{formatTimeEstimate(loadingProgress.estimatedSeconds)} remaining
							{/if}
						</p>
						<button 
							class="btn btn-sm btn-error mt-2 pointer-events-auto"
							on:click={stopBatchProcessing}
						>
							⏹️ Stop
						</button>
					</div>
				{/if}
									<table class="table table-zebra table-hover table-pin-rows table-pin-cols min-w-full">
					<thead>
						<tr>
							<th title="Select/deselect all visible apps">
								<input type="checkbox" class="checkbox" 
									bind:checked={selectAll} 
									on:change={handleSelectAll} />
							</th>
							<th class="cursor-pointer hover:bg-base-200" on:click={() => sortBy('displayName')} 
								title="Display name of the app (clickable for store apps)">
								App Name
								{#if sortColumn === 'displayName'}
									<span class="text-xs ml-1">{sortDirection === 'asc' ? '↑' : '↓'}</span>
								{/if}
							</th>
							<th class="cursor-pointer hover:bg-base-200" on:click={() => sortBy('packageName')}
								title="Unique Android package identifier (com.company.appname)">
								Package Name
								{#if sortColumn === 'packageName'}
									<span class="text-xs ml-1">{sortDirection === 'asc' ? '↑' : '↓'}</span>
								{/if}
							</th>
							<th class="cursor-pointer hover:bg-base-200" on:click={() => sortBy('type')}
								title="User app (installed by user) or System app (pre-installed)">
								Type
								{#if sortColumn === 'type'}
									<span class="text-xs ml-1">{sortDirection === 'asc' ? '↑' : '↓'}</span>
								{/if}
							</th>
							<th class="cursor-pointer hover:bg-base-200" on:click={() => sortBy('size')}
								title="APK file size - how much storage the app installation takes">
								Size
								{#if sortColumn === 'size'}
									<span class="text-xs ml-1">{sortDirection === 'asc' ? '↑' : '↓'}</span>
								{/if}
							</th>
							<th class="cursor-pointer hover:bg-base-200" on:click={() => sortBy('installDate')}
								title="When this app was first installed on the device">
								Install Date
								{#if sortColumn === 'installDate'}
									<span class="text-xs ml-1">{sortDirection === 'asc' ? '↑' : '↓'}</span>
								{/if}
							</th>
							<th class="cursor-pointer hover:bg-base-200" on:click={() => sortBy('lastUsed')}
								title="When this app was last opened or used by the user">
								Last Used
								{#if sortColumn === 'lastUsed'}
									<span class="text-xs ml-1">{sortDirection === 'asc' ? '↑' : '↓'}</span>
								{/if}
							</th>
							<th class="cursor-pointer hover:bg-base-200" on:click={() => sortBy('targetSdk')}
								title="Android SDK version this app targets (33+ modern, <29 legacy/may break)">
								Target SDK
								{#if sortColumn === 'targetSdk'}
									<span class="text-xs ml-1">{sortDirection === 'asc' ? '↑' : '↓'}</span>
								{/if}
							</th>
							<th class="cursor-pointer hover:bg-base-200" on:click={() => sortBy('installSource')}
								title="Where this app was installed from (Play Store, Samsung Store, Sideloaded)">
								Source
								{#if sortColumn === 'installSource'}
									<span class="text-xs ml-1">{sortDirection === 'asc' ? '↑' : '↓'}</span>
								{/if}
							</th>
							<th class="cursor-pointer hover:bg-base-200" on:click={() => sortBy('isEnabled')}
								title="Whether the app is enabled (✓) or disabled (✗) on the device">
								Status
								{#if sortColumn === 'isEnabled'}
									<span class="text-xs ml-1">{sortDirection === 'asc' ? '↑' : '↓'}</span>
								{/if}
							</th>
							<th class="cursor-pointer hover:bg-base-200" on:click={() => sortBy('dataSize')}
								title="User data storage used by app (databases, cache, files - separate from APK size)">
								Data Size
								{#if sortColumn === 'dataSize'}
									<span class="text-xs ml-1">{sortDirection === 'asc' ? '↑' : '↓'}</span>
								{/if}
							</th>
							<th title="System-level app permissions (HAS=has code, ALL=allow backup, LAR=large heap, etc.)">Flags</th>
							<!-- Category column removed -->
							<th title="Actions you can perform on this app">Actions</th>
						</tr>
					</thead>
					<tbody>
						{#each paginatedApps as app}
							<tr class="hover cursor-pointer {app.packageName === shiftSelectAnchor ? 'ring-1 ring-primary/50' : ''}" 
								on:click={(event) => handleRowClick(app.packageName, event)}>
								<td>
									<input type="checkbox" class="checkbox" 
										checked={selectedApps.has(app.packageName)}
										on:change={(event) => {
											event.stopPropagation();
											toggleAppSelection(app.packageName, event);
										}} />
								</td>
								<td class="font-medium">
									{#if getStoreUrl(app)}
										<a href={getStoreUrl(app)} target="_blank" rel="noopener noreferrer" 
											class="text-primary hover:text-primary-focus">
											{app.displayName}
										</a>
									{:else}
										{app.displayName}
									{/if}
								</td>
								<td class="text-sm text-base-content/70 font-mono">{app.packageName}</td>
								<td>
									<div class="badge badge-{app.type === 'user' ? 'primary' : 'secondary'} badge-sm">
										{app.type}
										{#if app.type === 'system'}
											🔒
										{/if}
									</div>
								</td>
								<td class="text-sm">{app.size}</td>
								<td class="text-sm">{formatDate(app.installDate)}</td>
								<td class="text-sm">{formatDate(app.lastUsed)}</td>
								<td class="text-sm">
									{#if app.targetSdk}
										<span class="badge badge-sm {app.targetSdk >= 33 ? 'badge-success' : app.targetSdk >= 29 ? 'badge-warning' : 'badge-error'}">
											{app.targetSdk}
										</span>
									{:else}
										<span class="text-base-content/50">—</span>
									{/if}
								</td>
								<td class="text-xs">
									<span class="badge badge-outline badge-xs">
										{app.installSource}
									</span>
								</td>
								<td class="text-sm">
									{#if app.isEnabled}
										<span class="text-success">✓</span>
									{:else}
										<span class="text-error">✗</span>
									{/if}
								</td>
								<td class="text-sm">{app.dataSize}</td>
								<td class="text-xs">
									{#if app.appFlags && app.appFlags.length > 0}
										<div class="flex flex-wrap gap-1">
											{#each app.appFlags as flag}
												<span class="badge badge-ghost badge-xs" title={flag}>
													{flag.substring(0, 3)}
												</span>
											{/each}
										</div>
									{:else}
										<span class="text-base-content/50">—</span>
									{/if}
								</td>
								<td>
									<button 
										class="btn btn-xs btn-error"
										disabled={app.type === 'system'}
										title={app.type === 'system' ? 'Cannot uninstall system apps' : 'Uninstall app'}
										on:click={() => {
											selectedApps.clear();
											selectedApps.add(app.packageName);
											selectedApps = selectedApps;
											uninstallSelected();
										}}
									>
										{#if app.type === 'system'}
											🔒
										{:else}
											🗑️
										{/if}
									</button>
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
				
				<!-- Pagination Controls -->
				{#if filteredApps.length > 0}
					<div class="flex flex-col sm:flex-row justify-between items-center mt-6 gap-4">
						<!-- Page Size Selector -->
						<div class="flex items-center gap-2">
							<span class="text-sm">Show:</span>
							<select class="select select-sm select-bordered" 
								value={pageSize} 
								on:change={(e) => changePageSize(e.target.value)}>
								<option value="50">50 per page</option>
								<option value="100">100 per page</option>
								<option value="all">All ({filteredApps.length})</option>
							</select>
						</div>
						
						<!-- Page Info -->
						<div class="text-sm text-base-content/70">
							{#if pageSize === 'all'}
								Showing all {filteredApps.length} apps
							{:else}
								Showing {Math.min((currentPage - 1) * parseInt(pageSize) + 1, filteredApps.length)}-{Math.min(currentPage * parseInt(pageSize), filteredApps.length)} of {filteredApps.length} apps
							{/if}
						</div>
						
						<!-- Page Navigation -->
						{#if pageSize !== 'all' && totalPages > 1}
							<div class="flex items-center gap-1">
								<button class="btn btn-sm btn-ghost" 
									disabled={currentPage === 1} 
									on:click={previousPage}>
									‹ Prev
								</button>
								
								<!-- Page Numbers -->
								<div class="flex gap-1 flex-wrap">
									{#each Array.from({length: totalPages}, (_, i) => i + 1) as page}
										<button class="btn btn-sm {page === currentPage ? 'btn-primary' : 'btn-ghost'}" 
											on:click={() => goToPage(page)}>
											{page}
										</button>
									{/each}
								</div>
								
								<button class="btn btn-sm btn-ghost" 
									disabled={currentPage === totalPages} 
									on:click={nextPage}>
									Next ›
								</button>
							</div>
						{/if}
					</div>
				{/if}
			</div>
		{:else if apps.length === 0}
			<div class="hero min-h-96">
				<div class="hero-content text-center">
					<div class="max-w-md">
						<h2 class="text-3xl font-bold">📱 Ready to Clean</h2>
						<p class="py-6">Connect your Android device via USB and load your app inventory to start cleaning.</p>
						<button 
							class="btn btn-primary btn-lg"
							disabled={!connectionStatus?.deviceConnected}
							on:click={loadApps}
						>
							{connectionStatus?.deviceConnected ? '📱 Load Apps' : '🔌 Connect Device'}
						</button>
					</div>
				</div>
			</div>
		{:else}
			<div class="hero min-h-96">
				<div class="hero-content text-center">
					<div class="max-w-md">
						<h2 class="text-2xl font-bold">🔍 No Apps Found</h2>
						<p class="py-6">No apps match your current search criteria.</p>
						<button class="btn btn-outline" on:click={() => {searchTerm = ''; hideSystemApps = true;}}>
							Clear Search
						</button>
					</div>
				</div>
			</div>
		{/if}
		

		

	</div>

	<!-- Toast Notification -->
	{#if toast}
		<div class="toast toast-bottom toast-center">
			<div class="alert {toast.type === 'success' ? 'alert-primary' : toast.type === 'error' ? 'alert-error' : toast.type === 'warning' ? 'alert-warning' : 'alert-info'}">
				<span>{toast.message}</span>
			</div>
		</div>
	{/if}

	<!-- Uninstall Confirmation Modal -->
	{#if showUninstallModal}
		<div class="modal modal-open">
			<div class="modal-box">
				<h3 class="font-bold text-lg">⚠️ Confirm Uninstall</h3>
				<p class="py-4">
					Are you sure you want to uninstall <strong>{selectedApps.size}</strong> 
					{selectedApps.size === 1 ? 'app' : 'apps'}?
				</p>
				<p class="text-sm text-base-content/70 mb-4">
					This action cannot be undone. Apps will need to be reinstalled from their stores.
				</p>
				<div class="modal-action">
					<button class="btn btn-ghost" on:click={cancelUninstall}>
						Cancel
					</button>
					<button class="btn btn-error" on:click={confirmUninstall}>
						🗑️ Uninstall {selectedApps.size === 1 ? 'App' : 'Apps'}
					</button>
				</div>
			</div>
		</div>
	{/if}

	<!-- Clear Cache Confirmation Modal -->
	{#if showClearCacheModal}
		<div class="modal modal-open">
			<div class="modal-box">
				<h3 class="font-bold text-lg">🧹 Confirm Clear Cache</h3>
				<p class="py-4">
					Are you sure you want to clear the app cache?
				</p>
				<p class="text-sm text-base-content/70 mb-4">
					This will remove all cached app data and reset the interface. 
					You'll need to click "Load Apps" to reload fresh data from your device.
				</p>
				<div class="modal-action">
					<button class="btn btn-ghost" on:click={cancelClearCache}>
						Cancel
					</button>
					<button class="btn btn-warning" on:click={confirmClearCache}>
						🧹 Clear Cache
					</button>
				</div>
			</div>
		</div>
	{/if}

	<!-- Failed Uninstalls Modal -->
	{#if showFailedUninstallsModal}
		<div class="modal modal-open">
			<div class="modal-box w-11/12 max-w-5xl">
				<h3 class="font-bold text-lg">❌ Failed Uninstalls ({failedUninstalls.length})</h3>
				<p class="py-2 text-sm text-base-content/70">
					Apps that could not be uninstalled. Some may be system apps or require special permissions.
				</p>
				
				<div class="overflow-x-auto max-h-96 mt-4">
					<table class="table table-zebra table-sm">
						<thead>
							<tr>
								<th>App Name</th>
								<th>Package Name</th>
								<th>Error</th>
								<th>Time</th>
							</tr>
						</thead>
						<tbody>
							{#each failedUninstalls as failure}
								<tr>
									<td class="font-medium">{failure.displayName}</td>
									<td class="font-mono text-xs">{failure.packageName}</td>
									<td class="text-error text-xs">{failure.error}</td>
									<td class="text-xs">{new Date(failure.timestamp).toLocaleTimeString()}</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
				
				<div class="modal-action">
					<button class="btn btn-ghost" on:click={clearFailedUninstalls}>
						🧹 Clear History
					</button>
					<button class="btn btn-primary" on:click={closeFailedUninstalls}>
						Close
					</button>
				</div>
			</div>
		</div>
	{/if}
</div>

<style>
	.hero {
		background: linear-gradient(135deg, var(--fallback-b1,oklch(var(--b1))) 0%, var(--fallback-b2,oklch(var(--b2))) 100%);
	}
</style>