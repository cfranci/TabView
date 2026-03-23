# Handoff — TabView
*Generated: 2026-03-23*

## Last Working On
Chrome extension for visual tab management — grid of live tab previews with close and reorder.

## Status
v1.0, functional. Uses Chrome debugger protocol (`Page.captureScreenshot`) to capture tab previews without switching tabs. Features:
- Auto-captures all tab previews on open (no tab jumping)
- Drag-and-drop to reorder tabs (actually moves them in Chrome)
- Close tabs from the grid with animation
- Click preview or title to switch to that tab
- Live updates when tabs are opened/closed/moved
- Dark theme UI

## Key Files
- `manifest.json` — Manifest V3, permissions: tabs, activeTab, debugger
- `background.js` — Service worker: handles extension icon click, debugger-based tab capture
- `manager.html/js/css` — The tab manager page (opens in a new tab)
- `icon128.png` — Generated 128x128 extension icon

## Key Commands
Load as unpacked extension in `chrome://extensions` with Developer mode enabled.

## Resume Notes
- The debugger permission causes a brief yellow "debugging" banner on tabs during capture — unavoidable but much better UX than switching tabs
- `chrome://` and other restricted URLs can't be captured (debugger can't attach)
- Could add: search/filter tabs, tab grouping support, keyboard shortcuts, pinned tab indicators
