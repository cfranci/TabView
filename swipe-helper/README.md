# TabSwipe

Three-finger swipe left/right on the trackpad to switch Chrome tabs. Companion helper for the TabView extension.

## Why a native app

macOS never delivers three-finger trackpad gestures to Chrome, so no extension code can see them. TabSwipe reads raw touches via the private MultitouchSupport framework and, when Chrome is frontmost, posts Ctrl+Tab / Ctrl+Shift+Tab (Chrome's built-in next/previous tab shortcuts).

## Build and run

```bash
./build.sh           # compile TabSwipe.app
./install-host.sh    # register the on/off bridge for the TabView extension
open TabSwipe.app
```

First launch prompts for Accessibility permission (needed to send the keystrokes). Grant it, then relaunch.

## On/off from the extension

Right-click the TabView extension icon in Chrome's toolbar and toggle **"Tab Swipe (3-finger)"**. The checkbox state is written to a flag file (`~/Library/Application Support/TabSwipe/enabled`) by a native-messaging host; TabSwipe.app reads it at the start of each gesture. Missing flag = on.

`install-host.sh` registers the host for Chrome/Brave/Edge and allows TabView's extension ID (`cjdgpanfcfbjfnnliicjfmmncflfcgfb`, derived from the load path `/Users/cf/Projects/TabView`). If you load the extension from a different path, pass the real ID: `./install-host.sh <extension-id>`. After (re)installing the host, reload the extension in `chrome://extensions` so it picks up the new permissions.

## Pieces

- `TabSwipe.swift` / `TabSwipe.app` — the persistent gesture listener
- `tabswipe-host.py` — native-messaging host; writes the on/off flag
- `install-host.sh` — registers the host manifest with Chrome

## Flags

Run the raw binary with flags, or edit the defaults in `TabSwipe.swift`:

- `--fingers N` finger count (default 3)
- `--natural` invert direction (swipe right goes to the tab on the left, trackpad "push content" style)
- `--verbose` log every detected swipe

## System gesture conflicts

- Three-finger drag (Accessibility > Pointer Control > Trackpad Options) must be OFF, otherwise three-finger swipes drag windows and select text while also switching tabs.
- The "swipe between full-screen applications" gesture must not be set to three fingers (four fingers or off is fine).

## Auto-start

Add TabSwipe.app to System Settings > General > Login Items.

## v2 ideas

- Native messaging into the TabView extension (richer actions: jump to TabView page, move tabs, swipe up to open TabView)
- Menu bar icon with on/off toggle
- Per-app shortcut maps (Safari, iTerm tabs)
