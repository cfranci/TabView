// TabView organizer: rule-based (no AI) tab ordering, account detection, and
// close suggestions. Pure functions over plain tab objects ({id, url, title,
// index, pinned, groupId, lastAccessed, active, audible}) so it runs in the
// manager page and under Node for tests.
(function (root) {
  "use strict";

  const DEFAULT_RULES_TEXT = "Gmail: mail.google.com\nCalendar: calendar.google.com";

  // Display order of the "type" buckets. Anything unmatched sorts last as Other.
  const TYPES = [
    ["Mail", ["mail.google.com", "outlook.live.com", "outlook.office.com", "mail.yahoo.com", "mail.proton.me", "superhuman.com"]],
    ["Calendar", ["calendar.google.com", "calendly.com", "cal.com"]],
    ["Chat", ["slack.com", "discord.com", "web.whatsapp.com", "messages.google.com", "web.telegram.org", "teams.microsoft.com", "meet.google.com", "zoom.us"]],
    ["Tasks", ["todoist.com", "linear.app", "trello.com", "asana.com", "atlassian.net", "clickup.com", "monday.com"]],
    ["Docs", ["docs.google.com", "drive.google.com", "sheets.google.com", "slides.google.com", "notion.so", "notion.site", "dropbox.com", "airtable.com", "figma.com", "canva.com"]],
    ["AI", ["claude.ai", "claude.com", "chatgpt.com", "openai.com", "gemini.google.com", "perplexity.ai", "openrouter.ai", "huggingface.co", "anthropic.com"]],
    ["Dev", ["github.com", "gitlab.com", "localhost", "127.0.0.1", "vercel.com", "vercel.app", "supabase.com", "cloudflare.com", "pages.dev", "workers.dev", "stackoverflow.com", "npmjs.com", "render.com", "netlify.com", "developer.chrome.com", "developer.apple.com"]],
    ["Finance", ["stripe.com", "mercury.com", "paypal.com", "chase.com", "quickbooks.intuit.com", "wise.com", "coinbase.com"]],
    ["Social", ["x.com", "twitter.com", "instagram.com", "facebook.com", "linkedin.com", "reddit.com", "tiktok.com", "threads.net"]],
    ["Video", ["youtube.com", "netflix.com", "twitch.tv", "vimeo.com", "spotify.com"]],
    ["Shopping", ["amazon.com", "ebay.com", "etsy.com", "walmart.com"]],
  ];
  const OTHER_TYPE = TYPES.length;

  // Google apps that default to the first signed-in account when the URL
  // carries no /u/N/ marker.
  const GOOGLE_DEFAULT_ACCOUNT_HOSTS = new Set([
    "mail.google.com", "calendar.google.com", "docs.google.com", "drive.google.com",
    "meet.google.com", "contacts.google.com", "keep.google.com", "photos.google.com",
  ]);

  const EMAIL_RE = /[a-z0-9][a-z0-9._%+-]*@[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}/i;

  function parseUrl(url) {
    try { return new URL(url); } catch (_) { return null; }
  }

  function hostOf(url) {
    const u = parseUrl(url);
    if (!u) return "";
    return u.host.replace(/^www\./, "").toLowerCase(); // host keeps the port (localhost:3000)
  }

  function hostMatches(host, domain) {
    const bare = host.replace(/:\d+$/, "");
    return bare === domain || bare.endsWith("." + domain);
  }

  function typeIndex(url) {
    const host = hostOf(url);
    if (!host) return OTHER_TYPE;
    for (let i = 0; i < TYPES.length; i++) {
      if (TYPES[i][1].some(d => hostMatches(host, d))) return i;
    }
    return OTHER_TYPE;
  }

  function typeName(url) {
    const i = typeIndex(url);
    return i === OTHER_TYPE ? "Other" : TYPES[i][0];
  }

  // "Name: pattern, pattern" per line. A tab matches a rule when its URL or
  // title contains any pattern. Rule order is the tab order.
  function parseRules(text) {
    const rules = [];
    for (const raw of String(text || "").split("\n")) {
      const line = raw.trim();
      if (!line || line.startsWith("#")) continue;
      const colon = line.indexOf(":");
      // A colon inside a URL or host:port ("https://x", "localhost:3000") is not a "Name:" prefix.
      const after = line.slice(colon + 1);
      const hasName = colon > 0 && !/[./]/.test(line.slice(0, colon)) && !/^(\/\/|\d)/.test(after);
      const name = hasName ? line.slice(0, colon).trim() : line;
      const rest = hasName ? line.slice(colon + 1) : line;
      const patterns = rest.split(",").map(p => p.trim().toLowerCase()).filter(Boolean);
      if (patterns.length) rules.push({ name, patterns });
    }
    return rules;
  }

  function ruleIndex(tab, rules) {
    const hay = ((tab.url || "") + " " + (tab.title || "")).toLowerCase();
    for (let i = 0; i < rules.length; i++) {
      if (rules[i].patterns.some(p => hay.includes(p))) return i;
    }
    return rules.length; // no rule: after every ruled tab
  }

  // Which signed-in account a tab belongs to, read from what the tab already
  // exposes: an email in the title, or Google's /u/N/ and authuser markers
  // (N is resolved to an email using any tab that shows both).
  function detectAccounts(tabs) {
    const googleIndexToEmail = {};
    const info = tabs.map(tab => {
      const u = parseUrl(tab.url || "");
      const host = u ? u.host.toLowerCase() : "";
      const isGoogle = hostMatches(host, "google.com");
      const titleEmail = ((tab.title || "").match(EMAIL_RE) || [null])[0];
      let gIndex = null;
      let email = titleEmail ? titleEmail.toLowerCase() : null;
      if (u && isGoogle) {
        const m = u.pathname.match(/\/u\/(\d+)(?:\/|$)/);
        const au = u.searchParams.get("authuser");
        if (m) gIndex = m[1];
        else if (au && /^\d+$/.test(au)) gIndex = au;
        else if (au && EMAIL_RE.test(au)) email = au.toLowerCase();
        else if (GOOGLE_DEFAULT_ACCOUNT_HOSTS.has(host)) gIndex = "0";
        if (gIndex !== null && email) googleIndexToEmail[gIndex] = email;
      }
      return { tab, isGoogle, gIndex, email };
    });

    const accounts = new Map();
    for (const { tab, isGoogle, gIndex, email } of info) {
      if (email) accounts.set(tab.id, email);
      else if (isGoogle && gIndex !== null) {
        accounts.set(tab.id, googleIndexToEmail[gIndex] || `Google account ${Number(gIndex) + 1}`);
      }
    }
    return accounts;
  }

  const squash = s => s.toLowerCase().replace(/[^a-z0-9]/g, "");

  // Project a tab belongs to: a repo, a local dev server, a hosting project.
  // Tabs with no direct signal inherit a project when their host or title
  // mentions one that is already known (e.g. the deployed site of an open repo).
  function detectProjects(tabs) {
    const projects = new Map();
    for (const tab of tabs) {
      const u = parseUrl(tab.url || "");
      if (!u) continue;
      const host = u.host.replace(/^www\./, "").toLowerCase();
      const seg = u.pathname.split("/").filter(Boolean);
      let p = null;
      if ((host === "github.com" || host === "gitlab.com") && seg.length >= 2 &&
          !["settings", "orgs", "notifications", "search", "marketplace"].includes(seg[0])) {
        p = seg[1];
      } else if (host === "vercel.com" && seg.length >= 2) {
        p = seg[1];
      } else if (host.endsWith(".vercel.app") || host.endsWith(".pages.dev") || host.endsWith(".netlify.app")) {
        p = host.split(".")[0];
      } else if (host === "supabase.com" && seg[1] === "project" && seg[2]) {
        p = seg[2];
      } else if (/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host)) {
        p = host;
      }
      if (p) projects.set(tab.id, p.toLowerCase());
    }

    const known = [...new Set(projects.values())]
      .filter(p => !/^(localhost|127\.0\.0\.1)/.test(p) && squash(p).length >= 5)
      .sort((a, b) => b.length - a.length);
    if (known.length) {
      for (const tab of tabs) {
        if (projects.has(tab.id)) continue;
        const hay = squash(hostOf(tab.url || "") + " " + (tab.title || ""));
        const hit = known.find(p => hay.includes(squash(p)));
        if (hit) projects.set(tab.id, hit);
      }
    }
    return projects;
  }

  function compareKeys(a, b) {
    for (let i = 0; i < a.length; i++) {
      if (a[i] === b[i]) continue;
      if (typeof a[i] === "number") return a[i] - b[i];
      return a[i] < b[i] ? -1 : 1;
    }
    return 0;
  }

  // "￿" pushes tabs without an account/project after those that have one.
  const LAST = "￿";

  // Returns the tabs in their organized order. mode: "smart" (type, then site,
  // then account), "account", or "project". Order rules always win.
  function sortTabs(tabs, mode, rules, accounts, projects) {
    const keyed = tabs.map(tab => {
      const rule = ruleIndex(tab, rules);
      const type = typeIndex(tab.url || "");
      const site = hostOf(tab.url || "") || LAST;
      const account = accounts.get(tab.id) || LAST;
      const project = projects.get(tab.id) || LAST;
      let key;
      if (mode === "account") key = [rule, account, type, site];
      else if (mode === "project") key = [rule, project, type, site];
      else key = [rule, type, site, account];
      key.push(tab.index);
      return { tab, key };
    });
    keyed.sort((a, b) => compareKeys(a.key, b.key));
    return keyed.map(k => k.tab);
  }

  function normalizeUrl(url) {
    const u = parseUrl(url);
    if (!u) return url || "";
    u.hash = "";
    return u.toString().replace(/\/$/, "");
  }

  const DAY = 24 * 60 * 60 * 1000;
  const BLANK_RE = /^(chrome:\/\/newtab\/?|chrome:\/\/new-tab-page\/?|about:blank|edge:\/\/newtab\/?)$/;
  const SEARCH_RE = /^https?:\/\/(www\.)?(google\.[a-z.]+\/search|bing\.com\/search|duckduckgo\.com\/\?)/;

  function days(ms) {
    const d = Math.round(ms / DAY);
    return d >= 14 ? `${Math.round(d / 7)} weeks` : `${d} day${d === 1 ? "" : "s"}`;
  }

  // Tabs that are probably safe to close, each with a reason. Pinned, active,
  // and audible tabs are never suggested.
  function suggestCloses(tabs, now = Date.now(), staleDays = 7) {
    const eligible = tabs.filter(t => !t.pinned && !t.active && !t.audible);
    const out = new Map();

    const byUrl = new Map();
    for (const tab of tabs) {
      if (BLANK_RE.test(tab.url || "")) continue;
      const k = normalizeUrl(tab.url || "");
      if (!k) continue;
      if (!byUrl.has(k)) byUrl.set(k, []);
      byUrl.get(k).push(tab);
    }
    for (const dupes of byUrl.values()) {
      if (dupes.length < 2) continue;
      // Keep the copy you would miss most: pinned or active first, then most recent.
      const rank = t => (t.pinned ? 2e15 : 0) + (t.active ? 1e15 : 0) + (t.lastAccessed || 0);
      const keep = dupes.slice().sort((a, b) => rank(b) - rank(a))[0];
      for (const tab of dupes) {
        if (tab === keep || !eligible.includes(tab)) continue;
        out.set(tab.id, `Duplicate: the same page is open in another tab (${dupes.length} copies)`);
      }
    }

    for (const tab of eligible) {
      if (out.has(tab.id)) continue;
      const url = tab.url || "";
      const idle = tab.lastAccessed ? now - tab.lastAccessed : 0;
      if (BLANK_RE.test(url)) out.set(tab.id, "Empty new tab");
      else if (SEARCH_RE.test(url) && idle > DAY) out.set(tab.id, `Old search results, untouched for ${days(idle)}`);
      else if (idle > staleDays * DAY) out.set(tab.id, `Not opened in ${days(idle)}`);
    }

    return tabs.filter(t => out.has(t.id)).map(t => ({ tabId: t.id, reason: out.get(t.id) }));
  }

  const api = {
    DEFAULT_RULES_TEXT, parseRules, ruleIndex, detectAccounts, detectProjects,
    sortTabs, suggestCloses, typeName, hostOf, normalizeUrl,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.TabOrganize = api;
})(typeof self !== "undefined" ? self : this);
