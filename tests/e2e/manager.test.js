// Core manager UI: rendering, previews, search, sorting, sizing, panels, shortcuts.
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { launch } = require("./harness");

let h;
before(async () => {
  h = await launch();
  await h.open([
    { slug: "alpha", title: "Alpha Docs" },
    { slug: "bravo", title: "Bravo Report" },
    { slug: "charlie", title: "Charlie Dashboard" },
    { slug: "delta", title: "Delta Docs" },
  ]);
});
after(async () => { await h?.close(); });

test("renders one card per tab with title, URL, position badge, and a tab count", async () => {
  assert.deepEqual(await h.cardSlugs(), ["alpha", "bravo", "charlie", "delta"]);
  assert.equal(await h.card("bravo").locator(".title").textContent(), "Bravo Report");
  assert.match(await h.card("bravo").locator(".title").getAttribute("title"), /\/bravo\?t=Bravo/);
  assert.match(await h.page.locator("#tabCount").textContent(), /^4 tabs across 1 window/);
  assert.equal(await h.page.locator(".window-current-badge").count(), 1);
  assert.equal(await h.page.locator(".window-tab-count").textContent(), "(4)");
  // The manager tab is index 0, so the fixture tabs are positions 2 to 5.
  assert.deepEqual(await h.page.locator(".index-badge").allTextContents(), ["2", "3", "4", "5"]);
});

test("the manager tab itself is never listed", async () => {
  assert.equal(await h.page.locator(`.tab-card[data-url^="chrome-extension://"]`).count(), 0);
});

test("Refresh All Captures produces a real screenshot and a RAM reading for every tab", async () => {
  await h.page.click("#captureAll");
  await h.waitToast(/Captured 4 previews$/, 30000);
  const srcs = await h.page.locator(".tab-card .preview > img").evaluateAll(els => els.map(e => e.src.slice(0, 22)));
  assert.equal(srcs.length, 4);
  for (const s of srcs) assert.match(s, /^data:image\/(jpeg|png|webp);base64/);
  const ram = await h.page.locator(".ram-badge").allTextContents();
  assert.ok(ram.every(r => /^\d+(\.\d+)? (MB|GB)$/.test(r)), `RAM badges: ${ram}`);
  assert.match(await h.page.locator("#tabCount").textContent(), /\| \d+(\.\d+)? (MB|GB)$/);
  assert.equal(await h.page.locator("#captureAll").isDisabled(), false, "button resets after capturing");
  assert.equal(await h.page.locator("#captureAll").textContent(), "↻ Refresh All Captures");
});

test("Cmd/Ctrl+R re-captures instead of reloading the page", async () => {
  await h.page.evaluate(() => { window.__notReloaded = true; });
  const mod = process.platform === "darwin" ? "Meta" : "Control";
  await h.page.keyboard.press(`${mod}+r`);
  await h.waitToast(/Captured 4 previews/, 30000);
  assert.equal(await h.page.evaluate(() => window.__notReloaded), true);
});

test("capture reports tabs it cannot screenshot as skipped, not failed", async () => {
  const [id] = await h.page.evaluate(async () => [(await chrome.tabs.create({ url: "chrome://version/", active: false })).id]);
  await h.until(() => h.page.evaluate(id => !!document.querySelector(`.tab-card[data-tab-id="${id}"]`), id), "chrome:// card");
  await h.page.click("#captureAll");
  const text = await h.waitToast(/Captured 4 previews \(1 skipped\)/, 30000);
  assert.doesNotMatch(text, /failed/);
  await h.page.evaluate(id => chrome.tabs.remove(id), id);
  await h.until(async () => (await h.cardSlugs()).length === 4, "card removed");
});

test("search filters by title, highlights the match, and updates the count", async () => {
  await h.page.fill("#searchInput", "docs");
  assert.deepEqual(await h.cardSlugs(), ["alpha", "delta"]);
  assert.equal(await h.page.locator(".window-tab-count").textContent(), "(2)");
  assert.equal(await h.card("alpha").locator(".title mark, .title .highlight, .title b, .title span").first().textContent(), "Docs");
});

test("search matches the URL too, and a miss hides the whole window", async () => {
  await h.page.fill("#searchInput", "/charlie");
  assert.deepEqual(await h.cardSlugs(), ["charlie"]);
  await h.page.fill("#searchInput", "zzz-nothing");
  assert.equal(await h.page.locator(".window-section").count(), 0);
});

