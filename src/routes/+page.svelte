<script>
	import { onMount } from 'svelte';
	
	let apps = [];
	let selectedApps = new Set();
	let connectionStatus = null;
	let loading = false;
	let searchTerm = '';
	let selectedCategory = 'all';
	let error = null;
	
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
	 * Load app list from device
	 */
	async function loadApps() {
		if (!connectionStatus?.deviceConnected) {
			error = 'Device not connected. Please connect Samsung Fold 5 via USB.';
			return;
		}
		
		loading = true;
		error = null;
		
		try {
			const response = await fetch('/api/apps/list');
			const data = await response.json();
			
			if (data.success) {
				apps = data.apps;
				selectedApps.clear();
				selectedApps = selectedApps; // Trigger reactivity
			} else {
				error = data.error || 'Failed to load apps';
			}
		} catch (err) {
			error = 'Network error loading apps';
			console.error('Load apps failed:', err);
		} finally {
			loading = false;
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
	 * Filter apps based on search and category
	 */
	$: filteredApps = apps.filter(app => {
		const matchesSearch = app.displayName.toLowerCase().includes(searchTerm.toLowerCase()) ||
		                     app.packageName.toLowerCase().includes(searchTerm.toLowerCase());
		const matchesCategory = selectedCategory === 'all' || app.category === selectedCategory;
		return matchesSearch && matchesCategory;
	});
	
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
					<div class="stat-desc">Samsung Fold 5</div>
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

		<!-- App Grid -->
		{#if filteredApps.length > 0}
			<div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
				{#each filteredApps as app}
					<div class="card bg-base-100 shadow-md hover:shadow-lg transition-shadow">
						<div class="card-body p-4">
							<!-- Selection Checkbox -->
							<div class="form-control">
								<label class="label cursor-pointer">
									<input 
										type="checkbox" 
										class="checkbox checkbox-primary"
										checked={selectedApps.has(app.packageName)}
										on:change={() => toggleAppSelection(app.packageName)}
									/>
									<span class="label-text font-semibold">{app.displayName}</span>
								</label>
							</div>
							
							<!-- App Details -->
							<div class="space-y-2">
								<div class="badge badge-outline badge-sm">{app.category}</div>
								<p class="text-xs text-base-content/70 truncate" title={app.packageName}>
									{app.packageName}
								</p>
								<div class="flex justify-between text-sm">
									<span class="badge badge-info badge-sm">{app.size}</span>
									<span class="text-base-content/60">{app.installDate}</span>
								</div>
							</div>
							
							<!-- Quick Actions -->
							<div class="card-actions justify-end">
								<button 
									class="btn btn-error btn-xs"
									on:click={() => {
										selectedApps.clear();
										selectedApps.add(app.packageName);
										selectedApps = selectedApps;
										uninstallSelected();
									}}
								>
									🗑️
								</button>
							</div>
						</div>
					</div>
				{/each}
			</div>
		{:else if apps.length === 0 && !loading}
			<div class="hero min-h-96">
				<div class="hero-content text-center">
					<div class="max-w-md">
						<h2 class="text-3xl font-bold">📱 Ready to Clean</h2>
						<p class="py-6">Connect your Samsung Fold 5 via USB and load your app inventory to start cleaning.</p>
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
		{:else if loading}
			<div class="hero min-h-96">
				<div class="hero-content text-center">
					<div class="loading loading-spinner loading-lg"></div>
					<p class="ml-4">Loading apps from device...</p>
				</div>
			</div>
		{:else}
			<div class="hero min-h-96">
				<div class="hero-content text-center">
					<div class="max-w-md">
						<h2 class="text-2xl font-bold">🔍 No Apps Found</h2>
						<p class="py-6">No apps match your current search and filter criteria.</p>
						<button class="btn btn-outline" on:click={() => {searchTerm = ''; selectedCategory = 'all';}}>
							Clear Filters
						</button>
					</div>
				</div>
			</div>
		{/if}
	</div>
</div>