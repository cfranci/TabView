// ── Elements ──
const grid = document.getElementById("grid");
const tabCountEl = document.getElementById("tabCount");
const captureBtn = document.getElementById("captureAll");
const mergeBtn = document.getElementById("mergeWindows");
const toastEl = document.getElementById("toast");
const actionBar = document.getElementById("actionBar");
const selectedCountEl = document.getElementById("selectedCount");
const searchInput = document.getElementById("searchInput");
const aiSearchToggle = document.getElementById("aiSearchToggle");
const sessionsPanel = document.getElementById("sessionsPanel");
const toggleSessionsBtn = document.getElementById("toggleSessions");
const saveSessionBtn = document.getElementById("saveSession");
const settingsPanel = document.getElementById("settingsPanel");
const openSettingsBtn = document.getElementById("openSettings");
const apiKeyInput = document.getElementById("apiKeyInput");
const saveApiKeyBtn = document.getElementById("saveApiKey");
const clearApiKeyBtn = document.getElementById("clearApiKey");
const apiKeyStatus = document.getElementById("apiKeyStatus");
const providerSelect = document.getElementById("providerSelect");
const anthropicSettings = document.getElementById("anthropicSettings");
const openrouterSettings = document.getElementById("openrouterSettings");
const openrouterKeyInput = document.getElementById("openrouterKeyInput");
const saveOpenrouterKeyBtn = document.getElementById("saveOpenrouterKey");
const clearOpenrouterKeyBtn = document.getElementById("clearOpenrouterKey");
const openrouterModelSelect = document.getElementById("openrouterModelSelect");
const refreshModelsBtn = document.getElementById("refreshModels");
const openrouterStatus = document.getElementById("openrouterStatus");
const localSettings = document.getElementById("localSettings");
const localModelSelect = document.getElementById("localModelSelect");
const refreshLocalModelsBtn = document.getElementById("refreshLocalModels");
const localStatus = document.getElementById("localStatus");
const promptSelect = document.getElementById("promptSelect");
const promptText = document.getElementById("promptText");
const savePromptBtn = document.getElementById("savePrompt");
const resetPromptBtn = document.getElementById("resetPrompt");
const promptStatus = document.getElementById("promptStatus");
const autoRefreshInput = document.getElementById("autoRefreshMinutes");
const saveAutoRefreshBtn = document.getElementById("saveAutoRefresh");
const aiAutoGroupBtn = document.getElementById("aiAutoGroup");
const aiSuggestClosesBtn = document.getElementById("aiSuggestCloses");
const aiModal = document.getElementById("aiModal");
const aiModalTitle = document.getElementById("aiModalTitle");
const aiModalBody = document.getElementById("aiModalBody");
const aiModalFooter = document.getElementById("aiModalFooter");
const aiModalClose = document.getElementById("aiModalClose");
const aiLoading = document.getElementById("aiLoading");
const aiLoadingText = document.getElementById("aiLoadingText");
const hoverTooltip = document.getElementById("hoverTooltip");
const updateBanner = document.getElementById("updateBanner");
const updateBannerText = document.getElementById("updateBannerText");
const updateReloadBtn = document.getElementById("updateReloadBtn");
const updateRepoLink = document.getElementById("updateRepoLink");
const updateDismiss = document.getElementById("updateDismiss");
const REPO_URL = "https://github.com/cfranci/TabView";

// ── State ──
let allWindows = [];
let managerTabId = null;
let managerWindowId = null;
let previews = {};
let previewTimestamps = {};
let selectedTabs = new Set();
let tabMemory = {};
let collapsedWindows = new Set();
let windowNames = {};
let tabGroupInfo = {};
let searchQuery = "";
let aiSearchMode = false;
let aiSearchResults = null; // { tabId: rank }
let aiCloseFlags = new Set();
let summaryCache = {}; // tabId -> string
let summaryInflight = new Set();
let hasApiKey = false;        // active provider is configured (gates AI features)
let aiProvider = "anthropic";
let hasOpenrouterKey = false;
let hasLocalModel = false;
let autoRefreshMinutes = 5;
let promptDefaults = {};   // key -> default guidance, fetched from background
let promptOverrides = {};  // key -> user override (only set keys present)
let lastFocusTimestamp = Date.now();

// ── Load saved prefs ──
try {
  const saved = localStorage.getItem("tabview_windowNames");
  if (saved) windowNames = JSON.parse(saved);
} catch (_) {}

// Card size preference
const CARD_SIZES = { small: 240, medium: 320, large: 440 };
let cardSize = localStorage.getItem("tabview_cardSize") || "medium";
if (!CARD_SIZES[cardSize]) cardSize = "medium";
function applyCardSize(size) {
  cardSize = size;
  document.documentElement.style.setProperty("--card-min", CARD_SIZES[size] + "px");
  document.querySelectorAll(".size-btn").forEach(b => {
    b.classList.toggle("active", b.dataset.size === size);
  });
  localStorage.setItem("tabview_cardSize", size);
}
applyCardSize(cardSize);
document.querySelectorAll(".size-btn").forEach(b => {
  b.addEventListener("click", () => applyCardSize(b.dataset.size));
});

// ── Init ──
(async () => {
  const self = await chrome.tabs.getCurrent();
  managerTabId = self.id;
  managerWindowId = self.windowId;

  await loadSettings();
  await loadAllWindows();
  await captureAllPreviews();
  checkForCrashRecovery();
  setupAutoRefresh();
  setupUpdateBanner();
})();

// ── Update banner ──
async function setupUpdateBanner() {
  updateRepoLink.href = REPO_URL;
  updateReloadBtn.addEventListener("click", () => chrome.runtime.reload());
  updateRepoLink.addEventListener("click", (e) => {
    e.preventDefault();
    chrome.tabs.create({ url: REPO_URL });
  });
  updateDismiss.addEventListener("click", () => updateBanner.classList.add("hidden"));

  // Show whatever the last background check found, then refresh in the background.
  const cached = (await chrome.storage.local.get("tabview_update")).tabview_update;
  if (cached?.available) showUpdateBanner(cached.version);
  const fresh = await chrome.runtime.sendMessage({ type: "checkUpdateNow" });
  if (fresh?.available) showUpdateBanner(fresh.version);
  else updateBanner.classList.add("hidden");
}

function showUpdateBanner(version) {
  const here = chrome.runtime.getManifest().version;
  updateBannerText.textContent = `TabView v${version} is available (you have v${here}). Pull the latest, then reload.`;
  updateBanner.classList.remove("hidden");
}

// ── Settings ──
async function loadSettings() {
  const data = await chrome.storage.local.get([
    "tabview_api_key",
    "tabview_provider",
    "tabview_openrouter_key",
    "tabview_openrouter_model",
    "tabview_local_model",
    "tabview_autorefresh_min",
  ]);
  let provider = data.tabview_provider;
  if (provider !== "anthropic" && provider !== "openrouter" && provider !== "local") {
    // Infer from whichever key exists so a saved OpenRouter key works without
    // also flipping the provider toggle.
    provider = (data.tabview_openrouter_key && !data.tabview_api_key) ? "openrouter" : "anthropic";
  }
  aiProvider = provider;
  hasOpenrouterKey = !!data.tabview_openrouter_key;
  hasLocalModel = !!data.tabview_local_model;
  const hasAnthropicKey = !!data.tabview_api_key;
  hasApiKey = aiProvider === "openrouter" ? hasOpenrouterKey
            : aiProvider === "local" ? hasLocalModel
            : hasAnthropicKey;

  providerSelect.value = aiProvider;
  setModelSelectValue(data.tabview_openrouter_model || "");
  setLocalModelValue(data.tabview_local_model || "");
  if (typeof data.tabview_autorefresh_min === "number") {
    autoRefreshMinutes = data.tabview_autorefresh_min;
  }
  autoRefreshInput.value = autoRefreshMinutes;
  updateProviderUI();
  updateApiKeyUI();
  await loadPrompts();
}

// Show the saved model id as the selected option even before the full catalog
// is fetched, so the current choice is never lost.
function setModelSelectValue(modelId) {
  if (!modelId) return;
  const exists = [...openrouterModelSelect.options].some(o => o.value === modelId);
  if (!exists) {
    const opt = document.createElement("option");
    opt.value = modelId;
    opt.textContent = modelId + " (saved)";
    openrouterModelSelect.insertBefore(opt, openrouterModelSelect.firstChild);
  }
  openrouterModelSelect.value = modelId;
}

function setLocalModelValue(modelId) {
  if (!modelId) return;
  const exists = [...localModelSelect.options].some(o => o.value === modelId);
  if (!exists) {
    const opt = document.createElement("option");
    opt.value = modelId;
    opt.textContent = modelId + " (saved)";
    localModelSelect.insertBefore(opt, localModelSelect.firstChild);
  }
  localModelSelect.value = modelId;
}

