#!/bin/bash
# Build TabSwipe.app (menu-bar-less background app, ad-hoc signed so TCC grants stick)
set -euo pipefail
cd "$(dirname "$0")"

swiftc -O TabSwipe.swift -o TabSwipe -framework Cocoa

APP=TabSwipe.app
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS"
cp TabSwipe "$APP/Contents/MacOS/TabSwipe"
cat > "$APP/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleIdentifier</key><string>com.tabview.tabswipe</string>
    <key>CFBundleName</key><string>TabSwipe</string>
    <key>CFBundleExecutable</key><string>TabSwipe</string>
    <key>CFBundlePackageType</key><string>APPL</string>
    <key>CFBundleShortVersionString</key><string>0.1</string>
    <key>LSUIElement</key><true/>
</dict>
</plist>
PLIST
codesign --force --sign - "$APP"
echo "Built $APP"
