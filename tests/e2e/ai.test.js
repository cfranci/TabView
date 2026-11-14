// AI settings and the four AI features, run against a fake local model server
// (the harness answers Ollama's API) so no key, network, or real model is needed.
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { launch } = require("./harness");

let h, ids;
before(async () => {
  h = await launch();
  ids = await h.open([
    { slug: "t1", title: "Quarterly budget" }, { slug: "t2", title: "Budget review notes" },
    { slug: "t3", title: "Flight to Lisbon" }, { slug: "t4", title: "Lisbon hotels" },
    { slug: "t5", title: "Random article" },
  ]);
});
after(async () => { await h?.close(); });

const useFakeModel = async () => {
  await h.setStorage({ tabview_provider: "local", tabview_local_model: "fake-model:latest", tabview_local_host: h.base });
  await h.reload();
  h.server.llmMode = "ok";
  h.server.llmCalls.length = 0;
};
const modalHidden = () => h.page.evaluate(() => document.getElementById("aiModal").classList.contains("hidden"));

test("with no key, AI buttons are disabled and the AI search toggle sends you to Settings", async () => {
  assert.equal(await h.page.locator("#aiAutoGroup").isDisabled(), true);
  assert.equal(await h.page.locator("#aiSuggestCloses").isDisabled(), true);
  assert.match(await h.page.locator("#apiKeyStatus").textContent(), /No key set/);
  await h.page.click("#aiSearchToggle");
  await h.waitToast(/Set an API key in Settings first/);
  assert.equal(await h.page.evaluate(() => document.getElementById("settingsPanel").classList.contains("hidden")), false);
});

test("Anthropic key: empty and wrong-prefix keys are rejected, a valid one enables AI, Clear disables it", async () => {
  await h.page.click("#saveApiKey");
  assert.equal(await h.page.locator("#apiKeyStatus").textContent(), "Enter a key first");
  await h.page.fill("#apiKeyInput", "sk-wrong-123");
  await h.page.click("#saveApiKey");
  assert.equal(await h.page.locator("#apiKeyStatus").textContent(), "Keys start with sk-ant-");
  assert.equal(await h.getStorage("tabview_api_key"), undefined);

  await h.page.fill("#apiKeyInput", "sk-ant-test-123");
  await h.page.click("#saveApiKey");
  await h.waitToast(/Anthropic key saved/);
  assert.equal(await h.getStorage("tabview_api_key"), "sk-ant-test-123");
  assert.equal(await h.page.locator("#aiAutoGroup").isDisabled(), false);
  assert.equal(await h.page.inputValue("#apiKeyInput"), "", "the key is not left visible in the field");

  await h.page.click("#clearApiKey");
  await h.waitToast(/Anthropic key cleared/);
  assert.equal(await h.getStorage("tabview_api_key"), undefined);
  assert.equal(await h.page.locator("#aiAutoGroup").isDisabled(), true);
});

test("switching provider shows only that provider's settings and is saved", async () => {
  const visible = () => h.page.evaluate(() => ["anthropicSettings", "openrouterSettings", "localSettings"]
    .filter(id => !document.getElementById(id).classList.contains("hidden")));
  // The change handler saves to storage before it updates the panel, so wait for each switch.
  const shows = id => h.until(async () => (await visible()).join() === id, `${id} to be the only visible section`);
  await shows("anthropicSettings");
  await h.page.selectOption("#providerSelect", "openrouter");
  await shows("openrouterSettings");
  assert.equal(await h.getStorage("tabview_provider"), "openrouter");
  await h.page.selectOption("#providerSelect", "local");
  await shows("localSettings");
  await h.page.selectOption("#providerSelect", "anthropic");
  await shows("anthropicSettings");
});

