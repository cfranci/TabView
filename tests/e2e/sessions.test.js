// Saved sessions, crash-recovery auto-saves, and the background message API.
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { launch } = require("./harness");

let h, ids;
before(async () => {
  h = await launch();
  ids = await h.open([{ slug: "one", title: "One" }, { slug: "two", title: "Two" }, { slug: "three", title: "Three" }]);
  await h.page.evaluate(async ids => {
    const g = await chrome.tabs.group({ tabIds: [ids[1], ids[2]] });
    await chrome.tabGroups.update(g, { title: "Saved Group", color: "cyan" });
  }, ids);
  await h.until(async () => (await h.page.locator(".group-cluster").count()) === 1, "cluster");
});
after(async () => { await h?.close(); });

const panelHidden = () => h.page.evaluate(() => document.getElementById("sessionsPanel").classList.contains("hidden"));
const savedRows = () => h.page.locator("#savedSessionsList .session-row");

test("the Sessions panel opens empty", async () => {
  assert.equal(await panelHidden(), true);
  await h.page.click("#toggleSessions");
  assert.equal(await panelHidden(), false);
  await h.until(async () => (await h.page.locator("#savedSessionsList .sessions-empty").count()) === 1, "empty state");
});

test("cancelling the name prompt saves nothing", async () => {
  const dialog = h.answerDialog(null);
  await h.page.click("#saveSession");
  assert.equal((await dialog).type, "prompt");
  assert.deepEqual(await h.send({ type: "getSessions" }), []);
});

test("Save Session stores every tab, minus the TabView tab, with its group", async () => {
  const dialog = h.answerDialog("Morning work");
  await h.page.click("#saveSession");
  await dialog;
  await h.waitToast(/Session "Morning work" saved/);
  const sessions = await h.send({ type: "getSessions" });
  assert.equal(sessions.length, 1);
  const s = sessions[0];
  assert.equal(s.name, "Morning work");
  assert.equal(s.tabCount, 3);
  assert.equal(s.windows.length, 1);
  assert.deepEqual(s.windows[0].tabs.map(t => t.title), ["One", "Two", "Three"]);
  assert.ok(s.windows[0].tabs.every(t => !t.url.startsWith("chrome-extension://")));
  assert.deepEqual(Object.values(s.groups), [{ title: "Saved Group", color: "cyan" }]);
  assert.equal(await h.page.locator("#saveSession").textContent(), "Save Session");
  assert.equal(await h.page.locator("#saveSession").isDisabled(), false);
});

test("the panel lists the saved session with its tab and window counts", async () => {
  await h.until(async () => (await savedRows().count()) === 1, "session row");
  assert.equal(await savedRows().locator(".session-name").textContent(), "Morning work");
  assert.match(await savedRows().locator(".session-meta").textContent(), /3 tabs · 1 window$/);
});

test("a session name containing HTML is shown as text", async () => {
  const dialog = h.answerDialog("<img src=x onerror=window.__xss=1>");
  await h.page.click("#saveSession");
  await dialog;
  await h.until(async () => (await savedRows().count()) === 2, "second row");
  assert.equal(await h.page.evaluate(() => window.__xss), undefined);
  assert.equal(await h.page.locator("#savedSessionsList img").count(), 0);
  // newest first
  assert.equal(await savedRows().first().locator(".session-name").textContent(), "<img src=x onerror=window.__xss=1>");
  await savedRows().first().locator(".session-delete").click();
  await h.waitToast(/Session deleted/);
  await h.until(async () => (await savedRows().count()) === 1, "row removed");
});

test("Restore reopens the session's tabs in a new window and rebuilds its group", async () => {
  await h.page.evaluate(ids => chrome.tabs.remove(ids), ids);
  await h.until(async () => (await h.tabs()).length === 0, "tabs closed");

  await savedRows().locator(".session-restore").click();
  await h.waitToast(/Restored 3 tabs/);
  const tabs = await h.until(async () => {
    const t = await h.tabs();
    return t.length === 3 && t.every(x => x.url.startsWith("http")) ? t : false;
  }, "restored tabs");
  assert.deepEqual(tabs.map(t => t.slug), ["one", "two", "three"]);
  assert.deepEqual(tabs.filter(t => t.group === "Saved Group").map(t => t.slug), ["two", "three"]);
  assert.equal(tabs.find(t => t.slug === "one").group, null);
  await h.until(async () => (await h.page.locator(".tab-card").count()) === 3, "cards for restored tabs");
});