test("Escape clears the search and / focuses it", async () => {
  await h.page.fill("#searchInput", "alpha");
  await h.page.keyboard.press("Escape");
  assert.equal(await h.page.inputValue("#searchInput"), "");
  assert.equal((await h.cardSlugs()).length, 4);
  assert.equal(await h.page.evaluate(() => document.activeElement.id), "");
  await h.page.keyboard.press("/");
  assert.equal(await h.page.evaluate(() => document.activeElement.id), "searchInput");
  assert.equal(await h.page.inputValue("#searchInput"), "", "the slash itself is not typed");
  await h.page.keyboard.press("Escape");
});

test("search text with HTML in it is shown as text, not rendered", async () => {
  await h.page.fill("#searchInput", "<img src=x onerror=window.__xss=1>");
  await h.page.fill("#searchInput", "");
  assert.equal(await h.page.evaluate(() => window.__xss), undefined);
});

test("a tab title containing HTML is escaped on the card and in the sidebar", async () => {
  const [id] = await h.open([{ slug: "evil", title: "<b id=injected>bold</b>&amp;" }]);
  await h.until(async () => (await h.card("evil").locator(".title").textContent()).includes("<b"), "title to load");
  assert.equal(await h.page.locator("#injected").count(), 0);
  await h.page.evaluate(id => chrome.tabs.remove(id), id);
  await h.until(async () => (await h.cardSlugs()).length === 4, "card removed");
});

test("sort by last used reorders cards, is remembered, and Window order restores it", async () => {
  // Visit bravo so it becomes the most recently used fixture tab.
  const bravo = (await h.tabs()).find(t => t.slug === "bravo");
  await h.page.evaluate(async ({ id, me }) => {
    await chrome.tabs.update(id, { active: true });
    await new Promise(r => setTimeout(r, 300));
    await chrome.tabs.update(me, { active: true });
  }, { id: bravo.id, me: await h.page.evaluate(async () => (await chrome.tabs.getCurrent()).id) });
  await h.reload();

  await h.page.selectOption("#sortSelect", "lastused-new");
  assert.equal((await h.cardSlugs())[0], "bravo");
  await h.page.selectOption("#sortSelect", "lastused");
  assert.equal((await h.cardSlugs()).at(-1), "bravo");
  assert.equal(await h.page.evaluate(() => localStorage.getItem("tabview_sortMode")), "lastused");
  assert.ok(await h.page.locator("#sortSelect.active").count(), "non-default sort is visually flagged");

  await h.reload();
  assert.equal(await h.page.inputValue("#sortSelect"), "lastused", "sort survives a reload");
  await h.page.selectOption("#sortSelect", "default");
  assert.deepEqual(await h.cardSlugs(), ["alpha", "bravo", "charlie", "delta"]);
});

test("sort by RAM puts the heaviest tab first", async () => {
  await h.page.click("#captureAll");
  await h.waitToast(/Captured 4 previews/, 30000);
  await h.page.selectOption("#sortSelect", "ram");
  const mb = (await h.page.locator(".ram-badge").allTextContents()).map(t => parseFloat(t) * (t.endsWith("GB") ? 1024 : 1));
  assert.deepEqual(mb, mb.slice().sort((a, b) => b - a));
  await h.page.selectOption("#sortSelect", "default");
});

test("every card shows an idle badge", async () => {
  const idle = await h.page.locator(".idle-badge").allTextContents();
  assert.equal(idle.length, 4);
  assert.ok(idle.every(t => /^(now|\d+(m|h|d|w|mo))$/.test(t)), `idle badges: ${idle}`);
});

test("S / M / L changes the card size and is remembered", async () => {
  // The inactive letters only show on hover (CSS), so dispatch the click directly.
  const sizeBtn = size => h.page.locator(`.size-btn[data-size="${size}"]`).dispatchEvent("click");
  const min = () => h.page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--card-min").trim());
  await sizeBtn("small");
  assert.equal(await min(), "240px");
  await sizeBtn("large");
  assert.equal(await min(), "440px");
  await h.reload();
  assert.equal(await min(), "440px");
  assert.equal(await h.page.locator(".size-btn.active").getAttribute("data-size"), "large");
  await sizeBtn("medium");
  assert.equal(await min(), "320px");
});

