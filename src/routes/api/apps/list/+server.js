import { json } from '@sveltejs/kit';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

// Simple console logging for debugging
function log(message, data = '') {
	console.log(`[ANDROID-API] ${message}`, data);
}

/**
 * Get list of all installed apps from Android device via ADB
 * @returns {Promise<Response>} JSON response with app list
 */
export async function GET() {
	log('Starting app list retrieval for Samsung Fold 5');
	try {
		// Check if device is connected (using Samsung Fold 5 serial from migration plan)
		const deviceSerial = 'RFCW708JTVX';
		
		// Get user-installed apps (non-system)
		const userAppsCmd = `adb -s ${deviceSerial} shell pm list packages -3`;
		const { stdout: userApps } = await execAsync(userAppsCmd);
		
		// Get system apps for comparison
		const systemAppsCmd = `adb -s ${deviceSerial} shell pm list packages -s`;
		const { stdout: systemApps } = await execAsync(systemAppsCmd);
		
		// Parse app lists
		const userAppsList = userApps
			.split('\n')
			.filter(line => line.startsWith('package:'))
			.map(line => line.replace('package:', '').trim())
			.filter(Boolean);
			
		const systemAppsList = systemApps
			.split('\n')
			.filter(line => line.startsWith('package:'))
			.map(line => line.replace('package:', '').trim())
			.filter(Boolean);
		
		// Get app details for user apps (real data)
		const appsWithDetails = await Promise.all(
			userAppsList.map(async (packageName) => {
				try {
					// Get app info and size
					const [infoCmd, sizeCmd] = [
						`adb -s ${deviceSerial} shell dumpsys package ${packageName} | grep -E "(firstInstallTime|lastUpdateTime)"`,
						`adb -s ${deviceSerial} shell du -sh /data/app/${packageName}* 2>/dev/null | head -1 || echo "0K"`
					];
					
					const [{ stdout: info }, { stdout: sizeInfo }] = await Promise.all([
						execAsync(infoCmd).catch(() => ({ stdout: '' })),
						execAsync(sizeCmd).catch(() => ({ stdout: '0K' }))
					]);
					
					// Parse install date
					const firstInstallMatch = info.match(/firstInstallTime=(.+)/);
					const installDate = firstInstallMatch 
						? new Date(parseInt(firstInstallMatch[1])).toISOString().split('T')[0]
						: 'Unknown';
					
					// Parse size
					const sizeMatch = sizeInfo.trim().split('\t')[0] || '0K';
					const size = sizeMatch === '0K' ? 'Unknown' : sizeMatch;
					
					// Generate display name from package
					const displayName = generateDisplayName(packageName);
					
					return {
						packageName,
						displayName,
						type: 'user',
						size,
						installDate,
						category: getAppCategory(packageName)
					};
				} catch (error) {
					return {
						packageName,
						displayName: generateDisplayName(packageName),
						type: 'user',
						size: 'Unknown',
						installDate: 'Unknown',
						category: 'Other',
						error: error.message
					};
				}
			})
		);
		
		return json({
			success: true,
			deviceSerial,
			totalUserApps: userAppsList.length,
			totalSystemApps: systemAppsList.length,
			apps: appsWithDetails,
			timestamp: new Date().toISOString()
		});
		
	} catch (error) {
		return json({
			success: false,
			error: error.message,
			deviceSerial: 'RFCW708JTVX',
			apps: [],
			timestamp: new Date().toISOString()
		}, { status: 500 });
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
		'com.samsung.android.gallery3d': 'Samsung Gallery'
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
