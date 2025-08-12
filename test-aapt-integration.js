#!/usr/bin/env node

import { generateDisplayName } from './src/lib/app-names.js';

/**
 * Test the new AAPT-powered generateDisplayName function
 */
async function testAAPTIntegration() {
    console.log('🧪 Testing AAPT-Powered App Name Generation\n');
    
    const testPackages = [
        'com.spotify.music',
        'com.quanticapps.remotetvs',
        'com.facebook.katana',
        'com.unknown.testapp'
    ];
    
    for (const packageName of testPackages) {
        console.log(`📱 Testing: ${packageName}`);
        
        try {
            const displayName = await generateDisplayName(packageName);
            console.log(`   ✨ Result: "${displayName}"`);
            
        } catch (error) {
            console.log(`   ❌ Error: ${error.message}`);
        }
        
        console.log('');
    }
    
    console.log('🎉 AAPT integration test complete!');
}

testAAPTIntegration();
