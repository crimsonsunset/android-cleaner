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
	// Try multiple possible paths for AAPT binary
	const possiblePaths = [
		'./tools/sdk/build-tools/34.0.0/aapt',           // Development
		'./macos/tools/sdk/build-tools/34.0.0/aapt',     // Compiled dist structure
		'../tools/sdk/build-tools/34.0.0/aapt',          // Alternative relative path
		'tools/sdk/build-tools/34.0.0/aapt'              // Without leading ./
	];
	
	let aaptPath = null;
	for (const path of possiblePaths) {
		if (fs.existsSync(path)) {
			aaptPath = path;
			console.log(`[AAPT] Found AAPT binary at: ${path}`);
			break;
		}
	}
	
	// Require AAPT - fail if not available
	if (!aaptPath) {
		console.warn(`[AAPT] AAPT binary not found in any of the expected locations: ${possiblePaths.join(', ')}`);
		return null;
	}
	
	let tempApkPath = null;
	
	try {
		// Get APK path from device
		const { stdout: pathOutput } = await execAsync(`adb -s RFCW708JTVX shell pm path ${packageName}`);
		const apkPath = pathOutput.split('\n')[0].replace('package:', '').trim();
		
		if (!apkPath) {
			return null;
		}
		
		// Pull APK from device
		tempApkPath = `temp_${packageName.replace(/\./g, '_')}.apk`;
		await execAsync(`adb -s RFCW708JTVX pull "${apkPath}" ${tempApkPath}`);
		
		// Extract app name using AAPT
		const { stdout: aaptOutput } = await execAsync(`${aaptPath} dump badging ${tempApkPath} | grep application-label`);
		const appName = aaptOutput.match(/application-label:'([^']+)'/)?.[1];
		
		return appName || null;
		
	} catch (error) {
		console.warn(`[AAPT] Failed to extract app name for ${packageName}: ${error.message}`);
		return null;
	} finally {
		// Always cleanup temp APK file, even on errors
		if (tempApkPath && fs.existsSync(tempApkPath)) {
			try {
				fs.unlinkSync(tempApkPath);
			} catch (cleanupError) {
				console.warn(`[AAPT] Failed to cleanup temp file ${tempApkPath}: ${cleanupError.message}`);
			}
		}
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
