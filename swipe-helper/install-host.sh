#!/bin/bash
# Register the TabSwipe native-messaging host so the TabView extension can
# toggle the swipe helper on/off from its right-click menu.
set -euo pipefail
cd "$(dirname "$0")"
HERE="$(pwd)"

# TabView's unpacked extension ID (derived from its load path /Users/cf/Projects/TabView).
# If you load the extension from a different path, pass the real ID as arg 1.
EXT_ID="${1:-cjdgpanfcfbjfnnliicjfmmncflfcgfb}"
HOST_NAME="com.tabview.tabswipe"
HOST_SCRIPT="$HERE/tabswipe-host.py"

chmod +x "$HOST_SCRIPT"

read -r -d '' MANIFEST <<JSON || true
{
  "name": "$HOST_NAME",
  "description": "TabSwipe on/off bridge for the TabView extension",
  "path": "$HOST_SCRIPT",
  "type": "stdio",
  "allowed_origins": ["chrome-extension://$EXT_ID/"]
}
JSON

# Register for every Chromium-family browser whose host dir exists.
TARGETS=(
  "$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts"
  "$HOME/Library/Application Support/Google/Chrome Beta/NativeMessagingHosts"
  "$HOME/Library/Application Support/Google/Chrome Canary/NativeMessagingHosts"
  "$HOME/Library/Application Support/BraveSoftware/Brave-Browser/NativeMessagingHosts"
  "$HOME/Library/Application Support/Microsoft Edge/NativeMessagingHosts"
)

installed=0
for dir in "${TARGETS[@]}"; do
  parent="$(dirname "$dir")"
  [ -d "$parent" ] || continue
  mkdir -p "$dir"
  printf '%s\n' "$MANIFEST" > "$dir/$HOST_NAME.json"
  echo "Registered host in: $dir"
  installed=$((installed + 1))
done

if [ "$installed" -eq 0 ]; then
  echo "No Chromium-family browser profile dirs found." >&2
  exit 1
fi
echo "Done. Extension ID allowed: $EXT_ID"
