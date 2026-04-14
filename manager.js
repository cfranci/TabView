const grid = document.getElementById("grid");
const tabCountEl = document.getElementById("tabCount");
const captureBtn = document.getElementById("captureAll");
const mergeBtn = document.getElementById("mergeWindows");
const toastEl = document.getElementById("toast");
const actionBar = document.getElementById("actionBar");
const selectedCountEl = document.getElementById("selectedCount");

let allTabs = [];
let managerTabId = null;
let currentWindowId = null;
let previews = {};
let selectedTabs = new Set();
let tabMemory = {};

// ── Init ──
(async () => {
  const self = await chrome.tabs.getCurrent();
  managerTabId = self.id;
  currentWindowId = self.windowId;
  await loadTabs();
  await captureAllPreviews();
})();

// ── Load tabs ──
async function loadTabs() {
  const tabs = await chrome.tabs.query({ currentWindow: true });
  allTabs = tabs.filter(t => t.id !== managerTabId);
  updateTabCount();
  renderGrid();
}

function updateTabCount() {
  const totalMem = Object.values(tabMemory).reduce((sum, m) => sum + m, 0);
  const memStr = totalMem ? ` | ${formatMemory(totalMem)}` : "";
  tabCountEl.textContent = `${allTabs.length} tabs${memStr}`;
}

