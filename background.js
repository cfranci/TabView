// ── Auto-save interval (minutes) ──
const AUTOSAVE_INTERVAL = 2;
const MAX_AUTOSAVES = 10;

// ── AI models / endpoints ──
const AI_MODEL = "claude-haiku-4-5-20251001";
const AI_API_URL = "https://api.anthropic.com/v1/messages";
const OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions";

// ── Update checking ──
// Chrome can't silently auto-update an unpacked extension, so instead we watch
// the production manifest on GitHub and surface a badge + in-app banner when a
// newer version ships. The user pulls + reloads (one click) to apply it.
const REPO_RAW_MANIFEST = "https://raw.githubusercontent.com/cfranci/TabView/main/manifest.json";
const REPO_URL = "https://github.com/cfranci/TabView";

function cmpVersions(a, b) {
  const pa = String(a).split(".").map(n => parseInt(n, 10) || 0);
  const pb = String(b).split(".").map(n => parseInt(n, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d !== 0) return d > 0 ? 1 : -1;
  }
  return 0;
}

async function checkForUpdate() {
  try {
    const res = await fetch(REPO_RAW_MANIFEST, { cache: "no-store" });
    if (!res.ok) return;
    const remote = await res.json();
    const local = chrome.runtime.getManifest().version;
    const available = cmpVersions(remote.version, local) > 0;
    await chrome.storage.local.set({
      tabview_update: { available, version: remote.version, local, checkedAt: Date.now() },
    });
    if (available) {
      chrome.action.setBadgeText({ text: "↑" });
      chrome.action.setBadgeBackgroundColor({ color: "#4f8bff" });
      chrome.action.setTitle({ title: `TabView — update available (v${remote.version})` });
    } else {
      chrome.action.setBadgeText({ text: "" });
      chrome.action.setTitle({ title: "Open TabView" });
    }
  } catch (_) {}
}

chrome.action.onClicked.addListener(async (tab) => {
  const tabs = await chrome.tabs.query({ currentWindow: true });
  const existing = tabs.find(t => t.url && t.url.startsWith(chrome.runtime.getURL("manager.html")));
  if (existing) {
    chrome.tabs.update(existing.id, { active: true });
    return;
  }
  chrome.tabs.create({ url: "manager.html" });
});

// ── Tab Swipe helper toggle (right-click the extension icon) ──
// A checkbox item in the action context menu flips the native TabSwipe.app
// on/off by writing a flag file through the native-messaging host.
const NATIVE_HOST = "com.tabview.tabswipe";
const SWIPE_MENU_ID = "tabswipe-toggle";

async function getSwipeEnabled() {
  const data = await chrome.storage.local.get("tabview_swipe_enabled");
  return data.tabview_swipe_enabled !== false; // default on
}

function sendSwipeState(enabled) {
  try {
    chrome.runtime.sendNativeMessage(NATIVE_HOST, { enabled }, () => {
      // Swallow "host not found" etc.; the menu still reflects user intent.
      void chrome.runtime.lastError;
    });
  } catch (_) {}
}

async function setupSwipeMenu() {
  const enabled = await getSwipeEnabled();
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: SWIPE_MENU_ID,
      title: "Tab Swipe (3-finger)",
      type: "checkbox",
      checked: enabled,
      contexts: ["action"],
    });
  });
  sendSwipeState(enabled); // keep the native flag in sync with stored intent
}

chrome.runtime.onInstalled.addListener(setupSwipeMenu);
chrome.runtime.onStartup.addListener(setupSwipeMenu);

