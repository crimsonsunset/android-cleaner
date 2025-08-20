#!/bin/bash

# Side Button Remapping Setup Script
# This script enables side button remapping by disabling Bixby and granting necessary permissions

echo "🔧 Setting up side button remapping..."
echo ""

# Check if ADB is available
if ! command -v adb &> /dev/null; then
    echo "❌ Error: ADB is not installed or not in PATH"
    echo "Please install Android SDK Platform Tools first"
    exit 1
fi

# Check if device is connected
echo "📱 Checking device connection..."
if ! adb devices | grep -q "device$"; then
    echo "❌ Error: No Android device found"
    echo "Please ensure your device is connected and USB debugging is enabled"
    exit 1
fi

echo "✅ Device connected"
echo ""

# Disable Samsung Bixby agent
echo "🚫 Disabling Samsung Bixby agent..."
adb shell pm disable-user com.samsung.android.bixby.agent
if [ $? -eq 0 ]; then
    echo "✅ Bixby agent disabled"
else
    echo "⚠️  Warning: Could not disable Bixby agent (might not be present)"
fi

# Grant READ_LOGS permission
echo "🔑 Granting READ_LOGS permission..."
adb shell pm grant com.jamworks.sidekeybuttonremap android.permission.READ_LOGS
if [ $? -eq 0 ]; then
    echo "✅ READ_LOGS permission granted"
else
    echo "❌ Error: Could not grant READ_LOGS permission"
fi

# Grant WRITE_SECURE_SETTINGS permission
echo "🔑 Granting WRITE_SECURE_SETTINGS permission..."
adb shell pm grant com.jamworks.sidekeybuttonremap android.permission.WRITE_SECURE_SETTINGS
if [ $? -eq 0 ]; then
    echo "✅ WRITE_SECURE_SETTINGS permission granted"
else
    echo "❌ Error: Could not grant WRITE_SECURE_SETTINGS permission"
fi

# Force stop the remapping app
echo "🔄 Restarting side button remap app..."
adb shell am force-stop com.jamworks.sidekeybuttonremap
if [ $? -eq 0 ]; then
    echo "✅ App restarted"
else
    echo "⚠️  Warning: Could not restart app"
fi

echo ""
echo "🎉 Side button remapping setup complete!"
echo ""
echo "📋 Next steps:"
echo "1. Open the Side Actions app on your phone"
echo "2. Configure your desired button mappings"
echo "3. Test the side button functionality"
echo ""
echo "💡 To disable remapping later, run: ./scripts/disable-side-button-remap.sh"
