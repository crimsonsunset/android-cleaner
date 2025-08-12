import { json } from '@sveltejs/kit';
import { saveCache, initCache } from '$lib/cache.js';

/**
 * Save app data to cache
 * @returns {Promise<Response>} JSON response with save status
 */
export async function POST({ request }) {
	try {
		const { deviceSerial, apps } = await request.json();
		
		if (!deviceSerial || !apps || !Array.isArray(apps)) {
			return json({
				success: false,
				error: 'deviceSerial and apps array are required'
			}, { status: 400 });
		}
		
		// Create new cache with apps
		const cache = initCache(deviceSerial);
		apps.forEach(app => {
			cache.apps[app.packageName] = app;
		});
		
		// Save to disk
		saveCache(cache);
		
		console.log(`[CACHE-SAVE] Saved ${apps.length} apps to cache for device ${deviceSerial}`);
		
		return json({
			success: true,
			message: `Cached ${apps.length} apps`,
			deviceSerial,
			appCount: apps.length,
			timestamp: new Date().toISOString()
		});
		
	} catch (error) {
		console.error('[CACHE-SAVE] Failed to save cache:', error.message);
		
		return json({
			success: false,
			error: 'Failed to save cache',
			timestamp: new Date().toISOString()
		}, { status: 500 });
	}
}