chrome.contextMenus.onClicked.addListener(async (info) => {
  if (info.menuItemId !== SWIPE_MENU_ID) return;
  const enabled = info.checked; // checkbox state after the click
  await chrome.storage.local.set({ tabview_swipe_enabled: enabled });
  sendSwipeState(enabled);
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "captureTab") {
    captureTabViaDebugger(msg.tabId).then(sendResponse);
    return true;
  }
  if (msg.type === "captureAllTabs") {
    captureAllTabs(msg.tabIds).then(sendResponse);
    return true;
  }
  if (msg.type === "getTabsMemory") {
    getTabsMemory(msg.tabIds).then(sendResponse);
    return true;
  }
  if (msg.type === "saveSession") {
    saveSession(msg.name).then(sendResponse);
    return true;
  }
  if (msg.type === "getSessions") {
    getSessions().then(sendResponse);
    return true;
  }
  if (msg.type === "deleteSession") {
    deleteSession(msg.id).then(sendResponse);
    return true;
  }
  if (msg.type === "restoreSession") {
    restoreSession(msg.id).then(sendResponse);
    return true;
  }
  if (msg.type === "getAutoSaves") {
    getAutoSaves().then(sendResponse);
    return true;
  }
  if (msg.type === "restoreAutoSave") {
    restoreAutoSave(msg.id).then(sendResponse);
    return true;
  }
  if (msg.type === "aiAutoGroup") {
    aiAutoGroup(msg.tabs).then(sendResponse);
    return true;
  }
  if (msg.type === "aiSuggestCloses") {
    aiSuggestCloses(msg.tabs).then(sendResponse);
    return true;
  }
  if (msg.type === "aiTabSummary") {
    aiTabSummary(msg.tab).then(sendResponse);
    return true;
  }
  if (msg.type === "aiSearch") {
    aiSearch(msg.query, msg.tabs).then(sendResponse);
    return true;
  }
  if (msg.type === "getPromptDefaults") {
    sendResponse(DEFAULT_PROMPTS);
    return false;
  }
  if (msg.type === "getOpenrouterModels") {
    fetchOpenrouterModels().then(sendResponse);
    return true;
  }
  if (msg.type === "getOllamaModels") {
    fetchOllamaModels(msg.host).then(sendResponse);
    return true;
  }
  if (msg.type === "checkUpdateNow") {
    checkForUpdate().then(async () => {
      const d = await chrome.storage.local.get("tabview_update");
      sendResponse(d.tabview_update || { available: false });
    });
    return true;
  }
});

// Fetch OpenRouter's live model catalog and tag each free vs paid by pricing.
// The /models endpoint is public (no key needed).
async function fetchOpenrouterModels() {
  try {
    const res = await fetch("https://openrouter.ai/api/v1/models");
    if (!res.ok) return { success: false, error: `HTTP ${res.status}` };
    const data = await res.json();
    const models = (data.data || []).map(m => {
      const p = m.pricing || {};
      const free = parseFloat(p.prompt || "0") === 0 && parseFloat(p.completion || "0") === 0;
      return { id: m.id, name: m.name || m.id, free };
    });
    // Free first, then alphabetical by name.
    models.sort((a, b) => (a.free === b.free ? a.name.localeCompare(b.name) : (a.free ? -1 : 1)));
    return { success: true, models };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

// List models installed in the local Ollama instance (/api/tags).
async function fetchOllamaModels(host) {
  const base = host || "http://localhost:11434";
  try {
    const res = await fetch(`${base}/api/tags`);
    if (!res.ok) return { success: false, error: `HTTP ${res.status}` };
    const data = await res.json();
    const models = (data.models || []).map(m => ({ id: m.name, name: m.name, free: true }));
    models.sort((a, b) => a.name.localeCompare(b.name));
    return { success: true, models };
  } catch (e) {
    return { success: false, error: `Can't reach Ollama at ${base}. Is it running?` };
  }
}

// ── Auto-save (crash recovery) ──
chrome.alarms.create("autosave", { periodInMinutes: AUTOSAVE_INTERVAL });
chrome.alarms.create("updatecheck", { periodInMinutes: 720 }); // twice a day

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "autosave") autoSaveSnapshot();
  if (alarm.name === "updatecheck") checkForUpdate();
});

chrome.runtime.onStartup.addListener(() => {
  autoSaveSnapshot();
  checkForUpdate();
});
chrome.runtime.onInstalled.addListener(checkForUpdate);

