const test = require("node:test");
const assert = require("node:assert/strict");
const O = require("../../organize.js");

const NOW = Date.UTC(2026, 10, 14);
const DAY = 864e5;
let nextId = 0;
const tab = (url, title = "", extra = {}) => {
  const id = ++nextId;
  return { id, index: id, url, title, pinned: false, active: false, audible: false, groupId: -1, lastAccessed: NOW - 3600e3, ...extra };
};
const order = (tabs, mode, rulesText = "") =>
  O.sortTabs(tabs, mode, O.parseRules(rulesText), O.detectAccounts(tabs), O.detectProjects(tabs)).map(t => t.title);

test("parseRules reads names, patterns, comments, and bare patterns", () => {
  assert.deepEqual(O.parseRules("Gmail: mail.google.com\n\n# note\nWork: Ready-App, readyapp ,\nlocalhost:3000\nhttps://x.com/a"), [
    { name: "Gmail", patterns: ["mail.google.com"] },
    { name: "Work", patterns: ["ready-app", "readyapp"] },
    { name: "localhost:3000", patterns: ["localhost:3000"] },
    { name: "https://x.com/a", patterns: ["https://x.com/a"] },
  ]);
  assert.deepEqual(O.parseRules(""), []);
  assert.deepEqual(O.parseRules(null), []);
  assert.deepEqual(O.parseRules("Empty:"), []);
});

test("default rules put Gmail then Calendar first", () => {
  const rules = O.parseRules(O.DEFAULT_RULES_TEXT);
  assert.deepEqual(rules.map(r => r.name), ["Gmail", "Calendar"]);
});

test("ruleIndex matches URL or title, case-insensitively, first rule wins", () => {
  const rules = O.parseRules("A: alpha\nB: beta, alpha");
  assert.equal(O.ruleIndex(tab("https://x.com/ALPHA"), rules), 0);
  assert.equal(O.ruleIndex(tab("https://x.com/", "My Beta page"), rules), 1);
  assert.equal(O.ruleIndex(tab("https://x.com/"), rules), 2);
});

test("hostOf strips www and keeps ports; bad URLs give empty string", () => {
  assert.equal(O.hostOf("https://www.Example.com/a"), "example.com");
  assert.equal(O.hostOf("http://localhost:3000/x"), "localhost:3000");
  assert.equal(O.hostOf("not a url"), "");
  assert.equal(O.hostOf(undefined), "");
});

test("typeName buckets known sites, including subdomains, and falls back to Other", () => {
  assert.equal(O.typeName("https://mail.google.com/mail/u/0/"), "Mail");
  assert.equal(O.typeName("https://docs.google.com/document/d/1"), "Docs");
  assert.equal(O.typeName("https://gist.github.com/x"), "Dev");
  assert.equal(O.typeName("http://localhost:5173/"), "Dev");
  assert.equal(O.typeName("https://www.youtube.com/watch"), "Video");
  assert.equal(O.typeName("https://notgithub.com/"), "Other");
  assert.equal(O.typeName("chrome://newtab/"), "Other");
});

test("detectAccounts reads the email from a Gmail title and maps /u/N to it", () => {
  const tabs = [
    tab("https://mail.google.com/mail/u/1/#inbox", "Inbox (3) - work@ready-app.com - Ready App Mail"),
    tab("https://docs.google.com/document/u/1/d/abc/edit", "Spec - Google Docs"),
    tab("https://mail.google.com/mail/u/0/#inbox", "Inbox - me@gmail.com - Gmail"),
    tab("https://calendar.google.com/calendar/u/0/r", "Calendar"),
    tab("https://drive.google.com/drive/my-drive", "My Drive"),
    tab("https://docs.google.com/spreadsheets/d/1/edit?authuser=1", "Budget"),
    tab("https://example.com/", "Example"),
  ];
  const a = O.detectAccounts(tabs);
  assert.equal(a.get(tabs[0].id), "work@ready-app.com");
  assert.equal(a.get(tabs[1].id), "work@ready-app.com", "/u/1/ resolves through the Gmail tab");
  assert.equal(a.get(tabs[2].id), "me@gmail.com");
  assert.equal(a.get(tabs[3].id), "me@gmail.com");
  assert.equal(a.get(tabs[4].id), "me@gmail.com", "no marker on a Google app means the first account");
  assert.equal(a.get(tabs[5].id), "work@ready-app.com", "authuser=1");
  assert.equal(a.has(tabs[6].id), false);
});