test("a window collapses and expands", async () => {
  await h.page.click(".collapse-toggle");
  assert.equal(await h.page.locator(".tab-card").count(), 0);
  assert.equal(await h.page.locator(".window-tab-count").textContent(), "(4)", "count still shown while collapsed");
  await h.page.click(".collapse-toggle");
  assert.equal(await h.page.locator(".tab-card").count(), 4);
});

test("double-click renames a window; the name survives a reload; Escape cancels", async () => {
  await h.page.dblclick(".window-name");
  await h.page.fill(".window-name-input", "Research");
  await h.page.keyboard.press("Enter");
  assert.equal(await h.page.locator(".window-name").textContent(), "Research");
  await h.reload();
  assert.equal(await h.page.locator(".window-name").textContent(), "Research");

  await h.page.dblclick(".window-name");
  await h.page.fill(".window-name-input", "Discarded edit");
  await h.page.keyboard.press("Escape");
  assert.equal(await h.page.locator(".window-name").textContent(), "Research");
});

test("help opens from the ? button and closes with Escape, Got it, and the ×", async () => {
  const hidden = () => h.page.evaluate(() => document.getElementById("helpModal").classList.contains("hidden"));
  await h.page.click("#helpBtn");
  assert.equal(await hidden(), false);
  await h.page.keyboard.press("Escape");
  assert.equal(await hidden(), true);
  await h.page.click("#helpBtn");
  await h.page.click("#helpModalDone");
  assert.equal(await hidden(), true);
  await h.page.click("#helpBtn");
  await h.page.click("#helpModalClose");
  assert.equal(await hidden(), true);
});

test("settings opens from the gear and closes with Escape", async () => {
  const hidden = () => h.page.evaluate(() => document.getElementById("settingsPanel").classList.contains("hidden"));
  assert.equal(await hidden(), true);
  await h.page.click("#openSettings");
  assert.equal(await hidden(), false);
  await h.page.keyboard.press("Escape");
  assert.equal(await hidden(), true);
});

test("auto-refresh interval saves, persists, and rejects a negative number", async () => {
  await h.page.click("#openSettings");
  await h.page.fill("#autoRefreshMinutes", "12");
  await h.page.click("#saveAutoRefresh");
  await h.waitToast(/Auto-refresh: after 12 min away/);
  assert.equal(await h.getStorage("tabview_autorefresh_min"), 12);
  await h.page.fill("#autoRefreshMinutes", "0");
  await h.page.click("#saveAutoRefresh");
  await h.waitToast(/Auto-refresh: off/);
  await h.page.fill("#autoRefreshMinutes", "-3");
  await h.page.click("#saveAutoRefresh");
  await h.waitToast(/Enter a number 0-60/);
  assert.equal(await h.getStorage("tabview_autorefresh_min"), 0);
  await h.reload();
  assert.equal(await h.page.inputValue("#autoRefreshMinutes"), "0");
});

test("auto-refresh interval rejects a value above the stated 0-60 range", async () => {
  await h.page.click("#openSettings");
  await h.page.fill("#autoRefreshMinutes", "500");
  await h.page.click("#saveAutoRefresh");
  await h.waitToast(/Enter a number 0-60/);
});

test("the share button is a placeholder that says so", async () => {
  await h.page.keyboard.press("Escape");
  await h.page.click("#shareBtn");
  await h.waitToast(/Share is coming/);
});

test("the grid follows tabs opened, retitled, and closed outside TabView", async () => {
  const [id] = await h.open([{ slug: "echo", title: "Echo" }]);
  assert.match(await h.page.locator("#tabCount").textContent(), /^5 tabs/);
  await h.page.evaluate(async ({ id, url }) => { await chrome.tabs.update(id, { url }); }, { id, url: h.fixture("echo", "Echo Renamed") });
  await h.until(async () => (await h.card("echo").locator(".title").textContent()) === "Echo Renamed", "retitled card");
  await h.page.evaluate(id => chrome.tabs.remove(id), id);
  await h.until(async () => /^4 tabs/.test(await h.page.locator("#tabCount").textContent()), "count to drop");
});

test("no errors were logged by the manager page", () => {
  assert.deepEqual(h.errors, []);
});
