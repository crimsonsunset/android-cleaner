import { json } from '@sveltejs/kit';
import { exec } from 'child_process';
import { promisify } from 'util';
import { loadCache, saveCache, isCacheValid, getCachedApp, setCachedApp, initCache } from '$lib/cache.js';

const execAsync = promisify(exec);

/**
 * Get detailed information for a specific app package
 * @returns {Promise<Response>} JSON response with app details
 */
export async function GET({ url }) {
	const packageName = url.searchParams.get('package');
	
	if (!packageName) {
		return json({
			success: false,
			error: 'Package name is required',
			app: null
		}, { status: 400 });
	}
	
	try {
		// Get connected devices and prefer Samsung Fold 5
		const devicesResult = await execAsync('adb devices');
		const deviceLines = devicesResult.stdout.split('\n').filter(line => line.includes('\tdevice'));
		
		if (deviceLines.length === 0) {
			return json({
				success: false,
				error: 'No devices connected',
				app: null
			});
		}
		
		// Prefer Samsung Fold 5 if available, otherwise use first device
		const samsungFold5 = 'RFCW708JTVX';
		let deviceSerial = deviceLines.find(line => line.includes(samsungFold5))?.split('\t')[0];
		
		if (!deviceSerial) {
			deviceSerial = deviceLines[0].split('\t')[0];
		}
		
		// Load cache and check if we have fresh data for this app
		let cache = loadCache();
		
		// Initialize cache if empty or wrong device
		if (!isCacheValid(cache, deviceSerial)) {
			cache = initCache(deviceSerial);
		}
		
		// Check if app is in cache
		const cachedApp = getCachedApp(cache, packageName);
		if (cachedApp) {
			return json({
				success: true,
				app: cachedApp,
				cached: true,
				deviceSerial,
				timestamp: new Date().toISOString()
			});
		}
		
		// Get fresh app details from device
		const appDetails = await getAppDetails(deviceSerial, packageName);
		
		// Cache the result
		setCachedApp(cache, packageName, appDetails);
		saveCache(cache);
		
		return json({
			success: true,
			app: appDetails,
			cached: false,
			deviceSerial,
			timestamp: new Date().toISOString()
		});
		
	} catch (error) {
		return json({
			success: false,
			error: error.message,
			app: null,
			deviceSerial: 'unknown',
			timestamp: new Date().toISOString()
		}, { status: 500 });
	}
}

/**
 * Get detailed information for a specific app package
 * @param {string} deviceSerial - Device serial number
 * @param {string} packageName - Package name to get details for
 * @returns {Object} App details
 */
async function getAppDetails(deviceSerial, packageName) {
	try {
		// Get app info using dumpsys
		const dumpsysCmd = `adb -s ${deviceSerial} shell dumpsys package ${packageName}`;
		const { stdout: dumpsysOutput } = await execAsync(dumpsysCmd);
		
		// Parse dumpsys output for key information
		const firstInstallMatch = dumpsysOutput.match(/firstInstallTime=([^\n]+)/);
		const lastUpdateMatch = dumpsysOutput.match(/lastUpdateTime=([^\n]+)/);
		const versionNameMatch = dumpsysOutput.match(/versionName=([^\s]+)/);
		const versionCodeMatch = dumpsysOutput.match(/versionCode=(\d+)/);
		const codePathMatch = dumpsysOutput.match(/codePath=([^\n]+)/);
		
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
				console.warn(`Failed to get size for ${packageName}:`, sizeError.message);
			}
		}
		
		// Try to get real app name from package manager
		const nameCmd = `adb -s ${deviceSerial} shell pm list packages -f | grep ${packageName}`;
		const { stdout: nameOutput } = await execAsync(nameCmd).catch(() => ({ stdout: '' }));
		
		// Check if it's a user app or system app
		const userAppCmd = `adb -s ${deviceSerial} shell pm list packages -3 | grep ${packageName}`;
		const isUserApp = await execAsync(userAppCmd).then(() => true).catch(() => false);
		
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
		
		// Generate display name
		const displayName = generateDisplayName(packageName);
		
		return {
			packageName,
			displayName,
			type: isUserApp ? 'user' : 'system',
			size: size === '0K' ? 'Unknown' : size,
			installDate,
			lastUpdate,
			versionName: versionNameMatch ? versionNameMatch[1] : 'Unknown',
			versionCode: versionCodeMatch ? parseInt(versionCodeMatch[1]) : 0,
			category: getAppCategory(packageName),
			detailsFetched: true
		};
		
	} catch (error) {
		console.warn(`Failed to get details for ${packageName}:`, error.message);
		
		// Return basic info if detailed fetch fails
		return {
			packageName,
			displayName: generateDisplayName(packageName),
			type: 'unknown',
			size: 'Unknown',
			installDate: 'Unknown',
			lastUpdate: 'Unknown',
			versionName: 'Unknown',
			versionCode: 0,
			category: 'Other',
			error: error.message,
			detailsFetched: false
		};
	}
}

