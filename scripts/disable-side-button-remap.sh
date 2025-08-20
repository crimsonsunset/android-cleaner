#!/bin/bash

# Side Button Remapping Disable Script
# This script disables side button remapping by re-enabling Bixby and revoking permissions

echo "🔧 Disabling side button remapping..."
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

# Re-enable Samsung Bixby agent
echo "✅ Re-enabling Samsung Bixby agent..."
adb shell pm enable com.samsung.android.bixby.agent
if [ $? -eq 0 ]; then
    echo "✅ Bixby agent re-enabled"
else
    echo "⚠️  Warning: Could not re-enable Bixby agent (might not be present)"
fi

# Revoke READ_LOGS permission
echo "🔒 Revoking READ_LOGS permission..."
adb shell pm revoke com.jamworks.sidekeybuttonremap android.permission.READ_LOGS
if [ $? -eq 0 ]; then
    echo "✅ READ_LOGS permission revoked"
else
    echo "⚠️  Warning: Could not revoke READ_LOGS permission"
fi

# Revoke WRITE_SECURE_SETTINGS permission
echo "🔒 Revoking WRITE_SECURE_SETTINGS permission..."
adb shell pm revoke com.jamworks.sidekeybuttonremap android.permission.WRITE_SECURE_SETTINGS
if [ $? -eq 0 ]; then
    echo "✅ WRITE_SECURE_SETTINGS permission revoked"
else
    echo "⚠️  Warning: Could not revoke WRITE_SECURE_SETTINGS permission"
fi

# Force stop the remapping app
echo "🔄 Stopping side button remap app..."
adb shell am force-stop com.jamworks.sidekeybuttonremap
if [ $? -eq 0 ]; then
    echo "✅ App stopped"
else
    echo "⚠️  Warning: Could not stop app"
fi

echo ""
echo "🎉 Side button remapping disabled!"
echo ""
echo "📋 Your device should now use the default side button behavior (Bixby)"
echo ""
echo "💡 To re-enable remapping later, run: ./scripts/enable-side-button-remap.sh"
