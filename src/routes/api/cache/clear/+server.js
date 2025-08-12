import { json } from '@sveltejs/kit';
import { unlinkSync, existsSync } from 'fs';
import { join } from 'path';

const CACHE_FILE = join(process.cwd(), 'app-cache.json');

/**
 * Clear the app cache file
 * @returns {Promise<Response>} JSON response with clear status
 */
export async function POST() {
	try {
		if (existsSync(CACHE_FILE)) {
			unlinkSync(CACHE_FILE);
			console.log('[CACHE] Cache file cleared');
		}
		
		return json({
			success: true,
			message: 'Cache cleared successfully',
			timestamp: new Date().toISOString()
		});
	} catch (error) {
		console.error('[CACHE] Failed to clear cache:', error.message);
		
		return json({
			success: false,
			error: 'Failed to clear cache',
			timestamp: new Date().toISOString()
		});
	}
}

