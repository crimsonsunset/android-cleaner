import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';

const execAsync = promisify(exec);

/**
 * Extract real app display name using AAPT (Android Asset Packaging Tool)
 * @param {string} packageName - Android package name
 * @returns {Promise<string|null>} Real app name or null if extraction fails
 */
async function extractRealAppName(packageName) {
	const aaptPath = './tools/sdk/build-tools/34.0.0/aapt';
	
	// Skip if AAPT not available
	if (!fs.existsSync(aaptPath)) {
		return null;
	}
	
	try {
		// Get APK path from device
		const { stdout: pathOutput } = await execAsync(`adb -s RFCW708JTVX shell pm path ${packageName}`);
		const apkPath = pathOutput.split('\n')[0].replace('package:', '').trim();
		
		if (!apkPath) {
			return null;
		}
		
		// Pull APK from device
		const tempApkPath = `temp_${packageName.replace(/\./g, '_')}.apk`;
		await execAsync(`adb -s RFCW708JTVX pull "${apkPath}" ${tempApkPath}`);
		
		// Extract app name using AAPT
		const { stdout: aaptOutput } = await execAsync(`${aaptPath} dump badging ${tempApkPath} | grep application-label`);
		const appName = aaptOutput.match(/application-label:'([^']+)'/)?.[1];
		
		// Cleanup temp APK
		fs.unlinkSync(tempApkPath);
		
		return appName || null;
		
	} catch (error) {
		// Silent fail - fallback to other methods
		return null;
	}
}

/**
 * Generate human-readable display name from package name with AAPT integration
 * @param {string} packageName - Android package name
 * @returns {Promise<string>} Display name
 */
export async function generateDisplayName(packageName) {
	// Step 1: Try to extract real app name using AAPT
	const realAppName = await extractRealAppName(packageName);
	if (realAppName) {
		return realAppName;
	}
	
	// Step 2: Known app mappings (fallback)
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
		'com.microsoft.teams': 'Microsoft Teams',
		'com.quanticapps.remotetvs': 'Remote TV'
	};
	
	if (knownApps[packageName]) {
		return knownApps[packageName];
	}
	
	// Step 3: Extract meaningful name from package (final fallback)
	const parts = packageName.split('.');
	const lastPart = parts[parts.length - 1];
	
	// Capitalize and clean up
	return lastPart.charAt(0).toUpperCase() + lastPart.slice(1).replace(/[_-]/g, ' ');
}

/**
 * Synchronous version for immediate fallback (legacy compatibility)
 * @param {string} packageName - Android package name
 * @returns {string} Display name
 */
export function generateDisplayNameSync(packageName) {
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
		'com.microsoft.teams': 'Microsoft Teams',
		'com.quanticapps.remotetvs': 'Remote TV'
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
