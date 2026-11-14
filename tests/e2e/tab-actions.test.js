// Selecting tabs and acting on them: group, discard, close, export, move
// between windows, merge, drag and drop, per-window and per-group buttons.
const { test, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { launch } = require("./harness");

let h;
before(async () => { h = await launch(); });
after(async () => { await h?.close(); });

// Each test starts from one window holding only the manager tab.
beforeEach(async () => {
  await h.page.evaluate(async () => {
    const me = await chrome.tabs.getCurrent();
    const others = (await chrome.tabs.query({})).filter(t => t.id !== me.id).map(t => t.id);
    if (others.length) await chrome.tabs.remove(others);
  });
  await h.until(async () => (await h.tabs()).length === 0 && (await h.windowCount()) === 1, "clean slate");
  await h.until(async () => (await h.page.locator(".tab-card").count()) === 0, "empty grid");
  await h.page.evaluate(() => { document.getElementById("toast").classList.add("hidden"); });
});

const actionBarHidden = () => h.page.evaluate(() => document.getElementById("actionBar").classList.contains("hidden"));
const selectedText = () => h.page.locator("#selectedCount").textContent();

test("checking a card selects it and shows the action bar; unchecking hides it", async () => {
  await h.open(["a", "b", "c"]);
  assert.equal(await actionBarHidden(), true);
  await h.select("a");
  assert.equal(await selectedText(), "1 selected");
  assert.equal(await actionBarHidden(), false);
  assert.equal(await h.page.locator(".tab-card.selected").count(), 1);
  await h.select("c");
  assert.equal(await selectedText(), "2 selected");
  await h.select("a");
  await h.select("c");
  assert.equal(await actionBarHidden(), true);
});

test("Shift+click anywhere on a card toggles selection without switching tabs", async () => {
  await h.open(["a", "b"]);
  const activeBefore = await h.page.evaluate(async () => (await chrome.tabs.query({ active: true, currentWindow: true }))[0].id);
  await h.card("b").locator(".preview").click({ modifiers: ["Shift"] });
  assert.equal(await selectedText(), "1 selected");
  assert.equal(await h.page.evaluate(async () => (await chrome.tabs.query({ active: true, currentWindow: true }))[0].id), activeBefore);
  await h.card("b").locator(".title").click({ modifiers: ["Shift"] });
  assert.equal(await actionBarHidden(), true);
});

test("holding Shift reveals every checkbox", async () => {
  await h.open(["a"]);
  await h.page.keyboard.down("Shift");
  assert.equal(await h.page.evaluate(() => document.body.classList.contains("shift-held")), true);
  await h.page.keyboard.up("Shift");
  assert.equal(await h.page.evaluate(() => document.body.classList.contains("shift-held")), false);
});

test("the window checkbox selects all, shows a partial state, and clears", async () => {
  await h.open(["a", "b", "c"]);
  const box = h.page.locator(".window-header .window-select-all");
  await h.select("b");
  assert.equal(await box.evaluate(e => e.indeterminate), true);
  await box.click();
  assert.equal(await selectedText(), "3 selected");
  assert.equal(await box.isChecked(), true);
  await box.click();
  assert.equal(await actionBarHidden(), true);
});

test("clicking a preview switches Chrome to that tab", async () => {
  const [, b] = await h.open(["a", "b"]);
  await h.card("b").locator(".preview").click();
  await h.until(() => h.page.evaluate(id => chrome.tabs.get(id).then(t => t.active), b), "tab b to become active");
  await h.page.bringToFront();
});

test("the × on a card closes that tab", async () => {
  await h.open(["a", "b"]);
  await h.card("a").hover();
  await h.card("a").locator(".close-btn").click({ force: true });
  await h.waitToast(/Tab closed/);
  assert.deepEqual(await h.slugs(), ["b"]);
  assert.deepEqual(await h.cardSlugs(), ["b"]);
});

test("Group makes a named Chrome tab group and renders it as a cluster", async () => {
  await h.open(["a", "b", "c"]);
  await h.select("a");
  await h.select("c");
  const dialog = h.answerDialog("Work");
  await h.page.click("#groupSelected");
  assert.equal((await dialog).type, "prompt");
  await h.waitToast(/Grouped 2 tabs/);
  const tabs = await h.tabs();
  assert.deepEqual(tabs.filter(t => t.group === "Work").map(t => t.slug).sort(), ["a", "c"]);
  assert.equal(tabs.find(t => t.slug === "b").group, null);
  assert.equal(await h.page.locator(".group-cluster-name").textContent(), "Work");
  assert.equal(await h.page.locator(".group-cluster-count").textContent(), "2 tabs");
  assert.equal(await h.page.locator(".group-cluster .tab-card").count(), 2);
  assert.equal(await actionBarHidden(), true, "selection is cleared after grouping");
});

test("cancelling the group name prompt changes nothing", async () => {
  await h.open(["a", "b"]);
  await h.select("a");
  await h.select("b");
  const dialog = h.answerDialog(null);
  await h.page.click("#groupSelected");
  await dialog;
  assert.ok((await h.tabs()).every(t => t.groupId === -1));
  assert.equal(await selectedText(), "2 selected");
});

test("group header: select all in group, Ungroup, and Close Group", async () => {
  const ids = await h.open(["a", "b", "c"]);
  await h.page.evaluate(async ids => {
    const g = await chrome.tabs.group({ tabIds: ids.slice(0, 2) });
    await chrome.tabGroups.update(g, { title: "Pair", color: "green" });
  }, ids);
  await h.until(async () => (await h.page.locator(".group-cluster").count()) === 1, "cluster");

  await h.page.locator(".group-cluster .window-select-all").click();
  assert.equal(await selectedText(), "2 selected");
  await h.page.locator(".group-cluster .window-select-all").click();

  await h.page.click('.group-cluster [data-action="ungroup"]');
  await h.waitToast(/Ungrouped 2 tabs/);
  assert.ok((await h.tabs()).every(t => t.groupId === -1));
  assert.equal(await h.page.locator(".group-cluster").count(), 0);

  await h.page.evaluate(ids => chrome.tabs.group({ tabIds: ids.slice(0, 2) }).then(g => chrome.tabGroups.update(g, { title: "Pair" })), ids);
  await h.until(async () => (await h.page.locator(".group-cluster").count()) === 1, "cluster again");
  const dialog = h.answerDialog(true);
  await h.page.click('.group-cluster [data-action="close-group"]');
  assert.match((await dialog).message, /Close 2 tabs\?/);
  await h.waitToast(/Closed 2 tabs/);
  assert.deepEqual(await h.slugs(), ["c"]);
});

test("Discard sends the selected tabs to be unloaded and marks them paused", async () => {
  const ids = await h.open(["a", "b", "c"]);
  const discarded = await h.stubDiscard();
  await h.select("a");
  await h.select("b");
  await h.page.click("#discardSelected");
  await h.waitToast(/Discarded 2 tabs/);
  assert.deepEqual((await discarded()).sort(), ids.slice(0, 2).sort());
  assert.equal(await h.page.locator(".tab-card.paused").count(), 2);
  assert.equal(await h.page.locator(".paused-badge").count(), 2);
  assert.equal(await h.card("c").locator(".paused-badge").count(), 0);
  assert.equal(await actionBarHidden(), true);
  await h.reload();
});

test("Pause All unloads a window's tabs; a second press has nothing to do", async () => {
  const ids = await h.open(["a", "b"]);
  const discarded = await h.stubDiscard();
  await h.page.click('[data-action="pause-all"]');
  await h.waitToast(/Paused 2 tabs/);
  assert.deepEqual((await discarded()).sort(), ids.slice().sort());
  await h.page.click('[data-action="pause-all"]');
  await h.waitToast(/Nothing to pause in this window/);
  await h.reload();
});

test("a group's Pause button unloads only that group, then reads Paused", async () => {
  const ids = await h.open(["a", "b", "c"]);
  await h.page.evaluate(ids => chrome.tabs.group({ tabIds: ids.slice(0, 2) }).then(g => chrome.tabGroups.update(g, { title: "G" })), ids);
  await h.until(async () => (await h.page.locator(".group-cluster").count()) === 1, "cluster");
  const discarded = await h.stubDiscard();
  await h.page.click('.group-cluster [data-action="pause-group"]');
  await h.waitToast(/Paused 2 tabs/);
  assert.deepEqual((await discarded()).sort(), ids.slice(0, 2).sort());
  const btn = h.page.locator('.group-cluster [data-action="pause-group"]');
  assert.equal(await btn.textContent(), "Paused");
  assert.equal(await btn.isDisabled(), true);
  await h.reload();
});

test("Close removes every selected tab", async () => {
  await h.open(["a", "b", "c"]);
  await h.select("a");
  await h.select("c");
  await h.page.click("#closeSelected");
  await h.waitToast(/Closed 2 tabs/);
  assert.deepEqual(await h.slugs(), ["b"]);
  assert.equal(await actionBarHidden(), true);
});

test("a selected tab closed elsewhere drops out of the selection", async () => {
  const [a] = await h.open(["a", "b"]);
  await h.select("a");
  await h.select("b");
  await h.page.evaluate(id => chrome.tabs.remove(id), a);
  await h.until(async () => (await selectedText()) === "1 selected", "selection to shrink");
});

test("Export to Window moves the selection into a new window, in order", async () => {
  await h.open(["a", "b", "c", "d"]);
  await h.select("b");
  await h.select("d");
  await h.page.click("#exportSelected");
  await h.waitToast(/Exported 2 tabs to new window/);
  assert.equal(await h.windowCount(), 2);
  const tabs = await h.tabs();
  const homeWin = tabs.find(t => t.slug === "a").windowId;
  assert.deepEqual(tabs.filter(t => t.windowId === homeWin).map(t => t.slug), ["a", "c"]);
  assert.deepEqual(tabs.filter(t => t.windowId !== homeWin).map(t => t.slug), ["b", "d"]);
  assert.equal(await h.page.locator(".window-section").count(), 2);
  assert.match(await h.page.locator("#tabCount").textContent(), /^4 tabs across 2 windows/);
});

// Open a second window holding the given fixture tabs; returns its id.
async function secondWindow(slugs) {
  const winId = await h.page.evaluate(async urls => {
    const w = await chrome.windows.create({ url: urls, focused: false });
    return w.id;
  }, slugs.map(s => h.fixture(s)));
  await h.until(async () => (await h.page.locator(".window-section").count()) === 2, "second window section");
  await h.until(async () => (await h.tabs()).filter(t => t.windowId === winId).every(t => t.title && !t.title.startsWith("127.0.0.1")), "second window titles");
  return winId;
}

test("+ Add Selected pulls selected tabs into that window", async () => {
  await h.open(["a", "b"]);
  const winId = await secondWindow(["x"]);
  await h.select("a");
  await h.page.locator(`.window-section[data-window-id="${winId}"] [data-action="add-selected"]`).click();
  await h.until(async () => (await h.tabs()).find(t => t.slug === "a").windowId === winId, "tab a to move");
  assert.deepEqual((await h.tabs()).filter(t => t.windowId === winId).map(t => t.slug), ["x", "a"]);
});

test("+ Add Selected with nothing selected asks you to select first", async () => {
  await h.open(["a"]);
  await h.page.click('[data-action="add-selected"]');
  await h.waitToast(/Select some tabs first/);
});

test("Move Here empties another window into the TabView window", async () => {
  await h.open(["a"]);
  const winId = await secondWindow(["x", "y"]);
  assert.equal(await h.page.locator('.current-window [data-action="move-here"]').count(), 0, "not offered on the current window");
  await h.page.locator(`.window-section[data-window-id="${winId}"] [data-action="move-here"]`).click();
  await h.until(async () => (await h.windowCount()) === 1, "second window to close");
  assert.deepEqual(await h.slugs(), ["a", "x", "y"]);
});

test("Merge Windows combines everything and keeps tab groups intact", async () => {
  await h.open(["a"]);
  const winId = await secondWindow(["x", "y", "z"]);
  await h.page.evaluate(async winId => {
    const tabs = await chrome.tabs.query({ windowId: winId });
    const g = await chrome.tabs.group({ tabIds: [tabs[0].id, tabs[1].id], createProperties: { windowId: winId } });
    await chrome.tabGroups.update(g, { title: "Keep Me", color: "purple" });
  }, winId);
  await h.until(async () => (await h.page.locator(".group-cluster").count()) === 1, "cluster");

  await h.page.click("#mergeWindows");
  await h.waitToast(/Merged 3 tabs/);
  assert.equal(await h.windowCount(), 1);
  const tabs = await h.tabs();
  assert.deepEqual(tabs.map(t => t.slug).sort(), ["a", "x", "y", "z"]);
  assert.deepEqual(tabs.filter(t => t.group === "Keep Me").map(t => t.slug), ["x", "y"]);
  assert.equal(await h.page.locator("#mergeWindows").textContent(), "Merge Windows");
});

test("Merge Windows with one window says so", async () => {
  await h.open(["a"]);
  await h.page.click("#mergeWindows");
  await h.waitToast(/Only one window open/);
});

test("Group All groups a whole window under the given name", async () => {
  await h.open(["a", "b", "c"]);
  const dialog = h.answerDialog("Everything");
  await h.page.click('[data-action="group-all"]');
  await dialog;
  await h.waitToast(/Grouped 3 tabs/);
  assert.ok((await h.tabs()).every(t => t.group === "Everything"));
});

test("Close All asks first; cancel keeps the tabs, confirm closes them", async () => {
  await h.open(["a", "b"]);
  let dialog = h.answerDialog(null);
  await h.page.click('[data-action="close-all"]');
  assert.match((await dialog).message, /Close all 2 tabs in this window\?/);
  assert.equal((await h.tabs()).length, 2);

  dialog = h.answerDialog(true);
  await h.page.click('[data-action="close-all"]');
  await dialog;
  await h.waitToast(/Closed 2 tabs/);
  assert.equal((await h.tabs()).length, 0);
});

test("dragging a card onto another reorders the real tab strip", async () => {
  await h.open(["a", "b", "c"]);
  await h.card("c").dragTo(h.card("a"));
  await h.waitToast(/Tab moved/);
  assert.deepEqual(await h.slugs(), ["c", "a", "b"]);
  assert.deepEqual(await h.cardSlugs(), ["c", "a", "b"]);
});

test("dragging a card onto a group joins it; dragging it onto a loose card leaves", async () => {
  const ids = await h.open(["a", "b", "c", "d"]);
  await h.page.evaluate(ids => chrome.tabs.group({ tabIds: [ids[0], ids[1]] }).then(g => chrome.tabGroups.update(g, { title: "G" })), ids);
  await h.until(async () => (await h.page.locator(".group-cluster").count()) === 1, "cluster");

  await h.card("d").dragTo(h.card("a"));
  await h.waitToast(/Tab moved into group/);
  assert.deepEqual((await h.tabs()).filter(t => t.group === "G").map(t => t.slug).sort(), ["a", "b", "d"]);

  await h.card("d").dragTo(h.card("c"));
  await h.waitToast(/Tab moved$/);
  const after = await h.tabs();
  assert.equal(after.find(t => t.slug === "d").group, null);
  assert.deepEqual(after.map(t => t.slug), ["a", "b", "c", "d"], "it also lands where it was dropped");
});

test("dragging a card into another window's header moves it there", async () => {
  await h.open(["a", "b"]);
  const winId = await secondWindow(["x"]);
  await h.card("a").dragTo(h.page.locator(`.window-section[data-window-id="${winId}"] .window-header`));
  await h.until(async () => (await h.tabs()).find(t => t.slug === "a").windowId === winId, "tab a to change window");
  assert.deepEqual((await h.tabs()).filter(t => t.windowId === winId).map(t => t.slug), ["x", "a"]);
});

test("dragging a group header moves the whole group", async () => {
  const ids = await h.open(["a", "b", "c"]);
  await h.page.evaluate(ids => chrome.tabs.group({ tabIds: [ids[1], ids[2]] }).then(g => chrome.tabGroups.update(g, { title: "G" })), ids);
  await h.until(async () => (await h.page.locator(".group-cluster").count()) === 1, "cluster");
  await h.page.locator(".group-cluster-header").dragTo(h.card("a"));
  await h.waitToast(/Group moved/);
  const tabs = await h.tabs();
  assert.deepEqual(tabs.map(t => t.slug), ["b", "c", "a"]);
  assert.deepEqual(tabs.filter(t => t.group === "G").map(t => t.slug), ["b", "c"]);
});

test("no errors were logged by the manager page", () => {
  assert.deepEqual(h.errors, []);
});
