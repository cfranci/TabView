const grid = document.getElementById("grid");
const tabCountEl = document.getElementById("tabCount");
const captureBtn = document.getElementById("captureAll");
const toastEl = document.getElementById("toast");

let allTabs = [];
let managerTabId = null;
let currentWindowId = null;
let previews = {}; // tabId -> dataUrl

// ── Init ──
(async () => {
  const self = await chrome.tabs.getCurrent();
  managerTabId = self.id;
  currentWindowId = self.windowId;
  await loadTabs();
  // Auto-capture on open
  await captureAllPreviews();
})();

// ── Load tabs ──
async function loadTabs() {
  const tabs = await chrome.tabs.query({ currentWindow: true });
  allTabs = tabs.filter(t => t.id !== managerTabId);
  tabCountEl.textContent = `${allTabs.length} tabs`;
  renderGrid();
}

// ── Render ──
function renderGrid() {
  grid.innerHTML = "";
  allTabs.forEach((tab, i) => {
    const card = document.createElement("div");
    card.className = "tab-card";
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

    card.innerHTML = `
      <div class="preview">${previewHtml}</div>
      <span class="index-badge">${i + 1}</span>
      <button class="close-btn" title="Close tab">&times;</button>
      <div class="info">
        ${tab.favIconUrl ? `<img class="favicon" src="${tab.favIconUrl}" alt="">` : ""}
        <span class="title" title="${escapeHtml(tab.url || "")}">${escapeHtml(tab.title || "Untitled")}</span>
      </div>
    `;

    // Switch to tab on title click
    card.querySelector(".title").addEventListener("click", (e) => {
      e.stopPropagation();
      chrome.tabs.update(tab.id, { active: true });
    });

    // Close tab
    card.querySelector(".close-btn").addEventListener("click", (e) => {
      e.stopPropagation();
      closeTab(tab.id, card);
    });

    // Click preview to switch
    card.querySelector(".preview").addEventListener("click", () => {
      chrome.tabs.update(tab.id, { active: true });
    });

    // Drag events
    card.addEventListener("dragstart", onDragStart);
    card.addEventListener("dragend", onDragEnd);
    card.addEventListener("dragover", onDragOver);
    card.addEventListener("dragenter", onDragEnter);
    card.addEventListener("dragleave", onDragLeave);
    card.addEventListener("drop", onDrop);

    grid.appendChild(card);
  });
}

// ── Close tab ──
async function closeTab(tabId, card) {
  card.classList.add("closing");
  await new Promise(r => setTimeout(r, 250));
  try {
    await chrome.tabs.remove(tabId);
  } catch (_) {}
  delete previews[tabId];
  await loadTabs();
  toast("Tab closed");
}

// ── Capture all previews via debugger (no tab switching) ──
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
    }
    renderGrid();
    toast(`Captured ${captured}/${tabIds.length} previews`);
  } else {
    toast("Capture failed — check extension permissions");
  }

  captureBtn.textContent = "Refresh Previews";
  captureBtn.disabled = false;
}

captureBtn.addEventListener("click", captureAllPreviews);

// ── Drag & Drop reorder ──
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

  // Reorder in Chrome
  const targetTab = allTabs[tgtIdx];
  await chrome.tabs.move(parseInt(dragSrcId), { index: targetTab.index });

  // Reload to reflect new order
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

// Listen for tab changes to keep the grid up to date
chrome.tabs.onRemoved.addListener((tabId) => {
  if (tabId !== managerTabId) {
    delete previews[tabId];
    loadTabs();
  }
});
chrome.tabs.onCreated.addListener(() => loadTabs());
chrome.tabs.onMoved.addListener(() => loadTabs());
