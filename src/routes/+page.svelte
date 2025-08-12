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
	let selectedCategory = 'all';
	let hideSystemApps = true; // Default to hiding system apps
	let error = null;
	
	// Table sorting
	let sortColumn = 'displayName';
	let sortDirection = 'asc';
	
	// Loading progress
	let loadingProgress = {
		current: 0,
		total: 0,
		percentage: 0,
		cached: 0
	};
	
	// App categories for filtering
	const categories = ['all', 'Social', 'Games', 'Entertainment', 'Finance', 'Productivity', 'Photo', 'Other'];
	
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
		} catch (err) {
			error = 'Failed to check ADB connection';
			console.error('Connection check failed:', err);
		}
	}
	
	/**
	 * Load app list from device with real dumpsys data and progress tracking
	 */
	async function loadApps() {
		if (!connectionStatus?.deviceConnected) {
			error = `Device not connected. Please connect your ${connectionStatus?.deviceInfo?.model || 'Android device'} via USB.`;
			return;
		}
		
		loading = true;
		error = null;
		loadingProgress = { current: 0, total: 0, percentage: 0, cached: 0 };
		
		try {
			// First get basic app list to show total count
			const basicResponse = await fetch('/api/apps/list?basic=true');
			const basicData = await basicResponse.json();
			
			if (!basicData.success) {
				error = basicData.error || 'Failed to get app list';
				return;
			}
			
			const totalApps = basicData.apps.length;
			loadingProgress.total = totalApps;
			
			// Now get detailed info for each app with progress updates
			const detailedApps = [];
			
			for (let i = 0; i < basicData.apps.length; i++) {
				const app = basicData.apps[i];
				loadingProgress.current = i + 1;
				loadingProgress.percentage = Math.round((loadingProgress.current / loadingProgress.total) * 100);
				
				try {
					// Get detailed info for this specific app
					const detailResponse = await fetch(`/api/apps/details?package=${encodeURIComponent(app.packageName)}`);
					const detailData = await detailResponse.json();
					
					if (detailData.success) {
						detailedApps.push(detailData.app);
						if (detailData.cached) {
							loadingProgress.cached++;
						}
					} else {
						// Fallback to basic data if detailed fetch fails
						detailedApps.push(app);
					}
				} catch (detailErr) {
					console.warn(`Failed to get details for ${app.packageName}:`, detailErr);
					// Use basic data as fallback
					detailedApps.push(app);
				}
				
				// Small delay to show progress and not overwhelm the device
				await new Promise(resolve => setTimeout(resolve, 50));
			}
			
			apps = detailedApps;
			selectedApps.clear();
			selectedApps = selectedApps; // Trigger reactivity
			
		} catch (err) {
			error = 'Network error loading apps';
			console.error('Load apps failed:', err);
		} finally {
			loading = false;
			loadingProgress = { current: 0, total: 0, percentage: 0, cached: 0 };
		}
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
	 * Filter and sort apps based on search, category, and sort settings
	 */
	$: filteredApps = apps
		.filter(app => {
			const matchesSearch = app.displayName.toLowerCase().includes(searchTerm.toLowerCase()) ||
			                     app.packageName.toLowerCase().includes(searchTerm.toLowerCase());
			const matchesCategory = selectedCategory === 'all' || app.category === selectedCategory;
			const matchesSystemFilter = !hideSystemApps || app.type !== 'system';
			return matchesSearch && matchesCategory && matchesSystemFilter;
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
	 * Get category counts for filter buttons
	 */
	$: categoryCounts = categories.reduce((counts, category) => {
		if (category === 'all') {
			counts[category] = apps.length;
		} else {
			counts[category] = apps.filter(app => app.category === category).length;
		}
		return counts;
	}, {});
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
					
					<!-- Category Filter -->
					<div class="flex flex-wrap gap-2">
						{#each categories as category}
							<button 
								class="btn btn-sm {selectedCategory === category ? 'btn-primary' : 'btn-outline'}"
								on:click={() => selectedCategory = category}
							>
								{category} 
								{#if categoryCounts[category]}
									<span class="badge badge-secondary">{categoryCounts[category]}</span>
								{/if}
							</button>
						{/each}
					</div>
					
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
							<p class="text-lg font-medium">Loading app details...</p>
							<p class="text-sm text-base-content/70">
								{loadingProgress.current} of {loadingProgress.total} apps processed
								{#if loadingProgress.cached > 0}
									<span class="text-green-600">({loadingProgress.cached} from cache)</span>
								{/if}
							</p>
							<p class="text-xs text-base-content/60">
								{#if loadingProgress.cached === loadingProgress.current}
									Loaded from cache - nearly instant! 🚀
								{:else}
									Estimated time remaining: {Math.ceil((loadingProgress.total - loadingProgress.current) * 0.18)} seconds
								{/if}
							</p>
						</div>
					</div>
					<progress class="progress progress-primary w-full max-w-md mx-auto" 
						value={loadingProgress.percentage} max="100"></progress>
				</div>
			</div>
		{:else if filteredApps.length > 0}
			<div class="overflow-x-auto">
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
							<th class="cursor-pointer hover:bg-base-200" on:click={() => sortBy('category')}>
								Category
								{#if sortColumn === 'category'}
									<span class="text-xs ml-1">{sortDirection === 'asc' ? '↑' : '↓'}</span>
								{/if}
							</th>
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
									<div class="badge badge-outline badge-sm">{app.category}</div>
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
						<p class="py-6">No apps match your current search and filter criteria.</p>
						<button class="btn btn-outline" on:click={() => {searchTerm = ''; selectedCategory = 'all'; hideSystemApps = true;}}>
							Clear Filters
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