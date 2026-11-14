// Linking a local model server: address, presets, optional key, model list,
// and the servers it has to cope with (Ollama, OpenAI-style, locked down).
const { test, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { launch } = require("./harness");

let h;
before(async () => { h = await launch(); });
after(async () => { await h?.close(); });

beforeEach(async () => {
  h.server.resetModelServer();
  h.server.llmMode = "ok";
  await h.page.evaluate(() => chrome.storage.local.clear());
  await h.reload();
  await h.page.click("#openSettings");
  await h.page.selectOption("#providerSelect", "local");
  await h.until(() => h.page.evaluate(() => !document.getElementById("localSettings").classList.contains("hidden")), "local settings");
});

const status = () => h.page.locator("#localStatus").textContent();
const statusClass = () => h.page.locator("#localStatus").getAttribute("class");
const connect = async address => {
  if (address !== undefined) await h.page.fill("#localHostInput", address);
  await h.page.click("#connectLocal");
  await h.until(async () => /\b(ok|err)\b/.test(await statusClass()) && !(await h.page.locator("#connectLocal").isDisabled()), "connect to finish");
};
const aiEnabled = async () => !(await h.page.locator("#aiAutoGroup").isDisabled());
const SUMMARY = { type: "aiTabSummary", tab: { id: 1, title: "x", url: "https://x.com" } };

test("the address starts at the Ollama default and presets fill in common servers", async () => {
  assert.equal(await h.page.inputValue("#localHostInput"), "http://localhost:11434");
  for (const [label, url] of [["LM Studio", "http://localhost:1234"], ["llama.cpp server", "http://localhost:8080"], ["Jan", "http://localhost:1337"], ["Ollama", "http://localhost:11434"]]) {
    await h.page.selectOption("#localPreset", { label });
    assert.equal(await h.page.inputValue("#localHostInput"), url);
    assert.equal(await h.page.inputValue("#localPreset"), "", "the preset menu resets");
  }
  assert.equal(await h.getStorage("tabview_local_host"), undefined, "a preset alone saves nothing");
});

test("Connect tidies the address, saves it, lists the models, and turns AI on", async () => {
  assert.equal(await aiEnabled(), false);
  const port = new URL(h.base).port;
  await connect(`  127.0.0.1:${port}/v1/  `);
  assert.equal(await h.page.inputValue("#localHostInput"), h.base);
  assert.equal(await h.getStorage("tabview_local_host"), h.base);
  assert.equal(await status(), `Connected to ${h.base}. 2 models available, using another:7b.`);
  assert.match(await statusClass(), /\bok\b/);
  assert.deepEqual(await h.page.locator("#localModelSelect option").allTextContents(), ["another:7b", "fake-model:latest"]);
  assert.equal(await h.getStorage("tabview_local_model"), "another:7b");
  assert.equal(await aiEnabled(), true);
  await h.waitToast(new RegExp(`Connected to ${h.base}`));
});

test("pressing Enter in the address field connects too", async () => {
  await h.page.fill("#localHostInput", h.base);
  await h.page.press("#localHostInput", "Enter");
  await h.until(async () => /\bok\b/.test(await statusClass()), "connected");
});

test("the settings survive a reload: address shown, model kept, AI still on", async () => {
  await connect(h.base);
  await h.page.selectOption("#localModelSelect", "fake-model:latest");
  await h.until(async () => (await h.getStorage("tabview_local_model")) === "fake-model:latest", "model saved");
  await h.reload();
  assert.equal(await h.page.inputValue("#providerSelect"), "local");
  assert.equal(await h.page.inputValue("#localHostInput"), h.base);
  assert.equal(await h.page.inputValue("#localModelSelect"), "fake-model:latest");
  assert.equal(await aiEnabled(), true);
});

test("requests reach the server with its own origin, not the extension's (Ollama rejects those)", async () => {
  await connect(h.base);
  const r = await h.send(SUMMARY);
  assert.equal(r.success, true);
  assert.ok(h.server.apiRequests.length >= 2);
  for (const req of h.server.apiRequests) {
    assert.ok(!(req.origin || "").startsWith("chrome-extension://"), `${req.path} sent origin ${req.origin}`);
  }
  assert.equal(h.server.apiRequests.find(r => r.path === "/v1/chat/completions").origin, h.base);
});

test("an OpenAI-style server (LM Studio, llama.cpp) lists models and answers", async () => {
  h.server.kind = "openai";
  h.server.models = ["qwen2.5-7b-instruct", "llama-3.2-3b"];
  await connect(h.base);
  assert.equal(await status(), `Connected to ${h.base}. 2 models available, using llama-3.2-3b.`);
  assert.deepEqual(h.server.apiRequests.map(r => r.path), ["/api/tags", "/v1/models"], "falls back from the Ollama listing");
  const r = await h.send(SUMMARY);
  assert.deepEqual(r, { success: true, summary: "A fake one-line summary." });
  assert.equal(h.server.llmCalls.at(-1).model, "llama-3.2-3b");
});

test("a server that needs a key: clear message without one, works once it is entered, and the key is not left on screen", async () => {
  h.server.requireKey = "secret-123";
  await connect(h.base);
  assert.equal(await status(), `The server at ${h.base} wants an API key. Add one under Settings.`);
  assert.match(await statusClass(), /\berr\b/);
  assert.equal(await aiEnabled(), false);

  await h.page.fill("#localKeyInput", "secret-123");
  await connect();
  assert.match(await status(), /^Connected to /);
  assert.equal(await h.getStorage("tabview_local_key"), "secret-123");
  assert.equal(await h.page.inputValue("#localKeyInput"), "");
  assert.match(await h.page.getAttribute("#localKeyInput", "placeholder"), /saved/);

  h.server.apiRequests.length = 0;
  assert.equal((await h.send(SUMMARY)).success, true);
  assert.equal(h.server.apiRequests.at(-1).authorization, "Bearer secret-123");

  await h.reload();
  assert.equal(await h.page.inputValue("#localKeyInput"), "", "never re-shown after a reload");
  assert.match(await h.page.getAttribute("#localKeyInput", "placeholder"), /saved/);
});

test("no key is sent when none is set", async () => {
  await connect(h.base);
  await h.send(SUMMARY);
  assert.ok(h.server.apiRequests.every(r => r.authorization === undefined));
});

test("switching to a server without the saved model picks one it does have", async () => {
  await connect(h.base);
  await h.page.selectOption("#localModelSelect", "fake-model:latest");
  await h.until(async () => (await h.getStorage("tabview_local_model")) === "fake-model:latest", "model saved");
  h.server.models = ["only-this-one"];
  await connect(h.base);
  assert.equal(await h.getStorage("tabview_local_model"), "only-this-one");
  assert.equal(await h.page.inputValue("#localModelSelect"), "only-this-one");

  h.server.models = ["only-this-one", "fake-model:latest", "zeta"];
  await h.page.click("#refreshLocalModels");
  await h.until(async () => /3 models available, using only-this-one/.test(await status()), "refresh keeps the saved model");
});

test("a server with no models says what to do, for Ollama and for the others", async () => {
  h.server.models = [];
  await connect(h.base);
  assert.equal(await status(), "Ollama is running but has no models. Run: ollama pull llama3.2");
  assert.equal(await aiEnabled(), false);
  h.server.kind = "openai";
  await connect(h.base);
  assert.equal(await status(), "The server is running but has no model loaded. Load one, then press Refresh.");
});

test("an address nothing is listening on gives a readable error and leaves AI off", async () => {
  await connect("http://127.0.0.1:1");
  assert.equal(await status(), "Can't reach a model server at http://127.0.0.1:1. Is it running?");
  assert.match(await statusClass(), /\berr\b/);
  assert.equal(await aiEnabled(), false);
});

test("connecting to a dead server after a good one turns AI back off", async () => {
  await connect(h.base);
  assert.equal(await aiEnabled(), true);
  await connect("http://127.0.0.1:1");
  assert.equal(await aiEnabled(), false);
});

test("something that is not an address is rejected before any request", async () => {
  await h.page.fill("#localHostInput", "http://");
  await h.page.click("#connectLocal");
  await h.until(async () => /doesn't look like an address/.test(await status()), "address error");
  assert.equal(await h.getStorage("tabview_local_host"), undefined);
  assert.equal(h.server.apiRequests.length, 0);
});

test("an empty address falls back to the Ollama default", async () => {
  await h.page.fill("#localHostInput", "   ");
  await h.page.click("#connectLocal");
  await h.until(async () => (await h.page.inputValue("#localHostInput")) === "http://localhost:11434", "default filled in");
});

test("a server that refuses the request explains the Ollama fix", async () => {
  h.server.forbid = true;
  await connect(h.base);
  assert.match(await status(), /refused the request \(403\).*OLLAMA_ORIGINS/);
  await h.setStorage({ tabview_local_model: "fake-model:latest" });
  const r = await h.send(SUMMARY);
  assert.equal(r.success, false);
  assert.match(r.error, /refused the request \(403\)/);
});

test("a server on another machine asks for permission first; declining saves nothing", async () => {
  await h.page.evaluate(() => {
    window.__asked = [];
    chrome.permissions.contains = async () => false;
    chrome.permissions.request = async p => { window.__asked.push(p.origins); return false; };
  });
  await h.page.fill("#localHostInput", "100.64.0.9:11434");
  await h.page.click("#connectLocal");
  await h.until(async () => /needs your permission to reach 100\.64\.0\.9/.test(await status()), "permission message");
  assert.deepEqual(await h.page.evaluate(() => window.__asked), [["http://100.64.0.9/*"]]);
  assert.equal(await h.getStorage("tabview_local_host"), undefined);
});

test("this machine never triggers a permission prompt", async () => {
  await h.page.evaluate(() => { window.__asked = 0; chrome.permissions.request = async () => { window.__asked++; return false; }; });
  await connect(h.base);
  assert.equal(await h.page.evaluate(() => window.__asked), 0);
  assert.match(await status(), /^Connected to /);
});

test("the manifest can ask for other hosts on demand without requiring them up front", async () => {
  const m = await h.page.evaluate(() => chrome.runtime.getManifest());
  assert.deepEqual(m.optional_host_permissions, ["http://*/*", "https://*/*"]);
  assert.ok(m.host_permissions.includes("http://localhost/*") && m.host_permissions.includes("http://127.0.0.1/*"));
  assert.ok(!m.host_permissions.some(p => p.includes("*://*") || p === "<all_urls>" || p.startsWith("http://*")));
});

test("the whole flow in the UI: connect, then Auto-Group runs on the linked model", async () => {
  await h.page.evaluate(async () => {
    const me = await chrome.tabs.getCurrent();
    const others = (await chrome.tabs.query({})).filter(t => t.id !== me.id).map(t => t.id);
    if (others.length) await chrome.tabs.remove(others);
  });
  await h.open(["a", "b", "c", "d"]);
  await connect(h.base);
  await h.page.keyboard.press("Escape");
  await h.page.click("#aiAutoGroup");
  await h.until(() => h.page.evaluate(() => !document.getElementById("aiModal").classList.contains("hidden")), "proposal modal");
  assert.equal(await h.page.locator(".ai-group-proposal").count(), 2);
  assert.equal(h.server.llmCalls.at(-1).model, "another:7b");
  await h.page.click("#aiCancel");
});

test("no errors were logged by the manager page", () => {
  assert.deepEqual(h.errors, []);
});