async function autoSaveSnapshot() {
  const windows = await chrome.windows.getAll({ populate: true });
  const snapshot = windows.map(win => ({
    windowId: win.id,
    tabs: win.tabs
      .filter(t => !t.url.startsWith("chrome-extension://"))
      .map(t => ({
        url: t.url,
        title: t.title,
        favIconUrl: t.favIconUrl,
        pinned: t.pinned,
        groupId: t.groupId,
      })),
  })).filter(w => w.tabs.length > 0);

  let groups = {};
  try {
    const allGroups = await chrome.tabGroups.query({});
    for (const g of allGroups) {
      groups[g.id] = { title: g.title, color: g.color };
    }
  } catch (_) {}

  const entry = {
    id: `auto_${Date.now()}`,
    timestamp: Date.now(),
    windows: snapshot,
    groups,
    tabCount: snapshot.reduce((sum, w) => sum + w.tabs.length, 0),
  };

  const data = await chrome.storage.local.get("tabview_autosaves");
  let autosaves = data.tabview_autosaves || [];
  autosaves.unshift(entry);
  autosaves = autosaves.slice(0, MAX_AUTOSAVES);
  await chrome.storage.local.set({ tabview_autosaves: autosaves });
}

async function getAutoSaves() {
  const data = await chrome.storage.local.get("tabview_autosaves");
  return data.tabview_autosaves || [];
}

async function restoreAutoSave(id) {
  const data = await chrome.storage.local.get("tabview_autosaves");
  const autosaves = data.tabview_autosaves || [];
  const save = autosaves.find(s => s.id === id);
  if (!save) return { success: false };
  return await restoreWindowSet(save);
}

async function saveSession(name) {
  const windows = await chrome.windows.getAll({ populate: true });
  const snapshot = windows.map(win => ({
    windowId: win.id,
    tabs: win.tabs
      .filter(t => !t.url.startsWith("chrome-extension://"))
      .map(t => ({
        url: t.url,
        title: t.title,
        favIconUrl: t.favIconUrl,
        pinned: t.pinned,
        groupId: t.groupId,
      })),
  })).filter(w => w.tabs.length > 0);

  let groups = {};
  try {
    const allGroups = await chrome.tabGroups.query({});
    for (const g of allGroups) {
      groups[g.id] = { title: g.title, color: g.color };
    }
  } catch (_) {}

  const entry = {
    id: `session_${Date.now()}`,
    name,
    timestamp: Date.now(),
    windows: snapshot,
    groups,
    tabCount: snapshot.reduce((sum, w) => sum + w.tabs.length, 0),
  };

  const data = await chrome.storage.local.get("tabview_sessions");
  const sessions = data.tabview_sessions || [];
  sessions.unshift(entry);
  await chrome.storage.local.set({ tabview_sessions: sessions });
  return { success: true, id: entry.id };
}

async function getSessions() {
  const data = await chrome.storage.local.get("tabview_sessions");
  return data.tabview_sessions || [];
}

async function deleteSession(id) {
  const data = await chrome.storage.local.get("tabview_sessions");
  let sessions = data.tabview_sessions || [];
  sessions = sessions.filter(s => s.id !== id);
  await chrome.storage.local.set({ tabview_sessions: sessions });
  return { success: true };
}

async function restoreSession(id) {
  const data = await chrome.storage.local.get("tabview_sessions");
  const sessions = data.tabview_sessions || [];
  const session = sessions.find(s => s.id === id);
  if (!session) return { success: false };
  return await restoreWindowSet(session);
}

