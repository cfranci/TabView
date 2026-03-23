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
});

async function captureTabViaDebugger(tabId) {
  try {
    await chrome.debugger.attach({ tabId }, "1.3");
    const result = await chrome.debugger.sendCommand(
      { tabId },
      "Page.captureScreenshot",
      { format: "jpeg", quality: 50 }
    );
    await chrome.debugger.detach({ tabId });
    return { success: true, dataUrl: "data:image/jpeg;base64," + result.data };
  } catch (e) {
    try { await chrome.debugger.detach({ tabId }); } catch (_) {}
    return { success: false, error: e.message };
  }
}

async function captureAllTabs(tabIds) {
  const results = {};
  for (const tabId of tabIds) {
    results[tabId] = await captureTabViaDebugger(tabId);
  }
  return results;
}
