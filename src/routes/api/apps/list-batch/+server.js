import { json } from '@sveltejs/kit';
import { exec } from 'child_process';
import { promisify } from 'util';
import { loadCache, saveCache, isCacheValid, initCache } from '$lib/cache.js';
import { generateDisplayName } from '$lib/app-names.js';

const execAsync = promisify(exec);

// Simple console logging for debugging
function log(message, data = '') {
	console.log(`[ANDROID-BATCH-API] ${message}`, data);
}

/**
 * Process a batch of apps and return results
 * @returns {Promise<Response>} JSON response with batch results
 */
export async function POST({ request }) {
	try {
		const { packageNames, deviceSerial, batchNumber, totalBatches } = await request.json();
		
		if (!packageNames || !Array.isArray(packageNames)) {
			return json({
				success: false,
				error: 'packageNames array is required',
				apps: []
			}, { status: 400 });
		}
		
		log(`Processing batch ${batchNumber}/${totalBatches} with ${packageNames.length} apps`);
		const batchStartTime = Date.now();
		
		// Process all apps in this batch concurrently
		const appsWithDetails = await Promise.all(
			packageNames.map(async (packageName) => {
				try {
					// Get full dumpsys output for this package
					const dumpsysCmd = `adb -s ${deviceSerial} shell dumpsys package ${packageName}`;
					const { stdout: dumpsysOutput } = await execAsync(dumpsysCmd);
					
					// Parse dumpsys output for key information
					const firstInstallMatch = dumpsysOutput.match(/firstInstallTime=([^\n]+)/);
					const lastUpdateMatch = dumpsysOutput.match(/lastUpdateTime=([^\n]+)/);
					const versionNameMatch = dumpsysOutput.match(/versionName=([^\s]+)/);
					const versionCodeMatch = dumpsysOutput.match(/versionCode=(\d+)/);
					const codePathMatch = dumpsysOutput.match(/codePath=([^\n]+)/);
					
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
							// Size calculation failed, keep as 'Unknown'
						}
					}
					
					return {
						packageName,
						displayName: await generateDisplayName(packageName),
						type: 'user',
						size,
						installDate,
						lastUpdate,
						versionName: versionNameMatch ? versionNameMatch[1] : 'Unknown',
						versionCode: versionCodeMatch ? parseInt(versionCodeMatch[1]) : 0,
						detailsFetched: true,
						cachedAt: Date.now()
					};
				} catch (error) {
					return {
						packageName,
						displayName: await generateDisplayName(packageName),
						type: 'user',
						size: 'Unknown',
						installDate: 'Unknown',
						lastUpdate: 'Unknown',
						versionName: 'Unknown',
						versionCode: 0,
						error: error.message,
						detailsFetched: false,
						cachedAt: Date.now()
					};
				}
			})
		);
		
		const batchTime = Date.now() - batchStartTime;
		log(`Batch ${batchNumber}/${totalBatches} completed in ${batchTime}ms`);
		
		return json({
			success: true,
			apps: appsWithDetails,
			batchNumber,
			totalBatches,
			processingTime: batchTime,
			timestamp: new Date().toISOString()
		});
		
	} catch (error) {
		return json({
			success: false,
			error: error.message,
			apps: [],
			timestamp: new Date().toISOString()
		}, { status: 500 });
	}
}

// Category logic removed per user request