async function restoreWindowSet(save) {
  let totalRestored = 0;
  for (const win of save.windows) {
    if (win.tabs.length === 0) continue;
    const newWin = await chrome.windows.create({ url: win.tabs[0].url });
    totalRestored++;
    const additionalUrls = win.tabs.slice(1);
    const createdTabIds = [newWin.tabs[0].id];
    for (const tab of additionalUrls) {
      const created = await chrome.tabs.create({
        windowId: newWin.id,
        url: tab.url,
        pinned: tab.pinned,
      });
      createdTabIds.push(created.id);
      totalRestored++;
    }
    if (save.groups) {
      const groupMap = {};
      for (let i = 0; i < win.tabs.length; i++) {
        const origGroupId = win.tabs[i].groupId;
        if (origGroupId && origGroupId !== -1 && save.groups[origGroupId]) {
          if (!groupMap[origGroupId]) groupMap[origGroupId] = [];
          groupMap[origGroupId].push(createdTabIds[i]);
        }
      }
      for (const [origId, tabIds] of Object.entries(groupMap)) {
        try {
          const newGroupId = await chrome.tabs.group({ tabIds, createProperties: { windowId: newWin.id } });
          const info = save.groups[origId];
          await chrome.tabGroups.update(newGroupId, { title: info.title, color: info.color });
        } catch (_) {}
      }
    }
  }
  return { success: true, restored: totalRestored };
}

// ── Screenshot capture ──
const CAPTURE_TIMEOUT_MS = 6000;   // per-tab ceiling so one bad tab can't stall a refresh
const CAPTURE_CONCURRENCY = 5;     // tabs captured in parallel
const RESTRICTED_URL_RE = /^(chrome|edge|about|devtools|chrome-extension|view-source|file):/i;

function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(label || "Timed out")), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// Returns true if a tab can't possibly produce a screenshot (no live renderer or
// a page the debugger can't attach to). These show up as blank previews, so we
// skip them up front and let the card keep its favicon placeholder.
function uncapturableReason(tab) {
  if (!tab) return "gone";
  if (tab.discarded) return "paused";
  if (tab.status === "unloaded") return "unloaded";
  const url = tab.url || "";
  if (RESTRICTED_URL_RE.test(url)) return "restricted";
  if (/^https:\/\/(chrome\.google\.com\/webstore|chromewebstore\.google\.com)/.test(url)) return "restricted";
  return null;
}

async function captureTabViaDebugger(tabId) {
  let tab;
  try {
    tab = await chrome.tabs.get(tabId);
  } catch {
    return { success: false, error: "gone", skipped: true, jsHeapUsed: 0 };
  }
  const skip = uncapturableReason(tab);
  if (skip) return { success: false, error: skip, skipped: true, jsHeapUsed: 0 };

  let attached = false;
  try {
    await withTimeout(chrome.debugger.attach({ tabId }, "1.3"), CAPTURE_TIMEOUT_MS, "attach timeout");
    attached = true;

    // Bound the capture to the viewport so background/long pages don't render a
    // giant full-document image (slow + memory-heavy).
    let clip;
    try {
      const lm = await withTimeout(
        chrome.debugger.sendCommand({ tabId }, "Page.getLayoutMetrics"),
        CAPTURE_TIMEOUT_MS, "layout timeout"
      );
      const vp = lm.cssVisualViewport || lm.visualViewport || lm.cssLayoutViewport || lm.layoutViewport || {};
      const w = Math.round(vp.clientWidth || 1280);
      const h = Math.round(vp.clientHeight || 800);
      clip = { x: 0, y: 0, width: w, height: h, scale: 1 };
    } catch (_) {}

    // captureBeyondViewport:true uses the document-render path, which produces a
    // real image for backgrounded tabs instead of the blank compositor surface.
    const shotParams = { format: "jpeg", quality: 55, captureBeyondViewport: true };
    if (clip) shotParams.clip = clip;

    const result = await withTimeout(
      chrome.debugger.sendCommand({ tabId }, "Page.captureScreenshot", shotParams),
      CAPTURE_TIMEOUT_MS, "screenshot timeout"
    );

    let jsHeapUsed = 0;
    try {
      await chrome.debugger.sendCommand({ tabId }, "Performance.enable");
      const metrics = await chrome.debugger.sendCommand({ tabId }, "Performance.getMetrics");
      await chrome.debugger.sendCommand({ tabId }, "Performance.disable");
      const heap = metrics.metrics.find(m => m.name === "JSHeapUsedSize");
      if (heap) jsHeapUsed = heap.value;
    } catch (_) {}

    return {
      success: true,
      dataUrl: "data:image/jpeg;base64," + result.data,
      jsHeapUsed,
    };
  } catch (e) {
    return { success: false, error: e.message, jsHeapUsed: 0 };
  } finally {
    if (attached) {
      try { await chrome.debugger.detach({ tabId }); } catch (_) {}
    }
  }
}

