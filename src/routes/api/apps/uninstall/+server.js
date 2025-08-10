import { json } from '@sveltejs/kit';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

/**
 * Uninstall selected apps from Android device via ADB
 * @param {Request} request - HTTP request with app list to uninstall
 * @returns {Promise<Response>} JSON response with uninstall results
 */
export async function POST({ request }) {
	try {
		const { packageNames } = await request.json();
		const deviceSerial = 'RFCW708JTVX';
		
		if (!packageNames || !Array.isArray(packageNames)) {
			return json({
				success: false,
				error: 'packageNames array is required',
				results: []
			}, { status: 400 });
		}
		
		// Process each app uninstall
		const results = await Promise.all(
			packageNames.map(async (packageName) => {
				try {
					// Safety check - don't uninstall system apps or critical packages
					if (isSystemApp(packageName)) {
						return {
							packageName,
							success: false,
							error: 'Cannot uninstall system app for safety',
							skipped: true
						};
					}
					
					// Execute uninstall command
					const uninstallCmd = `adb -s ${deviceSerial} shell pm uninstall --user 0 ${packageName}`;
					const { stdout, stderr } = await execAsync(uninstallCmd);
					
					// Check if uninstall was successful
					const success = stdout.includes('Success') || !stderr;
					
					return {
						packageName,
						success,
						output: stdout.trim(),
						error: stderr || null,
						timestamp: new Date().toISOString()
					};
					
				} catch (error) {
					return {
						packageName,
						success: false,
						error: error.message,
						timestamp: new Date().toISOString()
					};
				}
			})
		);
		
		const successCount = results.filter(r => r.success).length;
		const failureCount = results.filter(r => !r.success).length;
		
		return json({
			success: true,
			deviceSerial,
			totalRequested: packageNames.length,
			successCount,
			failureCount,
			results,
			timestamp: new Date().toISOString()
		});
		
	} catch (error) {
		return json({
			success: false,
			error: error.message,
			results: [],
			timestamp: new Date().toISOString()
		}, { status: 500 });
	}
}

/**
 * Check if package is a critical system app that shouldn't be uninstalled
 * @param {string} packageName - Android package name
 * @returns {boolean} True if system app
 */
function isSystemApp(packageName) {
	const systemPackages = [
		'com.android.settings',
		'com.android.systemui',
		'com.samsung.android.launcher',
		'com.android.vending', // Google Play Store
		'com.google.android.gms', // Google Play Services
		'com.samsung.android.dialer',
		'com.samsung.android.messaging',
		'com.android.contacts',
		'com.android.camera2',
		'android.auto_generated_rro_vendor__',
		'android.auto_generated_rro_product__'
	];
	
	// Check exact matches and patterns
	return systemPackages.some(sysPackage => 
		packageName === sysPackage || 
		packageName.startsWith('com.android.') ||
		packageName.startsWith('com.samsung.android.') ||
		packageName.includes('systemui') ||
		packageName.includes('launcher')
	);
}