async function refreshLocalModels() {
  refreshLocalModelsBtn.disabled = true;
  refreshLocalModelsBtn.textContent = "…";
  localStatus.textContent = "Looking for Ollama…";
  localStatus.className = "settings-status";
  const resp = await chrome.runtime.sendMessage({ type: "getOllamaModels" });
  refreshLocalModelsBtn.disabled = false;
  refreshLocalModelsBtn.textContent = "Refresh";
  if (!resp || !resp.success) {
    localStatus.textContent = resp?.error || "Couldn't reach Ollama. Is it running?";
    localStatus.className = "settings-status err";
    return;
  }
  if (!resp.models.length) {
    localStatus.textContent = "Ollama is running but has no models. Run: ollama pull llama3.2";
    localStatus.className = "settings-status err";
    return;
  }
  const current = (await chrome.storage.local.get("tabview_local_model")).tabview_local_model || "";
  localModelSelect.innerHTML = "";
  resp.models.forEach(m => {
    const opt = document.createElement("option");
    opt.value = m.id;
    opt.textContent = m.name;
    localModelSelect.appendChild(opt);
  });
  const pick = current || resp.models[0].id;
  setLocalModelValue(pick);
  if (!current) {
    await chrome.storage.local.set({ tabview_local_model: pick });
    hasLocalModel = true;
    if (aiProvider === "local") { hasApiKey = true; updateApiKeyUI(); }
  }
  localStatus.textContent = `Found ${resp.models.length} local model${resp.models.length !== 1 ? "s" : ""}. Using ${pick}.`;
  localStatus.className = "settings-status ok";
}

async function refreshModels() {
  refreshModelsBtn.disabled = true;
  refreshModelsBtn.textContent = "…";
  openrouterStatus.textContent = "Loading models…";
  openrouterStatus.className = "settings-status";
  const resp = await chrome.runtime.sendMessage({ type: "getOpenrouterModels" });
  refreshModelsBtn.disabled = false;
  refreshModelsBtn.textContent = "Refresh";
  if (!resp || !resp.success) {
    openrouterStatus.textContent = `Couldn't load models: ${resp?.error || "unknown error"}`;
    openrouterStatus.className = "settings-status err";
    return;
  }
  const data = await chrome.storage.local.get("tabview_openrouter_model");
  const current = data.tabview_openrouter_model || "";

  const free = resp.models.filter(m => m.free);
  const paid = resp.models.filter(m => !m.free);
  openrouterModelSelect.innerHTML = "";
  const mkOption = (m) => {
    const opt = document.createElement("option");
    opt.value = m.id;
    opt.textContent = `${m.name} — ${m.free ? "free" : "paid"}`;
    return opt;
  };
  const mkGroup = (label, list) => {
    if (!list.length) return;
    const og = document.createElement("optgroup");
    og.label = label;
    list.forEach(m => og.appendChild(mkOption(m)));
    openrouterModelSelect.appendChild(og);
  };
  mkGroup(`Free (${free.length})`, free);
  mkGroup(`Paid (${paid.length})`, paid);

  if (current) {
    setModelSelectValue(current);
    openrouterStatus.textContent = `Loaded ${resp.models.length} models (${free.length} free).`;
    openrouterStatus.className = "settings-status ok";
  } else {
    // Nothing chosen yet — auto-select a reputable free model so it works
    // out of the box. The user can change it from the dropdown.
    const pick = free.find(m => /gpt-oss|llama|deepseek|gemini|qwen|mistral/.test(m.id)
                                 && !/guard|safety|vision|embed/.test(m.id))
              || free[0] || resp.models[0];
    if (pick) {
      setModelSelectValue(pick.id);
      await chrome.storage.local.set({ tabview_openrouter_model: pick.id });
      openrouterStatus.textContent = `Loaded ${resp.models.length} models. Auto-picked free: ${pick.id}`;
      openrouterStatus.className = "settings-status ok";
    }
  }
}

// ── AI prompt editor ──
const PROMPT_LABELS = {
  autogroup: "Auto-group",
  suggestcloses: "Suggest closes",
  summary: "Tab summary",
  search: "Search",
};

async function loadPrompts() {
  promptDefaults = (await chrome.runtime.sendMessage({ type: "getPromptDefaults" })) || {};
  const data = await chrome.storage.local.get("tabview_prompts");
  promptOverrides = data.tabview_prompts || {};
  renderPrompt();
}

function renderPrompt() {
  const key = promptSelect.value;
  const overridden = typeof promptOverrides[key] === "string" && promptOverrides[key].trim();
  promptText.value = overridden ? promptOverrides[key] : (promptDefaults[key] || "");
  if (overridden) {
    promptStatus.textContent = "Custom prompt in use";
    promptStatus.className = "settings-status ok";
  } else {
    promptStatus.textContent = "Using default";
    promptStatus.className = "settings-status";
  }
}

function updateProviderUI() {
  anthropicSettings.classList.toggle("hidden", aiProvider !== "anthropic");
  openrouterSettings.classList.toggle("hidden", aiProvider !== "openrouter");
  localSettings.classList.toggle("hidden", aiProvider !== "local");
}

function updateApiKeyUI() {
  // Anthropic section status
  if (aiProvider === "anthropic" && hasApiKey) {
    apiKeyStatus.textContent = "✓ Key saved";
    apiKeyStatus.className = "settings-status ok";
    apiKeyInput.placeholder = "••••••••••••••• (saved)";
    apiKeyInput.value = "";
  } else {
    apiKeyStatus.textContent = aiProvider === "anthropic"
      ? "No key set — AI features disabled" : "";
    apiKeyStatus.className = "settings-status";
  }

  // OpenRouter section status
  if (hasOpenrouterKey) {
    openrouterStatus.textContent = "✓ Key saved";
    openrouterStatus.className = "settings-status ok";
    openrouterKeyInput.placeholder = "••••••••••••••• (saved)";
    openrouterKeyInput.value = "";
  } else {
    openrouterStatus.textContent = aiProvider === "openrouter"
      ? "No key set — AI features disabled" : "";
    openrouterStatus.className = "settings-status";
  }

  // Local (Ollama) section status
  if (aiProvider === "local") {
    if (hasLocalModel && localModelSelect.value) {
      localStatus.textContent = `✓ Using ${localModelSelect.value}`;
      localStatus.className = "settings-status ok";
    } else if (!localStatus.textContent) {
      localStatus.textContent = "Pick a local model (click Refresh)";
      localStatus.className = "settings-status";
    }
  }

  aiAutoGroupBtn.disabled = !hasApiKey;
  aiSuggestClosesBtn.disabled = !hasApiKey;
  aiSearchToggle.style.opacity = hasApiKey ? "1" : "0.5";
}

openSettingsBtn.addEventListener("click", () => {
  settingsPanel.classList.toggle("hidden");
});

providerSelect.addEventListener("change", async () => {
  const v = providerSelect.value;
  aiProvider = (v === "openrouter" || v === "local") ? v : "anthropic";
  await chrome.storage.local.set({ tabview_provider: aiProvider });
  // Recompute whether the now-active provider is configured.
  const data = await chrome.storage.local.get(["tabview_api_key", "tabview_openrouter_key", "tabview_local_model"]);
  hasOpenrouterKey = !!data.tabview_openrouter_key;
  hasLocalModel = !!data.tabview_local_model;
  hasApiKey = aiProvider === "openrouter" ? hasOpenrouterKey
            : aiProvider === "local" ? hasLocalModel
            : !!data.tabview_api_key;
  updateProviderUI();
  updateApiKeyUI();
  const label = aiProvider === "openrouter" ? "OpenRouter" : aiProvider === "local" ? "Local (Ollama)" : "Anthropic";
  toast(`Provider: ${label}`);
});

saveApiKeyBtn.addEventListener("click", async () => {
  const key = apiKeyInput.value.trim();
  if (!key) {
    apiKeyStatus.textContent = "Enter a key first";
    apiKeyStatus.className = "settings-status err";
    return;
  }
  if (!key.startsWith("sk-ant-")) {
    apiKeyStatus.textContent = "Keys start with sk-ant-";
    apiKeyStatus.className = "settings-status err";
    return;
  }
  await chrome.storage.local.set({ tabview_api_key: key });
  if (aiProvider === "anthropic") hasApiKey = true;
  updateApiKeyUI();
  toast("Anthropic key saved");
});

clearApiKeyBtn.addEventListener("click", async () => {
  await chrome.storage.local.remove("tabview_api_key");
  if (aiProvider === "anthropic") hasApiKey = false;
  apiKeyInput.placeholder = "sk-ant-...";
  updateApiKeyUI();
  toast("Anthropic key cleared");
});

saveOpenrouterKeyBtn.addEventListener("click", async () => {
  const key = openrouterKeyInput.value.trim();
  if (!key) {
    openrouterStatus.textContent = "Enter a key first";
    openrouterStatus.className = "settings-status err";
    return;
  }
  // Saving an OpenRouter key also selects OpenRouter as the active provider, so
  // the AI features start using it immediately.
  await chrome.storage.local.set({ tabview_openrouter_key: key, tabview_provider: "openrouter" });
  hasOpenrouterKey = true;
  aiProvider = "openrouter";
  hasApiKey = true;
  providerSelect.value = "openrouter";
  updateProviderUI();
  updateApiKeyUI();
  toast("OpenRouter key saved — provider set to OpenRouter. Click Refresh to pick a model.");
});

clearOpenrouterKeyBtn.addEventListener("click", async () => {
  await chrome.storage.local.remove("tabview_openrouter_key");
  hasOpenrouterKey = false;
  if (aiProvider === "openrouter") hasApiKey = false;
  openrouterKeyInput.placeholder = "sk-or-...";
  updateApiKeyUI();
  toast("OpenRouter key cleared");
});

refreshModelsBtn.addEventListener("click", refreshModels);

openrouterModelSelect.addEventListener("change", async () => {
  const model = openrouterModelSelect.value;
  if (!model) return;
  await chrome.storage.local.set({ tabview_openrouter_model: model });
  toast(`Model: ${model}`);
});

refreshLocalModelsBtn.addEventListener("click", refreshLocalModels);