// Capture a batch with bounded concurrency. A worker pool pulls from the queue
// so the slowest tab never blocks the others, and each tab is timeout-guarded.
async function captureAllTabs(tabIds) {
  const results = {};
  const queue = tabIds.slice();
  async function worker() {
    while (queue.length) {
      const tabId = queue.shift();
      try {
        results[tabId] = await captureTabViaDebugger(tabId);
      } catch (e) {
        results[tabId] = { success: false, error: e.message, jsHeapUsed: 0 };
      }
    }
  }
  const pool = Array.from(
    { length: Math.min(CAPTURE_CONCURRENCY, tabIds.length) },
    () => worker()
  );
  await Promise.all(pool);
  return results;
}

async function getTabMemory(tabId) {
  try {
    await chrome.debugger.attach({ tabId }, "1.3");
    await chrome.debugger.sendCommand({ tabId }, "Performance.enable");
    const metrics = await chrome.debugger.sendCommand({ tabId }, "Performance.getMetrics");
    await chrome.debugger.sendCommand({ tabId }, "Performance.disable");
    await chrome.debugger.detach({ tabId });
    const heap = metrics.metrics.find(m => m.name === "JSHeapUsedSize");
    return heap ? heap.value : 0;
  } catch (e) {
    try { await chrome.debugger.detach({ tabId }); } catch (_) {}
    return 0;
  }
}

async function getTabsMemory(tabIds) {
  const results = {};
  for (const tabId of tabIds) {
    results[tabId] = await getTabMemory(tabId);
  }
  return results;
}

// ──────────────────────────────────────────────────────────────
// AI features
// ──────────────────────────────────────────────────────────────

// Resolve the active provider and its credentials/model from storage.
const OLLAMA_DEFAULT_HOST = "http://localhost:11434";

async function getAIConfig() {
  const data = await chrome.storage.local.get([
    "tabview_provider",
    "tabview_api_key",
    "tabview_openrouter_key",
    "tabview_openrouter_model",
    "tabview_local_model",
    "tabview_local_host",
  ]);
  let provider = data.tabview_provider;
  if (provider !== "anthropic" && provider !== "openrouter" && provider !== "local") {
    // No explicit choice yet: infer from whichever key exists so a saved
    // OpenRouter key works without separately flipping the provider toggle.
    provider = (data.tabview_openrouter_key && !data.tabview_api_key) ? "openrouter" : "anthropic";
  }
  if (provider === "openrouter") {
    return {
      provider,
      key: data.tabview_openrouter_key || null,
      model: data.tabview_openrouter_model || "",
    };
  }
  if (provider === "local") {
    return {
      provider,
      key: "local", // sentinel: no key needed, but passes the "key set" check
      model: data.tabview_local_model || "",
      host: data.tabview_local_host || OLLAMA_DEFAULT_HOST,
    };
  }
  return { provider: "anthropic", key: data.tabview_api_key || null, model: AI_MODEL };
}

