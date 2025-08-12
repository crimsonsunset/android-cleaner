/**
 * Smart Android Device Name Resolution
 * Fetches live device database from DeviceMarketingNames GitHub repository
 * Provides fallback hierarchy for unknown devices
 */

// Cache configuration
let deviceDBCache = null;
let lastFetch = 0;
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Fetch live device database from GitHub
 * @returns {Promise<Map<string, string>>} Map of model -> marketing name
 */
async function fetchDeviceDatabase() {
	const url = 'https://raw.githubusercontent.com/Boehrsi/DeviceMarketingNames/refs/heads/main/DeviceMarketingNames/src/main/java/de/boehrsi/devicemarketingnames/data/DeviceIdentifiers.kt';
	
	try {
		console.log('[DEVICE-DB] Fetching live device database from GitHub...');
		const response = await fetch(url);
		
		if (!response.ok) {
			throw new Error(`GitHub fetch failed: ${response.status}`);
		}
		
		const kotlinCode = await response.text();
		
		// Parse Kotlin syntax: put("SM-F946U1", "Galaxy Z Fold5")
		const deviceMap = new Map();
		const putRegex = /put\("([^"]+)",\s*"([^"]+)"\)/g;
		
		let match;
		let deviceCount = 0;
		while ((match = putRegex.exec(kotlinCode)) !== null) {
			const [, model, marketingName] = match;
			deviceMap.set(model, marketingName);
			deviceCount++;
		}
		
		console.log(`[DEVICE-DB] Successfully parsed ${deviceCount} devices from GitHub`);
		return deviceMap;
		
	} catch (error) {
		console.warn('[DEVICE-DB] Failed to fetch device database:', error.message);
		return new Map(); // Return empty map on failure
	}
}

/**
 * Get cached device database with TTL
 * @returns {Promise<Map<string, string>>} Cached or fresh device database
 */
async function getCachedDeviceDB() {
	const now = Date.now();
	
	// Check if cache is valid
	if (!deviceDBCache || (now - lastFetch) > CACHE_TTL) {
		console.log('[DEVICE-DB] Cache expired, fetching fresh data...');
		deviceDBCache = await fetchDeviceDatabase();
		lastFetch = now;
	} else {
		console.log('[DEVICE-DB] Using cached device database');
	}
	
	return deviceDBCache;
}

/**
 * Smart device name resolution with fallback hierarchy
 * @param {string} model - Device model (e.g., "SM-F946U1")
 * @param {string} brand - Device brand (e.g., "samsung") 
 * @param {string} marketName - Marketing name from getprop (often empty)
 * @param {string} manufacturer - Manufacturer name
 * @param {string} serial - Device serial number (fallback for pattern detection)
 * @returns {Promise<string>} Human-readable device name
 */
export async function getSmartDeviceName(model, brand, marketName, manufacturer, serial) {
	try {
		// Try marketing name from device first (best case)
		if (marketName && marketName.trim() && marketName !== 'unknown') {
			console.log(`[DEVICE-DB] Using device marketing name: ${marketName}`);
			return marketName.trim();
		}
		
		// Try database lookup
		if (model && model.trim()) {
			const deviceDB = await getCachedDeviceDB();
			
			// Try exact match first
			let dbResult = deviceDB.get(model);
			if (dbResult) {
				console.log(`[DEVICE-DB] Found exact match: ${model} -> ${dbResult}`);
				return dbResult;
			}
			
			// Try case variations
			dbResult = deviceDB.get(model.toUpperCase());
			if (dbResult) {
				console.log(`[DEVICE-DB] Found uppercase match: ${model} -> ${dbResult}`);
				return dbResult;
			}
			
			dbResult = deviceDB.get(model.toLowerCase());
			if (dbResult) {
				console.log(`[DEVICE-DB] Found lowercase match: ${model} -> ${dbResult}`);
				return dbResult;
			}
		}
		
		// Try serial-based pattern detection (for devices that don't support getprop)
		if (serial) {
			const serialPattern = detectDeviceBySerial(serial);
			if (serialPattern) {
				console.log(`[DEVICE-DB] Detected by serial pattern: ${serial} -> ${serialPattern}`);
				return serialPattern;
			}
		}
		
		// Smart fallback hierarchy
		const fallbackName = createFallbackName(model, brand, manufacturer);
		console.log(`[DEVICE-DB] Using fallback name: ${fallbackName}`);
		return fallbackName;
		
	} catch (error) {
		console.warn('[DEVICE-DB] Error in smart device name resolution:', error.message);
		return createFallbackName(model, brand, manufacturer);
	}
}

/**
 * Detect device by serial number patterns
 * @param {string} serial - Device serial number
 * @returns {string|null} Device name or null if no pattern matches
 */
function detectDeviceBySerial(serial) {
	if (!serial) return null;
	
	// Known serial patterns
	const patterns = {
		'^8557R58QQS16': 'Spotify Car Thing',
		'^RFCW708JTVX': 'Samsung Galaxy Z Fold5',
		// Add more patterns as needed
	};
	
	for (const [pattern, deviceName] of Object.entries(patterns)) {
		if (new RegExp(pattern).test(serial)) {
			return deviceName;
		}
	}
	
	return null;
}

/**
 * Create fallback device name from available properties
 * @param {string} model - Device model
 * @param {string} brand - Device brand  
 * @param {string} manufacturer - Device manufacturer
 * @returns {string} Fallback device name
 */
function createFallbackName(model, brand, manufacturer) {
	// Clean and normalize inputs
	const cleanModel = model?.trim() || '';
	const cleanBrand = brand?.trim() || '';
	const cleanManufacturer = manufacturer?.trim() || '';
	
	// Priority: brand + model, manufacturer + model, model only, or serial
	if (cleanBrand && cleanModel) {
		// Avoid duplication: "Samsung SM-G950F" not "samsung samsung SM-G950F"
		if (cleanModel.toLowerCase().startsWith(cleanBrand.toLowerCase())) {
			return capitalize(cleanModel);
		}
		return `${capitalize(cleanBrand)} ${cleanModel}`;
	}
	
	if (cleanManufacturer && cleanModel) {
		if (cleanModel.toLowerCase().startsWith(cleanManufacturer.toLowerCase())) {
			return capitalize(cleanModel);
		}
		return `${capitalize(cleanManufacturer)} ${cleanModel}`;
	}
	
	if (cleanModel) {
		return cleanModel;
	}
	
	// Last resort
	return 'Unknown Device';
}

/**
 * Capitalize first letter of string
 * @param {string} str - String to capitalize
 * @returns {string} Capitalized string
 */
function capitalize(str) {
	if (!str || str.length === 0) return '';
	return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
}

/**
 * Clear device database cache (useful for testing)
 */
export function clearDeviceCache() {
	deviceDBCache = null;
	lastFetch = 0;
	console.log('[DEVICE-DB] Cache cleared');
}
