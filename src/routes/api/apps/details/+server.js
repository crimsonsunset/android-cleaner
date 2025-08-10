import { json } from '@sveltejs/kit';
import { exec } from 'child_process';
import { promisify } from 'util';
import { loadCache, saveCache, getCachedApp, setCachedApp } from '../../../lib/cache.js';

const execAsync = promisify(exec);

// Simple console logging for debugging
function log(message, data = '') {
	console.log(`[APP-DETAILS] ${message}`, data);
}

/**
 * Get detailed information for a specific app using dumpsys
 * @returns {Promise<Response>} JSON response with detailed app info
 */
export async function GET({ url }) {
	const packageName = url.searchParams.get('package');
	
	if (!packageName) {
		return json({ success: false, error: 'Package name is required' });
	}
	
	log(`Getting details for package: ${packageName}`);
	
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

		// Check cache first
		const cache = loadCache();
		const cachedApp = getCachedApp(cache, packageName);
		
		if (cachedApp && cache.deviceSerial === deviceSerial) {
			log(`Using cached data for ${packageName}`);
			return json({
				success: true,
				app: cachedApp,
				cached: true,
				timestamp: new Date().toISOString()
			});
		}
		
		// Get detailed app info using dumpsys
		const dumpsysCmd = `adb -s ${deviceSerial} shell dumpsys package ${packageName}`;
		const dumpsysResult = await execAsync(dumpsysCmd, { timeout: 5000 });
		
		// Parse real app name from applicationLabel
		let displayName = packageName.split('.').pop() || packageName;
		const labelMatch = dumpsysResult.stdout.match(/applicationLabel=([^\n\r]+)/);
		if (labelMatch && labelMatch[1]) {
			displayName = labelMatch[1].trim();
		}
		
		// Parse install date from firstInstallTime
		let installDate = 'Unknown';
		const installMatch = dumpsysResult.stdout.match(/firstInstallTime=([^\n\r]+)/);
		if (installMatch && installMatch[1]) {
			try {
				const timestamp = parseInt(installMatch[1].trim());
				if (!isNaN(timestamp)) {
					installDate = new Date(timestamp).toISOString().split('T')[0];
				}
			} catch (dateErr) {
				log(`Date parsing failed for ${packageName}:`, dateErr.message);
			}
		}
		
		// Get app size
		let size = 'Unknown';
		try {
			const sizeCmd = `adb -s ${deviceSerial} shell du -sh /data/app/${packageName}* 2>/dev/null`;
			const sizeResult = await execAsync(sizeCmd, { timeout: 3000 });
			const sizeMatch = sizeResult.stdout.trim().split('\t')[0];
			if (sizeMatch) {
				size = sizeMatch;
			}
		} catch (sizeErr) {
			// Try alternative size command
			try {
				const altSizeCmd = `adb -s ${deviceSerial} shell pm path ${packageName}`;
				const pathResult = await execAsync(altSizeCmd, { timeout: 3000 });
				if (pathResult.stdout.includes('package:')) {
					size = 'Installed';
				}
			} catch (altErr) {
				log(`Size detection failed for ${packageName}:`, altErr.message);
			}
		}
		
		// Intelligent categorization based on package name and permissions
		let category = 'Other';
		const packageLower = packageName.toLowerCase();
		const dumpsysLower = dumpsysResult.stdout.toLowerCase();
		
		if (packageLower.includes('social') || packageLower.includes('facebook') || 
			packageLower.includes('twitter') || packageLower.includes('instagram') ||
			packageLower.includes('snapchat') || packageLower.includes('tiktok')) {
			category = 'Social';
		} else if (packageLower.includes('game') || packageLower.includes('play') && packageLower.includes('games')) {
			category = 'Games';
		} else if (packageLower.includes('music') || packageLower.includes('video') || 
				   packageLower.includes('spotify') || packageLower.includes('youtube') ||
				   packageLower.includes('netflix') || packageLower.includes('hulu')) {
			category = 'Entertainment';
		} else if (packageLower.includes('bank') || packageLower.includes('pay') || 
				   packageLower.includes('wallet') || packageLower.includes('chase') ||
				   packageLower.includes('venmo') || packageLower.includes('zelle')) {
			category = 'Finance';
		} else if (packageLower.includes('office') || packageLower.includes('docs') || 
				   packageLower.includes('sheets') || packageLower.includes('slack') ||
				   packageLower.includes('teams') || packageLower.includes('zoom')) {
			category = 'Productivity';
		} else if (packageLower.includes('camera') || packageLower.includes('photo') || 
				   packageLower.includes('gallery') || packageLower.includes('image')) {
			category = 'Photo';
		}
		
		const appInfo = {
			packageName,
			displayName: displayName.charAt(0).toUpperCase() + displayName.slice(1),
			type: 'user',
			size,
			installDate,
			category
		};
		
		// Cache the result
		const cache = loadCache();
		if (cache.deviceSerial !== deviceSerial) {
			// Reset cache for new device
			cache.apps = {};
			cache.deviceSerial = deviceSerial;
		}
		setCachedApp(cache, packageName, appInfo);
		cache.lastUpdated = Date.now();
		saveCache(cache);
		
		log(`Successfully retrieved and cached details for ${packageName}:`, appInfo.displayName);
		
		return json({
			success: true,
			app: appInfo,
			cached: false,
			timestamp: new Date().toISOString()
		});
		
	} catch (err) {
		log(`Failed to get details for ${packageName}:`, err.message);
		
		// Return basic fallback info (don't cache failures)
		const fallbackApp = {
			packageName,
			displayName: packageName.split('.').pop()?.charAt(0).toUpperCase() + packageName.split('.').pop()?.slice(1) || packageName,
			type: 'user',
			size: 'Unknown',
			installDate: 'Unknown',
			category: 'Other'
		};
		
		return json({
			success: true,
			app: fallbackApp,
			cached: false,
			timestamp: new Date().toISOString()
		});
	}
}
