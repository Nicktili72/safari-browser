#!/bin/bash
# Build, populate, sign, and register the Safari extension wrapper.
# Usage: ./build.sh
set -e

cd "$(dirname "$0")"

WRAPPER="wrapper/Hermes Safari Bridge.app"
APP="$WRAPPER/Hermes Safari Bridge"
APP_BINARY="$WRAPPER/Contents/MacOS/Hermes Safari Bridge"
APP_EXE="$WRAPPER/Contents/PlugIns/Hermes Safari Bridge Extension.appex"
RESOURCES="$APP_EXE/Contents/Resources"
OUTPUT=".output/safari-mv2"

echo "=== Step 1: Build extension ==="
npm run build

echo ""
echo "=== Step 2: Copy build output into wrapper ==="
cp "$OUTPUT/background.js" "$RESOURCES/"
cp "$OUTPUT/manifest.json" "$RESOURCES/"
cp "$OUTPUT/icon-128.png" "$RESOURCES/"
cp -r "$OUTPUT/content-scripts" "$RESOURCES/"

echo ""
echo "=== Step 3: Clean old signatures ==="
codesign --remove-signature "$APP_EXE" 2>/dev/null || true
codesign --remove-signature "$WRAPPER" 2>/dev/null || true
find "$WRAPPER" -name "_CodeSignature" -exec rm -rf {} + 2>/dev/null || true

echo ""
echo "=== Step 4: Sign from inside out ==="
codesign --force --deep --sign - "$APP_EXE"
codesign --force --deep --sign - "$WRAPPER"
echo "Signatures verified."

echo ""
echo "=== Step 5: Launch wrapper to register with Safari ==="
killall Safari 2>/dev/null || true
killall "Hermes Safari Bridge" 2>/dev/null || true
sleep 1
open -a "Hermes Safari Bridge"
open -a Safari
sleep 2

echo ""
echo "=== Done ==="
echo ""
echo "Next steps (manual):"
echo "  1. Open Safari → Developer menu → 'Allow Unsigned Extensions' (toggle ON)"
echo "     This may prompt for admin password — one-time macOS authorization."
echo ""
echo "  2. In Safari → Settings → Extensions, enable 'Hermes Safari Bridge'"
echo ""
echo "  3. Start the daemon: npm run daemon:dev"
echo ""
echo "Verify:"
echo "  The extension should show as 'enabled' in Safari Settings → Extensions"