test("restoring an unknown session id fails cleanly", async () => {
  assert.equal((await h.send({ type: "restoreSession", id: "nope" })).success, false);
  assert.equal((await h.send({ type: "restoreAutoSave", id: "nope" })).success, false);
});

test("deleting a session removes it from storage and the panel", async () => {
  await savedRows().locator(".session-delete").click();
  await h.waitToast(/Session deleted/);
  assert.deepEqual(await h.send({ type: "getSessions" }), []);
  await h.until(async () => (await savedRows().count()) === 0, "row removed");
});

test("the Sessions button toggles the panel closed again", async () => {
  await h.page.click("#toggleSessions");
  assert.equal(await panelHidden(), true);
});

test("auto-saves list in the crash-recovery section without a delete button, and restore", async () => {
  const now = Date.now();
  await h.setStorage({ tabview_autosaves: [{
    id: "auto_test", timestamp: now, tabCount: 1, groups: {},
    windows: [{ windowId: 1, tabs: [{ url: h.fixture("recovered", "Recovered"), title: "Recovered", pinned: false, groupId: -1 }] }],
  }] });
  assert.equal((await h.send({ type: "getAutoSaves" })).length, 1);
  await h.page.click("#toggleSessions");
  const rows = h.page.locator("#autoSavesList .session-row");
  await h.until(async () => (await rows.count()) === 1, "auto-save row");
  assert.equal(await rows.locator(".session-name").textContent(), "Auto-save");
  assert.equal(await rows.locator(".session-delete").count(), 0);
  await rows.locator(".session-restore").click();
  await h.waitToast(/Restored 1 tabs/);
  await h.until(async () => (await h.slugs()).includes("recovered"), "recovered tab");
  await h.page.click("#toggleSessions");
});

test("crash recovery offers to restore when many tabs vanished since a recent auto-save", async () => {
  const tabs = Array.from({ length: 12 }, (_, i) => ({ url: h.fixture(`lost${i}`), title: `Lost ${i}`, pinned: false, groupId: -1 }));
  await h.setStorage({ tabview_autosaves: [{ id: "auto_crash", timestamp: Date.now(), tabCount: 12, groups: {}, windows: [{ windowId: 1, tabs }] }] });
  const before = (await h.tabs()).length;
  const dialog = h.answerDialog(null); // decline
  await h.page.reload();
  const info = await dialog;
  assert.equal(info.type, "confirm");
  assert.match(info.message, /may have lost \d+ tabs/);
  await h.settled();
  assert.equal((await h.tabs()).length, before, "declining restores nothing");
});

test("crash recovery stays quiet when the auto-save is old", async () => {
  const tabs = Array.from({ length: 12 }, (_, i) => ({ url: h.fixture(`lost${i}`), title: `Lost ${i}`, pinned: false, groupId: -1 }));
  await h.setStorage({ tabview_autosaves: [{ id: "auto_old", timestamp: Date.now() - 60 * 60 * 1000, tabCount: 12, groups: {}, windows: [{ windowId: 1, tabs }] }] });
  let prompted = false;
  const onDialog = d => { prompted = true; d.dismiss(); };
  h.page.on("dialog", onDialog);
  await h.reload();
  await new Promise(r => setTimeout(r, 500));
  h.page.off("dialog", onDialog);
  assert.equal(prompted, false);
});

test("background: getTabsMemory returns a heap size per tab", async () => {
  const tabs = await h.tabs();
  const mem = await h.send({ type: "getTabsMemory", tabIds: tabs.map(t => t.id) });
  assert.equal(typeof mem, "object");
  for (const t of tabs.filter(t => t.url.startsWith("http") && !t.discarded)) {
    assert.ok(mem[t.id] > 0, `heap for ${t.slug}: ${JSON.stringify(mem[t.id])}`);
  }
});

test("background: captureTab returns an image for a page and a skip for a closed tab", async () => {
  const t = (await h.tabs()).find(t => t.url.startsWith("http"));
  const ok = await h.send({ type: "captureTab", tabId: t.id });
  assert.equal(ok.success, true);
  assert.match(ok.dataUrl, /^data:image\//);
  const missing = await h.send({ type: "captureTab", tabId: 987654321 });
  assert.equal(missing.success, false);
});

test("background: prompt defaults cover all four AI features", async () => {
  const d = await h.send({ type: "getPromptDefaults" });
  assert.deepEqual(Object.keys(d).sort(), ["autogroup", "search", "suggestcloses", "summary"]);
  assert.ok(Object.values(d).every(v => typeof v === "string" && v.length > 40));
});

test("no errors were logged by the manager page", () => {
  assert.deepEqual(h.errors, []);
});
