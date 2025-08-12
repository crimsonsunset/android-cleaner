import { json } from '@sveltejs/kit';
import { exec } from 'child_process';
import { promisify } from 'util';
import { getSmartDeviceName } from '$lib/device-names.js';

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
					const propsCmd = `adb -s ${device.serial} shell "getprop ro.product.model && getprop ro.product.brand && getprop ro.product.name && getprop ro.product.marketname && getprop ro.product.manufacturer"`;
					const { stdout: propsOutput } = await execAsync(propsCmd);
					
					// Check if getprop failed (some devices don't support it)
					if (propsOutput.includes('not found') || propsOutput.includes('No such file')) {
						throw new Error('getprop not supported on this device');
					}
					
					const [model, brand, productName, marketName, manufacturer] = propsOutput.trim().split('\n').map(line => line.trim());
					
					// Use smart device name resolution
					const displayName = await getSmartDeviceName(model, brand, marketName, manufacturer, device.serial);
					
					return {
						...device,
						displayName,
						model,
						brand,
						productName,
						marketName,
						manufacturer
					};
				} catch (error) {
					console.warn(`Could not get device info for ${device.serial}:`, error.message);
					
					// Fallback to smart device name with serial-based detection
					const displayName = await getSmartDeviceName(null, null, null, null, device.serial);
					
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
					manufacturer: targetDevice.manufacturer,
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