function shortDomain(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function tabBriefLine(t) {
  const domain = shortDomain(t.url);
  const title = (t.title || "").slice(0, 120);
  return `[${t.id}] ${domain} — ${title}`;
}

async function callClaude({ system, user, maxTokens = 2000 }) {
  const cfg = await getAIConfig();
  if (!cfg.key) return { success: false, error: "No API key set" };
  if ((cfg.provider === "openrouter" || cfg.provider === "local") && !cfg.model) {
    const what = cfg.provider === "local" ? "a local Ollama model" : "an OpenRouter model";
    return { success: false, error: `No model selected — open Settings → AI and pick ${what}.` };
  }
  const openAIShaped = cfg.provider === "openrouter" || cfg.provider === "local";

  try {
    let res;
    if (cfg.provider === "local") {
      // Ollama's OpenAI-compatible endpoint. Runs locally, no auth.
      res = await fetch(`${cfg.host}/v1/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: cfg.model,
          max_tokens: maxTokens,
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
        }),
      });
    } else if (cfg.provider === "openrouter") {
      res = await fetch(OPENROUTER_API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${cfg.key}`,
          "HTTP-Referer": "https://github.com/cfranci/TabView",
          "X-Title": "TabView",
        },
        body: JSON.stringify({
          model: cfg.model,
          max_tokens: maxTokens,
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
        }),
      });
    } else {
      res = await fetch(AI_API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": cfg.key,
          "anthropic-version": "2023-06-01",
          "anthropic-dangerous-direct-browser-access": "true",
        },
        body: JSON.stringify({
          model: cfg.model,
          max_tokens: maxTokens,
          system,
          messages: [{ role: "user", content: user }],
        }),
      });
    }

    if (!res.ok) {
      const text = await res.text();
      let errMsg = `HTTP ${res.status}`;
      try {
        const j = JSON.parse(text);
        if (j.error && j.error.message) errMsg = j.error.message;
      } catch {}
      return { success: false, error: errMsg };
    }

    const data = await res.json();
    // Anthropic: content[0].text. OpenAI-shaped (OpenRouter/Ollama): choices[0].message.content.
    const content = openAIShaped
      ? data.choices?.[0]?.message?.content
      : data.content?.[0]?.text;
    if (!content) return { success: false, error: "Empty response" };
    return { success: true, text: content };
  } catch (e) {
    if (cfg.provider === "local") {
      return { success: false, error: `Can't reach Ollama at ${cfg.host}. Is it running? (${e.message})` };
    }
    return { success: false, error: e.message };
  }
}

function extractJson(text) {
  // Try to extract a JSON object from the response (Claude often wraps it)
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = fenced ? fenced[1] : text;
  const trimmed = raw.trim();
  // Find first { or [
  const firstObj = trimmed.indexOf("{");
  const firstArr = trimmed.indexOf("[");
  let start;
  if (firstObj === -1) start = firstArr;
  else if (firstArr === -1) start = firstObj;
  else start = Math.min(firstObj, firstArr);
  if (start === -1) return null;
  const sub = trimmed.slice(start);
  try {
    return JSON.parse(sub);
  } catch {
    return null;
  }
}

// ── Auto-group ──
// ── Editable system prompts ──
// The guidance half of each prompt is user-editable (Settings → AI Prompts).
// The format footer below is appended automatically so the JSON contract the
// parsers rely on can't be edited away.
const DEFAULT_PROMPTS = {
  autogroup: `You organize browser tabs into meaningful groups. Group by topic, task, or purpose — not by domain alone. Skip tabs that don't fit a group (don't force everything into a group). Use 2-7 groups total. Group names should be short (1-3 words).`,
  suggestcloses: `You help users prune their browser tabs. Identify tabs that are good candidates to close:
- Duplicate or near-duplicate tabs (same page or same content)
- Empty/new tabs (about:blank, chrome://newtab)
- Settings or temporary tabs that look done
- Old searches/results pages the user likely doesn't need
- Tabs that appear stale or one-off

Be CONSERVATIVE. Don't flag tabs that look like active reading, documents, code, or long-form content. Only flag tabs you're confident the user is done with. If nothing is worth flagging, return an empty list.`,
  summary: `You write one-sentence summaries (under 25 words) of what a web page is likely about, based on its title and URL. Be specific and useful. No filler ("This page is...", "A page about..."). Just the content.`,
  search: `You are a semantic tab finder. Given a user query in natural language and a list of open browser tabs, return the tab IDs that best match the query, ordered by relevance (most relevant first). Include only tabs that genuinely match — be selective. Return up to 10.`,
};

