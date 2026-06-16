#!/bin/bash
# Double-click to update TabView (macOS). Pulls the latest production code,
# rebuilds the swipe helper, then tells you to reload the extension.
cd "$(dirname "$0")"
echo "Updating TabView…"
if ! git pull --ff-only origin main; then
  echo
  echo "Pull failed (you may have local changes). Resolve manually, then rerun."
  read -r -p "Press Return to close."
  exit 1
fi

if [ -f swipe-helper/build.sh ]; then
  echo "Rebuilding swipe helper…"
  ( cd swipe-helper && ./build.sh && ./install-host.sh ) || echo "Swipe helper build skipped/failed (optional)."
  pkill -f "TabSwipe.app/Contents/MacOS/TabSwipe" 2>/dev/null
  open swipe-helper/TabSwipe.app 2>/dev/null
fi

echo
echo "Updated. Final step: open chrome://extensions and click Reload on TabView,"
echo "or just click \"Reload now\" in TabView's blue update banner."
read -r -p "Press Return to close."
