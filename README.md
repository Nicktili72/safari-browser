# Hermes Safari Bridge

Browser extension that lets the local Hermes daemon drive Safari: navigate, read, click, fill, screenshot.

## Architecture

```
Agent → CLI (sbf) → WS://localhost:52800/cli → WS daemon
                                    ↕
                    WS://localhost:52800/extension
                                    ↕
                      Safari extension (background.js)
                                    ↕
                      Content script (content.js) on target page
```

## Quick Start

```bash
# 1. Build and install the wrapper app
./build.sh

# 2. Enable unsigned extensions in Safari (Developer menu)
#    Then enable the extension in Safari → Settings → Extensions

# 3. Start the daemon
./daemon.sh start

# 4. Use the CLI
./sbf status
./sbf read
./sbf navigate https://example.com
```

## Prerequisites

- macOS 13.0+ (Ventura)
- Safari 16.4+
- Node.js 18+
- Xcode command-line tools (`xcode-select --install`)

## Setup Steps

### 1. Build the wrapper

```bash
./build.sh
```

This builds the WXT extension, copies it into the wrapper bundle, codesigns everything, and launches the wrapper app to register it with Safari.

### 2. Enable unsigned extensions in Safari

Since this is a dev extension (not signed by Apple), you need to enable unsigned extensions:

1. Open Safari
2. **Developer → Allow Unsigned Extensions** — toggle ON
   - This may prompt for admin password (one-time macOS authorization)
3. **Safari → Settings → Extensions** — enable "Hermes Safari Bridge"

> If the extension doesn't appear, quit Safari (⌘Q), launch the wrapper app once, then reopen Safari.

### 3. Start the daemon

```bash
./daemon.sh start
```

The daemon listens on `ws://127.0.0.1:52800` and bridges between the CLI and the Safari extension.

### 4. Verify

```bash
./sbf status
```

Expected output:
```json
{
  "connected": true,
  "daemon": true,
  "extensionConnected": true
}
```

## CLI Usage

```bash
./sbf <command> [args...]
```

| Command | Description |
|---------|-------------|
| `status` | Show daemon & extension status |
| `tabs list` | List browser tabs |
| `tabs new [url]` | Open new tab |
| `tabs close [tabId]` | Close tab |
| `navigate <url>` | Navigate current tab |
| `read` | Read page snapshot |
| `click @eN` | Click element by ref |
| `fill @eN <value>` | Fill form field |
| `select @eN <value>` | Select option |
| `press <key>` | Press key |
| `scroll <dy>` | Scroll page |
| `value @eN` | Get element value |
| `shot` | Take screenshot |

Exit codes: `0` success, `1` usage, `2` extension offline, `3` daemon unreachable, `4` internal error

## Daemon

```bash
./daemon.sh start    # Start background daemon
./daemon.sh stop     # Stop daemon
./daemon.sh status   # Check if running
```

Logs: `/tmp/safari-browser-daemon.log`

## Project Structure

```
safari-browser/
├── package.json           # WXT + ws dependencies
├── wxt.config.ts          # Manifest config (MV2, Safari)
├── entrypoints/
│   ├── background.ts      # Extension background (WS bridge handler)
│   └── content.ts         # Content script (DOM snapshot + command dispatch)
├── daemon/
│   ├── daemon.mjs         # WS server (port 52800)
│   └── sbf.mjs            # CLI client
├── scripts/
│   └── gen-icon.mjs       # Hand-rolled PNG icon generator
├── wrapper/
│   └── Hermes Safari Bridge.app/
│       ├── Contents/
│       │   ├── Info.plist
│       │   ├── MacOS/Hermes Safari Bridge   # Stub binary
│       │   ├── Resources/Icon.png
│       │   └── PlugIns/
│       │       └── Hermes Safari Bridge Extension.appex/
│       │           ├── Info.plist
│       │           └── Resources/
│       │               ├── background.js
│       │               ├── content-scripts/content.js
│       │               ├── manifest.json
│       │               └── icon-128.png
├── build.sh               # Build + sign + register
└── daemon.sh              # Daemon lifecycle
```

## Build Output

The WXT build produces `.output/safari-mv2/`. The `build.sh` script copies these files into the wrapper app bundle and code-signs everything.

## Troubleshooting

### Extension not showing in Safari Settings

1. Quit Safari completely (⌘Q)
2. Launch wrapper app once: `open -a "Hermes Safari Bridge"`
3. Reopen Safari
4. Check Settings → Extensions

### Extension appears as "(UNSIGNED)" and won't enable

You need to toggle **Developer → Allow Unsigned Extensions** in Safari. AppleScript automation is broken in Safari 27+, so this must be done manually.

### Wrapper app JS is stale

After rebuilding:
```bash
./build.sh
```

This copies the latest WXT output into the wrapper bundle. If Safari still shows stale content, clear WebKit cache:
```bash
rm -rf ~/Library/WebKit/com.apple.Safari*
```

### Daemon not running

```bash
./daemon.sh status    # Check
./daemon.sh start     # Start
cat /tmp/safari-browser-daemon.log  # Debug
```

### Port already in use

The daemon uses port 52800. If another process holds it:
```bash
lsof -i :52800
./daemon.sh stop
```

### Re-signing after changes

Modifying a codesigned app invalidates the signature. The `build.sh` handles this automatically. Manual re-sign:
```bash
codesign --force --deep --sign - ~/safari-browser/wrapper/"Hermes Safari Bridge.app"
```
