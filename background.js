// ── Auto-save interval (minutes) ──
const AUTOSAVE_INTERVAL = 2;
const MAX_AUTOSAVES = 10;

// ── Anthropic model ──
const AI_MODEL = "claude-haiku-4-5-20251001";
const AI_API_URL = "https://api.anthropic.com/v1/messages";

chrome.action.onClicked.addListener(async (tab) => {
  const tabs = await chrome.tabs.query({ currentWindow: true });
  const existing = tabs.find(t => t.url && t.url.startsWith(chrome.runtime.getURL("manager.html")));
  if (existing) {
    chrome.tabs.update(existing.id, { active: true });
    return;
  }
  chrome.tabs.create({ url: "manager.html" });
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
});

// ── Auto-save (crash recovery) ──
chrome.alarms.create("autosave", { periodInMinutes: AUTOSAVE_INTERVAL });

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "autosave") autoSaveSnapshot();
});

chrome.runtime.onStartup.addListener(() => {
  autoSaveSnapshot();
});

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
async function captureTabViaDebugger(tabId) {
  try {
    await chrome.debugger.attach({ tabId }, "1.3");
    const result = await chrome.debugger.sendCommand(
      { tabId },
      "Page.captureScreenshot",
      { format: "jpeg", quality: 50 }
    );
    let jsHeapUsed = 0;
    try {
      await chrome.debugger.sendCommand({ tabId }, "Performance.enable");
      const metrics = await chrome.debugger.sendCommand({ tabId }, "Performance.getMetrics");
      await chrome.debugger.sendCommand({ tabId }, "Performance.disable");
      const heap = metrics.metrics.find(m => m.name === "JSHeapUsedSize");
      if (heap) jsHeapUsed = heap.value;
    } catch (_) {}
    await chrome.debugger.detach({ tabId });
    return {
      success: true,
      dataUrl: "data:image/jpeg;base64," + result.data,
      jsHeapUsed,
    };
  } catch (e) {
    try { await chrome.debugger.detach({ tabId }); } catch (_) {}
    return { success: false, error: e.message, jsHeapUsed: 0 };
  }
}

async function captureAllTabs(tabIds) {
  const results = {};
  for (const tabId of tabIds) {
    results[tabId] = await captureTabViaDebugger(tabId);
  }
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

async function getApiKey() {
  const data = await chrome.storage.local.get("tabview_api_key");
  return data.tabview_api_key || null;
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
  const apiKey = await getApiKey();
  if (!apiKey) return { success: false, error: "No API key set" };

  try {
    const res = await fetch(AI_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify({
        model: AI_MODEL,
        max_tokens: maxTokens,
        system,
        messages: [{ role: "user", content: user }],
      }),
    });

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
    const content = data.content?.[0]?.text;
    if (!content) return { success: false, error: "Empty response" };
    return { success: true, text: content };
  } catch (e) {
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
async function aiAutoGroup(tabs) {
  const VALID_COLORS = ["grey", "blue", "red", "yellow", "green", "pink", "purple", "cyan", "orange"];
  const briefs = tabs.map(tabBriefLine).join("\n");

  const system = `You organize browser tabs into meaningful groups. Group by topic, task, or purpose — not by domain alone. Skip tabs that don't fit a group (don't force everything into a group). Use 2-7 groups total. Group names should be short (1-3 words). Pick a color from: ${VALID_COLORS.join(", ")}.

Respond with ONLY a JSON object in this exact format, no prose, no markdown:
{"groups": [{"name": "Short Name", "color": "blue", "tabIds": [1, 2, 3], "reason": "brief why"}]}`;

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

  const system = `You help users prune their browser tabs. Identify tabs that are good candidates to close:
- Duplicate or near-duplicate tabs (same page or same content)
- Empty/new tabs (about:blank, chrome://newtab)
- Settings or temporary tabs that look done
- Old searches/results pages the user likely doesn't need
- Tabs that appear stale or one-off

Be CONSERVATIVE. Don't flag tabs that look like active reading, documents, code, or long-form content. Only flag tabs you're confident the user is done with. If nothing is worth flagging, return an empty list.

Respond with ONLY a JSON object, no markdown:
{"suggestions": [{"tabId": 123, "reason": "Why this tab can probably be closed (1 short sentence)"}]}`;

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
  const system = `You write one-sentence summaries (under 25 words) of what a web page is likely about, based on its title and URL. Be specific and useful. No filler ("This page is...", "A page about..."). Just the content.`;
  const user = `Title: ${tab.title || "(none)"}\nURL: ${tab.url || "(none)"}\n\nOne-sentence summary:`;
  const result = await callClaude({ system, user, maxTokens: 100 });
  if (!result.success) return result;
  return { success: true, summary: result.text.trim() };
}

// ── Natural-language search ──
async function aiSearch(query, tabs) {
  const briefs = tabs.map(tabBriefLine).join("\n");
  const system = `You are a semantic tab finder. Given a user query in natural language and a list of open browser tabs, return the tab IDs that best match the query, ordered by relevance (most relevant first). Include only tabs that genuinely match — be selective. Return up to 10.

Respond with ONLY a JSON object, no markdown:
{"matches": [tabId1, tabId2, ...]}`;
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
