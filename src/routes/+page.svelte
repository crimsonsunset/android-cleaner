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
	let stopRequested = false; // For halting batch processing
	let selectedDeviceSerial = null; // Currently selected device (fake for now)
	
	// Table sorting
	let sortColumn = 'displayName';
	let sortDirection = 'asc';
	
	// Loading progress
	let loadingProgress = {
		current: 0,
		total: 0,
		percentage: 0,
		cached: 0,
		expectedTotal: 0 // Track expected total for batch processing
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
		loadingProgress = { current: 0, total: 0, percentage: 0, cached: 0, expectedTotal: 0 };
		
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
		} finally {
			loading = false;
			// Keep progress visible briefly to show completion
			setTimeout(() => {
				loadingProgress = { current: 0, total: 0, percentage: 0, cached: 0, expectedTotal: 0 };
			}, 1000);
		}
	}
	
	/**
	 * Process app batches with real-time progress updates
	 */
	async function processBatchesWithProgress(packageList, deviceSerial, totalApps) {
		const BATCH_SIZE = 5;
		const totalBatches = Math.ceil(packageList.length / BATCH_SIZE);
		
		// Initialize progress tracking
		loadingProgress.expectedTotal = totalApps;
		loadingProgress.total = totalApps;
		loadingProgress.current = 0;
		loadingProgress.percentage = 0;
		
		console.log(`[BATCH-START] Processing ${totalApps} apps in ${totalBatches} batches of ${BATCH_SIZE}`);
		
		for (let i = 0; i < packageList.length; i += BATCH_SIZE) {
			// Check if stop was requested
			if (stopRequested) {
				console.log(`[BATCH-STOPPED] Processing halted at ${apps.length}/${totalApps} apps`);
				break;
			}
			
			const batch = packageList.slice(i, i + BATCH_SIZE);
			const batchNumber = Math.floor(i / BATCH_SIZE) + 1;
			
			try {
				const batchResponse = await fetch('/api/apps/list-batch', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						packageNames: batch,
						deviceSerial,
						batchNumber,
						totalBatches
					})
				});
				
				const batchData = await batchResponse.json();
				
				if (batchData.success) {
					// Add new apps to the list
					apps = [...apps, ...batchData.apps];
					
					// Update progress
					loadingProgress.current = apps.length;
					loadingProgress.percentage = Math.round((apps.length / totalApps) * 100);
					
					console.log(`[BATCH-${batchNumber}] Completed: ${apps.length}/${totalApps} apps (${loadingProgress.percentage}%)`);
					
					// Force reactivity update
					apps = apps;
				} else {
					console.error(`[BATCH-${batchNumber}] Failed:`, batchData.error);
				}
			} catch (batchError) {
				console.error(`[BATCH-${batchNumber}] Network error:`, batchError);
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
				
				// Show results summary
				alert(`Uninstall complete: ${data.successCount} successful, ${data.failureCount} failed`);
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
	 * Toggle app selection
	 */
	function toggleAppSelection(packageName) {
		if (selectedApps.has(packageName)) {
			selectedApps.delete(packageName);
		} else {
			selectedApps.add(packageName);
		}
		selectedApps = selectedApps; // Trigger reactivity
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
	}
	
	/**
	 * Clear all selections
	 */
	function clearSelection() {
		selectedApps.clear();
		selectedApps = selectedApps;
	}
	
	/**
	 * Bulk uninstall selected apps
	 */
	async function bulkUninstall() {
		if (selectedApps.size === 0) return;
		
		const confirmed = confirm(`Are you sure you want to uninstall ${selectedApps.size} apps?`);
		if (!confirmed) return;
		
		await uninstallSelected();
	}

	/**
	 * Clear app cache to force fresh data
	 */
	async function clearCache() {
		try {
			const response = await fetch('/api/cache/clear', { method: 'POST' });
			const data = await response.json();
			
			if (data.success) {
				alert('Cache cleared! Next load will fetch fresh data.');
			} else {
				error = data.error || 'Failed to clear cache';
			}
		} catch (err) {
			error = 'Network error clearing cache';
			console.error('Clear cache failed:', err);
		}
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
			
			// Handle string comparisons
			if (typeof aVal === 'string') {
				aVal = aVal.toLowerCase();
				bVal = bVal.toLowerCase();
			}
			
			const result = aVal < bVal ? -1 : aVal > bVal ? 1 : 0;
			return sortDirection === 'asc' ? result : -result;
		});
		
	/**
	 * Check if all visible apps are selected
	 */
	$: selectAll = filteredApps.length > 0 && filteredApps.every(app => selectedApps.has(app.packageName));
	
	/**
	 * Stop batch processing
	 */
	function stopBatchProcessing() {
		stopRequested = true;
		console.log('[BATCH-STOP] Stop requested by user');
	}