test("detectAccounts: authuser email, unknown index, non-Google email in title", () => {
  const tabs = [
    tab("https://docs.google.com/document/d/1/edit?authuser=Boss%40corp.com", "Doc"),
    tab("https://mail.google.com/mail/u/2/#inbox", "Loading…"),
    tab("https://app.example.com/", "Dashboard · jane.doe+x@startup.io"),
    tab("https://www.google.com/search?q=hi", "hi - Google Search"),
  ];
  const a = O.detectAccounts(tabs);
  assert.equal(a.get(tabs[0].id), "boss@corp.com");
  assert.equal(a.get(tabs[1].id), "Google account 3");
  assert.equal(a.get(tabs[2].id), "jane.doe+x@startup.io");
  assert.equal(a.has(tabs[3].id), false, "plain Google search has no account signal");
});

test("detectProjects finds repos, dev servers, hosting projects, and related tabs", () => {
  const tabs = [
    tab("https://github.com/cfranci/TabView/pulls", "Pull requests"),
    tab("https://tabview.vercel.app/", "Landing"),
    tab("http://localhost:3000/admin", "Admin"),
    tab("https://vercel.com/acme/storefront/deployments", "Deployments"),
    tab("https://supabase.com/dashboard/project/abcdefgh/editor", "Editor"),
    tab("https://docs.example.com/", "Storefront launch checklist"),
    tab("https://github.com/settings/profile", "Profile"),
    tab("https://example.com/", "Unrelated"),
  ];
  const p = O.detectProjects(tabs);
  assert.equal(p.get(tabs[0].id), "tabview");
  assert.equal(p.get(tabs[1].id), "tabview");
  assert.equal(p.get(tabs[2].id), "localhost:3000");
  assert.equal(p.get(tabs[3].id), "storefront");
  assert.equal(p.get(tabs[4].id), "abcdefgh");
  assert.equal(p.get(tabs[5].id), "storefront", "title mentions a known project");
  assert.equal(p.has(tabs[6].id), false, "github settings is not a repo");
  assert.equal(p.has(tabs[7].id), false);
});

test("detectProjects does not spread very short project names", () => {
  const tabs = [tab("https://github.com/me/app", "app"), tab("https://apple.com/", "Apple")];
  assert.equal(O.detectProjects(tabs).has(tabs[1].id), false);
});

test("smart mode: rules first, then type, then site, then account", () => {
  const tabs = [
    tab("https://www.youtube.com/watch?v=1", "yt"),
    tab("https://github.com/a/bbbbb", "gh"),
    tab("https://docs.google.com/document/u/1/d/a", "doc-work"),
    tab("https://mail.google.com/mail/u/1/", "gmail-work - w@corp.com - Mail"),
    tab("https://example.com/", "other"),
    tab("https://docs.google.com/document/u/0/d/b", "doc-me"),
    tab("https://mail.google.com/mail/u/0/", "gmail-me - a@gmail.com - Gmail"),
    tab("https://calendar.google.com/calendar/u/0/r", "cal"),
  ];
  assert.deepEqual(order(tabs, "smart", O.DEFAULT_RULES_TEXT), [
    "gmail-me - a@gmail.com - Gmail", "gmail-work - w@corp.com - Mail", "cal",
    "doc-me", "doc-work", "gh", "yt", "other",
  ]);
});

test("account mode keeps each account's tabs together, unknown accounts last", () => {
  const tabs = [
    tab("https://example.com/", "no-account"),
    tab("https://docs.google.com/document/u/1/d/a", "doc-work"),
    tab("https://mail.google.com/mail/u/0/", "gmail-me - a@gmail.com - Gmail"),
    tab("https://mail.google.com/mail/u/1/", "gmail-work - w@corp.com - Mail"),
    tab("https://docs.google.com/document/u/0/d/b", "doc-me"),
  ];
  assert.deepEqual(order(tabs, "account"), [
    "gmail-me - a@gmail.com - Gmail", "doc-me", "gmail-work - w@corp.com - Mail", "doc-work", "no-account",
  ]);
});

test("project mode keeps each project's tabs together, unknown projects last", () => {
  const tabs = [
    tab("https://example.com/", "none"),
    tab("https://zebra-site.vercel.app/", "zebra-live"),
    tab("https://github.com/me/alpha-app", "alpha-repo"),
    tab("https://github.com/me/zebra-site", "zebra-repo"),
    tab("https://alpha-app.pages.dev/", "alpha-live"),
  ];
  // Within a project, tabs go by type and then site name (alpha-app.pages.dev before github.com).
  assert.deepEqual(order(tabs, "project"), ["alpha-live", "alpha-repo", "zebra-repo", "zebra-live", "none"]);
});

test("sorting is stable: ties keep their original tab order, and input is not mutated", () => {
  const tabs = [tab("https://example.com/1", "one"), tab("https://example.com/2", "two"), tab("https://example.com/3", "three")];
  const copy = tabs.slice();
  assert.deepEqual(order(tabs, "smart"), ["one", "two", "three"]);
  assert.deepEqual(tabs, copy);
});

