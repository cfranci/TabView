// Shared harness: launches Chromium with the unpacked extension, serves local
// fixture pages (no internet needed), and exposes helpers for driving the
// manager page and reading real Chrome tab state.
const http = require("node:http");
const os = require("node:os");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");

const EXT_DIR = path.resolve(__dirname, "..", "..");

// Fixture site: any path returns a small page titled from ?t=. It also plays
// the part of a local Ollama server so the AI features run without a real model.
function startServer() {
  const llmCalls = [];
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    const isModelApi = ["/api/tags", "/v1/models", "/v1/chat/completions"].includes(url.pathname);
    if (isModelApi) {
      server.apiRequests.push({ path: url.pathname, origin: req.headers.origin, authorization: req.headers.authorization });
      // Behave like real servers: Ollama refuses extension origins, some servers want a key.
      if ((req.headers.origin || "").startsWith("chrome-extension://") || server.forbid) {
        res.writeHead(403); return res.end();
      }
      if (server.requireKey && req.headers.authorization !== `Bearer ${server.requireKey}`) {
        res.writeHead(401, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ error: "unauthorized" }));
      }
    }
    const json = (code, body) => { res.writeHead(code, { "Content-Type": "application/json" }); res.end(JSON.stringify(body)); };
    if (url.pathname === "/api/tags") {
      // kind "openai" plays LM Studio / llama.cpp, which have no Ollama listing.
      if (server.kind === "openai") { res.writeHead(404); return res.end(); }
      return json(200, { models: server.models.map(name => ({ name })) });
    }
    if (url.pathname === "/v1/models") {
      return json(200, { object: "list", data: server.models.map(id => ({ id, object: "model" })) });
    }
    if (url.pathname === "/v1/chat/completions") {
      let body = "";
      req.on("data", c => (body += c));
      req.on("end", () => {
        const payload = JSON.parse(body);
        const system = payload.messages[0].content;
        const user = payload.messages[1].content;
        llmCalls.push({ system, user, model: payload.model });
        const ids = [...user.matchAll(/^\[(\d+)\]/gm)].map(m => Number(m[1]));
        let content;
        if (server.llmMode === "error") {
          res.writeHead(500, { "Content-Type": "application/json" });
          return res.end(JSON.stringify({ error: { message: "model exploded" } }));
        } else if (server.llmMode === "garbage") {
          content = "I would rather not answer in JSON today.";
        } else if (system.includes('{"groups"')) {
          content = "```json\n" + JSON.stringify({ groups: [
            { name: "First Pair", color: "blue", tabIds: ids.slice(0, 2), reason: "test" },
            { name: "Second Pair", color: "not-a-color", tabIds: ids.slice(2, 4), reason: "test" },
            { name: "Too Small", color: "red", tabIds: ids.slice(4, 5), reason: "dropped: under 2 tabs" },
          ] }) + "\n```";
        } else if (system.includes('{"suggestions"')) {
          content = JSON.stringify({ suggestions: [
            { tabId: ids[0], reason: "Fake model says close this" },
            { tabId: 99999999, reason: "not a real tab, must be filtered" },
          ] });
        } else if (system.includes('{"matches"')) {
          content = JSON.stringify({ matches: [ids[2], ids[0], 99999999] });
        } else {
          content = "A fake one-line summary.";
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ choices: [{ message: { content } }] }));
      });
      return;
    }
    const title = url.searchParams.get("t") || url.pathname;
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(`<!doctype html><title>${title}</title><body style="background:#246;color:#fff;font:40px sans-serif"><h1>${title}</h1>`);
  });
  server.llmCalls = llmCalls;
  server.llmMode = "ok";
  server.apiRequests = [];
  server.resetModelServer = () => {
    server.kind = "ollama";
    server.models = ["fake-model:latest", "another:7b"];
    server.requireKey = null;
    server.forbid = false;
    server.apiRequests.length = 0;
  };
  server.resetModelServer();
  return new Promise(resolve => server.listen(0, "127.0.0.1", () => resolve(server)));
}

// Close the fixture server, dropping keep-alive sockets so close() resolves.
function stopServer(server) {
  server.closeAllConnections?.();
  return new Promise(r => server.close(() => r()));
}

