# Handoff -- TabView
*Updated: 2026-04-14*

## Last Working On
v2.0 upgrade -- added RAM monitoring, multi-select, tab grouping, discard, and window merging.

## Status
v2.0, functional. All v1 features preserved. New in v2:
- Per-tab RAM display via `chrome.processes` API (auto-refreshes every 10s)
- Checkbox multi-select on each tab card
- Floating action bar when tabs are selected (Group / Discard / Close)
- Tab grouping with Chrome's native tab groups API
- Discard tabs to free RAM without closing them
- Merge all Chrome windows into one
- High-memory tabs (300+ MB) highlighted with orange badge
- Total Chrome memory shown in header

## Key Files
- `manifest.json` -- Manifest V3, permissions: tabs, activeTab, debugger, processes, tabGroups
- `background.js` -- Service worker: handles extension icon click, debugger-based tab capture
- `manager.html/js/css` -- The tab manager page (opens in a new tab)
- `icon128.png` -- 128x128 extension icon

## Key Commands
Load as unpacked extension in `chrome://extensions` with Developer mode enabled.

## Resume Notes
- The debugger permission causes a brief yellow "debugging" banner on tabs during capture -- unavoidable but better UX than switching tabs
- `chrome://` and other restricted URLs can't be captured (debugger can't attach)
- `chrome.processes` API may not be available in all Chromium forks. Code degrades gracefully -- RAM badges just stay empty.
- Discarded tabs show 0 MB until the user navigates back to them (Chrome unloads them from memory)
- Could add: search/filter tabs, keyboard shortcuts, pinned tab indicators, sort by RAM usage
