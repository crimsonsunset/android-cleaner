# 🤖 Android Cleaner

**SvelteKit Web App for Android Device Management via ADB**

A functional web application for managing Android apps through ADB commands. Features batch processing, app metadata analysis, and bulk operations for device cleanup.

![App Screenshot](app-screenshot.jpeg)

*Functional table interface with batch processing, selection tools, and app metadata*

## ✨ Features

### 🚀 **Advanced App Intelligence**
- **High-Accuracy Names**: AAPT-powered real app display names (no more `com.package.names`)
- **Comprehensive Metadata**: Install source, target SDK, last used dates, data usage, app flags
- **Smart Device Detection**: Auto-detects Samsung Fold models and other devices with pretty names

### 📊 **Functional UI**
- **Sortable Data Table**: Click column headers to sort by size, date, SDK version, etc.
- **Range Selection**: Shift-click to select multiple apps at once
- **Batch Progress**: Live progress tracking during app processing
- **User Feedback**: Toast notifications for actions and errors

### ⚡ **Performance Features** 
- **Batch Processing**: Processes apps in groups of 5 to prevent system overload
- **Stop Control**: Cancel batch operations in progress
- **Caching**: File-based cache for faster subsequent loads
- **Error Handling**: Tracks and displays failed operations

### 🎯 **Additional Features**
- **Bulk Operations**: Select and uninstall multiple apps at once
- **System App Protection**: Basic safety checks to prevent removing system apps
- **Device Detection**: Identifies connected Android devices with friendly names
- **App Store Links**: Click app names to open store pages (where available)

## 🛠 System Requirements

### **Essential**
- **ADB (Android Debug Bridge)**: Bundled with app, no setup needed
- **USB Debugging**: Enabled on your Android device
- **Chrome/Chromium**: For best app mode experience (auto-detected)

### **Supported Devices**
- ✅ **Android devices with ADB support**
- ✅ **Samsung Galaxy series** (tested with Fold 5, enhanced detection)
- 🔄 **Multiple device support** (UI implemented, backend switching in progress)

### **Operating Systems**
- 🍎 **macOS**: Tested and working
- 🪟 **Windows**: Should work (ADB path may need adjustment)  
- 🐧 **Linux**: Should work (ADB path may need adjustment)

## 🚀 Quick Start

### **1. Enable USB Debugging**
```
Settings → Developer Options → USB Debugging → ON
```

### **2. Connect Device**
```bash
# Check connection (bundled ADB)
./tools/sdk/platform-tools/adb devices
```

### **3. Run Development Server**
```bash
npm install        # Install dependencies + setup AAPT
npm run dev        # Start at http://localhost:5173
```

### **4. Manage Apps**
1. App opens in browser
2. Select your device from dropdown
3. Apps load progressively with real-time progress
4. Select apps → Uninstall → Clean device! 🎉

## 🔧 Development Setup

### **Prerequisites**
- **Node.js 18+** or **Bun 1.0+**
- **PNPM** (recommended) or **NPM**

### **Clone & Install**
```bash
git clone <repository>
cd android-cleaner
pnpm install          # Auto-runs AAPT setup
```

### **Development Server**
```bash
pnpm dev             # http://localhost:5173
```

### **Build for Production**
```bash
# Build for production
pnpm build

# Preview production build
pnpm preview     # http://localhost:4173
```

## 🏗 Architecture

### **Tech Stack**
- **Frontend**: SvelteKit + DaisyUI + TailwindCSS
- **Backend**: SvelteKit API routes + Node.js child_process
- **ADB Integration**: Android SDK build-tools + AAPT
- **Caching**: File-based JSON with device-specific invalidation

### **Key Components**
```
src/
├── routes/
│   ├── +page.svelte              # Main UI
│   └── api/
│       ├── adb/status/           # Device detection
│       └── apps/
│           ├── list/             # Package enumeration
│           ├── list-batch/       # Batch processing
│           ├── details/          # Individual app data
│           └── uninstall/        # Bulk uninstall + cache updates
├── lib/
│   ├── app-names.js              # AAPT integration
│   └── cache.js                  # Smart caching system
└── tools/                        # Bundled Android SDK tools
```

## 📱 Use Cases

**Practical Android App Management**

1. **App Analysis**: View installed apps with metadata like install dates, sizes, and sources
2. **Bulk Cleanup**: Remove multiple unwanted apps efficiently before device migration
3. **Device Auditing**: Review what's installed and identify apps for removal

**Useful for**:
- Cleaning devices before migrations
- App auditing and storage cleanup
- Android development and testing workflows

## 🤝 Contributing

Built with ❤️ for Android power users. Contributions welcome!

### **Development Workflow**
1. Read `docs/next-session.md` for current priorities
2. Check `docs/roadmap.md` for planned features
3. Follow existing code patterns and conventions
4. Test with real Android devices when possible

## 📄 License

**Private Project** - Built for Android device management.

---

**🔧 Functional Android device management via ADB with web interface**