/**
 * Generate human-readable display name from package name
 * @param {string} packageName - Android package name
 * @returns {string} Display name
 */
function generateDisplayName(packageName) {
	// Known app mappings
	const knownApps = {
		'com.spotify.music': 'Spotify',
		'com.facebook.katana': 'Facebook',
		'com.instagram.android': 'Instagram',
		'com.whatsapp': 'WhatsApp',
		'com.google.android.youtube': 'YouTube',
		'com.twitter.android': 'Twitter',
		'com.samsung.android.messaging': 'Samsung Messages',
		'com.samsung.android.contacts': 'Samsung Contacts',
		'com.android.chrome': 'Chrome',
		'com.google.android.gm': 'Gmail',
		'com.samsung.android.gallery3d': 'Samsung Gallery',
		'com.google.android.apps.photos': 'Google Photos',
		'com.netflix.mediaclient': 'Netflix',
		'com.amazon.mShop.android.shopping': 'Amazon Shopping',
		'com.paypal.android.p2pmobile': 'PayPal',
		'com.uber.app': 'Uber',
		'com.lyft.android': 'Lyft',
		'com.discord': 'Discord',
		'com.slack': 'Slack',
		'com.microsoft.teams': 'Microsoft Teams'
	};
	
	if (knownApps[packageName]) {
		return knownApps[packageName];
	}
	
	// Extract meaningful name from package
	const parts = packageName.split('.');
	const lastPart = parts[parts.length - 1];
	
	// Capitalize and clean up
	return lastPart.charAt(0).toUpperCase() + lastPart.slice(1).replace(/[_-]/g, ' ');
}

/**
 * Categorize app based on package name patterns
 * @param {string} packageName - Android package name
 * @returns {string} App category
 */
function getAppCategory(packageName) {
	const name = packageName.toLowerCase();
	
	// Social apps
	if (name.includes('social') || name.includes('facebook') || name.includes('instagram') || 
		name.includes('twitter') || name.includes('discord') || name.includes('slack') ||
		name.includes('whatsapp') || name.includes('telegram') || name.includes('snapchat')) {
		return 'Social';
	}
	
	// Games
	if (name.includes('game') || name.includes('play') || name.includes('arcade') ||
		name.includes('puzzle') || name.includes('casino') || name.includes('racing')) {
		return 'Games';
	}
	
	// Entertainment
	if (name.includes('music') || name.includes('spotify') || name.includes('youtube') ||
		name.includes('netflix') || name.includes('video') || name.includes('media') ||
		name.includes('stream') || name.includes('podcast')) {
		return 'Entertainment';
	}
	
	// Finance
	if (name.includes('bank') || name.includes('pay') || name.includes('wallet') ||
		name.includes('finance') || name.includes('invest') || name.includes('credit')) {
		return 'Finance';
	}
	
	// Productivity
	if (name.includes('office') || name.includes('docs') || name.includes('pdf') ||
		name.includes('note') || name.includes('calendar') || name.includes('email') ||
		name.includes('microsoft') || name.includes('google')) {
		return 'Productivity';
	}
	
	// Photo & Camera
	if (name.includes('camera') || name.includes('photo') || name.includes('gallery') ||
		name.includes('image') || name.includes('edit')) {
		return 'Photo';
	}
	
	return 'Other';
}