localModelSelect.addEventListener("change", async () => {
  const model = localModelSelect.value;
  if (!model) return;
  await chrome.storage.local.set({ tabview_local_model: model });
  hasLocalModel = true;
  if (aiProvider === "local") { hasApiKey = true; updateApiKeyUI(); }
  toast(`Local model: ${model}`);
});

promptSelect.addEventListener("change", renderPrompt);

savePromptBtn.addEventListener("click", async () => {
  const key = promptSelect.value;
  const text = promptText.value.trim();
  if (!text) {
    promptStatus.textContent = "Prompt can't be empty — use Reset for the default";
    promptStatus.className = "settings-status err";
    return;
  }
  promptOverrides[key] = text;
  await chrome.storage.local.set({ tabview_prompts: promptOverrides });
  renderPrompt();
  toast(`${PROMPT_LABELS[key]} prompt saved`);
});

resetPromptBtn.addEventListener("click", async () => {
  const key = promptSelect.value;
  if (!confirm(`Are you sure you want to reset the ${PROMPT_LABELS[key]} prompt to default?`)) return;
  delete promptOverrides[key];
  await chrome.storage.local.set({ tabview_prompts: promptOverrides });
  renderPrompt();
  toast(`${PROMPT_LABELS[key]} prompt reset to default`);
});

saveAutoRefreshBtn.addEventListener("click", async () => {
  const n = parseInt(autoRefreshInput.value, 10);
  if (isNaN(n) || n < 0) {
    toast("Enter a number 0-60");
    return;
  }
  autoRefreshMinutes = n;
  await chrome.storage.local.set({ tabview_autorefresh_min: n });
  toast(`Auto-refresh: ${n === 0 ? "off" : `after ${n} min away`}`);
});

document.querySelectorAll(".settings-link").forEach(el => {
  el.addEventListener("click", () => {
    chrome.tabs.create({ url: el.dataset.url });
  });
});

// ── Load all windows ──
async function loadAllWindows() {
  const windows = await chrome.windows.getAll({ populate: true });
  allWindows = windows.map(win => ({
    id: win.id,
    tabs: win.tabs.filter(t => t.id !== managerTabId),
  })).filter(win => win.tabs.length > 0);

  await loadTabGroupInfo();
  updateTabCount();
  renderAll();
}

async function loadTabGroupInfo() {
  tabGroupInfo = {};
  try {
    const groups = await chrome.tabGroups.query({});
    for (const group of groups) {
      tabGroupInfo[group.id] = { title: group.title, color: group.color };
    }
  } catch (_) {}
}

function updateTabCount() {
  const totalTabs = allWindows.reduce((sum, w) => sum + w.tabs.length, 0);
  const totalMem = Object.values(tabMemory).reduce((sum, m) => sum + m, 0);
  const memStr = totalMem ? ` | ${formatMemory(totalMem)}` : "";
  tabCountEl.textContent = `${totalTabs} tabs across ${allWindows.length} window${allWindows.length !== 1 ? "s" : ""}${memStr}`;
}

