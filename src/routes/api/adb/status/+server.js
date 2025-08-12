import { json } from '@sveltejs/kit';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

/**
 * Check ADB connection status and device availability
 * @returns {Promise<Response>} JSON response with connection status
 */
export async function GET() {
	console.log('[ADB-STATUS] Checking device connection...');
	try {
		// Check if ADB is available
		const adbVersionCmd = 'adb version';
		await execAsync(adbVersionCmd);
		
		// List connected devices
		const devicesCmd = 'adb devices';
		const { stdout: devicesOutput } = await execAsync(devicesCmd);
		
		// Parse device list and get info for each device
		const deviceLines = devicesOutput
			.split('\n')
			.filter(line => line.includes('\t'))
			.map(line => {
				const [serial, status] = line.split('\t');
				return { serial: serial.trim(), status: status.trim() };
			});
		
		// Get detailed info for all connected devices
		const allDevicesWithInfo = await Promise.all(
			deviceLines.map(async (device) => {
				if (device.status !== 'device') {
					return { ...device, displayName: device.serial };
				}
				
				try {
					const propsCmd = `adb -s ${device.serial} shell "getprop ro.product.model && getprop ro.product.brand && getprop ro.product.name && getprop ro.product.marketname"`;
					const { stdout: propsOutput } = await execAsync(propsCmd);
					
					// Check if getprop failed (some devices don't support it)
					if (propsOutput.includes('not found') || propsOutput.includes('No such file')) {
						throw new Error('getprop not supported on this device');
					}
					
					const [model, brand, productName, marketName] = propsOutput.trim().split('\n').map(line => line.trim());
					
					// Create human readable device name
					let displayName = model || device.serial;
					
					// Try marketname first (most user-friendly)
					if (marketName && marketName !== '' && marketName !== 'unknown') {
						displayName = marketName;
					} else if (brand && brand.toLowerCase() === 'samsung') {
						// Special handling for Samsung devices
						if (model && model.includes('F946U')) {
							displayName = 'Samsung Galaxy Z Fold5';
						} else if (model && model.includes('F936U')) {
							displayName = 'Samsung Galaxy Z Fold4';
						} else if (model && model.includes('F926U')) {
							displayName = 'Samsung Galaxy Z Fold3';
						} else if (brand && productName) {
							displayName = `${brand} ${productName}`;
						}
					} else if (brand && productName) {
						displayName = `${brand} ${productName}`;
					} else if (model && model.includes('Car_Thing')) {
						displayName = 'Spotify Car Thing';
					}
					
					// Handle special device patterns by serial
					if (device.serial.startsWith('8557R58QQS16')) {
						displayName = 'Spotify Car Thing';
					}
					
					return {
						...device,
						displayName,
						model,
						brand,
						productName,
						marketName
					};
				} catch (error) {
					console.warn(`Could not get device info for ${device.serial}:`, error.message);
					
					// Try to identify device by serial number patterns
					let displayName = device.serial;
					if (device.serial.startsWith('8557R58QQS16')) {
						displayName = 'Spotify Car Thing';
					} else if (device.serial.startsWith('RFCW708JTVX')) {
						displayName = 'Samsung Galaxy Z Fold5';
					}
					
					return { ...device, displayName };
				}
			})
		);
		
		// Prefer Samsung Fold 5 if available, otherwise use first device
		const samsungFold5 = 'RFCW708JTVX';
		let targetDevice = allDevicesWithInfo.find(device => device.serial === samsungFold5);
		
		if (!targetDevice && allDevicesWithInfo.length > 0) {
			// Fallback to first available device
			targetDevice = allDevicesWithInfo[0];
		}
		
		// Get device info if connected (already have basic info, just need Android version)
		let deviceInfo = null;
		if (targetDevice && targetDevice.status === 'device') {
			try {
				const versionCmd = `adb -s ${targetDevice.serial} shell getprop ro.build.version.release`;
				const { stdout: androidVersion } = await execAsync(versionCmd);
				
				deviceInfo = {
					model: targetDevice.model,
					brand: targetDevice.brand,
					productName: targetDevice.productName,
					marketName: targetDevice.marketName,
					displayName: targetDevice.displayName,
					androidVersion: androidVersion.trim(),
					serial: targetDevice.serial
				};
			} catch (error) {
				console.warn('Could not get Android version:', error.message);
				deviceInfo = {
					displayName: targetDevice.displayName,
					serial: targetDevice.serial
				};
			}
		}
		
		return json({
			success: true,
			adbAvailable: true,
			targetDevice: targetDevice?.serial || 'none',
			deviceConnected: !!targetDevice && targetDevice.status === 'device',
			deviceStatus: targetDevice?.status || 'not found',
			deviceInfo,
			allDevices: allDevicesWithInfo,
			timestamp: new Date().toISOString()
		});
		
	} catch (error) {
		return json({
			success: false,
			adbAvailable: false,
			targetDevice: 'RFCW708JTVX',
			deviceConnected: false,
			deviceStatus: 'error',
			error: error.message,
			allDevices: [],
			timestamp: new Date().toISOString()
		}, { status: 500 });
	}
}
