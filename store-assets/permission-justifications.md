# Permission justifications (paste into the dashboard fields)

## Single purpose
TabView is a visual tab manager. It shows all open tabs as preview cards so the
user can see, search, group, organize, and close tabs and windows from one place.

## Permission justifications

**tabs** — Read each tab's title, URL, and favicon to build the visual grid, the
search index, and the group and session features. Core to the single purpose.

**activeTab** — Act on the tab the user interacts with from the grid (switch to it,
close it, move it).

**debugger** — Capture a screenshot preview of each tab using the Chrome DevTools
Protocol (Page.captureScreenshot) without disrupting the user by switching tabs.
This is the only way to get a real thumbnail of a backgrounded tab. The same call
reads JS heap size for the per tab memory display. We attach only to take the
screenshot and detach immediately; we never read page content or network traffic.

**tabGroups** — Create, name, and color Chrome tab groups when the user groups
tabs manually or via the AI auto group feature, and preserve groups when merging
windows.

**storage** — Save the user's settings, saved sessions, crash recovery snapshots,
and (if the user enables AI) their own API key, all locally on the device.

**alarms** — Run the periodic crash recovery snapshot on a timer.

## Host permission justifications

**api.anthropic.com / openrouter.ai** — Used only for the optional AI features
(auto group, suggest closes, summaries, natural language search). The user must
supply their own API key and explicitly trigger each AI action. When they do, the
extension sends the relevant tab titles and URLs to the provider the user chose.
No AI request is made otherwise.

## Are you using remote code?
No. All code is bundled in the package. The extension calls remote HTTP APIs for
data only; it does not load or execute any remote scripts.

## Data usage disclosures (Privacy practices tab)
- Does the item collect or use web browsing activity? Yes, limited.
  Tab titles and URLs are read locally to render the grid. They are transmitted to
  a third party (Anthropic or OpenRouter) ONLY when the user enables AI features
  and clicks an AI action, and only to fulfill that request.
- Personally identifiable info: No.
- Authentication info: The user's own API key is stored locally and sent only to
  the provider it belongs to. It is never sent anywhere else.
- We do not sell or transfer data, do not use it for advertising, and do not use it
  for anything beyond the user's requested feature.
- A privacy policy URL is required (see PRIVACY.md).
