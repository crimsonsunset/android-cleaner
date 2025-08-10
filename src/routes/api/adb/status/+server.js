import { json } from '@sveltejs/kit';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

/**
 * Check ADB connection status and device availability
 * @returns {Promise<Response>} JSON response with connection status
 */
export async function GET() {
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
		
		// Check for Samsung Fold 5 specifically
		const targetSerial = 'RFCW708JTVX';
		const targetDevice = deviceLines.find(device => device.serial === targetSerial);
		
		// Get device info if connected
		let deviceInfo = null;
		if (targetDevice && targetDevice.status === 'device') {
			try {
				const modelCmd = `adb -s ${targetSerial} shell getprop ro.product.model`;
				const versionCmd = `adb -s ${targetSerial} shell getprop ro.build.version.release`;
				
				const { stdout: model } = await execAsync(modelCmd);
				const { stdout: androidVersion } = await execAsync(versionCmd);
				
				deviceInfo = {
					model: model.trim(),
					androidVersion: androidVersion.trim(),
					serial: targetSerial
				};
			} catch (error) {
				console.warn('Could not get device info:', error.message);
			}
		}
		
		return json({
			success: true,
			adbAvailable: true,
			targetDevice: targetSerial,
			deviceConnected: !!targetDevice,
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