function autogroupFormat(colors) {
  return `Pick a color from: ${colors.join(", ")}.

Respond with ONLY a JSON object in this exact format, no prose, no markdown:
{"groups": [{"name": "Short Name", "color": "blue", "tabIds": [1, 2, 3], "reason": "brief why"}]}`;
}
const SUGGESTCLOSES_FORMAT = `Respond with ONLY a JSON object, no markdown:
{"suggestions": [{"tabId": 123, "reason": "Why this tab can probably be closed (1 short sentence)"}]}`;
const SEARCH_FORMAT = `Respond with ONLY a JSON object, no markdown:
{"matches": [tabId1, tabId2, ...]}`;

// Returns the user's override for a prompt, or the default if none/blank.
async function getGuidance(key) {
  const data = await chrome.storage.local.get("tabview_prompts");
  const overrides = data.tabview_prompts || {};
  const v = overrides[key];
  return (typeof v === "string" && v.trim()) ? v : DEFAULT_PROMPTS[key];
}

async function aiAutoGroup(tabs) {
  const VALID_COLORS = ["grey", "blue", "red", "yellow", "green", "pink", "purple", "cyan", "orange"];
  const briefs = tabs.map(tabBriefLine).join("\n");

  const guidance = await getGuidance("autogroup");
  const system = `${guidance}\n\n${autogroupFormat(VALID_COLORS)}`;

  const user = `Here are ${tabs.length} open tabs. Group them:\n\n${briefs}`;

  const result = await callClaude({ system, user, maxTokens: 3000 });
  if (!result.success) return result;

  const parsed = extractJson(result.text);
  if (!parsed || !Array.isArray(parsed.groups)) {
    return { success: false, error: "AI returned malformed response" };
  }

  // Validate
  const validTabIds = new Set(tabs.map(t => t.id));
  const groups = parsed.groups
    .map(g => ({
      name: String(g.name || "Group"),
      color: VALID_COLORS.includes(g.color) ? g.color : null,
      tabIds: (g.tabIds || []).filter(id => validTabIds.has(id)),
      reason: g.reason || "",
    }))
    .filter(g => g.tabIds.length >= 2);

  return { success: true, groups };
}

// ── Suggest closes ──
async function aiSuggestCloses(tabs) {
  const briefs = tabs.map(tabBriefLine).join("\n");

  const guidance = await getGuidance("suggestcloses");
  const system = `${guidance}\n\n${SUGGESTCLOSES_FORMAT}`;

  const user = `Here are ${tabs.length} open tabs. Flag any that look like good candidates to close:\n\n${briefs}`;

  const result = await callClaude({ system, user, maxTokens: 2500 });
  if (!result.success) return result;

  const parsed = extractJson(result.text);
  if (!parsed || !Array.isArray(parsed.suggestions)) {
    return { success: false, error: "AI returned malformed response" };
  }

  const validTabIds = new Set(tabs.map(t => t.id));
  const suggestions = parsed.suggestions
    .filter(s => validTabIds.has(s.tabId))
    .map(s => ({ tabId: s.tabId, reason: String(s.reason || "Flagged") }));

  return { success: true, suggestions };
}

// ── Per-tab summary ──
async function aiTabSummary(tab) {
  const system = await getGuidance("summary");
  const user = `Title: ${tab.title || "(none)"}\nURL: ${tab.url || "(none)"}\n\nOne-sentence summary:`;
  const result = await callClaude({ system, user, maxTokens: 100 });
  if (!result.success) return result;
  return { success: true, summary: result.text.trim() };
}

// ── Natural-language search ──
async function aiSearch(query, tabs) {
  const briefs = tabs.map(tabBriefLine).join("\n");
  const guidance = await getGuidance("search");
  const system = `${guidance}\n\n${SEARCH_FORMAT}`;
  const user = `Query: "${query}"\n\nTabs:\n${briefs}`;
  const result = await callClaude({ system, user, maxTokens: 1000 });
  if (!result.success) return result;

  const parsed = extractJson(result.text);
  if (!parsed || !Array.isArray(parsed.matches)) {
    return { success: false, error: "AI returned malformed response" };
  }
  const validTabIds = new Set(tabs.map(t => t.id));
  const matches = parsed.matches.filter(id => validTabIds.has(id)).slice(0, 10);
  return { success: true, matches };
}
