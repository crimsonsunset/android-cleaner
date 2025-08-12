import { json } from '@sveltejs/kit';
import { exec } from 'child_process';
import { promisify } from 'util';
import { generateDisplayName } from '$lib/app-names.js';
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
		const timeStampMatch = dumpsysOutput.match(/timeStamp=([^\n]+)/);
		const versionNameMatch = dumpsysOutput.match(/versionName=([^\s]+)/);
		const versionCodeMatch = dumpsysOutput.match(/versionCode=(\d+)/);
		const codePathMatch = dumpsysOutput.match(/codePath=([^\n]+)/);
		
		// Parse additional useful information
		const targetSdkMatch = dumpsysOutput.match(/targetSdk=(\d+)/);
		const installerMatch = dumpsysOutput.match(/installerPackageName=([^\n\s]+)/);
		const enabledMatch = dumpsysOutput.match(/enabled=(\d+)/);
		const flagsMatch = dumpsysOutput.match(/flags=\[\s*([^\]]+)\s*\]/);
		const dataDirectoryMatch = dumpsysOutput.match(/dataDir=([^\n\s]+)/);
		
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

		// Parse last used time (timeStamp field)
		let lastUsed = 'Unknown';
		if (timeStampMatch) {
			const dateStr = timeStampMatch[1].trim();
			if (/^\d+$/.test(dateStr)) {
				// Unix timestamp
				lastUsed = new Date(parseInt(dateStr)).toISOString().split('T')[0];
			} else {
				// Formatted date (YYYY-MM-DD HH:MM:SS)
				const parsed = new Date(dateStr);
				lastUsed = !isNaN(parsed.getTime()) ? parsed.toISOString().split('T')[0] : 'Unknown';
			}
		}
		
		// Parse additional fields
		const targetSdk = targetSdkMatch ? parseInt(targetSdkMatch[1]) : null;
		
		// Parse installer package name and make it human-readable
		let installSource = 'Unknown';
		if (installerMatch) {
			const installer = installerMatch[1];
			switch (installer) {
				case 'com.android.vending':
					installSource = 'Play Store';
					break;
				case 'com.sec.android.app.samsungapps':
					installSource = 'Samsung Store';
					break;
				case 'com.amazon.venezia':
					installSource = 'Amazon Store';
					break;
				case 'null':
					installSource = 'Sideloaded';
					break;
				default:
					installSource = installer.includes('.') ? installer.split('.').pop() : installer;
			}
		}
		
		// Parse enabled status
		const isEnabled = enabledMatch ? enabledMatch[1] === '0' : true; // 0 = enabled, higher = disabled
		
		// Parse app flags
		let appFlags = [];
		if (flagsMatch) {
			appFlags = flagsMatch[1].split(/\s+/).filter(flag => flag.length > 0);
		}
		
		// Get data directory size if available
		let dataSize = 'Unknown';
		if (dataDirectoryMatch) {
			const dataDir = dataDirectoryMatch[1].trim();
			const dataSizeCmd = `adb -s ${deviceSerial} shell du -sh "${dataDir}" 2>/dev/null | cut -f1`;
			try {
				const { stdout: dataSizeOutput } = await execAsync(dataSizeCmd);
				const rawDataSize = dataSizeOutput.trim();
				dataSize = rawDataSize || 'Unknown';
			} catch (dataSizeError) {
				console.warn(`Failed to get data size for ${packageName}:`, dataSizeError.message);
			}
		}

		// Generate display name
		const displayName = await generateDisplayName(packageName);
		
		return {
			packageName,
			displayName,
			type: isUserApp ? 'user' : 'system',
			size: size === '0K' ? 'Unknown' : size,
			installDate,
			lastUpdate,
			lastUsed,
			versionName: versionNameMatch ? versionNameMatch[1] : 'Unknown',
			versionCode: versionCodeMatch ? parseInt(versionCodeMatch[1]) : 0,
			targetSdk,
			installSource,
			isEnabled,
			appFlags: appFlags.slice(0, 3), // Limit to top 3 flags to keep data manageable
			dataSize,
			detailsFetched: true
		};
		
	} catch (error) {
		console.warn(`Failed to get details for ${packageName}:`, error.message);
		
		// Return basic info if detailed fetch fails
		return {
			packageName,
			displayName: await generateDisplayName(packageName),
			type: 'unknown',
			size: 'Unknown',
			installDate: 'Unknown',
			lastUpdate: 'Unknown',
			lastUsed: 'Unknown',
			versionName: 'Unknown',
			versionCode: 0,
			targetSdk: null,
			installSource: 'Unknown',
			isEnabled: true,
			appFlags: [],
			dataSize: 'Unknown',
			error: error.message,
			detailsFetched: false
		};
	}
}

// Category logic removed per user request