async function launch() {
  const server = await startServer();
  const base = `http://127.0.0.1:${server.address().port}`;
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "tabview-test-"));
  let ctx;
  try {
    ctx = await chromium.launchPersistentContext(profile, {
      channel: "chromium",
      headless: true,
      viewport: { width: 1500, height: 900 },
      args: [`--disable-extensions-except=${EXT_DIR}`, `--load-extension=${EXT_DIR}`],
    });
  } catch (e) {
    // Without this, a failed launch (e.g. browser not installed: run
    // `npx playwright install chromium`) leaves the fixture server listening
    // and the test process never exits.
    await stopServer(server);
    fs.rmSync(profile, { recursive: true, force: true });
    throw e;
  }
  const sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent("serviceworker", { timeout: 20000 });
  const extId = sw.url().split("/")[2];
  const managerUrl = `chrome-extension://${extId}/manager.html`;

  const errors = [];
  const page = await ctx.newPage();
  page.on("pageerror", e => errors.push(`pageerror: ${e.message}`));
  page.on("console", m => { if (m.type() === "error") errors.push(`console: ${m.text()}`); });
  await page.goto(managerUrl);
  // The persistent context starts with one about:blank tab; drop it for a clean slate.
  for (const p of ctx.pages()) if (p !== page) await p.close();

  const h = {
    ctx, page, server, base, extId, managerUrl, errors,

    fixture: (slug, title) => `${base}/${slug}?t=${encodeURIComponent(title || slug)}`,

    // Poll until fn() (run in Node) returns something truthy.
    async until(fn, what = "condition", timeout = 15000) {
      const start = Date.now();
      let last;
      while (Date.now() - start < timeout) {
        try { last = await fn(); if (last) return last; } catch (e) { last = e.message; }
        await new Promise(r => setTimeout(r, 100));
      }
      throw new Error(`Timed out waiting for ${what} (last: ${JSON.stringify(last)})`);
    },

    // Every tab except the manager, in window then tab-strip order.
    async tabs() {
      return page.evaluate(async () => {
        const me = (await chrome.tabs.getCurrent()).id;
        const groups = Object.fromEntries((await chrome.tabGroups.query({})).map(g => [g.id, g.title]));
        return (await chrome.tabs.query({}))
          .filter(t => t.id !== me)
          .sort((a, b) => a.windowId - b.windowId || a.index - b.index)
          .map(t => ({
            id: t.id, windowId: t.windowId, index: t.index, title: t.title, url: t.url,
            slug: (() => { try { return new URL(t.url).pathname.slice(1); } catch { return t.url; } })(),
            pinned: t.pinned, discarded: t.discarded, groupId: t.groupId,
            group: t.groupId === -1 ? null : (groups[t.groupId] ?? ""),
          }));
      });
    },
    async slugs() { return (await h.tabs()).map(t => t.slug); },
    async windowCount() { return page.evaluate(async () => (await chrome.windows.getAll()).length); },

    // Open fixture tabs (in the manager's window unless windowId is given) and
    // wait until the manager shows a loaded card for each one.
    async open(specs, opts = {}) {
      const urls = specs.map(s => typeof s === "string" ? h.fixture(s) : (s.url || h.fixture(s.slug, s.title)));
      const ids = await page.evaluate(async ({ urls, opts }) => {
        const ids = [];
        for (const url of urls) ids.push((await chrome.tabs.create({ url, active: false, ...opts })).id);
        return ids;
      }, { urls, opts });
      await h.until(async () => {
        const state = await page.evaluate(ids => Promise.all(ids.map(id => chrome.tabs.get(id).then(t => t.status))), ids);
        return state.every(s => s === "complete");
      }, "tabs to finish loading");
      await h.until(() => page.evaluate(ids => ids.every(id => document.querySelector(`.tab-card[data-tab-id="${id}"]`)), ids), "cards to render");
      return ids;
    },

    card: slug => page.locator(`.tab-card[data-url*="/${slug}?"]`),
    cardSlugs: () => page.evaluate(() => [...document.querySelectorAll(".tab-card")].map(c => {
      try { return new URL(c.dataset.url).pathname.slice(1); } catch { return c.dataset.url; }
    })),
    async select(slug) { await h.card(slug).locator(".tab-checkbox").click({ force: true }); },

    toast: () => page.locator("#toast").textContent(),
    async waitToast(re, timeout = 15000) {
      return h.until(async () => {
        const visible = await page.evaluate(() => !document.getElementById("toast").classList.contains("hidden"));
        const text = await h.toast();
        return visible && re.test(text) ? text : false;
      }, `toast matching ${re}`, timeout);
    },

    // Answer the next prompt()/confirm(). Pass null to cancel.
    answerDialog(answer) {
      return new Promise(resolve => page.once("dialog", async d => {
        const info = { type: d.type(), message: d.message() };
        if (answer === null) await d.dismiss(); else await d.accept(answer === true ? undefined : answer);
        resolve(info);
      }));
    },

    // Really discarding a tab crashes Chromium while Playwright is attached to
    // it (a DevTools-session limitation, not an extension bug). So the pause
    // tests swap chrome.tabs.discard for a recorder and report those tabs as
    // discarded, which still exercises the manager's own logic and rendering.
    // Lost on reload; call again after one.
    async stubDiscard() {
      await page.evaluate(() => {
        const discarded = (window.__discarded = new Set());
        chrome.tabs.discard = async id => { discarded.add(id); };
        const realGetAll = chrome.windows.getAll.bind(chrome.windows);
        chrome.windows.getAll = async opts => {
          const wins = await realGetAll(opts);
          for (const w of wins) for (const t of w.tabs || []) if (discarded.has(t.id)) t.discarded = true;
          return wins;
        };
      });
      return () => page.evaluate(() => [...window.__discarded]);
    },

    async setStorage(obj) { await page.evaluate(o => chrome.storage.local.set(o), obj); },
    async getStorage(key) { return page.evaluate(async k => (await chrome.storage.local.get(k))[k], key); },
    async reload() {
      await page.reload();
      await h.settled();
    },
    // The manager captures previews on load and re-renders when that finishes.
    // Wait for it so a test never acts on DOM that is about to be replaced.
    async settled() {
      await page.waitForFunction(() =>
        document.querySelector("#tabCount").textContent.length > 0 &&
        !document.querySelector("#captureAll").disabled);
    },
    send: msg => page.evaluate(m => chrome.runtime.sendMessage(m), msg),

    async close() {
      // Always stop the server and clean up, even if the browser is already gone.
      try { await ctx.close(); } catch {}
      await stopServer(server);
      fs.rmSync(profile, { recursive: true, force: true });
    },
  };
  await page.waitForFunction(() => typeof TabOrganize === "object");
  await page.waitForFunction(() => document.querySelector("#tabCount").textContent.length > 0);
  return h;
}

module.exports = { launch, EXT_DIR };
