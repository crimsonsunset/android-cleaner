import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';

const execAsync = promisify(exec);

async function quickTest() {
    console.log('🧪 Testing js-apk-parser');
    
    try {
        // Dynamic import
        const ApkParser = (await import('js-apk-parser')).default;
        console.log('✅ APK Parser loaded successfully');
        
        // Test a simple APK pull
        const packageName = 'com.spotify.music';
        const { stdout: pathOutput } = await execAsync(`adb -s RFCW708JTVX shell pm path ${packageName}`);
        const apkPath = pathOutput.split('\n')[0].replace('package:', '').trim();
        
        console.log(`📍 APK Path: ${apkPath}`);
        
        if (apkPath) {
            console.log('✅ Successfully got APK path from device');
            
            // Try to pull and parse
            const tempApkPath = './temp_spotify.apk';
            console.log('📥 Pulling APK...');
            await execAsync(`adb -s RFCW708JTVX pull "${apkPath}" "${tempApkPath}"`);
            
            console.log('🔍 Parsing APK...');
            
            // Read the file as buffer
            const apkBuffer = fs.readFileSync(tempApkPath);
            
            // Try different ways to parse
            console.log('Trying ApkParser constructor...');
            const parser = new ApkParser(apkBuffer);
            
            console.log('Available methods:', Object.getOwnPropertyNames(parser));
            console.log('Prototype methods:', Object.getOwnPropertyNames(Object.getPrototypeOf(parser)));
            
            // Cleanup
            fs.unlinkSync(tempApkPath);
            console.log('\n✅ Test completed successfully!');
        }
        
    } catch (error) {
        console.log(`❌ Error: ${error.message}`);
        console.log(`Stack: ${error.stack}`);
        
        // Cleanup temp file if it exists
        try {
            fs.unlinkSync('./temp_spotify.apk');
        } catch {}
    }
}

quickTest().catch(console.error);
