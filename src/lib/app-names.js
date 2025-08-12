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
	
	// Require AAPT - fail if not available
	if (!fs.existsSync(aaptPath)) {
		console.warn(`[AAPT] AAPT binary not found at ${aaptPath}. Run 'npm run setup-aapt' to install.`);
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
		console.warn(`[AAPT] Failed to extract app name for ${packageName}: ${error.message}`);
		return null;
	}
}

/**
 * Generate human-readable display name from package name using AAPT only
 * @param {string} packageName - Android package name
 * @returns {Promise<string>} Display name or package name if AAPT fails
 */
export async function generateDisplayName(packageName) {
	// AAPT-only extraction for maximum accuracy
	const realAppName = await extractRealAppName(packageName);
	if (realAppName) {
		return realAppName;
	}
	
	// If AAPT fails, return package name as-is for transparency
	console.warn(`[AAPT] Failed to extract app name for ${packageName}, using package name`);
	return packageName;
}

/**
 * Synchronous version - DEPRECATED, use async generateDisplayName instead
 * @param {string} packageName - Android package name
 * @returns {string} Package name as-is (AAPT requires async operation)
 */
export function generateDisplayNameSync(packageName) {
	console.warn('[AAPT] Sync function deprecated - AAPT requires async operation, returning package name');
	return packageName;
}