// ── Memory ──
function formatMemory(bytes) {
  if (!bytes) return "";
  const mb = bytes / (1024 * 1024);
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`;
  return `${Math.round(mb)} MB`;
}

// ── Render ──
function renderGrid() {
  grid.innerHTML = "";
  allTabs.forEach((tab, i) => {
    const card = document.createElement("div");
    card.className = `tab-card${selectedTabs.has(tab.id) ? " selected" : ""}`;
    card.draggable = true;
    card.dataset.tabId = tab.id;
    card.dataset.index = i;

    const preview = previews[tab.id];
    const previewHtml = preview
      ? `<img src="${preview}" alt="Preview">`
      : `<div class="placeholder">
           ${tab.favIconUrl ? `<img src="${tab.favIconUrl}" alt="">` : ""}
           <span>Capturing...</span>
         </div>`;

    const memText = formatMemory(tabMemory[tab.id]);
    const memHigh = (tabMemory[tab.id] || 0) > 100 * 1024 * 1024;

    card.innerHTML = `
      <input type="checkbox" class="tab-checkbox" ${selectedTabs.has(tab.id) ? "checked" : ""}>
      <span class="index-badge">${i + 1}</span>
      <button class="close-btn" title="Close tab">&times;</button>
      <div class="preview">${previewHtml}</div>
      <div class="info">
        ${tab.favIconUrl ? `<img class="favicon" src="${tab.favIconUrl}" alt="">` : ""}
        <span class="title" title="${escapeHtml(tab.url || "")}">${escapeHtml(tab.title || "Untitled")}</span>
        <span class="ram-badge${memHigh ? " ram-high" : ""}">${memText}</span>
      </div>
    `;

    card.querySelector(".tab-checkbox").addEventListener("change", (e) => {
      e.stopPropagation();
      toggleSelect(tab.id);
    });

    card.querySelector(".title").addEventListener("click", (e) => {
      e.stopPropagation();
      chrome.tabs.update(tab.id, { active: true });
    });

    card.querySelector(".close-btn").addEventListener("click", (e) => {
      e.stopPropagation();
      closeTab(tab.id, card);
    });

    card.querySelector(".preview").addEventListener("click", () => {
      chrome.tabs.update(tab.id, { active: true });
    });

    card.addEventListener("dragstart", onDragStart);
    card.addEventListener("dragend", onDragEnd);
    card.addEventListener("dragover", onDragOver);
    card.addEventListener("dragenter", onDragEnter);
    card.addEventListener("dragleave", onDragLeave);
    card.addEventListener("drop", onDrop);

    grid.appendChild(card);
  });
}

// ── Selection ──
function toggleSelect(tabId) {
  if (selectedTabs.has(tabId)) {
    selectedTabs.delete(tabId);
  } else {
    selectedTabs.add(tabId);
  }

  const card = document.querySelector(`.tab-card[data-tab-id="${tabId}"]`);
  if (card) {
    card.classList.toggle("selected", selectedTabs.has(tabId));
    card.querySelector(".tab-checkbox").checked = selectedTabs.has(tabId);
  }
  updateActionBar();
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

// ── Group selected ──
async function groupSelectedTabs() {
  if (selectedTabs.size === 0) return;

  const name = prompt("Group name (leave empty for none):");
  if (name === null) return;

  const tabIds = Array.from(selectedTabs);
  try {
    const groupId = await chrome.tabs.group({ tabIds });
    if (name) {
      const colors = ["blue", "red", "yellow", "green", "pink", "purple", "cyan", "orange"];
      const color = colors[Math.floor(Math.random() * colors.length)];
      await chrome.tabGroups.update(groupId, { title: name, color });
    }
    selectedTabs.clear();
    updateActionBar();
    await loadTabs();
    toast(`Grouped ${tabIds.length} tabs`);
  } catch (e) {
    toast("Failed to group tabs");
  }
}

// ── Discard selected (free RAM without closing) ──
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
  await loadTabs();
  toast(`Discarded ${discarded} tabs -- RAM freed`);
}

// ── Close selected ──
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
  await loadTabs();
  toast(`Closed ${count} tabs`);
}

// ── Merge all windows ──
async function mergeAllWindows() {
  const windows = await chrome.windows.getAll({ populate: true });
  if (windows.length <= 1) {
    toast("Only one window open");
    return;
  }

  mergeBtn.disabled = true;
  mergeBtn.textContent = "Merging...";

  let moved = 0;
  for (const win of windows) {
    if (win.id === currentWindowId) continue;
    for (const tab of win.tabs) {
      try {
        await chrome.tabs.move(tab.id, { windowId: currentWindowId, index: -1 });
        moved++;
      } catch (_) {}
    }
  }

  mergeBtn.textContent = "Merge Windows";
  mergeBtn.disabled = false;
  await loadTabs();
  toast(`Merged ${moved} tabs from ${windows.length - 1} windows`);
}

// ── Close single tab ──
async function closeTab(tabId, card) {
  card.classList.add("closing");
  selectedTabs.delete(tabId);
  updateActionBar();
  await new Promise(r => setTimeout(r, 250));
  try { await chrome.tabs.remove(tabId); } catch (_) {}
  delete previews[tabId];
  delete tabMemory[tabId];
  await loadTabs();
  toast("Tab closed");
}

// ── Capture previews + memory in one pass ──
async function captureAllPreviews() {
  captureBtn.disabled = true;
  captureBtn.textContent = "Capturing...";

  const tabIds = allTabs.map(t => t.id);
  const results = await chrome.runtime.sendMessage({
    type: "captureAllTabs",
    tabIds,
  });

  if (results) {
    let captured = 0;
    for (const [tabId, result] of Object.entries(results)) {
      if (result.success) {
        previews[tabId] = result.dataUrl;
        captured++;
      }
      if (result.jsHeapUsed) {
        tabMemory[tabId] = result.jsHeapUsed;
      }
    }
    updateTabCount();
    renderGrid();
    toast(`Captured ${captured}/${tabIds.length} previews`);
  } else {
    toast("Capture failed");
  }

  captureBtn.textContent = "Refresh Previews";
  captureBtn.disabled = false;
}

// ── Button listeners ──
captureBtn.addEventListener("click", captureAllPreviews);
mergeBtn.addEventListener("click", mergeAllWindows);
document.getElementById("groupSelected").addEventListener("click", groupSelectedTabs);
document.getElementById("discardSelected").addEventListener("click", discardSelectedTabs);
document.getElementById("closeSelected").addEventListener("click", closeSelectedTabs);

// ── Drag & Drop ──
let dragSrcId = null;

function onDragStart(e) {
  dragSrcId = this.dataset.tabId;
  this.classList.add("dragging");
  e.dataTransfer.effectAllowed = "move";
}

function onDragEnd() {
  this.classList.remove("dragging");
  document.querySelectorAll(".tab-card").forEach(c => c.classList.remove("drag-over"));
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
  this.classList.remove("drag-over");

  const targetId = this.dataset.tabId;
  if (dragSrcId === targetId) return;

  const srcIdx = allTabs.findIndex(t => t.id === parseInt(dragSrcId));
  const tgtIdx = allTabs.findIndex(t => t.id === parseInt(targetId));
  if (srcIdx === -1 || tgtIdx === -1) return;

  await chrome.tabs.move(parseInt(dragSrcId), { index: allTabs[tgtIdx].index });
  await loadTabs();
  toast("Tab moved");
}

// ── Helpers ──
function escapeHtml(str) {
  const d = document.createElement("div");
  d.textContent = str;
  return d.innerHTML;
}

function toast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.remove("hidden");
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => toastEl.classList.add("hidden"), 2000);
}

// ── Tab events ──
chrome.tabs.onRemoved.addListener((tabId) => {
  if (tabId !== managerTabId) {
    delete previews[tabId];
    delete tabMemory[tabId];
    selectedTabs.delete(tabId);
    updateActionBar();
    loadTabs();
  }
});
chrome.tabs.onCreated.addListener(() => loadTabs());
chrome.tabs.onMoved.addListener(() => loadTabs());