test("saving an OpenRouter key switches the provider to OpenRouter; clearing disables AI", async () => {
  await h.page.selectOption("#providerSelect", "openrouter");
  await h.page.click("#saveOpenrouterKey");
  assert.equal(await h.page.locator("#openrouterStatus").textContent(), "Enter a key first");
  await h.page.selectOption("#providerSelect", "anthropic");
  await h.until(async () => (await h.getStorage("tabview_provider")) === "anthropic", "provider saved");

  await h.page.evaluate(() => { document.getElementById("openrouterSettings").classList.remove("hidden"); });
  await h.page.fill("#openrouterKeyInput", "sk-or-test");
  await h.page.click("#saveOpenrouterKey");
  await h.waitToast(/OpenRouter key saved/);
  assert.equal(await h.getStorage("tabview_provider"), "openrouter");
  assert.equal(await h.page.inputValue("#providerSelect"), "openrouter");
  assert.equal(await h.page.locator("#aiAutoGroup").isDisabled(), false);

  await h.page.click("#clearOpenrouterKey");
  await h.waitToast(/OpenRouter key cleared/);
  assert.equal(await h.page.locator("#aiAutoGroup").isDisabled(), true);
});

test("with a key but no model chosen, an AI call explains what to pick", async () => {
  await h.setStorage({ tabview_provider: "openrouter", tabview_openrouter_key: "sk-or-test" });
  await h.page.evaluate(() => chrome.storage.local.remove("tabview_openrouter_model"));
  const r = await h.send({ type: "aiTabSummary", tab: { id: 1, title: "x", url: "https://x.com" } });
  assert.equal(r.success, false);
  assert.match(r.error, /No model selected.*OpenRouter/);
  await h.page.evaluate(() => chrome.storage.local.remove(["tabview_openrouter_key", "tabview_provider"]));
});

test("Local provider: Refresh lists installed models, picks the first, and enables AI", async () => {
  await h.setStorage({ tabview_local_host: h.base });
  await h.reload();
  await h.page.click("#openSettings");
  await h.page.selectOption("#providerSelect", "local");
  assert.equal(await h.page.locator("#aiAutoGroup").isDisabled(), true);
  await h.page.click("#refreshLocalModels");
  await h.until(async () => /2 models available, using another:7b\./.test(await h.page.locator("#localStatus").textContent()), "model list");
  assert.deepEqual(await h.page.locator("#localModelSelect option").allTextContents(), ["another:7b", "fake-model:latest"]);
  assert.equal(await h.getStorage("tabview_local_model"), "another:7b");
  assert.equal(await h.page.locator("#aiAutoGroup").isDisabled(), false);

  await h.page.selectOption("#localModelSelect", "fake-model:latest");
  await h.waitToast(/Local model: fake-model:latest/);
  assert.equal(await h.getStorage("tabview_local_model"), "fake-model:latest");
});