test("custom rule order beats the built-in type order", () => {
  const tabs = [tab("https://mail.google.com/mail/u/0/", "gmail"), tab("https://www.youtube.com/", "yt"), tab("https://github.com/a/bbbbb", "gh")];
  assert.deepEqual(order(tabs, "smart", "Video: youtube.com\nCode: github.com"), ["yt", "gh", "gmail"]);
});

test("normalizeUrl ignores the fragment and a trailing slash, keeps the query", () => {
  assert.equal(O.normalizeUrl("https://example.com/a/#top"), "https://example.com/a");
  assert.equal(O.normalizeUrl("https://example.com/a?x=1#y"), "https://example.com/a?x=1");
  assert.notEqual(O.normalizeUrl("https://example.com/a?x=1"), O.normalizeUrl("https://example.com/a?x=2"));
  assert.equal(O.normalizeUrl("nonsense"), "nonsense");
});

test("suggestCloses flags duplicates and keeps the most recently used copy", () => {
  const tabs = [
    tab("https://example.com/a", "old copy", { lastAccessed: NOW - 2 * DAY }),
    tab("https://example.com/a#section", "fresh copy", { lastAccessed: NOW - 60e3 }),
    tab("https://example.com/a/", "middle copy", { lastAccessed: NOW - DAY }),
  ];
  const s = O.suggestCloses(tabs, NOW);
  assert.deepEqual(s.map(x => x.tabId), [tabs[0].id, tabs[2].id]);
  assert.match(s[0].reason, /Duplicate.*3 copies/);
});

test("suggestCloses keeps a pinned or active duplicate over a newer loose one", () => {
  const pinned = [tab("https://example.com/p", "pinned", { pinned: true, lastAccessed: NOW - 5 * DAY }), tab("https://example.com/p", "loose")];
  assert.deepEqual(O.suggestCloses(pinned, NOW).map(x => x.tabId), [pinned[1].id]);
  const active = [tab("https://example.com/q", "active", { active: true, lastAccessed: NOW - 5 * DAY }), tab("https://example.com/q", "loose")];
  assert.deepEqual(O.suggestCloses(active, NOW).map(x => x.tabId), [active[1].id]);
});

test("suggestCloses flags empty tabs, old searches, and stale tabs with a reason", () => {
  const tabs = [
    tab("chrome://newtab/", "New Tab"),
    tab("about:blank", ""),
    tab("https://www.google.com/search?q=old", "old search", { lastAccessed: NOW - 3 * DAY }),
    tab("https://www.google.com/search?q=new", "fresh search", { lastAccessed: NOW - 3600e3 }),
    tab("https://news.example.com/", "stale", { lastAccessed: NOW - 20 * DAY }),
    tab("https://news.example.com/b", "six days", { lastAccessed: NOW - 6 * DAY }),
    tab("https://news.example.com/c", "no timestamp", { lastAccessed: undefined }),
  ];
  const s = Object.fromEntries(O.suggestCloses(tabs, NOW).map(x => [x.tabId, x.reason]));
  assert.equal(s[tabs[0].id], "Empty new tab");
  assert.equal(s[tabs[1].id], "Empty new tab", "two blank tabs are both flagged as empty, not as duplicates of each other");
  assert.match(s[tabs[2].id], /Old search results.*3 days/);
  assert.equal(s[tabs[3].id], undefined);
  assert.match(s[tabs[4].id], /Not opened in 3 weeks/);
  assert.equal(s[tabs[5].id], undefined, "under the 7-day threshold");
  assert.equal(s[tabs[6].id], undefined, "unknown age is never called stale");
});

test("suggestCloses never suggests pinned, active, or audible tabs", () => {
  const old = { lastAccessed: NOW - 90 * DAY };
  const tabs = [
    tab("https://a.example.com/", "pinned", { ...old, pinned: true }),
    tab("https://b.example.com/", "active", { ...old, active: true }),
    tab("https://c.example.com/", "playing", { ...old, audible: true }),
    tab("chrome://newtab/", "active blank", { active: true }),
  ];
  assert.deepEqual(O.suggestCloses(tabs, NOW), []);
});

test("suggestCloses honours a custom stale threshold and returns tab-strip order", () => {
  const tabs = [
    tab("https://a.example.com/", "a", { lastAccessed: NOW - 3 * DAY }),
    tab("chrome://newtab/", "blank"),
    tab("https://b.example.com/", "b", { lastAccessed: NOW - 4 * DAY }),
  ];
  assert.deepEqual(O.suggestCloses(tabs, NOW, 2).map(x => x.tabId), tabs.map(t => t.id));
  assert.deepEqual(O.suggestCloses(tabs, NOW).map(x => x.tabId), [tabs[1].id]);
});
