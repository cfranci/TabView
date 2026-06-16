#!/bin/bash
# Notify when TabView goes live on the Chrome Web Store.
#
# After your first upload the dashboard URL contains a 32-char item ID. Pass it:
#   ./notify-when-live.command <ITEM_ID>
# While the item is unpublished the public page 404s; when it goes live it returns 200.
#
# Schedule it (pick one):
#   • launchd: load the plist in this folder (runs hourly), or
#   • Claude: /loop 1h ./store-assets/notify-when-live.command <ITEM_ID>, or
#   • crontab -e:  0 * * * * /Users/cf/Projects/TabView/store-assets/notify-when-live.command <ITEM_ID>

ITEM_ID="${1:?usage: notify-when-live.command <ITEM_ID>}"
URL="https://chromewebstore.google.com/detail/$ITEM_ID"
STATE="$HOME/Library/Application Support/TabSwipe/cws-live-$ITEM_ID"

code=$(curl -s -o /dev/null -w "%{http_code}" -L "$URL")
if [ "$code" = "200" ]; then
  # Only notify once, on the transition to live.
  if [ ! -f "$STATE" ]; then
    mkdir -p "$(dirname "$STATE")"; touch "$STATE"
    osascript -e "display notification \"It is live: $URL\" with title \"TabView published\" sound name \"Glass\""
    echo "LIVE: $URL"
  else
    echo "Already live (notified earlier)."
  fi
else
  echo "Not live yet (HTTP $code). Will keep checking."
fi
