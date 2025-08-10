import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';

const CACHE_FILE = join(process.cwd(), 'app-cache.json');
const CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 hours in milliseconds

/**
 * Load app cache from disk
 * @returns {Object} Cache object with apps and metadata
 */
export function loadCache() {
	try {
		if (!existsSync(CACHE_FILE)) {
			return { apps: {}, lastUpdated: 0, deviceSerial: null };
		}
		
		const cacheData = JSON.parse(readFileSync(CACHE_FILE, 'utf8'));
		return cacheData;
	} catch (error) {
		console.warn('Failed to load app cache:', error.message);
		return { apps: {}, lastUpdated: 0, deviceSerial: null };
	}
}

/**
 * Save app cache to disk
 * @param {Object} cache - Cache object to save
 */
export function saveCache(cache) {
	try {
		writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2));
		console.log(`[CACHE] Saved ${Object.keys(cache.apps).length} apps to cache`);
	} catch (error) {
		console.error('Failed to save app cache:', error.message);
	}
}

/**
 * Check if cache is valid for given device and timeframe
 * @param {Object} cache - Cache object
 * @param {string} deviceSerial - Current device serial
 * @returns {boolean} True if cache is valid
 */
export function isCacheValid(cache, deviceSerial) {
	if (!cache || !cache.lastUpdated || cache.deviceSerial !== deviceSerial) {
		return false;
	}
	
	const age = Date.now() - cache.lastUpdated;
	return age < CACHE_DURATION;
}

/**
 * Get app from cache
 * @param {Object} cache - Cache object
 * @param {string} packageName - Package name to lookup
 * @returns {Object|null} Cached app data or null
 */
export function getCachedApp(cache, packageName) {
	return cache.apps[packageName] || null;
}

/**
 * Add app to cache
 * @param {Object} cache - Cache object
 * @param {string} packageName - Package name
 * @param {Object} appData - App data to cache
 */
export function setCachedApp(cache, packageName, appData) {
	cache.apps[packageName] = {
		...appData,
		cachedAt: Date.now()
	};
}

/**
 * Initialize cache for device
 * @param {string} deviceSerial - Device serial number
 * @returns {Object} Initialized cache object
 */
export function initCache(deviceSerial) {
	return {
		apps: {},
		lastUpdated: Date.now(),
		deviceSerial: deviceSerial
	};
}