// ── Memory ──
function formatMemory(bytes) {
  if (!bytes) return "";
  const mb = bytes / (1024 * 1024);
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`;
  return `${Math.round(mb)} MB`;
}

// ── Group color map ──
const groupColorMap = {
  grey: "#5f6368",
  blue: "#5b8def",
  red: "#e53935",
  yellow: "#f9ab00",
  green: "#34a853",
  pink: "#e91e8a",
  purple: "#a142f4",
  cyan: "#24c1e0",
  orange: "#e8a040",
};
const groupColorList = ["blue", "red", "yellow", "green", "pink", "purple", "cyan", "orange"];

// ── Search ──
searchInput.addEventListener("input", (e) => {
  searchQuery = e.target.value.trim();
  if (!aiSearchMode) renderAll();
});

searchInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && aiSearchMode && searchQuery) {
    runAiSearch();
  }
});

aiSearchToggle.addEventListener("click", () => {
  if (!hasApiKey) {
    toast("Set an API key in Settings first");
    settingsPanel.classList.remove("hidden");
    return;
  }
  aiSearchMode = !aiSearchMode;
  aiSearchToggle.classList.toggle("active", aiSearchMode);
  searchInput.classList.toggle("ai-mode", aiSearchMode);
  searchInput.placeholder = aiSearchMode
    ? "Describe what you're looking for (Enter to search)..."
    : "Search tabs by title or URL...";
  aiSearchResults = null;
  renderAll();
});

// Shift-held: reveal all checkboxes and enable shift-click-anywhere selection
document.addEventListener("keydown", (e) => {
  if (e.key === "Shift") document.body.classList.add("shift-held");
});
document.addEventListener("keyup", (e) => {
  if (e.key === "Shift") document.body.classList.remove("shift-held");
});
window.addEventListener("blur", () => document.body.classList.remove("shift-held"));

// OS detection so shortcut hints show the right modifier (Chrome exposes this).
const IS_MAC = (navigator.userAgentData?.platform || navigator.platform || "").toLowerCase().includes("mac");
const MOD_LABEL = IS_MAC ? "⌘" : "Ctrl+";
captureBtn.title = `Re-capture a fresh screenshot of every tab (${MOD_LABEL}R)`;

// Cmd+R (mac) / Ctrl+R (Windows) refreshes captures instead of reloading the page.
document.addEventListener("keydown", (e) => {
  const mod = IS_MAC ? e.metaKey : e.ctrlKey;
  if (mod && !e.shiftKey && (e.key === "r" || e.key === "R")) {
    e.preventDefault();
    if (!captureBtn.disabled) captureAllPreviews();
  }
});

document.addEventListener("keydown", (e) => {
  if (e.key === "/" && document.activeElement !== searchInput) {
    e.preventDefault();
    searchInput.focus();
  }
  if (e.key === "Escape") {
    if (document.activeElement === searchInput) {
      searchInput.value = "";
      searchQuery = "";
      aiSearchResults = null;
      searchInput.blur();
      renderAll();
    } else if (!aiModal.classList.contains("hidden")) {
      closeAiModal();
    } else if (!helpModal.classList.contains("hidden")) {
      closeHelp();
    } else if (!settingsPanel.classList.contains("hidden")) {
      settingsPanel.classList.add("hidden");
    }
  }
});

function tabMatchesSearch(tab) {
  if (!searchQuery || aiSearchMode) return true;
  const q = searchQuery.toLowerCase();
  const title = (tab.title || "").toLowerCase();
  const url = (tab.url || "").toLowerCase();
  return title.includes(q) || url.includes(q);
}

// ── Render ──
function renderAll() {
  grid.innerHTML = "";
  allWindows.forEach(win => {
    const filteredTabs = win.tabs.filter(tabMatchesSearch);
    if (filteredTabs.length === 0 && searchQuery && !aiSearchMode) return;

    const section = document.createElement("div");
    section.className = "window-section";
    if (win.id === managerWindowId) section.classList.add("current-window");
    section.dataset.windowId = win.id;

    const isCollapsed = collapsedWindows.has(win.id);
    const isCurrent = win.id === managerWindowId;
    const name = windowNames[win.id] || (isCurrent ? "Current Window" : "Window");
    const displayCount = searchQuery && !aiSearchMode ? filteredTabs.length : win.tabs.length;

    // Header
    const header = document.createElement("div");
    header.className = "window-header";

    const visibleTabs = (searchQuery && !aiSearchMode) ? filteredTabs : win.tabs;
    const allSelected = visibleTabs.length > 0 && visibleTabs.every(t => selectedTabs.has(t.id));
    const someSelected = visibleTabs.some(t => selectedTabs.has(t.id));

    header.innerHTML = `
      <button class="collapse-toggle" title="${isCollapsed ? "Expand" : "Collapse"}">
        <span class="collapse-arrow ${isCollapsed ? "collapsed" : ""}">&#9660;</span>
      </button>
      <input type="checkbox" class="window-select-all" title="Select all in this window">
      <span class="window-name">${escapeHtml(name)}</span>
      ${isCurrent ? `<span class="window-current-badge">This Window</span>` : ""}
      <span class="window-tab-count">(${displayCount})</span>
      <span class="window-spacer"></span>
      <div class="window-actions">
        <button class="window-action-btn primary" data-action="add-selected" title="Move currently selected tabs into this window">+ Add Selected</button>
        ${!isCurrent ? `<button class="window-action-btn" data-action="move-here" title="Move all tabs from this window into the TabView window">⇆ Move Here</button>` : ""}
        <button class="window-action-btn" data-action="group-all" title="Put all tabs in this window into a Chrome tab group">⊞ Group All</button>
        <button class="window-action-btn" data-action="pause-all" title="Unload all tabs in this window from RAM (they reload when visited)">⏸ Pause All</button>
        <button class="window-action-btn danger" data-action="close-all" title="Close every tab in this window">× Close All</button>
      </div>
    `;

    const selAll = header.querySelector(".window-select-all");
    selAll.checked = allSelected;
    selAll.indeterminate = !allSelected && someSelected;
    selAll.addEventListener("click", (e) => {
      e.stopPropagation();
      toggleSelectAllInWindow(win.id, e.target.checked);
    });

    header.querySelector(".collapse-toggle").addEventListener("click", () => {
      if (collapsedWindows.has(win.id)) collapsedWindows.delete(win.id);
      else collapsedWindows.add(win.id);
      renderAll();
    });

    const nameEl = header.querySelector(".window-name");
    nameEl.addEventListener("dblclick", (e) => {
      e.stopPropagation();
      const input = document.createElement("input");
      input.type = "text";
      input.className = "window-name-input";
      input.value = windowNames[win.id] || name;
      nameEl.replaceWith(input);
      input.focus();
      input.select();
      const save = () => {
        const newName = input.value.trim() || name;
        windowNames[win.id] = newName;
        localStorage.setItem("tabview_windowNames", JSON.stringify(windowNames));
        renderAll();
      };
      input.addEventListener("blur", save);
      input.addEventListener("keydown", (ev) => {
        if (ev.key === "Enter") save();
        if (ev.key === "Escape") renderAll();
      });
    });

    header.querySelectorAll(".window-action-btn").forEach(btn => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        handleWindowAction(btn.dataset.action, win.id);
      });
    });

    section.appendChild(header);

    if (!isCollapsed) {
      const windowGrid = document.createElement("div");
      windowGrid.className = "window-grid";
      renderWindowBody(windowGrid, visibleTabs, win.id);
      section.appendChild(windowGrid);
    }

    // Drop anywhere in this window (header, empty space, collapsed strip) to move
    // the dragged tab/group into it. Card/cluster drops stopPropagation, so this
    // only fires for drops that didn't land on a specific card or group.
    attachSectionDropHandlers(section, win.id);

    grid.appendChild(section);
  });
}

// ── Render a window's body: walk tabs in Chrome's tab-strip order, render
//    group clusters in-place wherever a grouped tab first appears ──
function renderWindowBody(container, tabs, windowId) {
  // AI search mode: ignore Chrome tab order, sort by AI rank for clear ranked results
  if (aiSearchMode && aiSearchResults) {
    const ranked = tabs.slice().sort((a, b) => {
      const ra = aiSearchResults[a.id] ?? 999;
      const rb = aiSearchResults[b.id] ?? 999;
      return ra - rb;
    });
    ranked.forEach(tab => container.appendChild(createTabCard(tab, tab.index, windowId)));
    return;
  }

  // Default: render in Chrome's actual tab order, with grouped runs as clusters
  const sortedTabs = tabs.slice().sort((a, b) => a.index - b.index);
  const rendered = new Set();
  for (const tab of sortedTabs) {
    if (rendered.has(tab.id)) continue;
    if (tab.groupId !== -1 && tabGroupInfo[tab.groupId]) {
      const gtabs = sortedTabs.filter(t => t.groupId === tab.groupId);
      renderGroupCluster(container, tab.groupId, gtabs, windowId);
      gtabs.forEach(t => rendered.add(t.id));
    } else {
      container.appendChild(createTabCard(tab, tab.index, windowId));
      rendered.add(tab.id);
    }
  }
}

function renderGroupCluster(container, groupId, gtabs, windowId) {
  const info = tabGroupInfo[groupId];
  const color = groupColorMap[info.color] || "#5f6368";
  const cluster = document.createElement("div");
  cluster.className = "group-cluster";
  cluster.dataset.tabCount = gtabs.length;
  cluster.style.setProperty("--group-accent", color);
  cluster.style.setProperty("--group-bg", hexToRgba(color, 0.06));
  cluster.style.setProperty("--group-border", hexToRgba(color, 0.3));

  const allGroupSelected = gtabs.every(t => selectedTabs.has(t.id));
  const someGroupSelected = gtabs.some(t => selectedTabs.has(t.id));
  const allPaused = gtabs.every(t => t.discarded);

  cluster.innerHTML = `
    <div class="group-cluster-header" title="Drag to reorder this group in the Chrome tab strip">
      <input type="checkbox" class="window-select-all" title="Select every tab in this group">
      <span class="group-cluster-name" title="${escapeHtml(info.title || "Group")}">${escapeHtml(info.title || "Group")}</span>
      <span class="group-cluster-count" title="Number of tabs in this group">${gtabs.length} tab${gtabs.length !== 1 ? "s" : ""}</span>
      <div class="group-cluster-actions">
        <button class="window-action-btn" data-action="pause-group" title="${allPaused ? "Already paused" : "Free RAM by unloading these tabs — visiting reloads them"}" ${allPaused ? "disabled" : ""}>${allPaused ? "Paused" : "⏸ Pause"}</button>
        <button class="window-action-btn" data-action="ungroup" title="Remove these tabs from the group">Ungroup</button>
        <button class="window-action-btn danger" data-action="close-group" title="Close all tabs in this group">Close Group</button>
      </div>
    </div>
    <div class="group-cluster-grid"></div>
  `;

  const groupSel = cluster.querySelector(".window-select-all");
  groupSel.checked = allGroupSelected;
  groupSel.indeterminate = !allGroupSelected && someGroupSelected;
  groupSel.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleSelectTabs(gtabs.map(t => t.id), e.target.checked);
  });

  cluster.querySelectorAll(".window-action-btn").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const action = btn.dataset.action;
      if (action === "ungroup") ungroupTabs(gtabs.map(t => t.id));
      else if (action === "close-group") closeTabIds(gtabs.map(t => t.id));
      else if (action === "pause-group") pauseTabIds(gtabs.map(t => t.id), "group");
    });
  });

  const grid = cluster.querySelector(".group-cluster-grid");
  gtabs.forEach(tab => grid.appendChild(createTabCard(tab, tab.index, windowId)));

  // Make the cluster header a drag handle; allow dropping tabs/other groups onto the cluster
  const headerEl = cluster.querySelector(".group-cluster-header");
  attachGroupDragHandlers(cluster, headerEl, groupId, gtabs, windowId);

  container.appendChild(cluster);
}

// ── Create a tab card ──
function createTabCard(tab, index, windowId) {
  const card = document.createElement("div");
  card.className = `tab-card${selectedTabs.has(tab.id) ? " selected" : ""}`;
  if (tab.discarded) card.classList.add("paused");
  if (aiCloseFlags.has(tab.id)) card.classList.add("ai-flagged-close");
  if (aiSearchMode && aiSearchResults && aiSearchResults[tab.id] !== undefined && aiSearchResults[tab.id] < 5) {
    card.classList.add("ai-rank-top");
  }
  card.draggable = true;
  card.dataset.tabId = tab.id;
  card.dataset.index = index;
  card.dataset.windowId = windowId;
  // Embed the full title and URL invisibly on the card (not just the visible/
  // truncated title). Present in the DOM for search, copy, and recovery; never shown.
  card.dataset.url = tab.url || "";
  card.dataset.title = tab.title || "";

  const preview = previews[tab.id];
  const previewAge = previewTimestamps[tab.id] ? (Date.now() - previewTimestamps[tab.id]) : null;
  const isStale = previewAge !== null && previewAge > 30 * 60 * 1000; // 30 min
  const previewHtml = preview
    ? `<img src="${preview}" alt="Preview">${isStale ? `<span class="preview-stale-tag">stale</span>` : ""}`
    : `<div class="placeholder">
         ${tab.favIconUrl ? `<img src="${tab.favIconUrl}" alt="">` : ""}
         <span>Capturing...</span>
       </div>`;

  const memText = formatMemory(tabMemory[tab.id]);
  const memHigh = (tabMemory[tab.id] || 0) > 100 * 1024 * 1024;

  // Highlight search matches in title
  const titleText = tab.title || "Untitled";
  const displayTitle = searchQuery && !aiSearchMode
    ? highlightMatch(titleText, searchQuery)
    : escapeHtml(titleText);

  const rankBadge = aiSearchMode && aiSearchResults && aiSearchResults[tab.id] !== undefined
    ? `<span class="ai-rank-badge">#${aiSearchResults[tab.id] + 1}</span>`
    : "";

  const pausedBadge = tab.discarded ? `<span class="paused-badge" title="Paused — unloaded from RAM. Click to reload.">⏸ Paused</span>` : "";

  card.innerHTML = `
    <input type="checkbox" class="tab-checkbox" title="Select this tab (Shift+click anywhere on the card also works)" ${selectedTabs.has(tab.id) ? "checked" : ""}>
    <span class="index-badge" title="Tab position in the window">${index + 1}</span>
    <button class="close-btn" title="Close this tab">&times;</button>
    <div class="preview" title="Click to switch to this tab">${previewHtml}</div>
    ${rankBadge}
    ${pausedBadge}
    <div class="info">
      ${tab.favIconUrl ? `<img class="favicon" src="${tab.favIconUrl}" alt="">` : ""}
      <span class="title" title="${escapeHtml(tab.url || "")}">${displayTitle}</span>
      <span class="ram-badge${memHigh ? " ram-high" : ""}">${memText}</span>
    </div>
  `;

  // Shift+click anywhere on the card toggles selection (catches before title/preview handlers)
  card.addEventListener("click", (e) => {
    if (!e.shiftKey) return;
    if (e.target.closest(".tab-checkbox") || e.target.closest(".close-btn")) return;
    e.preventDefault();
    e.stopPropagation();
    toggleSelect(tab.id);
  }, true);

  card.querySelector(".tab-checkbox").addEventListener("change", (e) => {
    e.stopPropagation();
    toggleSelect(tab.id);
  });

  card.querySelector(".title").addEventListener("click", (e) => {
    e.stopPropagation();
    chrome.tabs.update(tab.id, { active: true });
    chrome.windows.update(windowId, { focused: true });
  });

  card.querySelector(".close-btn").addEventListener("click", (e) => {
    e.stopPropagation();
    closeTab(tab.id, card);
  });

  card.querySelector(".preview").addEventListener("click", () => {
    chrome.tabs.update(tab.id, { active: true });
    chrome.windows.update(windowId, { focused: true });
  });

  // Hover summary
  let hoverTimer;
  card.addEventListener("mouseenter", (e) => {
    if (!hasApiKey) return;
    hoverTimer = setTimeout(() => showHoverSummary(tab, card), 600);
  });
  card.addEventListener("mouseleave", () => {
    clearTimeout(hoverTimer);
    hideHoverSummary();
  });
  card.addEventListener("mousemove", (e) => {
    if (!hoverTooltip.classList.contains("hidden")) {
      positionTooltip(e);
    }
  });

  card.addEventListener("dragstart", onDragStart);
  card.addEventListener("dragend", onDragEnd);
  card.addEventListener("dragover", onDragOver);
  card.addEventListener("dragenter", onDragEnter);
  card.addEventListener("dragleave", onDragLeave);
  card.addEventListener("drop", onDrop);

  return card;
}

