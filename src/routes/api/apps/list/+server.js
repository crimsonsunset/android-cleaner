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
		
		// Cache miss or invalid - return package list for frontend-controlled batching
		log(`[BULK-FRESH] Cache miss, returning package list for frontend batch processing`);
		
		// Get user-installed apps (non-system)
		const userAppsCmd = `adb -s ${deviceSerial} shell pm list packages -3`;
		const { stdout: userApps } = await execAsync(userAppsCmd);
		
		// Parse app lists
		const userAppsList = userApps
			.split('\n')
			.filter(line => line.startsWith('package:'))
			.map(line => line.replace('package:', '').trim())
			.filter(Boolean);
		
		return json({
			success: true,
			deviceSerial,
			totalUserApps: userAppsList.length,
			totalSystemApps: 0,
			packageList: userAppsList, // Send package list for frontend to batch
			apps: [], // No apps processed yet
			cached: false,
			requiresBatching: true, // Signal frontend to use batch processing
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

// Category logic removed per user request
