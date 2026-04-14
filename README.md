<p align="center">
  <img src="icon128.png" width="80" alt="TabView icon">
</p>

<h1 align="center">TabView</h1>

<p align="center">
  A Chrome extension that lets you see all your tabs as visual previews in a single grid -- monitor RAM usage, multi-select tabs, create groups, and merge windows.
</p>

<p align="center">
  <img src="screenshot.png" alt="TabView in action" width="800">
</p>

---

## Features

- **Visual tab previews** -- Captures screenshots of all tabs in the background (no disruptive tab switching)
- **Per-tab RAM usage** -- See how much memory each tab is consuming, auto-refreshes every 10 seconds. High-memory tabs (300+ MB) are highlighted in orange.
- **Multi-select** -- Checkbox on each tab card for selecting multiple tabs at once
- **Tab grouping** -- Select tabs and group them with a name and color using Chrome's native tab groups
- **Discard tabs** -- Unload selected tabs from memory without closing them to free RAM
- **Merge windows** -- One-click button to combine all Chrome windows into one
- **Close tabs** -- Hit the X on any card or bulk-close selected tabs
- **Drag & drop reorder** -- Drag cards to rearrange your actual Chrome tab order
- **Click to switch** -- Click any preview or title to jump straight to that tab
- **Live updates** -- Grid stays in sync as you open, close, or move tabs
- **Auto-capture** -- Previews start capturing automatically when you open TabView

## Install (Developer Mode)

TabView isn't on the Chrome Web Store -- install it manually in about 30 seconds:

1. **Download** this repo:
   - Click the green **Code** button above, then **Download ZIP**
   - Or clone it: `git clone https://github.com/cfranci/TabView.git`

2. **Open Chrome's extension page**:
   - Go to `chrome://extensions` in your address bar

3. **Enable Developer Mode**:
   - Toggle the **Developer mode** switch in the top-right corner

4. **Load the extension**:
   - Click **Load unpacked**
   - Select the `TabView` folder you downloaded/cloned

5. **Pin it** (optional but recommended):
   - Click the puzzle piece icon in Chrome's toolbar
   - Pin **TabView** so it's always one click away

## Usage

Click the **TabView** icon in your toolbar. A new tab opens with a grid of all your tabs.

### Basic controls
- **Click a preview** -- switches to that tab
- **Click the X** -- closes that tab
- **Drag a card** -- reorders the tab in Chrome
- **"Refresh Previews"** -- re-captures all screenshots

### RAM monitoring
Each tab card displays its memory usage on the right side of the info bar. Total memory across all tabs shows in the header. Tabs using more than 300 MB get an orange badge to flag them as heavy.

### Multi-select and bulk actions
Check the box on the top-left of any tab card to select it. A floating action bar appears at the bottom with three options:

- **Group** -- Creates a Chrome tab group from selected tabs. Enter a name and a random color is assigned.
- **Discard** -- Unloads selected tabs from memory without closing them. The tab stays in your tab bar but its content is freed from RAM. Chrome reloads it when you click on it.
- **Close** -- Closes all selected tabs.

### Merge windows
Click **Merge Windows** in the header to pull every tab from all other Chrome windows into the current window.

## Permissions

| Permission | Purpose |
|-----------|---------|
| `tabs` | Read tab titles, URLs, and favicons |
| `activeTab` | Access the current tab |
| `debugger` | Capture tab screenshots without switching tabs (Chrome DevTools Protocol) |
| `processes` | Read per-tab memory/RAM usage |
| `tabGroups` | Create and name tab groups |

## License

MIT
