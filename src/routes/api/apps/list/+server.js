import { json } from '@sveltejs/kit';
import { exec } from 'child_process';
import { promisify } from 'util';
import { loadCache, saveCache, isCacheValid, initCache } from '$lib/cache.js';
import { generateDisplayName } from '$lib/app-names.js';

const execAsync = promisify(exec);

// Simple console logging for debugging
function log(message, data = '') {
	console.log(`[ANDROID-API] ${message}`, data);
}

/**
 * Get list of all installed apps from Android device via ADB with smart caching
 * @returns {Promise<Response>} JSON response with app list
 */
export async function GET({ url }) {
	const isBasic = url.searchParams.get('basic') === 'true';
	log(`Starting app list retrieval (basic: ${isBasic})`);
	try {
		// Get connected devices and prefer Samsung Fold 5
		const devicesResult = await execAsync('adb devices');
		const deviceLines = devicesResult.stdout.split('\n').filter(line => line.includes('\tdevice'));
		
		if (deviceLines.length === 0) {
			return json({ success: false, error: 'No devices connected' });
		}
		
		// Prefer Samsung Fold 5 if available, otherwise use first device
		const samsungFold5 = 'RFCW708JTVX';
		let deviceSerial = deviceLines.find(line => line.includes(samsungFold5))?.split('\t')[0];
		
		if (!deviceSerial) {
			// Fallback to first available device
			deviceSerial = deviceLines[0].split('\t')[0];
		}
		
		log(`Using device: ${deviceSerial}`);
		
		// Load cache and check if we have valid bulk data
		let cache = loadCache();
		
		if (isCacheValid(cache, deviceSerial) && Object.keys(cache.apps).length > 0) {
			// Return cached data instantly - BULK LOAD FROM CACHE!
			const cachedApps = Object.values(cache.apps);
			log(`[BULK-CACHE] Returning ${cachedApps.length} apps from cache instantly`);
			
			return json({
				success: true,
				deviceSerial,
				totalUserApps: cachedApps.filter(app => app.type === 'user').length,
				totalSystemApps: cachedApps.filter(app => app.type === 'system').length,
				apps: cachedApps,
				cached: true,
				timestamp: new Date().toISOString()
			});
		}
		
		// Cache miss or invalid - fetch fresh data from device
		log(`[BULK-FRESH] Cache miss, fetching fresh data from device`);
		
		// Get user-installed apps (non-system)
		const userAppsCmd = `adb -s ${deviceSerial} shell pm list packages -3`;
		const { stdout: userApps } = await execAsync(userAppsCmd);
		
		// Parse app lists
		const userAppsList = userApps
			.split('\n')
			.filter(line => line.startsWith('package:'))
			.map(line => line.replace('package:', '').trim())
			.filter(Boolean);
		
		// Process apps in controlled batches to prevent system overload
		const BATCH_SIZE = 5; // Process 5 apps at a time
		const appsWithDetails = [];
		
		log(`[BATCH-PROCESS] Processing ${userAppsList.length} apps in batches of ${BATCH_SIZE}`);
		
		for (let i = 0; i < userAppsList.length; i += BATCH_SIZE) {
			const batch = userAppsList.slice(i, i + BATCH_SIZE);
			const batchStartTime = Date.now();
			
			log(`[BATCH-PROCESS] Processing batch ${Math.floor(i/BATCH_SIZE) + 1}/${Math.ceil(userAppsList.length/BATCH_SIZE)} (${batch.length} apps)`);
			
			const batchResults = await Promise.all(
				batch.map(async (packageName) => {
					try {
						// Get full dumpsys output for this package
						const dumpsysCmd = `adb -s ${deviceSerial} shell dumpsys package ${packageName}`;
						const { stdout: dumpsysOutput } = await execAsync(dumpsysCmd);
						
						// Parse dumpsys output for key information
						const firstInstallMatch = dumpsysOutput.match(/firstInstallTime=([^\n]+)/);
						const lastUpdateMatch = dumpsysOutput.match(/lastUpdateTime=([^\n]+)/);
						const versionNameMatch = dumpsysOutput.match(/versionName=([^\s]+)/);
						const versionCodeMatch = dumpsysOutput.match(/versionCode=(\d+)/);
						const codePathMatch = dumpsysOutput.match(/codePath=([^\n]+)/);
						
						// Parse install date (handle both Unix timestamps and formatted dates)
						let installDate = 'Unknown';
						if (firstInstallMatch) {
							const dateStr = firstInstallMatch[1].trim();
							if (/^\d+$/.test(dateStr)) {
								// Unix timestamp
								installDate = new Date(parseInt(dateStr)).toISOString().split('T')[0];
							} else {
								// Formatted date (YYYY-MM-DD HH:MM:SS)
								const parsed = new Date(dateStr);
								installDate = !isNaN(parsed.getTime()) ? parsed.toISOString().split('T')[0] : 'Unknown';
							}
						}
						
						let lastUpdate = installDate;
						if (lastUpdateMatch) {
							const dateStr = lastUpdateMatch[1].trim();
							if (/^\d+$/.test(dateStr)) {
								// Unix timestamp
								lastUpdate = new Date(parseInt(dateStr)).toISOString().split('T')[0];
							} else {
								// Formatted date (YYYY-MM-DD HH:MM:SS)
								const parsed = new Date(dateStr);
								lastUpdate = !isNaN(parsed.getTime()) ? parsed.toISOString().split('T')[0] : installDate;
							}
						}
						
						// Get app size using the actual codePath
						let size = 'Unknown';
						if (codePathMatch) {
							const codePath = codePathMatch[1].trim();
							const sizeCmd = `adb -s ${deviceSerial} shell du -sh "${codePath}" 2>/dev/null | cut -f1`;
							try {
								const { stdout: sizeOutput } = await execAsync(sizeCmd);
								const rawSize = sizeOutput.trim();
								size = rawSize || 'Unknown';
							} catch (sizeError) {
								// Size calculation failed, keep as 'Unknown'
							}
						}
						
						return {
							packageName,
							displayName: await generateDisplayName(packageName),
							type: 'user',
							size,
							installDate,
							lastUpdate,
							versionName: versionNameMatch ? versionNameMatch[1] : 'Unknown',
							versionCode: versionCodeMatch ? parseInt(versionCodeMatch[1]) : 0,
							category: getAppCategory(packageName),
							detailsFetched: true,
							cachedAt: Date.now()
						};
					} catch (error) {
						return {
							packageName,
							displayName: await generateDisplayName(packageName),
							type: 'user',
							size: 'Unknown',
							installDate: 'Unknown',
							lastUpdate: 'Unknown',
							versionName: 'Unknown',
							versionCode: 0,
							category: 'Other',
							error: error.message,
							detailsFetched: false,
							cachedAt: Date.now()
						};
					}
				})
			);
			
			// Add batch results to main array
			appsWithDetails.push(...batchResults);
			
			const batchTime = Date.now() - batchStartTime;
			log(`[BATCH-PROCESS] Batch ${Math.floor(i/BATCH_SIZE) + 1} completed in ${batchTime}ms (${appsWithDetails.length}/${userAppsList.length} total)`);
		}
		
		// Save to cache for future bulk loads
		cache = initCache(deviceSerial);
		appsWithDetails.forEach(app => {
			cache.apps[app.packageName] = app;
		});
		saveCache(cache);
		
		return json({
			success: true,
			deviceSerial,
			totalUserApps: userAppsList.length,
			totalSystemApps: 0, // We only fetch user apps for this endpoint
			apps: appsWithDetails,
			cached: false,
			batchProcessed: true,
			batchSize: BATCH_SIZE,
			timestamp: new Date().toISOString()
		});
		
	} catch (error) {
		return json({
			success: false,
			error: error.message,
			deviceSerial: 'unknown',
			apps: [],
			timestamp: new Date().toISOString()
		}, { status: 500 });
	}
}

// generateDisplayName function moved to $lib/app-names.js for pure AAPT integration

/**
 * Categorize app based on package name patterns
 * @param {string} packageName - Android package name
 * @returns {string} App category
 */
function getAppCategory(packageName) {
	const name = packageName.toLowerCase();
	
	if (name.includes('social') || name.includes('facebook') || name.includes('instagram') || name.includes('twitter')) {
		return 'Social';
	}
	if (name.includes('game') || name.includes('play') || name.includes('arcade')) {
		return 'Games';
	}
	if (name.includes('music') || name.includes('spotify') || name.includes('youtube')) {
		return 'Entertainment';
	}
	if (name.includes('bank') || name.includes('pay') || name.includes('wallet')) {
		return 'Finance';
	}
	if (name.includes('office') || name.includes('docs') || name.includes('pdf')) {
		return 'Productivity';
	}
	if (name.includes('camera') || name.includes('photo') || name.includes('gallery')) {
		return 'Photo';
	}
	
	return 'Other';
}
