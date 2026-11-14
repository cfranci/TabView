// The no-AI organizer, order rules, undo, Cleanup, and the URL sidebar,
// checked against Chrome's real tab strip.
const { test, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { launch } = require("./harness");

let h;
before(async () => { h = await launch(); });
after(async () => { await h?.close(); });

beforeEach(async () => {
  await h.page.evaluate(async () => {
    const me = await chrome.tabs.getCurrent();
    const others = (await chrome.tabs.query({})).filter(t => t.id !== me.id).map(t => t.id);
    if (others.length) await chrome.tabs.remove(others);
    await chrome.storage.local.remove("tabview_order_rules");
    localStorage.removeItem("tabview_sidebarOpen");
    localStorage.removeItem("tabview_sortMode");
  });
  await h.until(async () => (await h.tabs()).length === 0 && (await h.windowCount()) === 1, "clean slate");
  await h.reload();
});

// Fixture tabs are all on 127.0.0.1, so "site" never differs. Titles carry the
// signal instead: an email for the account, and rule keywords.
const mail = (slug, email) => ({ slug, title: `Inbox - ${email} - Mail` });
// Pick an Organize menu entry and wait for its own toast (hiding the previous
// one first, so a lingering message can't be mistaken for the new result).
const organize = async (mode, expect = /Organized|Already organized/) => {
  await h.page.evaluate(() => document.getElementById("toast").classList.add("hidden"));
  await h.page.selectOption("#organizeSelect", mode);
  return h.waitToast(expect);
};
const undo = (expect = /Tab order restored/) => organize("undo", expect);

test("the Organize menu resets to its label after every choice", async () => {
  await h.open(["a"]);
  await organize("smart");
  assert.equal(await h.page.inputValue("#organizeSelect"), "");
  assert.equal(await h.page.locator("#organizeSelect").isDisabled(), false);
});

test("By logged-in account puts each account's tabs side by side, unknown accounts last", async () => {
  await h.open([mail("w1", "work@corp.com"), { slug: "none1", title: "No account" }, mail("p1", "me@gmail.com"), mail("w2", "work@corp.com"), mail("p2", "me@gmail.com")]);
  const toast = await organize("account");
  assert.match(toast, /Organized 1 window by logged-in account/);
  assert.deepEqual(await h.slugs(), ["p1", "p2", "w1", "w2", "none1"]);
  assert.deepEqual(await h.cardSlugs(), ["p1", "p2", "w1", "w2", "none1"], "the grid shows the new order");
  assert.ok((await h.tabs()).every(t => t.groupId === -1), "no Chrome tab groups are created");
});

test("order rules win over everything, in the order they are listed", async () => {
  await h.setStorage({ tabview_order_rules: "Reports: report\nInbox: inbox" });
  await h.reload();
  await h.open([{ slug: "x", title: "Something else" }, mail("m1", "me@gmail.com"), { slug: "r1", title: "Weekly report" }, mail("m2", "me@gmail.com"), { slug: "r2", title: "Sales report" }]);
  await organize("smart");
  assert.deepEqual(await h.slugs(), ["r1", "r2", "m1", "m2", "x"]);
});

test("By project keeps a local dev server's tabs together", async () => {
  const other = `http://localhost:${new URL(h.base).port}`; // same server, different host name = different "project"
  await h.open([{ url: `${other}/l1?t=L1` }, "a", { url: `${other}/l2?t=L2` }, "b"]);
  await organize("project");
  const slugs = await h.slugs();
  assert.equal(Math.abs(slugs.indexOf("l1") - slugs.indexOf("l2")), 1, `localhost tabs adjacent: ${slugs}`);
  assert.equal(Math.abs(slugs.indexOf("a") - slugs.indexOf("b")), 1, `127.0.0.1 tabs adjacent: ${slugs}`);
});

test("organizing twice reports there is nothing to do", async () => {
  await h.open([mail("w1", "work@corp.com"), mail("p1", "me@gmail.com")]);
  await organize("account");
  assert.match(await organize("account"), /Already organized by logged-in account/);
});

test("Undo restores the exact previous order, once", async () => {
  await h.open([mail("w1", "work@corp.com"), "n", mail("p1", "me@gmail.com"), mail("w2", "work@corp.com")]);
  const before = await h.slugs();
  await organize("account");
  assert.notDeepEqual(await h.slugs(), before);
  await undo();
  assert.deepEqual(await h.slugs(), before);
  await undo(/Nothing to undo/);
});

test("pinned tabs and Chrome tab groups keep their places; only loose tabs move", async () => {
  const ids = await h.open([mail("pin", "zzz@corp.com"), mail("w1", "work@corp.com"), "g1", "g2", mail("p1", "me@gmail.com"), mail("w2", "work@corp.com")]);
  await h.page.evaluate(async ids => {
    await chrome.tabs.update(ids[0], { pinned: true });
    const g = await chrome.tabs.group({ tabIds: [ids[2], ids[3]] });
    await chrome.tabGroups.update(g, { title: "Keep", color: "red" });
  }, ids);
  await h.until(async () => (await h.page.locator(".group-cluster").count()) === 1, "cluster");
  const managerIndex = () => h.page.evaluate(async () => (await chrome.tabs.getCurrent()).index);
  const mgrBefore = await managerIndex();

  await organize("account");
  const tabs = await h.tabs();
  // Slots: pin | loose | [g1 g2] | loose | loose  ->  loose slots filled with p1, w1, w2.
  assert.deepEqual(tabs.map(t => t.slug), ["pin", "p1", "g1", "g2", "w1", "w2"]);
  assert.equal(tabs[0].pinned, true);
  assert.deepEqual(tabs.filter(t => t.group === "Keep").map(t => t.slug), ["g1", "g2"]);
  assert.ok(tabs.filter(t => !t.slug.startsWith("g")).every(t => t.group === null), "no loose tab was pulled into the group");
  assert.equal(await managerIndex(), mgrBefore, "the TabView tab stays put");

  await undo();
  const restored = await h.tabs();
  assert.deepEqual(restored.map(t => t.slug), ["pin", "w1", "g1", "g2", "p1", "w2"]);
  assert.deepEqual(restored.filter(t => t.group === "Keep").map(t => t.slug), ["g1", "g2"]);
});

test("each window is organized on its own; tabs never change window", async () => {
  await h.open([mail("w1", "work@corp.com"), mail("p1", "me@gmail.com")]);
  const winId = await h.page.evaluate(async urls => (await chrome.windows.create({ url: urls, focused: false })).id,
    [h.fixture("w2", "Inbox - work@corp.com - Mail"), h.fixture("p2", "Inbox - me@gmail.com - Mail")]);
  await h.until(async () => (await h.tabs()).filter(t => t.windowId === winId).every(t => t.title.includes("@")), "second window titles");
  assert.match(await organize("account"), /Organized 2 windows/);
  const tabs = await h.tabs();
  assert.deepEqual(tabs.filter(t => t.windowId !== winId).map(t => t.slug), ["p1", "w1"]);
  assert.deepEqual(tabs.filter(t => t.windowId === winId).map(t => t.slug), ["p2", "w2"]);
});

test("organizing switches a RAM / last-used sort back to window order so the result is visible", async () => {
  await h.open([mail("w1", "work@corp.com"), mail("p1", "me@gmail.com")]);
  await h.page.selectOption("#sortSelect", "ram");
  await organize("account");
  assert.equal(await h.page.inputValue("#sortSelect"), "default");
  assert.deepEqual(await h.cardSlugs(), ["p1", "w1"]);
});

test("Edit order rules opens Settings with the defaults; Save and Reset persist", async () => {
  await h.page.selectOption("#organizeSelect", "rules");
  assert.equal(await h.page.evaluate(() => document.getElementById("settingsPanel").classList.contains("hidden")), false);
  assert.equal(await h.page.inputValue("#orderRulesText"), "Gmail: mail.google.com\nCalendar: calendar.google.com");

  await h.page.fill("#orderRulesText", "A: alpha\n# comment\nB: beta");
  await h.page.click("#saveOrderRules");
  await h.waitToast(/Saved 2 order rules/);
  assert.equal(await h.getStorage("tabview_order_rules"), "A: alpha\n# comment\nB: beta");
  await h.reload();
  assert.equal(await h.page.inputValue("#orderRulesText"), "A: alpha\n# comment\nB: beta");

  await h.page.click("#openSettings");
  await h.page.click("#resetOrderRules");
  await h.waitToast(/Order rules reset to default/);
  assert.equal(await h.getStorage("tabview_order_rules"), undefined);
  assert.equal(await h.page.inputValue("#orderRulesText"), "Gmail: mail.google.com\nCalendar: calendar.google.com");
});

test("Cleanup lists duplicates and empty tabs with reasons and closes only the ticked ones", async () => {
  await h.open(["keep", "dup", "dup", { url: "about:blank" }]);
  await h.page.click("#quickSuggestCloses");
  assert.equal(await h.page.locator("#aiModalTitle").textContent(), "Cleanup");
  assert.match(await h.page.locator("#aiModalBody p").first().textContent(), /^\s*2 tabs look safe to close/);
  const reasons = await h.page.locator(".ai-close-row-reason").allTextContents();
  assert.deepEqual(reasons, ["Duplicate: the same page is open in another tab (2 copies)", "Empty new tab"]);
  assert.equal(await h.page.locator(".tab-card.ai-flagged-close").count(), 2);

  await h.page.locator(".ai-close-include").nth(1).uncheck(); // keep the blank tab
  await h.page.click("#aiApply");
  await h.waitToast(/Closed 1 tabs/);
  const slugs = await h.slugs();
  assert.equal(slugs.filter(s => s === "dup").length, 1, "one copy of the duplicate survives");
  assert.ok(slugs.includes("keep"));
  assert.ok((await h.tabs()).some(t => t.url === "about:blank"), "the unticked blank tab is still open");
});

test("Cleanup with nothing to close says so", async () => {
  await h.open(["a", "b"]);
  await h.page.click("#quickSuggestCloses");
  assert.match(await h.page.locator("#aiModalBody").textContent(), /No tabs flagged for closing/);
  await h.page.click("#aiCancel");
});

test("Cleanup works with no AI key configured", async () => {
  assert.equal(await h.page.locator("#aiSuggestCloses").isDisabled(), true);
  assert.equal(await h.page.locator("#quickSuggestCloses").isDisabled(), false);
  assert.equal(await h.page.locator("#organizeSelect").isDisabled(), false);
});

const sidebarHidden = () => h.page.evaluate(() => document.getElementById("sidebar").classList.contains("hidden"));

test("the sidebar opens from ☰, lists every tab with title, URL and account, and remembers being open", async () => {
  await h.open([mail("m1", "me@gmail.com"), { slug: "plain", title: "Plain page" }]);
  assert.equal(await sidebarHidden(), true);
  await h.page.click("#toggleSidebar");
  assert.equal(await sidebarHidden(), false);
  assert.equal(await h.page.locator("#sidebarTitle").textContent(), "Open tabs (2)");
  assert.deepEqual(await h.page.locator(".sidebar-title").allTextContents(), ["Inbox - me@gmail.com - Mail", "Plain page"]);
  const urls = await h.page.locator(".sidebar-url").allTextContents();
  assert.match(urls[0], /^me@gmail\.com · 127\.0\.0\.1:\d+\/m1\?/);
  assert.match(urls[1], /^127\.0\.0\.1:\d+\/plain\?/);
  assert.match(await h.page.locator(".sidebar-window").textContent(), /Current Window · 2/);
  assert.equal(await h.page.evaluate(() => getComputedStyle(document.body).paddingLeft), "320px", "the grid makes room");

  await h.reload();
  assert.equal(await sidebarHidden(), false, "still open after a reload");
  assert.equal(await h.page.locator(".sidebar-row").count(), 2);
  await h.page.click("#sidebarClose");
  assert.equal(await sidebarHidden(), true);
  assert.equal(await h.page.evaluate(() => getComputedStyle(document.body).paddingLeft), "0px");
});

test("the sidebar follows the search box and live tab changes", async () => {
  await h.open([{ slug: "apple", title: "Apple" }, { slug: "banana", title: "Banana" }]);
  await h.page.click("#toggleSidebar");
  await h.page.fill("#searchInput", "banana");
  assert.deepEqual(await h.page.locator(".sidebar-title").allTextContents(), ["Banana"]);
  assert.equal(await h.page.locator("#sidebarTitle").textContent(), "Open tabs (1)");
  await h.page.fill("#searchInput", "zzz");
  assert.match(await h.page.locator("#sidebarList").textContent(), /No tabs match your search/);
  await h.page.fill("#searchInput", "");
  await h.open([{ slug: "cherry", title: "Cherry" }]);
  await h.until(async () => (await h.page.locator(".sidebar-row").count()) === 3, "new tab in sidebar");
});

test("sidebar rows jump to the tab, × closes it, and Copy URLs copies the list", async () => {
  const [a, b] = await h.open([{ slug: "apple", title: "Apple" }, { slug: "banana", title: "Banana" }]);
  await h.page.click("#toggleSidebar");

  await h.page.locator(".sidebar-row").nth(0).hover();
  await h.page.locator(".sidebar-row").nth(0).locator(".sidebar-close").click();
  await h.until(async () => (await h.slugs()).join() === "banana", "apple closed");
  await h.until(async () => (await h.page.locator(".sidebar-row").count()) === 1, "row removed");

  await h.ctx.grantPermissions(["clipboard-read", "clipboard-write"]).catch(() => {});
  await h.page.evaluate(() => { navigator.clipboard.writeText = async text => { window.__copied = text; }; });
  await h.page.click("#sidebarCopy");
  await h.waitToast(/Copied 1 URL$/);
  assert.equal(await h.page.evaluate(() => window.__copied), h.fixture("banana", "Banana"));

  await h.page.locator(".sidebar-row").nth(0).locator(".sidebar-title").click();
  await h.until(() => h.page.evaluate(id => chrome.tabs.get(id).then(t => t.active), b), "banana to become active");
  await h.page.bringToFront();
});

test("no errors were logged by the manager page", () => {
  assert.deepEqual(h.errors, []);
});