function highlightMatch(text, query) {
  const escaped = escapeHtml(text);
  const escapedQuery = escapeHtml(query);
  const regex = new RegExp(`(${escapedQuery.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi");
  return escaped.replace(regex, `<mark>$1</mark>`);
}

function hexToRgba(hex, alpha) {
  const h = hex.replace("#", "");
  const r = parseInt(h.substring(0, 2), 16);
  const g = parseInt(h.substring(2, 4), 16);
  const b = parseInt(h.substring(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// ── Selection ──
function toggleSelect(tabId) {
  if (selectedTabs.has(tabId)) selectedTabs.delete(tabId);
  else selectedTabs.add(tabId);
  renderAll();
  updateActionBar();
}

function toggleSelectTabs(tabIds, checked) {
  for (const id of tabIds) {
    if (checked) selectedTabs.add(id);
    else selectedTabs.delete(id);
  }
  renderAll();
  updateActionBar();
}

function toggleSelectAllInWindow(windowId, checked) {
  const win = allWindows.find(w => w.id === windowId);
  if (!win) return;
  toggleSelectTabs(win.tabs.map(t => t.id), checked);
}

function updateActionBar() {
  const count = selectedTabs.size;
  if (count === 0) {
    actionBar.classList.add("hidden");
  } else {
    actionBar.classList.remove("hidden");
    selectedCountEl.textContent = `${count} selected`;
  }
}

// ── Window actions ──
async function handleWindowAction(action, windowId) {
  if (action === "add-selected") return addSelectedToWindow(windowId);
  if (action === "move-here") return moveWindowHere(windowId);
  if (action === "group-all") return groupAllInWindow(windowId);
  if (action === "pause-all") return pauseAllInWindow(windowId);
  if (action === "close-all") return closeAllInWindow(windowId);
}

async function pauseAllInWindow(windowId) {
  const win = allWindows.find(w => w.id === windowId);
  if (!win) return;
  const candidateIds = win.tabs.filter(t => !t.active && !t.discarded).map(t => t.id);
  if (candidateIds.length === 0) {
    toast("Nothing to pause in this window");
    return;
  }
  await pauseTabIds(candidateIds, "window");
}

async function pauseTabIds(tabIds, label) {
  let paused = 0;
  let freedMem = 0;
  for (const id of tabIds) {
    if (tabMemory[id]) freedMem += tabMemory[id];
    try {
      await chrome.tabs.discard(id);
      paused++;
      delete tabMemory[id];
    } catch (_) {}
  }
  await loadAllWindows();
  const memStr = freedMem ? ` (~${formatMemory(freedMem)} freed)` : "";
  toast(`Paused ${paused} tab${paused !== 1 ? "s" : ""}${memStr}`);
}

async function addSelectedToWindow(targetWindowId) {
  if (selectedTabs.size === 0) {
    toast("Select some tabs first");
    return;
  }
  const tabIds = Array.from(selectedTabs).filter(id => {
    const win = allWindows.find(w => w.tabs.some(t => t.id === id));
    return win && win.id !== targetWindowId;
  });
  if (tabIds.length === 0) {
    toast("Selected tabs are already in this window");
    return;
  }
  let moved = 0;
  for (const id of tabIds) {
    try {
      await chrome.tabs.move(id, { windowId: targetWindowId, index: -1 });
      moved++;
    } catch (_) {}
  }
  selectedTabs.clear();
  updateActionBar();
  await loadAllWindows();
  toast(`Moved ${moved} tabs into window`);
}

async function moveWindowHere(sourceWindowId) {
  const win = allWindows.find(w => w.id === sourceWindowId);
  if (!win) return;
  let moved = 0;
  for (const tab of win.tabs) {
    try {
      await chrome.tabs.move(tab.id, { windowId: managerWindowId, index: -1 });
      moved++;
    } catch (_) {}
  }
  await loadAllWindows();
  toast(`Moved ${moved} tabs to current window`);
}

async function groupAllInWindow(windowId) {
  const win = allWindows.find(w => w.id === windowId);
  if (!win) return;
  const name = prompt("Group name for all tabs in this window (leave empty for none):");
  if (name === null) return;
  const tabIds = win.tabs.map(t => t.id);
  try {
    const groupId = await chrome.tabs.group({ tabIds, createProperties: { windowId } });
    if (name) {
      const color = groupColorList[Math.floor(Math.random() * groupColorList.length)];
      await chrome.tabGroups.update(groupId, { title: name, color });
    }
    await loadAllWindows();
    toast(`Grouped ${tabIds.length} tabs`);
  } catch (e) {
    toast("Failed to group");
  }
}

async function closeAllInWindow(windowId) {
  const win = allWindows.find(w => w.id === windowId);
  if (!win) return;
  if (!confirm(`Close all ${win.tabs.length} tabs in this window?`)) return;
  let closed = 0;
  for (const tab of win.tabs) {
    try {
      await chrome.tabs.remove(tab.id);
      delete previews[tab.id];
      delete tabMemory[tab.id];
      selectedTabs.delete(tab.id);
      closed++;
    } catch (_) {}
  }
  updateActionBar();
  await loadAllWindows();
  toast(`Closed ${closed} tabs`);
}

async function ungroupTabs(tabIds) {
  try {
    await chrome.tabs.ungroup(tabIds);
    await loadAllWindows();
    toast(`Ungrouped ${tabIds.length} tabs`);
  } catch (_) {
    toast("Failed to ungroup");
  }
}

async function closeTabIds(tabIds) {
  if (!confirm(`Close ${tabIds.length} tabs?`)) return;
  let closed = 0;
  for (const id of tabIds) {
    try {
      await chrome.tabs.remove(id);
      delete previews[id];
      delete tabMemory[id];
      selectedTabs.delete(id);
      closed++;
    } catch (_) {}
  }
  updateActionBar();
  await loadAllWindows();
  toast(`Closed ${closed} tabs`);
}

// ── Action bar handlers ──
async function groupSelectedTabs() {
  if (selectedTabs.size === 0) return;
  const name = prompt("Group name (leave empty for none):");
  if (name === null) return;
  const ids = Array.from(selectedTabs);
  try {
    // chrome.tabs.group can't span windows, so bucket the selection by window
    // and make one group per window (same name + color for consistency).
    const byWindow = {};
    const tabObjs = await Promise.all(ids.map(id => chrome.tabs.get(id).catch(() => null)));
    for (const t of tabObjs) {
      if (!t) continue;
      (byWindow[t.windowId] ||= []).push(t.id);
    }
    const color = groupColorList[Math.floor(Math.random() * groupColorList.length)];
    let grouped = 0;
    for (const [winId, winTabIds] of Object.entries(byWindow)) {
      const groupId = await chrome.tabs.group({ tabIds: winTabIds, createProperties: { windowId: Number(winId) } });
      if (name) await chrome.tabGroups.update(groupId, { title: name, color });
      grouped += winTabIds.length;
    }
    selectedTabs.clear();
    updateActionBar();
    await loadAllWindows();
    const winCount = Object.keys(byWindow).length;
    toast(`Grouped ${grouped} tabs${winCount > 1 ? ` across ${winCount} windows` : ""}`);
  } catch (e) {
    toast("Failed to group tabs");
  }
}

async function discardSelectedTabs() {
  if (selectedTabs.size === 0) return;
  let discarded = 0;
  for (const tabId of selectedTabs) {
    try {
      await chrome.tabs.discard(tabId);
      discarded++;
    } catch (_) {}
  }
  selectedTabs.clear();
  updateActionBar();
  await loadAllWindows();
  toast(`Discarded ${discarded} tabs -- RAM freed`);
}

async function exportSelectedToWindow() {
  if (selectedTabs.size === 0) return;
  const tabIds = Array.from(selectedTabs);
  try {
    const newWin = await chrome.windows.create({ tabId: tabIds[0] });
    for (const id of tabIds.slice(1)) {
      try { await chrome.tabs.move(id, { windowId: newWin.id, index: -1 }); } catch (_) {}
    }
    selectedTabs.clear();
    updateActionBar();
    await loadAllWindows();
    toast(`Exported ${tabIds.length} tab${tabIds.length !== 1 ? "s" : ""} to new window`);
  } catch (e) {
    toast("Export failed: " + e.message);
  }
}

async function closeSelectedTabs() {
  if (selectedTabs.size === 0) return;
  const count = selectedTabs.size;
  for (const tabId of selectedTabs) {
    try { await chrome.tabs.remove(tabId); } catch (_) {}
    delete previews[tabId];
    delete tabMemory[tabId];
  }
  selectedTabs.clear();
  updateActionBar();
  await loadAllWindows();
  toast(`Closed ${count} tabs`);
}

async function mergeAllWindows() {
  if (allWindows.length <= 1) {
    toast("Only one window open");
    return;
  }
  mergeBtn.disabled = true;
  mergeBtn.textContent = "Merging...";
  let moved = 0;
  for (const win of allWindows) {
    if (win.id === managerWindowId) continue;

    // Move whole tab groups first. Moving grouped tabs individually with
    // chrome.tabs.move ungroups them; chrome.tabGroups.move carries the group
    // (membership, title, color) into the target window intact.
    const groupIds = [...new Set(
      win.tabs.map(t => t.groupId).filter(gid => gid !== undefined && gid !== -1)
    )];
    for (const gid of groupIds) {
      try {
        await chrome.tabGroups.move(gid, { windowId: managerWindowId, index: -1 });
        moved += win.tabs.filter(t => t.groupId === gid).length;
      } catch (_) {}
    }

    // Then move the ungrouped tabs.
    for (const tab of win.tabs) {
      if (tab.groupId !== undefined && tab.groupId !== -1) continue;
      try {
        await chrome.tabs.move(tab.id, { windowId: managerWindowId, index: -1 });
        moved++;
      } catch (_) {}
    }
  }
  mergeBtn.textContent = "Merge Windows";
  mergeBtn.disabled = false;
  await loadAllWindows();
  toast(`Merged ${moved} tabs`);
}

async function closeTab(tabId, card) {
  card.classList.add("closing");
  selectedTabs.delete(tabId);
  updateActionBar();
  await new Promise(r => setTimeout(r, 250));
  try { await chrome.tabs.remove(tabId); } catch (_) {}
  delete previews[tabId];
  delete tabMemory[tabId];
  await loadAllWindows();
  toast("Tab closed");
}

// ── Capture previews ──
async function captureAllPreviews(opts = {}) {
  captureBtn.disabled = true;
  captureBtn.textContent = "Capturing...";
  if (!opts.silent) grid.classList.add("capturing"); // blur + shimmer while loading

  try {
    const allTabs = allWindows.flatMap(w => w.tabs);
    let tabIds;
    if (opts.staleOnly) {
      const cutoff = Date.now() - 30 * 60 * 1000;
      tabIds = allTabs
        .filter(t => !previews[t.id] || !previewTimestamps[t.id] || previewTimestamps[t.id] < cutoff)
        .map(t => t.id);
    } else {
      tabIds = allTabs.map(t => t.id);
    }

    if (tabIds.length === 0) return;

    let results;
    try {
      results = await chrome.runtime.sendMessage({ type: "captureAllTabs", tabIds });
    } catch (e) {
      if (!opts.silent) toast("Capture failed: " + e.message);
      return;
    }

    if (!results) {
      if (!opts.silent) toast("Capture failed");
      return;
    }

    let captured = 0, skipped = 0, failed = 0;
    for (const [tabId, result] of Object.entries(results)) {
      if (result.success) {
        previews[tabId] = result.dataUrl;
        previewTimestamps[tabId] = Date.now();
        captured++;
      } else if (result.skipped) {
        skipped++;
      } else {
        failed++;
      }
      if (result.jsHeapUsed) tabMemory[tabId] = result.jsHeapUsed;
    }
    updateTabCount();
    renderAll();

    if (!opts.silent) {
      let msg = `Captured ${captured} preview${captured !== 1 ? "s" : ""}`;
      const extras = [];
      if (skipped) extras.push(`${skipped} skipped`);
      if (failed) extras.push(`${failed} failed`);
      if (extras.length) msg += ` (${extras.join(", ")})`;
      toast(msg);
    }
  } finally {
    captureBtn.textContent = "↻ Refresh All Captures";
    captureBtn.disabled = false;
    grid.classList.remove("capturing");
  }
}

// ── Auto-refresh on focus ──
function setupAutoRefresh() {
  document.addEventListener("visibilitychange", async () => {
    if (document.visibilityState === "visible") {
      const awayMin = (Date.now() - lastFocusTimestamp) / 60000;
      if (autoRefreshMinutes > 0 && awayMin >= autoRefreshMinutes) {
        await loadAllWindows();
        captureAllPreviews({ staleOnly: false, silent: true })
          .then(() => toast(`Auto-refreshed (was away ${Math.round(awayMin)} min)`));
      }
      lastFocusTimestamp = Date.now();
    } else {
      lastFocusTimestamp = Date.now();
    }
  });
  window.addEventListener("focus", () => { lastFocusTimestamp = Date.now(); });
}

// ── AI: Auto-Group ──
aiAutoGroupBtn.addEventListener("click", async () => {
  if (!hasApiKey) return;
  showAiLoading("Analyzing your tabs...");

  const tabs = allWindows.flatMap(w => w.tabs.map(t => ({
    id: t.id, title: t.title, url: t.url, windowId: w.id,
  })));

  try {
    const result = await chrome.runtime.sendMessage({
      type: "aiAutoGroup",
      tabs: tabs.map(t => ({ id: t.id, title: t.title, url: t.url })),
    });
    hideAiLoading();
    if (!result || !result.success) {
      toast(result?.error || "AI request failed");
      return;
    }
    showAutoGroupModal(result.groups, tabs);
  } catch (e) {
    hideAiLoading();
    toast("AI request failed: " + e.message);
  }
});

function showAutoGroupModal(groups, tabs) {
  const tabMap = new Map(tabs.map(t => [t.id, t]));
  aiModalTitle.textContent = "✨ Proposed Groups";
  aiModalBody.innerHTML = `<p style="margin-bottom:14px;color:#aaa;font-size:13px">
    AI suggests organizing your tabs into ${groups.length} groups. Uncheck any you don't want, or edit names. Click Apply to create them.
  </p>`;

  groups.forEach((g, gi) => {
    const color = g.color && groupColorMap[g.color] ? g.color : groupColorList[gi % groupColorList.length];
    const accentHex = groupColorMap[color];
    const block = document.createElement("div");
    block.className = "ai-group-proposal";
    block.dataset.idx = gi;
    block.style.setProperty("--group-accent", accentHex);
    block.innerHTML = `
      <div class="ai-group-proposal-header">
        <input type="checkbox" class="ai-group-include" checked>
        <input type="text" class="ai-group-name" value="${escapeHtml(g.name)}">
        <span class="ai-group-proposal-count">${g.tabIds.length} tabs</span>
      </div>
      <div class="ai-group-proposal-tabs"></div>
    `;
    block.dataset.color = color;
    const tabsList = block.querySelector(".ai-group-proposal-tabs");
    for (const tid of g.tabIds) {
      const t = tabMap.get(tid);
      if (!t) continue;
      const row = document.createElement("div");
      row.className = "ai-group-proposal-tab";
      row.innerHTML = `${t.favIconUrl ? `<img src="${escapeHtml(t.favIconUrl)}">` : ""}<span>${escapeHtml(t.title || t.url)}</span>`;
      tabsList.appendChild(row);
    }
    aiModalBody.appendChild(block);
  });

  aiModalFooter.innerHTML = `
    <button id="aiCancel">Cancel</button>
    <button id="aiApply" class="primary">Apply Groups</button>
  `;
  document.getElementById("aiCancel").addEventListener("click", closeAiModal);
  document.getElementById("aiApply").addEventListener("click", () => applyAutoGroups(groups));
  aiModal.classList.remove("hidden");
}

async function applyAutoGroups(groups) {
  const blocks = aiModalBody.querySelectorAll(".ai-group-proposal");
  closeAiModal();
  showAiLoading("Creating groups...");
  let created = 0;
  for (const block of blocks) {
    const include = block.querySelector(".ai-group-include").checked;
    if (!include) continue;
    const idx = parseInt(block.dataset.idx);
    const name = block.querySelector(".ai-group-name").value.trim();
    const color = block.dataset.color;
    const g = groups[idx];

    // Group per window (Chrome tab groups must be within one window)
    const byWindow = new Map();
    for (const tabId of g.tabIds) {
      const win = allWindows.find(w => w.tabs.some(t => t.id === tabId));
      if (!win) continue;
      if (!byWindow.has(win.id)) byWindow.set(win.id, []);
      byWindow.get(win.id).push(tabId);
    }
    for (const [winId, tabIds] of byWindow) {
      try {
        const groupId = await chrome.tabs.group({ tabIds, createProperties: { windowId: winId } });
        await chrome.tabGroups.update(groupId, {
          title: name || `Group ${idx + 1}`,
          color,
        });
        created++;
      } catch (_) {}
    }
  }
  hideAiLoading();
  await loadAllWindows();
  toast(`Created ${created} groups`);
}

// ── AI: Suggest Closes ──
aiSuggestClosesBtn.addEventListener("click", async () => {
  if (!hasApiKey) return;
  showAiLoading("Looking for tabs you can close...");
  const tabs = allWindows.flatMap(w => w.tabs.map(t => ({
    id: t.id, title: t.title, url: t.url,
  })));
  try {
    const result = await chrome.runtime.sendMessage({
      type: "aiSuggestCloses",
      tabs,
    });
    hideAiLoading();
    if (!result || !result.success) {
      toast(result?.error || "AI request failed");
      return;
    }
    showCloseSuggestionsModal(result.suggestions, tabs);
  } catch (e) {
    hideAiLoading();
    toast("AI request failed: " + e.message);
  }
});

function showCloseSuggestionsModal(suggestions, tabs) {
  const tabMap = new Map(tabs.map(t => [t.id, t]));
  aiModalTitle.textContent = "✨ Suggested Closes";

  if (suggestions.length === 0) {
    aiModalBody.innerHTML = `<p style="color:#aaa;font-size:14px">No tabs flagged for closing. Everything looks worth keeping.</p>`;
    aiModalFooter.innerHTML = `<button id="aiCancel" class="primary">OK</button>`;
    document.getElementById("aiCancel").addEventListener("click", closeAiModal);
    aiModal.classList.remove("hidden");
    return;
  }

  // Flag in main view too
  aiCloseFlags = new Set(suggestions.map(s => s.tabId));
  renderAll();

  aiModalBody.innerHTML = `<p style="margin-bottom:14px;color:#aaa;font-size:13px">
    AI flagged ${suggestions.length} tabs as candidates to close. Uncheck any you want to keep.
  </p>`;

  suggestions.forEach((s) => {
    const t = tabMap.get(s.tabId);
    if (!t) return;
    const row = document.createElement("div");
    row.className = "ai-close-row";
    row.dataset.tabId = s.tabId;
    row.innerHTML = `
      <input type="checkbox" class="ai-close-include" checked>
      <div class="ai-close-row-content">
        <div class="ai-close-row-title">
          ${t.favIconUrl ? `<img src="${escapeHtml(t.favIconUrl)}">` : ""}
          <span title="${escapeHtml(t.url || "")}">${escapeHtml(t.title || t.url)}</span>
        </div>
        <div class="ai-close-row-reason">${escapeHtml(s.reason || "Flagged")}</div>
      </div>
    `;
    aiModalBody.appendChild(row);
  });

  aiModalFooter.innerHTML = `
    <button id="aiCancel">Cancel</button>
    <button id="aiApply" class="primary">Close Selected</button>
  `;
  document.getElementById("aiCancel").addEventListener("click", () => {
    aiCloseFlags.clear();
    renderAll();
    closeAiModal();
  });
  document.getElementById("aiApply").addEventListener("click", applyCloseSuggestions);
  aiModal.classList.remove("hidden");
}

async function applyCloseSuggestions() {
  const rows = aiModalBody.querySelectorAll(".ai-close-row");
  const toClose = [];
  for (const row of rows) {
    if (row.querySelector(".ai-close-include").checked) {
      toClose.push(parseInt(row.dataset.tabId));
    }
  }
  closeAiModal();
  aiCloseFlags.clear();
  let closed = 0;
  for (const id of toClose) {
    try {
      await chrome.tabs.remove(id);
      delete previews[id];
      delete tabMemory[id];
      closed++;
    } catch (_) {}
  }
  await loadAllWindows();
  toast(`Closed ${closed} tabs`);
}

// ── AI: Tab summaries on hover ──
async function showHoverSummary(tab, card) {
  const cached = summaryCache[tab.id];
  if (cached) {
    showTooltipContent(tab, cached);
    return;
  }
  showTooltipContent(tab, null);
  if (summaryInflight.has(tab.id)) return;
  summaryInflight.add(tab.id);
  try {
    const result = await chrome.runtime.sendMessage({
      type: "aiTabSummary",
      tab: { id: tab.id, title: tab.title, url: tab.url },
    });
    summaryInflight.delete(tab.id);
    if (result && result.success) {
      summaryCache[tab.id] = result.summary;
      // Only update if still hovering same tab
      if (hoverTooltip.dataset.tabId == tab.id && !hoverTooltip.classList.contains("hidden")) {
        showTooltipContent(tab, result.summary);
      }
    }
  } catch (_) {
    summaryInflight.delete(tab.id);
  }
}

function showTooltipContent(tab, summary) {
  hoverTooltip.dataset.tabId = tab.id;
  if (summary === null) {
    hoverTooltip.innerHTML = `
      <div class="hover-tooltip-label">✨ AI Summary</div>
      <div class="hover-tooltip-loading">Reading tab...</div>
    `;
  } else {
    hoverTooltip.innerHTML = `
      <div class="hover-tooltip-label">✨ AI Summary</div>
      <div>${escapeHtml(summary)}</div>
    `;
  }
  hoverTooltip.classList.remove("hidden");
}

function hideHoverSummary() {
  hoverTooltip.classList.add("hidden");
  hoverTooltip.dataset.tabId = "";
}

function positionTooltip(e) {
  const x = e.clientX + 16;
  const y = e.clientY + 16;
  const maxX = window.innerWidth - 340;
  const maxY = window.innerHeight - 100;
  hoverTooltip.style.left = Math.min(x, maxX) + "px";
  hoverTooltip.style.top = Math.min(y, maxY) + "px";
}

// ── AI: Natural-language search ──
async function runAiSearch() {
  if (!hasApiKey || !searchQuery) return;
  showAiLoading("Searching...");
  const tabs = allWindows.flatMap(w => w.tabs.map(t => ({
    id: t.id, title: t.title, url: t.url,
  })));
  try {
    const result = await chrome.runtime.sendMessage({
      type: "aiSearch",
      query: searchQuery,
      tabs,
    });
    hideAiLoading();
    if (!result || !result.success) {
      toast(result?.error || "AI search failed");
      return;
    }
    aiSearchResults = {};
    result.matches.forEach((tabId, idx) => {
      aiSearchResults[tabId] = idx;
    });
    renderAll();
    toast(`Found ${result.matches.length} matches`);
  } catch (e) {
    hideAiLoading();
    toast("AI search failed");
  }
}

// ── AI Modal helpers ──
function closeAiModal() {
  aiModal.classList.add("hidden");
}
aiModalClose.addEventListener("click", closeAiModal);
aiModal.addEventListener("click", (e) => {
  if (e.target === aiModal) closeAiModal();
});

function showAiLoading(text) {
  aiLoadingText.textContent = text || "Thinking...";
  aiLoading.classList.remove("hidden");
}
function hideAiLoading() {
  aiLoading.classList.add("hidden");
}

// ── Sessions ──
toggleSessionsBtn.addEventListener("click", () => {
  sessionsPanel.classList.toggle("hidden");
  if (!sessionsPanel.classList.contains("hidden")) loadSessionsPanel();
});

saveSessionBtn.addEventListener("click", async () => {
  const name = prompt("Session name:");
  if (!name) return;
  saveSessionBtn.disabled = true;
  saveSessionBtn.textContent = "Saving...";
  const result = await chrome.runtime.sendMessage({ type: "saveSession", name });
  if (result && result.success) {
    toast(`Session "${name}" saved`);
    if (!sessionsPanel.classList.contains("hidden")) loadSessionsPanel();
  } else {
    toast("Failed to save session");
  }
  saveSessionBtn.textContent = "Save Session";
  saveSessionBtn.disabled = false;
});

async function loadSessionsPanel() {
  const [sessions, autoSaves] = await Promise.all([
    chrome.runtime.sendMessage({ type: "getSessions" }),
    chrome.runtime.sendMessage({ type: "getAutoSaves" }),
  ]);
  renderSessionsList("savedSessionsList", sessions, true);
  renderSessionsList("autoSavesList", autoSaves, false);
}

function renderSessionsList(containerId, items, canDelete) {
  const container = document.getElementById(containerId);
  if (!items || items.length === 0) {
    container.innerHTML = `<p class="sessions-empty">None yet</p>`;
    return;
  }
  container.innerHTML = "";
  items.forEach(item => {
    const row = document.createElement("div");
    row.className = "session-row";
    const date = new Date(item.timestamp);
    const timeStr = date.toLocaleDateString("en-US", {
      month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
    });
    const windowCount = item.windows ? item.windows.length : 0;
    const label = item.name || `Auto-save`;
    row.innerHTML = `
      <div class="session-info">
        <span class="session-name">${escapeHtml(label)}</span>
        <span class="session-meta">${timeStr} &middot; ${item.tabCount} tabs &middot; ${windowCount} window${windowCount !== 1 ? "s" : ""}</span>
      </div>
      <div class="session-actions">
        <button class="session-restore" title="Restore this session">Restore</button>
        ${canDelete ? `<button class="session-delete" title="Delete this session">&times;</button>` : ""}
      </div>
    `;
    row.querySelector(".session-restore").addEventListener("click", async () => {
      const msgType = canDelete ? "restoreSession" : "restoreAutoSave";
      const result = await chrome.runtime.sendMessage({ type: msgType, id: item.id });
      if (result && result.success) {
        toast(`Restored ${result.restored} tabs`);
        await loadAllWindows();
      } else {
        toast("Restore failed");
      }
    });
    if (canDelete) {
      row.querySelector(".session-delete").addEventListener("click", async () => {
        await chrome.runtime.sendMessage({ type: "deleteSession", id: item.id });
        toast("Session deleted");
        loadSessionsPanel();
      });
    }
    container.appendChild(row);
  });
}

async function checkForCrashRecovery() {
  const autoSaves = await chrome.runtime.sendMessage({ type: "getAutoSaves" });
  if (!autoSaves || autoSaves.length === 0) return;
  const latest = autoSaves[0];
  const age = Date.now() - latest.timestamp;
  const totalCurrentTabs = allWindows.reduce((sum, w) => sum + w.tabs.length, 0);
  if (latest.tabCount > totalCurrentTabs + 5 && age < 10 * 60 * 1000) {
    const diff = latest.tabCount - totalCurrentTabs;
    const shouldRestore = confirm(
      `It looks like you may have lost ${diff} tabs since your last session.\n\n` +
      `Last auto-save: ${latest.tabCount} tabs (${new Date(latest.timestamp).toLocaleTimeString()})\n` +
      `Current: ${totalCurrentTabs} tabs\n\n` +
      `Would you like to restore the previous session?`
    );
    if (shouldRestore) {
      const result = await chrome.runtime.sendMessage({ type: "restoreAutoSave", id: latest.id });
      if (result && result.success) {
        toast(`Recovered ${result.restored} tabs`);
        await loadAllWindows();
      }
    }
  }
}

// ── Button listeners ──
captureBtn.addEventListener("click", () => captureAllPreviews());
mergeBtn.addEventListener("click", mergeAllWindows);
document.getElementById("groupSelected").addEventListener("click", groupSelectedTabs);
document.getElementById("exportSelected").addEventListener("click", exportSelectedToWindow);
document.getElementById("discardSelected").addEventListener("click", discardSelectedTabs);
document.getElementById("closeSelected").addEventListener("click", closeSelectedTabs);

// Help modal
const helpModal = document.getElementById("helpModal");
const helpBtn = document.getElementById("helpBtn");
function openHelp() { helpModal.classList.remove("hidden"); }
function closeHelp() { helpModal.classList.add("hidden"); }
helpBtn.addEventListener("click", openHelp);
document.getElementById("helpModalClose").addEventListener("click", closeHelp);
document.getElementById("helpModalDone").addEventListener("click", closeHelp);
helpModal.addEventListener("click", (e) => { if (e.target === helpModal) closeHelp(); });

// Share button (placeholder until live)
document.getElementById("shareBtn").addEventListener("click", () => {
  toast("Share is coming once TabView goes live");
});

// ── Drag & Drop (tabs and groups) ──
let dragSrcType = null;       // "tab" | "group"
let dragSrcId = null;          // tab id
let dragSrcGroupId = null;     // group id
let dragSrcWindowId = null;

function onDragStart(e) {
  dragSrcType = "tab";
  dragSrcId = this.dataset.tabId;
  dragSrcWindowId = this.dataset.windowId;
  dragSrcGroupId = null;
  this.classList.add("dragging");
  e.dataTransfer.effectAllowed = "move";
  e.dataTransfer.setData("text/plain", "tab:" + dragSrcId);
}
function onDragEnd() {
  this.classList.remove("dragging");
  document.querySelectorAll(".drag-over").forEach(c => c.classList.remove("drag-over"));
  dragSrcType = null;
}
function onDragOver(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = "move";
}
function onDragEnter(e) {
  e.preventDefault();
  this.classList.add("drag-over");
}
function onDragLeave() {
  this.classList.remove("drag-over");
}
async function onDrop(e) {
  e.preventDefault();
  e.stopPropagation(); // handled here — don't let the window section also catch it
  this.classList.remove("drag-over");
  const targetWindowId = parseInt(this.dataset.windowId);
  const targetWin = allWindows.find(w => w.id === targetWindowId);
  if (!targetWin) return;
  const targetTab = targetWin.tabs.find(t => t.id === parseInt(this.dataset.tabId));
  if (!targetTab) return;

  // Group-aware tab drops: dropping a tab onto a card that lives in a group adds
  // it to that group; dropping it onto a loose (ungrouped) card pulls it out of
  // whatever group it was in. Same-group drops fall through to a plain reorder.
  if (dragSrcType === "tab") {
    const draggedId = parseInt(dragSrcId);
    if (draggedId === targetTab.id) return;
    const targetGroupId = (targetTab.groupId !== -1 && tabGroupInfo[targetTab.groupId]) ? targetTab.groupId : null;
    const draggedTab = findTab(draggedId);
    const draggedGroupId = draggedTab ? draggedTab.groupId : -1;
    if (targetGroupId !== null && draggedGroupId !== targetGroupId) {
      await joinGroup(draggedId, targetGroupId, targetWindowId);
      return;
    }
    if (targetGroupId === null && draggedGroupId !== -1) {
      try { await chrome.tabs.ungroup(draggedId); } catch (_) {}
    }
  }

  await moveDragged(targetWindowId, targetTab.index);
}

// Find a tab object by id across all windows (for group-membership checks)
function findTab(tabId) {
  for (const w of allWindows) {
    const t = w.tabs.find(t => t.id === tabId);
    if (t) return t;
  }
  return null;
}

// Add a dragged tab into an existing group, moving it across windows first if
// needed (Chrome groups can't span windows). Joining a new group automatically
// removes the tab from whatever group it was in before.
async function joinGroup(tabId, groupId, targetWindowId) {
  try {
    const t = findTab(tabId);
    const srcWindowId = t ? t.windowId : parseInt(dragSrcWindowId);
    if (srcWindowId !== targetWindowId) {
      await chrome.tabs.move(tabId, { windowId: targetWindowId, index: -1 });
    }
    await chrome.tabs.group({ groupId, tabIds: [tabId] });
    await loadAllWindows();
    toast("Tab moved into group");
  } catch (err) {
    toast("Couldn't add to group: " + err.message);
  }
}

async function moveDragged(targetWindowId, targetIndex) {
  try {
    if (dragSrcType === "tab") {
      if (dragSrcId === null) return;
      await chrome.tabs.move(parseInt(dragSrcId), {
        windowId: targetWindowId,
        index: targetIndex,
      });
      await loadAllWindows();
      toast("Tab moved");
    } else if (dragSrcType === "group") {
      if (dragSrcGroupId === null) return;
      await chrome.tabGroups.move(parseInt(dragSrcGroupId), {
        windowId: targetWindowId,
        index: targetIndex,
      });
      await loadAllWindows();
      toast("Group moved");
    }
  } catch (err) {
    toast("Move failed: " + err.message);
  }
}

// Window-section drop target: dropping a tab/group anywhere in a window (that
// isn't a specific card or cluster) appends it to the end of that window.
function attachSectionDropHandlers(section, windowId) {
  section.addEventListener("dragover", (e) => {
    if (!dragSrcType) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  });
  section.addEventListener("dragenter", (e) => {
    if (!dragSrcType) return;
    // Only highlight when dragging from a different window — same-window appends
    // are handled fine, but the highlight is most useful for cross-window moves.
    e.preventDefault();
    section.classList.add("drag-over");
  });
  section.addEventListener("dragleave", (e) => {
    // Ignore leave events bubbling up from children
    if (e.target === section) section.classList.remove("drag-over");
  });
  section.addEventListener("drop", async (e) => {
    if (!dragSrcType) return;
    e.preventDefault();
    section.classList.remove("drag-over");
    // index -1 == append to the end of the target window
    await moveDragged(windowId, -1);
  });
}

// Group cluster drag handlers (attached when the cluster is rendered)
function attachGroupDragHandlers(cluster, headerEl, groupId, gtabs, windowId) {
  headerEl.draggable = true;
  headerEl.style.cursor = "grab";

  headerEl.addEventListener("dragstart", (e) => {
    // Don't start group drag if the user grabbed a button or checkbox
    if (e.target.closest("button, input")) {
      e.preventDefault();
      return;
    }
    e.stopPropagation();
    dragSrcType = "group";
    dragSrcGroupId = groupId;
    dragSrcWindowId = windowId;
    dragSrcId = null;
    cluster.classList.add("dragging");
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", "group:" + groupId);
  });

  headerEl.addEventListener("dragend", () => {
    cluster.classList.remove("dragging");
    document.querySelectorAll(".drag-over").forEach(el => el.classList.remove("drag-over"));
    dragSrcType = null;
  });

  // Cluster as a drop target (lets you drop a tab/group ONTO a group to reorder)
  cluster.addEventListener("dragover", (e) => {
    if (!dragSrcType) return;
    if (dragSrcType === "group" && dragSrcGroupId === groupId) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  });
  cluster.addEventListener("dragenter", (e) => {
    if (!dragSrcType) return;
    if (dragSrcType === "group" && dragSrcGroupId === groupId) return;
    e.preventDefault();
    cluster.classList.add("drag-over");
  });
  cluster.addEventListener("dragleave", (e) => {
    if (e.target === cluster) cluster.classList.remove("drag-over");
  });
  cluster.addEventListener("drop", async (e) => {
    if (!dragSrcType) return;
    if (dragSrcType === "group" && dragSrcGroupId === groupId) return;
    e.preventDefault();
    e.stopPropagation();
    cluster.classList.remove("drag-over");
    if (dragSrcType === "tab") {
      const draggedId = parseInt(dragSrcId);
      const draggedTab = findTab(draggedId);
      if (draggedTab && draggedTab.groupId === groupId) {
        // already in this group — reorder to the front of the group
        const firstIndex = Math.min(...gtabs.map(t => t.index));
        await moveDragged(windowId, firstIndex);
      } else {
        await joinGroup(draggedId, groupId, windowId);
      }
      return;
    }
    // a group dropped onto another group: reorder the whole group to that spot
    const firstIndex = Math.min(...gtabs.map(t => t.index));
    await moveDragged(windowId, firstIndex);
  });
}

// ── Helpers ──
function escapeHtml(str) {
  const d = document.createElement("div");
  d.textContent = str == null ? "" : str;
  return d.innerHTML;
}

function toast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.remove("hidden");
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => toastEl.classList.add("hidden"), 2200);
}

// ── Tab events ──
chrome.tabs.onRemoved.addListener((tabId) => {
  if (tabId !== managerTabId) {
    delete previews[tabId];
    delete tabMemory[tabId];
    selectedTabs.delete(tabId);
    updateActionBar();
    loadAllWindows();
  }
});
chrome.tabs.onCreated.addListener(() => loadAllWindows());
chrome.tabs.onMoved.addListener(() => loadAllWindows());
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.groupId !== undefined || changeInfo.title || changeInfo.discarded !== undefined) {
    loadAllWindows();
  }
});