</script>

<svelte:head>
	<title>Android Cleaner - Samsung Fold 5 App Manager</title>
</svelte:head>

<div class="min-h-screen bg-base-100">
	<!-- Header -->
	<div class="navbar bg-base-300 shadow-lg">
		<div class="navbar-start">
			<h1 class="btn btn-ghost text-xl">📱 Android Cleaner</h1>
		</div>
		<div class="navbar-center">
			<div class="stats stats-horizontal">
				<div class="stat">
					<div class="stat-title">Device</div>
					<div class="stat-value text-sm">
						{connectionStatus?.deviceConnected ? '✅ Connected' : '❌ Disconnected'}
					</div>
					<div class="stat-desc">{connectionStatus?.deviceInfo?.displayName || connectionStatus?.deviceInfo?.model || 'Unknown Device'}</div>
				</div>
				<div class="stat">
					<div class="stat-title">Apps Loaded</div>
					<div class="stat-value text-lg">{apps.length}</div>
				</div>
				<div class="stat">
					<div class="stat-title">Selected</div>
					<div class="stat-value text-lg">{selectedApps.size}</div>
				</div>
			</div>
		</div>
		<div class="navbar-end">
			<button class="btn btn-primary" on:click={checkConnection}>
				🔄 Check Connection
			</button>
		</div>
	</div>

	<div class="container mx-auto p-4">
		<!-- Bulk Actions Bar -->
		{#if selectedApps.size > 0}
			<div class="fixed bottom-4 left-1/2 transform -translate-x-1/2 bg-base-100 shadow-xl border rounded-lg p-4 flex items-center gap-4 z-50">
				<span class="text-sm font-medium">{selectedApps.size} apps selected</span>
				<button class="btn btn-sm btn-error" on:click={bulkUninstall}>
					🗑️ Uninstall Selected
				</button>
				<button class="btn btn-sm btn-ghost" on:click={clearSelection}>
					Clear Selection
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

		<!-- Controls -->
		<div class="card bg-base-200 shadow-xl mb-6">
			<div class="card-body">
				<div class="flex flex-wrap gap-4 items-center justify-between">
					<!-- Search -->
					<div class="form-control">
						<input 
							type="text" 
							placeholder="Search apps..." 
							class="input input-bordered w-full max-w-xs"
							bind:value={searchTerm}
						/>
					</div>
					
					<!-- No category filters - removed per user request -->
					
					<!-- System Apps Toggle -->
					<div class="form-control">
						<label class="label cursor-pointer gap-2">
							<span class="label-text">Hide System Apps</span>
							<input 
								type="checkbox" 
								class="toggle toggle-primary" 
								bind:checked={hideSystemApps} 
							/>
						</label>
					</div>
					
					<!-- Action Buttons -->
					<div class="flex gap-2">
						<button 
							class="btn btn-accent"
							class:loading={loading}
							disabled={!connectionStatus?.deviceConnected || loading}
							on:click={loadApps}
						>
							{loading ? '' : '📱'} Load Apps
						</button>
						
						<button 
							class="btn btn-ghost btn-sm"
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
						>
							🗑️ Uninstall ({selectedApps.size})
						</button>
					</div>
				</div>
			</div>
		</div>

		<!-- Apps Table -->
		{#if loading}
			<div class="overflow-x-auto">
				<div class="flex flex-col gap-4 p-8 text-center">
					<div class="flex items-center justify-center gap-4">
						<span class="loading loading-spinner loading-lg text-primary"></span>
						<div>
							<p class="text-lg font-medium">Loading apps...</p>
							<div class="flex items-center gap-4">
								<p class="text-sm text-base-content/70">
									{#if loadingProgress.expectedTotal > 0}
										{loadingProgress.current}/{loadingProgress.expectedTotal} apps processed
									{:else}
										Reading app data from Samsung Fold 5
									{/if}
								</p>
								{#if loadingProgress.expectedTotal > 0}
									<button 
										class="btn btn-sm btn-error"
										on:click={stopBatchProcessing}
									>
										⏹️ Stop
									</button>
								{/if}
							</div>
							<p class="text-xs text-base-content/60">
								{#if loadingProgress.expectedTotal > 0}
									🔄 AAPT batch processing ({loadingProgress.percentage}% complete)
								{:else}
									⚡ Checking cache or starting fresh scan
								{/if}
							</p>
						</div>
					</div>
					{#if loadingProgress.expectedTotal > 0}
						<progress class="progress progress-primary w-full max-w-md mx-auto" 
							value={loadingProgress.current} 
							max={loadingProgress.expectedTotal}></progress>
						<p class="text-xs text-center mt-2 text-base-content/60">
							{loadingProgress.current}/{loadingProgress.expectedTotal} apps processed
						</p>
					{:else}
						<progress class="progress progress-primary w-full max-w-md mx-auto"></progress>
					{/if}
				</div>
			</div>
		{:else if filteredApps.length > 0}
			<div class="overflow-x-auto {loading ? 'pointer-events-none opacity-75' : ''}">
				<table class="table table-zebra table-hover">
					<thead>
						<tr>
							<th>
								<input type="checkbox" class="checkbox" 
									bind:checked={selectAll} 
									on:change={handleSelectAll} />
							</th>
							<th class="cursor-pointer hover:bg-base-200" on:click={() => sortBy('displayName')}>
								App Name
								{#if sortColumn === 'displayName'}
									<span class="text-xs ml-1">{sortDirection === 'asc' ? '↑' : '↓'}</span>
								{/if}
							</th>
							<th class="cursor-pointer hover:bg-base-200" on:click={() => sortBy('packageName')}>
								Package Name
								{#if sortColumn === 'packageName'}
									<span class="text-xs ml-1">{sortDirection === 'asc' ? '↑' : '↓'}</span>
								{/if}
							</th>
							<th class="cursor-pointer hover:bg-base-200" on:click={() => sortBy('type')}>
								Type
								{#if sortColumn === 'type'}
									<span class="text-xs ml-1">{sortDirection === 'asc' ? '↑' : '↓'}</span>
								{/if}
							</th>
							<th class="cursor-pointer hover:bg-base-200" on:click={() => sortBy('size')}>
								Size
								{#if sortColumn === 'size'}
									<span class="text-xs ml-1">{sortDirection === 'asc' ? '↑' : '↓'}</span>
								{/if}
							</th>
							<th class="cursor-pointer hover:bg-base-200" on:click={() => sortBy('installDate')}>
								Install Date
								{#if sortColumn === 'installDate'}
									<span class="text-xs ml-1">{sortDirection === 'asc' ? '↑' : '↓'}</span>
								{/if}
							</th>
							<!-- Category column removed -->
							<th>Actions</th>
						</tr>
					</thead>
					<tbody>
						{#each filteredApps as app}
							<tr class="hover">
								<td>
									<input type="checkbox" class="checkbox" 
										checked={selectedApps.has(app.packageName)}
										on:change={() => toggleAppSelection(app.packageName)} />
								</td>
								<td class="font-medium">{app.displayName}</td>
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
								<td class="text-sm">{app.installDate}</td>
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
		
		<!-- Bulk Actions Bar (appears when apps are selected) -->
		{#if selectedApps.size > 0}
			<div class="sticky bottom-4 left-0 right-0 mx-auto max-w-md">
				<div class="alert alert-info shadow-lg">
					<div class="flex-1">
						<span>{selectedApps.size} apps selected</span>
					</div>
					<div class="flex-none gap-2">
						<button class="btn btn-sm btn-ghost" on:click={clearSelection}>
							Clear
						</button>
						<button 
							class="btn btn-sm btn-error" 
							on:click={uninstallSelected}
							disabled={Array.from(selectedApps).every(pkg => {
								const app = apps.find(a => a.packageName === pkg);
								return app?.type === 'system';
							})}
						>
							🗑️ Uninstall ({selectedApps.size})
						</button>
					</div>
				</div>
			</div>
		{/if}
		
		<!-- Bulk Actions Bar (appears when apps are selected) -->
		{#if selectedApps.size > 0}
			<div class="sticky bottom-4 left-0 right-0 mx-auto max-w-md">
				<div class="alert alert-info shadow-lg">
					<div class="flex-1">
						<span>{selectedApps.size} apps selected</span>
					</div>
					<div class="flex-none gap-2">
						<button class="btn btn-sm btn-ghost" on:click={clearSelection}>
							Clear
						</button>
						<button 
							class="btn btn-sm btn-error" 
							on:click={uninstallSelected}
							disabled={Array.from(selectedApps).every(pkg => {
								const app = apps.find(a => a.packageName === pkg);
								return app?.type === 'system';
							})}
						>
							🗑️ Uninstall ({selectedApps.size})
						</button>
					</div>
				</div>
			</div>
		{/if}
	</div>
</div>

<style>
	.hero {
		background: linear-gradient(135deg, var(--fallback-b1,oklch(var(--b1))) 0%, var(--fallback-b2,oklch(var(--b2))) 100%);
	}
</style>