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
		
		// Parse device list
		const deviceLines = devicesOutput
			.split('\n')
			.filter(line => line.includes('\t'))
			.map(line => {
				const [serial, status] = line.split('\t');
				return { serial: serial.trim(), status: status.trim() };
			});
		
		// Prefer Samsung Fold 5 if available, otherwise use first device
		const samsungFold5 = 'RFCW708JTVX';
		let targetDevice = deviceLines.find(device => device.serial === samsungFold5);
		
		if (!targetDevice && deviceLines.length > 0) {
			// Fallback to first available device
			targetDevice = deviceLines[0];
		}
		
		// Get device info if connected
		let deviceInfo = null;
		if (targetDevice && targetDevice.status === 'device') {
			try {
				const propsCmd = `adb -s ${targetDevice.serial} shell "getprop ro.product.model && getprop ro.product.brand && getprop ro.product.name && getprop ro.product.marketname && getprop ro.build.version.release"`;
				const { stdout: propsOutput } = await execAsync(propsCmd);
				const [model, brand, productName, marketName, androidVersion] = propsOutput.trim().split('\n').map(line => line.trim());
				
				// Create human readable device name
				let displayName = model;
				
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
				}
				
				deviceInfo = {
					model: model,
					brand: brand,
					productName: productName,
					marketName: marketName,
					displayName: displayName,
					androidVersion: androidVersion,
					serial: targetDevice.serial
				};
			} catch (error) {
				console.warn('Could not get device info:', error.message);
			}
		}
		
		return json({
			success: true,
			adbAvailable: true,
			targetDevice: targetDevice?.serial || 'none',
			deviceConnected: !!targetDevice && targetDevice.status === 'device',
			deviceStatus: targetDevice?.status || 'not found',
			deviceInfo,
			allDevices: deviceLines,
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