test("Local provider: an unreachable server gives a readable error", async () => {
  const r = await h.send({ type: "getOllamaModels", host: "http://127.0.0.1:1" });
  assert.equal(r.success, false);
  assert.match(r.error, /Can't reach a model server at http:\/\/127\.0\.0\.1:1/);
});

test("Auto-Group proposes groups, drops undersized ones, and Apply creates them in Chrome", async () => {
  await useFakeModel();
  await h.page.click("#aiAutoGroup");
  await h.until(async () => !(await modalHidden()), "proposal modal");
  assert.equal(await h.page.locator("#aiModalTitle").textContent(), "✨ Proposed Groups");
  const names = await h.page.locator(".ai-group-name").evaluateAll(els => els.map(e => e.value));
  assert.deepEqual(names, ["First Pair", "Second Pair"], "the 1-tab group is filtered out");
  assert.deepEqual(await h.page.locator(".ai-group-proposal-count").allTextContents(), ["2 tabs", "2 tabs"]);

  const call = h.server.llmCalls.at(-1);
  assert.equal(call.model, "fake-model:latest");
  assert.match(call.user, /Here are 5 open tabs/);
  assert.match(call.user, /\[\d+\] 127\.0\.0\.1 — Quarterly budget/);

  // Rename one group, untick the other, then apply.
  await h.page.locator(".ai-group-name").first().fill("Money");
  await h.page.locator(".ai-group-include").nth(1).uncheck();
  await h.page.click("#aiApply");
  await h.waitToast(/Created 1 groups/);
  const tabs = await h.tabs();
  assert.deepEqual(tabs.filter(t => t.group === "Money").map(t => t.slug), ["t1", "t2"]);
  assert.ok(tabs.filter(t => !["t1", "t2"].includes(t.slug)).every(t => t.group === null));
  assert.equal(await modalHidden(), true);
  await h.page.evaluate(ids => chrome.tabs.ungroup(ids), ids);
});

test("Auto-Group: Cancel creates nothing", async () => {
  await h.page.click("#aiAutoGroup");
  await h.until(async () => !(await modalHidden()), "proposal modal");
  await h.page.click("#aiCancel");
  assert.equal(await modalHidden(), true);
  assert.ok((await h.tabs()).every(t => t.groupId === -1));
});

test("Suggest Closes lists flagged tabs with reasons, ignores unknown ids, and closes the ticked ones", async () => {
  await h.page.click("#aiSuggestCloses");
  await h.until(async () => !(await modalHidden()), "suggestions modal");
  assert.equal(await h.page.locator("#aiModalTitle").textContent(), "✨ Suggested Closes");
  assert.equal(await h.page.locator(".ai-close-row").count(), 1);
  assert.equal(await h.page.locator(".ai-close-row-reason").textContent(), "Fake model says close this");
  assert.equal(await h.page.locator(".tab-card.ai-flagged-close").count(), 1, "flagged on the grid too");

  await h.page.click("#aiCancel");
  assert.equal(await h.page.locator(".tab-card.ai-flagged-close").count(), 0, "cancel clears the flags");
  assert.equal((await h.tabs()).length, 5);

  await h.page.click("#aiSuggestCloses");
  await h.until(async () => !(await modalHidden()), "suggestions modal");
  await h.page.click("#aiApply");
  await h.waitToast(/Closed 1 tabs/);
  assert.deepEqual(await h.slugs(), ["t2", "t3", "t4", "t5"]);
});

test("AI search ranks matching cards first with rank badges; toggling off restores normal search", async () => {
  await h.page.click("#aiSearchToggle");
  assert.match(await h.page.getAttribute("#searchInput", "placeholder"), /Describe what you're looking for/);
  await h.page.fill("#searchInput", "my trip");
  assert.equal((await h.cardSlugs()).length, 4, "typing alone does not filter in AI mode");
  await h.page.keyboard.press("Enter");
  await h.waitToast(/Found 2 matches/);
  // The fake model returns [third tab, first tab] of the 4 it was sent: t4 then t2.
  assert.deepEqual((await h.cardSlugs()).slice(0, 2), ["t4", "t2"]);
  assert.deepEqual(await h.page.locator(".ai-rank-badge").allTextContents(), ["#1", "#2"]);
  assert.match(h.server.llmCalls.at(-1).user, /^Query: "my trip"/);

  await h.page.click("#aiSearchToggle");
  assert.match(await h.page.getAttribute("#searchInput", "placeholder"), /Search tabs by title or URL/);
  assert.equal(await h.page.locator(".ai-rank-badge").count(), 0);
  await h.page.fill("#searchInput", "");
});

test("hovering a card shows an AI summary, and the second hover uses the cache", async () => {
  // Park the pointer and reload so no summary is cached from an earlier test's mouse movement.
  await h.page.mouse.move(5, 5);
  await h.reload();
  h.server.llmCalls.length = 0;
  await h.card("t3").hover();
  await h.until(async () => (await h.page.locator("#hoverTooltip").textContent()).includes("A fake one-line summary."), "summary tooltip");
  assert.equal(h.server.llmCalls.length, 1);
  assert.match(h.server.llmCalls[0].user, /Title: Flight to Lisbon/);
  await h.page.mouse.move(5, 5);
  await h.until(() => h.page.evaluate(() => document.getElementById("hoverTooltip").classList.contains("hidden")), "tooltip to hide");
  await h.card("t3").hover();
  await h.until(async () => (await h.page.locator("#hoverTooltip").textContent()).includes("A fake one-line summary."), "cached tooltip");
  assert.equal(h.server.llmCalls.length, 1, "no second request");
  await h.page.mouse.move(5, 5);
});

test("a custom prompt is sent to the model, with the required format still appended; Reset restores the default", async () => {
  await h.page.click("#openSettings");
  await h.page.selectOption("#promptSelect", "suggestcloses");
  const original = await h.page.inputValue("#promptText");
  assert.equal(await h.page.locator("#promptStatus").textContent(), "Using default");

  await h.page.fill("#promptText", "   ");
  await h.page.click("#savePrompt");
  assert.match(await h.page.locator("#promptStatus").textContent(), /can't be empty/);

  await h.page.fill("#promptText", "ONLY FLAG PURPLE TABS");
  await h.page.click("#savePrompt");
  await h.waitToast(/Suggest closes prompt saved/);
  assert.equal(await h.page.locator("#promptStatus").textContent(), "Custom prompt in use");
  assert.deepEqual(await h.getStorage("tabview_prompts"), { suggestcloses: "ONLY FLAG PURPLE TABS" });

  await h.send({ type: "aiSuggestCloses", tabs: [{ id: 1, title: "x", url: "https://x.com" }] });
  const sys = h.server.llmCalls.at(-1).system;
  assert.ok(sys.startsWith("ONLY FLAG PURPLE TABS"));
  assert.match(sys, /\{"suggestions"/, "output format cannot be edited away");

  await h.page.selectOption("#promptSelect", "summary");
  assert.equal(await h.page.locator("#promptStatus").textContent(), "Using default", "other prompts are untouched");
  await h.page.selectOption("#promptSelect", "suggestcloses");

  const dialog = h.answerDialog(true);
  await h.page.click("#resetPrompt");
  assert.match((await dialog).message, /reset the Suggest closes prompt/);
  await h.waitToast(/prompt reset to default/);
  assert.equal(await h.page.inputValue("#promptText"), original);
  assert.deepEqual(await h.getStorage("tabview_prompts"), {});
  await h.page.keyboard.press("Escape");
});

test("a model error is shown to the user and nothing changes", async () => {
  h.server.llmMode = "error";
  await h.page.click("#aiAutoGroup");
  await h.waitToast(/model exploded/);
  assert.equal(await modalHidden(), true);
  assert.equal(await h.page.evaluate(() => document.getElementById("aiLoading").classList.contains("hidden")), true, "spinner is dismissed");
});

test("a non-JSON model reply is reported as malformed for every JSON feature", async () => {
  h.server.llmMode = "garbage";
  const tabs = [{ id: 1, title: "a", url: "https://a.com" }, { id: 2, title: "b", url: "https://b.com" }];
  for (const msg of [{ type: "aiAutoGroup", tabs }, { type: "aiSuggestCloses", tabs }, { type: "aiSearch", query: "q", tabs }]) {
    const r = await h.send(msg);
    assert.deepEqual(r, { success: false, error: "AI returned malformed response" }, msg.type);
  }
  h.server.llmMode = "ok";
});

test("an unreachable local model gives a readable error", async () => {
  await h.setStorage({ tabview_local_host: "http://127.0.0.1:1" });
  const r = await h.send({ type: "aiTabSummary", tab: { id: 1, title: "x", url: "https://x.com" } });
  assert.equal(r.success, false);
  assert.match(r.error, /Can't reach a model server at http:\/\/127\.0\.0\.1:1/);
  await h.setStorage({ tabview_local_host: h.base });
});

test("no errors were logged by the manager page", () => {
  assert.deepEqual(h.errors, []);
});
