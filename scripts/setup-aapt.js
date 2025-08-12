#!/usr/bin/env node

import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';

const execAsync = promisify(exec);

/**
 * Automated AAPT setup for real Android app names
 * Runs automatically after pnpm install via postinstall hook
 */
async function setupAAT() {
    const aaptPath = './tools/sdk/build-tools/34.0.0/aapt';
    
    // Skip if AAPT already exists
    if (fs.existsSync(aaptPath)) {
        console.log('✅ AAPT already installed');
        return;
    }
    
    console.log('🔧 Setting up AAPT for real Android app names...');
    
    try {
        // Create tools directory
        await execAsync('mkdir -p tools');
        
        // Download Android SDK command line tools if needed
        if (!fs.existsSync('./tools/cmdline-tools')) {
            console.log('📥 Downloading Android SDK Command Line Tools (153MB)...');
            await execAsync(`
                cd tools && 
                curl -L "https://dl.google.com/android/repository/commandlinetools-mac-11076708_latest.zip" -o android-cmdline-tools.zip && 
                unzip -q android-cmdline-tools.zip && 
                rm android-cmdline-tools.zip
            `);
        }
        
        // Install build-tools with auto-accepted licenses
        console.log('🔨 Installing build-tools (auto-accepting licenses)...');
        await execAsync(`
            cd tools && 
            yes | ./cmdline-tools/bin/sdkmanager --sdk_root=./sdk "build-tools;34.0.0"
        `);
        
        // Verify installation
        const { stdout } = await execAsync(`${aaptPath} version`);
        console.log(`✅ AAPT installed successfully: ${stdout.trim()}`);
        console.log('📱 Ready to extract real Android app names!');
        
    } catch (error) {
        console.warn(`⚠️  AAPT setup failed: ${error.message}`);
        console.warn('📝 App names will use fallback method until AAPT is available');
    }
}

setupAAT();
