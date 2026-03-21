# Karakeep Chrome Extension Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Manifest V3 Chrome Extension that saves the current page to a self-hosted Karakeep instance with note, tags, and list selection.

**Architecture:** Pure Vanilla JS, no build step, ES modules throughout. `utils.js` is the shared module imported by `popup.js`, `background.js`, and `options.js`. The background service worker owns all network calls and caching; the popup reads from `chrome.storage.local` directly for low-latency tag search.

**Tech Stack:** Vanilla JS (ES2022), Chrome Extension Manifest V3, `chrome.storage.local`, `chrome.alarms`, `chrome.tabs`, `chrome.action`. Node.js for running unit tests on `utils.js`.

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `manifest.json` | Create | MV3 config, permissions, content script declaration, shortcut |
| `utils.js` | Create | Trie, inverted index, searchTags, storage helpers, apiFetch |
| `test-utils.js` | Create | Node.js unit tests for all `utils.js` pure functions |
| `content.js` | Create | getSelection message responder |
| `styles.css` | Create | Shared CSS, dark/light via prefers-color-scheme |
| `background.js` | Create | Cache refresh, badge, silent save, message router |
| `options.html` | Create | Settings page markup |
| `options.js` | Create | Settings form, test connection |
| `popup.html` | Create | Popup markup |
| `popup.js` | Create | UI controller, tag chips, optimistic save |
| `benchmark.js` | Create | Dev-only Trie perf benchmark |

---

## Task 1: Project Scaffold — manifest.json

**Files:**
- Create: `manifest.json`

- [ ] **Step 1: Create manifest.json**

```json
{
  "manifest_version": 3,
  "name": "Karakeep",
  "version": "1.0.0",
  "description": "Save bookmarks to your Karakeep instance",
  "permissions": ["storage", "activeTab", "alarms", "tabs"],
  "host_permissions": ["<all_urls>"],
  "background": {
    "service_worker": "background.js",
    "type": "module"
  },
  "action": {
    "default_popup": "popup.html"
  },
  "options_page": "options.html",
  "content_scripts": [
    {
      "matches": ["<all_urls>"],
      "js": ["content.js"],
      "run_at": "document_idle"
    }
  ],
  "commands": {
    "silent-save": {
      "suggested_key": { "default": "Ctrl+Shift+S" },
      "description": "Save current tab silently to Karakeep"
    }
  }
}
```

- [ ] **Step 2: Verify it loads in Chrome**

  1. Open `chrome://extensions`
  2. Enable "Developer mode" (top right toggle)
  3. Click "Load unpacked" → select the project folder
  4. Expected: extension appears with name "Karakeep", no errors in the "Errors" column

- [ ] **Step 3: Commit**

```bash
git init
git add manifest.json
git commit -m "feat: add MV3 manifest"
```

---

## Task 2: utils.js — Trie (TDD)

**Files:**
- Create: `utils.js` (Trie class only)
- Create: `test-utils.js`

This task covers only the `Trie` class. Testing is done with a Node.js script using `console.assert`. No test framework required — run with `node test-utils.js`.

- [ ] **Step 1: Write the failing tests for Trie**

Create `test-utils.js`:

```js
// test-utils.js — run with: node test-utils.js
// Import only the Trie class (will fail until utils.js exists)
import { Trie } from './utils.js';

let passed = 0;
let failed = 0;

function assert(condition, label) {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ ${label}`);
    failed++;
  }
}

// --- Trie tests ---
console.log('\nTrie');

const t = new Trie();
t.insert('devtools', 'id-1');
t.insert('developer', 'id-2');
t.insert('design', 'id-3');
t.insert('react', 'id-4');

const devResults = t.search('dev');
assert(devResults.length === 2, 'search("dev") returns 2 results');
assert(devResults.some(r => r.id === 'id-1'), 'search("dev") includes devtools');
assert(devResults.some(r => r.id === 'id-2'), 'search("dev") includes developer');

const desResults = t.search('des');
assert(desResults.length === 1, 'search("des") returns 1 result');
assert(desResults[0].id === 'id-3', 'search("des") returns design');

assert(t.search('xyz').length === 0, 'search("xyz") returns empty');
assert(t.search('').length === 4, 'search("") returns all entries');

// Serialize / deserialize round-trip
const serialized = t.serialize();
assert(typeof serialized === 'object', 'serialize() returns plain object');
assert(JSON.stringify(serialized) !== undefined, 'serialize() output is JSON-safe');

const t2 = Trie.deserialize(serialized);
const roundTrip = t2.search('dev');
assert(roundTrip.length === 2, 'deserialize() round-trip: search("dev") returns 2');
assert(t2.search('react').length === 1, 'deserialize() round-trip: search("react") returns 1');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
```

- [ ] **Step 2: Run tests — confirm they fail**

```bash
node --input-type=module < test-utils.js 2>&1 | head -5
```

Expected: error like `Cannot find module './utils.js'` or similar import failure.

- [ ] **Step 3: Implement the Trie class in utils.js**

Create `utils.js` with only the `Trie` class (other exports will be added in later tasks):

```js
// utils.js
// IMPORTANT: No top-level chrome.* API calls anywhere in this file.

// ─── Trie ────────────────────────────────────────────────────────────────────

class TrieNode {
  constructor() {
    this.children = {}; // char → TrieNode
    this.entries = [];  // [{ label, id }] stored at leaf/intermediate nodes
  }
}

export class Trie {
  constructor() {
    this.root = new TrieNode();
  }

  insert(word, id) {
    let node = this.root;
    const label = word.toLowerCase();
    for (const ch of label) {
      if (!node.children[ch]) node.children[ch] = new TrieNode();
      node = node.children[ch];
    }
    node.entries.push({ label: word, id });
  }

  search(prefix) {
    let node = this.root;
    const lp = prefix.toLowerCase();
    for (const ch of lp) {
      if (!node.children[ch]) return [];
      node = node.children[ch];
    }
    // Collect all entries in the subtree
    const results = [];
    const stack = [node];
    while (stack.length) {
      const n = stack.pop();
      results.push(...n.entries);
      for (const child of Object.values(n.children)) stack.push(child);
    }
    return results;
  }

  serialize() {
    function serializeNode(node) {
      const children = {};
      for (const [ch, child] of Object.entries(node.children)) {
        children[ch] = serializeNode(child);
      }
      return { entries: node.entries, children };
    }
    return serializeNode(this.root);
  }

  static deserialize(data) {
    const trie = new Trie();
    function deserializeNode(data) {
      const node = new TrieNode();
      node.entries = data.entries || [];
      for (const [ch, childData] of Object.entries(data.children || {})) {
        node.children[ch] = deserializeNode(childData);
      }
      return node;
    }
    trie.root = deserializeNode(data);
    return trie;
  }
}
```

- [ ] **Step 4: Run tests — confirm Trie tests pass**

```bash
node test-utils.js
```

Requires a `package.json` with `{ "type": "module" }` at the project root (create it if missing). Alternatively:
```bash
node --input-type=module < test-utils.js
```

Expected output:
```
Trie
  ✓ search("dev") returns 2 results
  ✓ search("dev") includes devtools
  ✓ search("dev") includes developer
  ✓ search("des") returns 1 result
  ✓ search("des") returns design
  ✓ search("xyz") returns empty
  ✓ search("") returns all entries
  ✓ serialize() returns plain object
  ✓ serialize() output is JSON-safe
  ✓ deserialize() round-trip: search("dev") returns 2
  ✓ deserialize() round-trip: search("react") returns 1

11 passed, 0 failed
```

- [ ] **Step 5: Commit**

```bash
git add utils.js test-utils.js
git commit -m "feat: add Trie with serialize/deserialize"
```

---

## Task 3: utils.js — buildInvertedIndex + searchTags (TDD)

**Files:**
- Modify: `utils.js` (add two exports)
- Modify: `test-utils.js` (add new tests)

- [ ] **Step 1: Add failing tests for buildInvertedIndex and searchTags to test-utils.js**

**Important:** ES module `import` statements must be at the top of the file. Move all `import` lines to the very top of `test-utils.js` before running. The code below shows what to add; hoist the import line to join the existing imports at line 1–2.

Append the test body to `test-utils.js` (before the final summary lines), and add `buildInvertedIndex, searchTags` to the existing import at the top:

```js
// --- buildInvertedIndex tests ---
console.log('\nbuildInvertedIndex');

import { buildInvertedIndex, searchTags } from './utils.js';

const tags = [
  { id: 'a', name: 'devtools' },
  { id: 'b', name: 'react' },
  { id: 'c', name: 'typescript' },
];
const idx = buildInvertedIndex(tags);

assert(typeof idx === 'object' && !Array.isArray(idx), 'returns plain object');
// 'dev' is a 3-char fragment of 'devtools'
assert(Array.isArray(idx['dev']) && idx['dev'].includes('a'), 'fragment "dev" maps to devtools id');
// 'rea' is a fragment of 'react'
assert(Array.isArray(idx['rea']) && idx['rea'].includes('b'), 'fragment "rea" maps to react id');

// --- searchTags tests ---
console.log('\nsearchTags');

const trie3 = new Trie();
tags.forEach(tag => trie3.insert(tag.name, tag.id));

// Prefix match
const r1 = searchTags('dev', trie3, idx, tags);
assert(r1.length >= 1, 'searchTags("dev") returns at least 1 result');
assert(r1[0].id === 'a', 'searchTags("dev") prefix match is first');

// Substring match (no prefix match for 'tool')
const r2 = searchTags('tool', trie3, idx, tags);
assert(r2.some(r => r.id === 'a'), 'searchTags("tool") substring matches devtools');

// No results
const r3 = searchTags('zzz', trie3, idx, tags);
assert(r3.length === 0, 'searchTags("zzz") returns empty');

// Max 5 results
const manyTags = Array.from({ length: 10 }, (_, i) => ({ id: `t${i}`, name: `tag${i}` }));
const bigTrie = new Trie();
const bigIdx = buildInvertedIndex(manyTags);
manyTags.forEach(tag => bigTrie.insert(tag.name, tag.id));
const r4 = searchTags('tag', bigTrie, bigIdx, manyTags);
assert(r4.length <= 5, 'searchTags caps results at 5');

// Deduplication
const r5 = searchTags('dev', trie3, idx, tags);
const ids5 = r5.map(r => r.id);
assert(new Set(ids5).size === ids5.length, 'searchTags deduplicates by id');
```

- [ ] **Step 2: Run tests — confirm new tests fail**

```bash
node test-utils.js 2>&1 | grep "✗"
```

Expected: failures for `buildInvertedIndex` and `searchTags`.

- [ ] **Step 3: Implement buildInvertedIndex and searchTags in utils.js**

Append to `utils.js` after the `Trie` class:

```js
// ─── Inverted Index ───────────────────────────────────────────────────────────

/**
 * Builds a plain-object inverted index over 2–4 char substrings of tag names.
 * @param {Array<{id: string, name: string}>} tags
 * @returns {{ [fragment: string]: string[] }}
 */
export function buildInvertedIndex(tags) {
  const index = {};
  for (const { id, name } of tags) {
    const lower = name.toLowerCase();
    for (let start = 0; start < lower.length; start++) {
      for (let len = 2; len <= 4 && start + len <= lower.length; len++) {
        const fragment = lower.slice(start, start + len);
        if (!index[fragment]) index[fragment] = [];
        if (!index[fragment].includes(id)) index[fragment].push(id);
      }
    }
  }
  return index;
}

// ─── Tag Search ───────────────────────────────────────────────────────────────

/**
 * Returns up to 5 tag objects matching query.
 * Prefix matches (from Trie) come first; substring-only matches (from index) follow.
 * @param {string} query
 * @param {Trie} trie
 * @param {{ [fragment: string]: string[] }} invertedIndex
 * @param {Array<{id: string, name: string}>} allTags
 * @returns {Array<{id: string, name: string}>}
 */
export function searchTags(query, trie, invertedIndex, allTags) {
  if (!query) return [];
  const q = query.toLowerCase();
  const seen = new Set();
  const results = [];

  // 1. Prefix matches from Trie (highest priority)
  for (const entry of trie.search(q)) {
    if (!seen.has(entry.id)) {
      seen.add(entry.id);
      const tag = allTags.find(t => t.id === entry.id);
      if (tag) results.push(tag);
    }
    if (results.length >= 5) return results;
  }

  // 2. Substring matches from inverted index
  // Use the longest fragment of query that fits in the index (2–4 chars)
  const fragment = q.slice(0, Math.min(4, q.length));
  if (fragment.length >= 2) {
    for (const id of (invertedIndex[fragment] || [])) {
      if (!seen.has(id)) {
        seen.add(id);
        const tag = allTags.find(t => t.id === id);
        if (tag) results.push(tag);
      }
      if (results.length >= 5) return results;
    }
  }

  return results;
}
```

- [ ] **Step 4: Run all tests — confirm all pass**

```bash
node test-utils.js
```

Expected: all tests pass, `0 failed`.

- [ ] **Step 5: Commit**

```bash
git add utils.js test-utils.js
git commit -m "feat: add buildInvertedIndex and searchTags to utils"
```

---

## Task 4: utils.js — Storage Helpers + apiFetch (TDD)

**Files:**
- Modify: `utils.js` (add four exports)
- Modify: `test-utils.js` (add storage/apiFetch tests with chrome mock)

- [ ] **Step 1: Add failing tests with a chrome storage mock**

Append to `test-utils.js`:

```js
// --- Storage helpers + apiFetch tests ---
console.log('\nStorage helpers (mocked chrome.storage)');

import { getSettings, saveSettings, getCache, apiFetch } from './utils.js';

// Mock chrome.storage.local
const store = {};
globalThis.chrome = {
  storage: {
    local: {
      get: (keys) => Promise.resolve(
        Array.isArray(keys)
          ? Object.fromEntries(keys.map(k => [k, store[k]]))
          : { [keys]: store[keys] }
      ),
      set: (obj) => { Object.assign(store, obj); return Promise.resolve(); },
    }
  }
};

// getSettings — cold (returns defaults)
const s1 = await getSettings();
assert(s1.serverUrl === '', 'getSettings() returns empty serverUrl when unset');
assert(s1.apiKey === '', 'getSettings() returns empty apiKey when unset');

// saveSettings + getSettings round-trip
await saveSettings({ serverUrl: 'https://example.com', apiKey: 'abc123' });
const s2 = await getSettings();
assert(s2.serverUrl === 'https://example.com', 'saveSettings/getSettings round-trip: serverUrl');
assert(s2.apiKey === 'abc123', 'saveSettings/getSettings round-trip: apiKey');

// getCache — cold (all fallbacks)
const c1 = await getCache();
assert(Array.isArray(c1.tags) && c1.tags.length === 0, 'getCache() cold: tags is []');
assert(Array.isArray(c1.lists) && c1.lists.length === 0, 'getCache() cold: lists is []');
assert(Array.isArray(c1.bookmarkedUrls) && c1.bookmarkedUrls.length === 0, 'getCache() cold: bookmarkedUrls is []');
assert(Array.isArray(c1.lastUsedTags) && c1.lastUsedTags.length === 0, 'getCache() cold: lastUsedTags is []');
assert(typeof c1.trie.search === 'function', 'getCache() cold: trie is a live Trie instance');
assert(typeof c1.invertedIndex === 'object', 'getCache() cold: invertedIndex is plain object');

// apiFetch — error on empty serverUrl
try {
  await apiFetch('/api/v1/tags', undefined, { serverUrl: '', apiKey: '' });
  assert(false, 'apiFetch throws on empty serverUrl');
} catch (e) {
  assert(e instanceof Error, 'apiFetch throws Error on empty serverUrl');
}
```

- [ ] **Step 2: Run — confirm new tests fail**

```bash
node test-utils.js 2>&1 | grep "✗"
```

- [ ] **Step 3: Implement storage helpers and apiFetch in utils.js**

Append to `utils.js`:

```js
// ─── Storage Helpers ──────────────────────────────────────────────────────────

const STORAGE_KEYS = {
  SETTINGS: 'settings',
  TAGS: 'tags',
  LISTS: 'lists',
  TAG_TRIE: 'tagTrie',
  TAG_INVERTED_INDEX: 'tagInvertedIndex',
  BOOKMARKED_URLS: 'bookmarkedUrls',
  LAST_USED_TAGS: 'lastUsedTags',
};

/** @returns {Promise<{ serverUrl: string, apiKey: string }>} */
export async function getSettings() {
  const result = await chrome.storage.local.get(STORAGE_KEYS.SETTINGS);
  return result[STORAGE_KEYS.SETTINGS] ?? { serverUrl: '', apiKey: '' };
}

/** @param {{ serverUrl: string, apiKey: string }} settings */
export async function saveSettings(settings) {
  await chrome.storage.local.set({ [STORAGE_KEYS.SETTINGS]: settings });
}

/**
 * @returns {Promise<{
 *   tags: Array<{id:string,name:string}>,
 *   lists: Array<{id:string,name:string}>,
 *   trie: Trie,
 *   invertedIndex: Object,
 *   bookmarkedUrls: string[],
 *   lastUsedTags: string[]
 * }>}
 */
export async function getCache() {
  const keys = [
    STORAGE_KEYS.TAGS,
    STORAGE_KEYS.LISTS,
    STORAGE_KEYS.TAG_TRIE,
    STORAGE_KEYS.TAG_INVERTED_INDEX,
    STORAGE_KEYS.BOOKMARKED_URLS,
    STORAGE_KEYS.LAST_USED_TAGS,
  ];
  const result = await chrome.storage.local.get(keys);
  return {
    tags:          result[STORAGE_KEYS.TAGS]               ?? [],
    lists:         result[STORAGE_KEYS.LISTS]              ?? [],
    trie:          result[STORAGE_KEYS.TAG_TRIE]
                     ? Trie.deserialize(result[STORAGE_KEYS.TAG_TRIE])
                     : new Trie(),
    invertedIndex: result[STORAGE_KEYS.TAG_INVERTED_INDEX] ?? {},
    bookmarkedUrls:result[STORAGE_KEYS.BOOKMARKED_URLS]    ?? [],
    lastUsedTags:  result[STORAGE_KEYS.LAST_USED_TAGS]     ?? [],
  };
}

// ─── API Fetch ────────────────────────────────────────────────────────────────

/**
 * @param {string} path
 * @param {RequestInit} [options]
 * @param {{ serverUrl: string, apiKey: string }} [settings]
 */
export async function apiFetch(path, options = {}, settings) {
  const s = settings ?? await getSettings();
  if (!s.serverUrl) throw new Error('Server URL is not configured.');
  const url = s.serverUrl.replace(/\/$/, '') + path;
  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${s.apiKey}`,
      ...(options.headers ?? {}),
    },
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`HTTP ${response.status}: ${text || response.statusText}`);
  }
  return response.json();
}
```

- [ ] **Step 4: Run all tests — confirm all pass**

```bash
node test-utils.js
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add utils.js test-utils.js
git commit -m "feat: add storage helpers and apiFetch to utils"
```

---

## Task 5: content.js

**Files:**
- Create: `content.js`

- [ ] **Step 1: Create content.js**

```js
// content.js — declared content script, no imports
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.action === 'getSelection') {
    sendResponse({ selection: window.getSelection().toString() });
  }
});
```

- [ ] **Step 2: Manual test**

  1. Reload the extension in `chrome://extensions`
  2. Open any webpage, select some text
  3. Open DevTools console on that page
  4. Run: `chrome.runtime.sendMessage({ action: 'getSelection' }, r => console.log(r))`
  5. Expected: `{ selection: "your selected text" }`

- [ ] **Step 3: Commit**

```bash
git add content.js
git commit -m "feat: add content script for getSelection"
```

---

## Task 6: styles.css

**Files:**
- Create: `styles.css`

- [ ] **Step 1: Create styles.css**

```css
/* styles.css */
:root {
  --color-bg:          #ffffff;
  --color-bg-secondary:#f4f4f5;
  --color-bg-input:    #f9f9fb;
  --color-border:      #e4e4e7;
  --color-text:        #18181b;
  --color-text-muted:  #71717a;
  --color-accent:      #6c63ff;
  --color-accent-soft: rgba(108,99,255,0.12);
  --color-success:     #22c55e;
  --color-error-bg:    #fef2f2;
  --color-error-text:  #dc2626;
  --color-error-border:#fca5a5;
  --radius-sm:         4px;
  --radius-md:         6px;
  --radius-pill:       999px;
}

@media (prefers-color-scheme: dark) {
  :root {
    --color-bg:          #18181b;
    --color-bg-secondary:#27272a;
    --color-bg-input:    #1f1f23;
    --color-border:      #3f3f46;
    --color-text:        #f4f4f5;
    --color-text-muted:  #a1a1aa;
    --color-error-bg:    #450a0a;
    --color-error-text:  #fca5a5;
    --color-error-border:#7f1d1d;
  }
}

*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

body {
  font-family: system-ui, -apple-system, sans-serif;
  font-size: 13px;
  color: var(--color-text);
  background: var(--color-bg);
  width: 320px;
}

/* ── Header ─────────────────────────────────────────────────── */
.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px 8px;
  border-bottom: 1px solid var(--color-border);
}
.header-title { font-weight: 700; font-size: 14px; color: var(--color-accent); }
.header-gear {
  background: none; border: none; cursor: pointer;
  color: var(--color-text-muted); font-size: 16px; padding: 2px;
  line-height: 1;
}
.header-gear:hover { color: var(--color-text); }

/* ── Form ────────────────────────────────────────────────────── */
.form { padding: 10px 12px 12px; display: flex; flex-direction: column; gap: 8px; }

/* ── Page row ────────────────────────────────────────────────── */
.page-row { display: flex; gap: 8px; align-items: flex-start; }
.page-title {
  flex: 1 1 60%;
  font-size: 12px;
  font-weight: 500;
  color: var(--color-text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  padding-top: 4px;
}
.list-select {
  flex: 0 0 auto;
  min-width: 100px;
  max-width: 130px;
  background: var(--color-bg-secondary);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  color: var(--color-text);
  font-size: 12px;
  padding: 4px 6px;
  cursor: pointer;
}

/* ── Textarea ────────────────────────────────────────────────── */
.note-textarea {
  width: 100%;
  background: var(--color-bg-input);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  color: var(--color-text);
  font-size: 12px;
  padding: 6px 8px;
  resize: vertical;
  min-height: 56px;
  font-family: inherit;
}
.note-textarea:focus { outline: none; border-color: var(--color-accent); }

/* ── Tags ────────────────────────────────────────────────────── */
.tags-area { position: relative; }
.chips-row {
  display: flex; flex-wrap: wrap; gap: 4px;
  min-height: 0;
}
.chips-row:not(:empty) { margin-bottom: 4px; }
.chip {
  display: inline-flex; align-items: center; gap: 4px;
  background: var(--color-accent-soft);
  color: var(--color-accent);
  border-radius: var(--radius-pill);
  padding: 2px 8px 2px 10px;
  font-size: 11px; font-weight: 500;
}
.chip-remove {
  background: none; border: none; cursor: pointer;
  color: var(--color-accent); font-size: 13px;
  line-height: 1; padding: 0;
}
.tag-input {
  width: 100%;
  background: var(--color-bg-input);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  color: var(--color-text);
  font-size: 12px;
  padding: 5px 8px;
  font-family: inherit;
}
.tag-input:focus { outline: none; border-color: var(--color-accent); }

.suggestions {
  position: absolute;
  top: 100%; left: 0; right: 0;
  z-index: 100;
  background: var(--color-bg);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  box-shadow: 0 4px 12px rgba(0,0,0,0.12);
  overflow-y: auto;
  max-height: 130px;
  display: none;
}
.suggestions.open { display: block; }
.suggestion-item {
  padding: 6px 10px;
  font-size: 12px;
  cursor: pointer;
  color: var(--color-text);
}
.suggestion-item:hover,
.suggestion-item.active { background: var(--color-accent-soft); color: var(--color-accent); }

/* ── Save button ─────────────────────────────────────────────── */
.save-btn {
  width: 100%;
  background: var(--color-accent);
  color: #fff;
  border: none;
  border-radius: var(--radius-md);
  padding: 8px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  letter-spacing: 0.2px;
}
.save-btn:hover:not(:disabled) { filter: brightness(1.1); }
.save-btn:disabled { opacity: 0.7; cursor: not-allowed; }

/* ── Error banner ────────────────────────────────────────────── */
.error-banner {
  display: none;
  position: fixed; bottom: 0; left: 0; right: 0;
  background: var(--color-error-bg);
  color: var(--color-error-text);
  border-top: 1px solid var(--color-error-border);
  font-size: 11px;
  padding: 6px 12px;
}
.error-banner.visible { display: block; }

/* ── Not-configured banner ───────────────────────────────────── */
.unconfigured {
  padding: 16px 12px;
  text-align: center;
  color: var(--color-text-muted);
  font-size: 12px;
  line-height: 1.5;
}
.unconfigured a, .unconfigured button {
  color: var(--color-accent);
  background: none; border: none;
  cursor: pointer; font-size: 12px;
  text-decoration: underline; padding: 0;
}

/* ── Options page ────────────────────────────────────────────── */
.options-body { padding: 24px; max-width: 460px; }
.options-body h1 { font-size: 18px; margin-bottom: 20px; color: var(--color-accent); }
.field { margin-bottom: 16px; }
.field label { display: block; font-size: 12px; font-weight: 600; margin-bottom: 4px; color: var(--color-text-muted); text-transform: uppercase; letter-spacing: .5px; }
.field input {
  width: 100%;
  background: var(--color-bg-input);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  color: var(--color-text);
  font-size: 13px;
  padding: 7px 10px;
}
.field input:focus { outline: none; border-color: var(--color-accent); }
.options-actions { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
.btn-primary {
  background: var(--color-accent); color: #fff;
  border: none; border-radius: var(--radius-md);
  padding: 7px 16px; font-size: 13px; font-weight: 600; cursor: pointer;
}
.btn-secondary {
  background: var(--color-bg-secondary); color: var(--color-text);
  border: 1px solid var(--color-border); border-radius: var(--radius-md);
  padding: 7px 16px; font-size: 13px; cursor: pointer;
}
.status-msg { font-size: 12px; }
.status-msg.success { color: var(--color-success); }
.status-msg.error   { color: var(--color-error-text); }
```

- [ ] **Step 2: Visual check**

  Open `popup.html` in Chrome (even before popup.js is complete). Confirm no CSS parse errors in DevTools console.

- [ ] **Step 3: Commit**

```bash
git add styles.css
git commit -m "feat: add shared styles with system dark/light theme"
```

---

## Task 7: background.js — Cache Refresh

**Files:**
- Create: `background.js`

- [ ] **Step 1: Create background.js with cache refresh logic**

```js
// background.js
import { apiFetch, buildInvertedIndex, Trie, getCache } from './utils.js';

const STORAGE = {
  TAGS:          'tags',
  LISTS:         'lists',
  TAG_TRIE:      'tagTrie',
  TAG_INDEX:     'tagInvertedIndex',
  BOOKMARKED:    'bookmarkedUrls',
  LAST_TAGS:     'lastUsedTags',
};

// ─── Cache Refresh ────────────────────────────────────────────────────────────

async function fetchAllBookmarkUrls() {
  const urls = [];
  let cursor = null;
  while (true) {
    const path = cursor
      ? `/api/v1/bookmarks?limit=100&cursor=${encodeURIComponent(cursor)}`
      : '/api/v1/bookmarks?limit=100';
    const data = await apiFetch(path);
    const items = data.bookmarks ?? data.items ?? data ?? [];
    for (const b of items) {
      if (b.url) urls.push(b.url);
    }
    // Stop if no next cursor or empty page
    cursor = data.nextCursor ?? data.cursor ?? null;
    if (!cursor || items.length === 0) break;
  }
  return urls;
}

async function refreshCache() {
  try {
    const [tagsData, listsData, bookmarkUrls] = await Promise.all([
      apiFetch('/api/v1/tags'),
      apiFetch('/api/v1/lists'),
      fetchAllBookmarkUrls(),
    ]);

    const tags  = tagsData.tags  ?? tagsData  ?? [];
    const lists = listsData.lists ?? listsData ?? [];

    const trie = new Trie();
    for (const tag of tags) trie.insert(tag.name, tag.id);
    const invertedIndex = buildInvertedIndex(tags);

    await chrome.storage.local.set({
      [STORAGE.TAGS]:       tags,
      [STORAGE.LISTS]:      lists,
      [STORAGE.TAG_TRIE]:   trie.serialize(),
      [STORAGE.TAG_INDEX]:  invertedIndex,
      [STORAGE.BOOKMARKED]: bookmarkUrls,
    });
  } catch (err) {
    // Settings not yet configured or network error — fail silently
    console.warn('[Karakeep] Cache refresh failed:', err.message);
  }
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create('refreshCache', { periodInMinutes: 10 });
  refreshCache();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'refreshCache') refreshCache();
});
```

- [ ] **Step 2: Manual test**

  1. Reload extension
  2. Open `chrome://extensions` → click "Service Worker" link to open DevTools for the background
  3. In the Console, run: `chrome.storage.local.get(null, console.log)`
  4. Expected: empty (not yet configured) — no errors in the console

- [ ] **Step 3: Commit**

```bash
git add background.js
git commit -m "feat: add background cache refresh with trie/index build"
```

---

## Task 8: background.js — Badge Logic

**Files:**
- Modify: `background.js`

- [ ] **Step 1: Add badge logic after the cache refresh section**

Append to `background.js`:

```js
// ─── Badge ────────────────────────────────────────────────────────────────────

async function updateBadge(tabId, url) {
  if (!url || url.startsWith('chrome://')) {
    chrome.action.setBadgeText({ text: '', tabId });
    return;
  }
  const result = await chrome.storage.local.get(STORAGE.BOOKMARKED);
  const bookmarkedUrls = result[STORAGE.BOOKMARKED] ?? [];
  if (bookmarkedUrls.includes(url)) {
    chrome.action.setBadgeText({ text: '', tabId });
    chrome.action.setBadgeBackgroundColor({ color: '#22c55e', tabId });
  } else {
    chrome.action.setBadgeText({ text: '', tabId });
    chrome.action.setBadgeBackgroundColor({ color: [0, 0, 0, 0], tabId });
  }
}

chrome.tabs.onActivated.addListener(({ tabId }) => {
  chrome.tabs.get(tabId, (tab) => {
    if (tab?.url) updateBadge(tabId, tab.url);
  });
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab?.url) {
    updateBadge(tabId, tab.url);
  }
});
```

- [ ] **Step 2: Manual test**

  1. Configure server URL and API key in options (even a fake one — just to populate storage)
  2. Manually set a bookmarked URL: in background DevTools console run:
     `chrome.storage.local.set({ bookmarkedUrls: ['https://example.com'] })`
  3. Navigate to `https://example.com`
  4. Expected: extension icon shows a green dot
  5. Navigate to another URL
  6. Expected: green dot disappears

- [ ] **Step 3: Commit**

```bash
git add background.js
git commit -m "feat: add badge logic — green dot for bookmarked URLs"
```

---

## Task 9: background.js — Message Router + Silent Save

**Files:**
- Modify: `background.js`

- [ ] **Step 1: Append the message router and silent save handler**

Append to `background.js`:

```js
// ─── Create Bookmark ──────────────────────────────────────────────────────────

async function createBookmark(url, title, description, tagIds, listId) {
  const data = await apiFetch('/api/v1/bookmarks', {
    method: 'POST',
    body: JSON.stringify({ url, title, description, tagIds, listId }),
  });

  // Update bookmarkedUrls cache
  const result = await chrome.storage.local.get(STORAGE.BOOKMARKED);
  const urls = result[STORAGE.BOOKMARKED] ?? [];
  if (!urls.includes(url)) urls.push(url);
  await chrome.storage.local.set({
    [STORAGE.BOOKMARKED]: urls,
    [STORAGE.LAST_TAGS]:  tagIds ?? [],
  });

  // Refresh badge for any tab showing this URL
  // Note: chrome.tabs.query requires a match pattern, not a raw URL.
  // Query all tabs and filter by exact URL instead.
  const allTabs = await chrome.tabs.query({});
  for (const tab of allTabs) {
    if (tab.url === url) updateBadge(tab.id, tab.url);
  }

  return data;
}

// ─── Message Router ───────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.action === 'createBookmark') {
    const { url, title, description, tagIds, listId } = msg.payload;
    createBookmark(url, title, description, tagIds, listId)
      .then(() => sendResponse({ ok: true }))
      .catch(err => sendResponse({ ok: false, error: err.message }));
    return true; // keep channel open for async response
  }

  if (msg.action === 'refreshCache') {
    refreshCache().then(() => sendResponse({ ok: true }));
    return true;
  }
});

// ─── Silent Save (Ctrl+Shift+S) ───────────────────────────────────────────────

chrome.commands.onCommand.addListener((command) => {
  if (command !== 'silent-save') return;
  chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
    const tab = tabs[0];
    if (!tab?.url) return;
    const result = await chrome.storage.local.get(STORAGE.LAST_TAGS);
    const lastUsedTags = result[STORAGE.LAST_TAGS] ?? [];
    createBookmark(tab.url, tab.title ?? '', '', lastUsedTags, null)
      .catch(() => {}); // silently swallow errors
  });
});
```

- [ ] **Step 2: Manual test — message router**

  1. Reload extension
  2. In background DevTools console:
     ```js
     chrome.runtime.sendMessage(
       { action: 'createBookmark', payload: { url: 'https://test.com', title: 'Test', description: '', tagIds: [], listId: null } },
       r => console.log(r)
     )
     ```
  3. Expected (if server not configured): `{ ok: false, error: "Server URL is not configured." }`

- [ ] **Step 3: Manual test — Ctrl+Shift+S**

  1. Configure options with a real server URL + API key
  2. Navigate to any page
  3. Press Ctrl+Shift+S
  4. Expected: no popup, but check background console for any errors; check Karakeep UI for the new bookmark

- [ ] **Step 4: Commit**

```bash
git add background.js
git commit -m "feat: add message router, createBookmark, and silent save"
```

---

## Task 10: options.html + options.js

**Files:**
- Create: `options.html`
- Create: `options.js`

- [ ] **Step 1: Create options.html**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Karakeep — Options</title>
  <link rel="stylesheet" href="styles.css">
</head>
<body>
  <div class="options-body">
    <h1>Karakeep Settings</h1>

    <div class="field">
      <label for="serverUrl">Server URL</label>
      <input type="url" id="serverUrl" placeholder="https://karakeep.example.com" autocomplete="off">
    </div>

    <div class="field">
      <label for="apiKey">API Key</label>
      <input type="password" id="apiKey" placeholder="Your API key" autocomplete="off">
    </div>

    <div class="options-actions">
      <button class="btn-primary" id="saveBtn">Save</button>
      <button class="btn-secondary" id="testBtn">Test Connection</button>
      <span class="status-msg" id="statusMsg"></span>
    </div>
  </div>
  <script type="module" src="options.js"></script>
</body>
</html>
```

- [ ] **Step 2: Create options.js**

```js
// options.js
import { getSettings, saveSettings, apiFetch } from './utils.js';

const serverUrlInput = document.getElementById('serverUrl');
const apiKeyInput    = document.getElementById('apiKey');
const saveBtn        = document.getElementById('saveBtn');
const testBtn        = document.getElementById('testBtn');
const statusMsg      = document.getElementById('statusMsg');

function showStatus(text, type) {
  statusMsg.textContent = text;
  statusMsg.className = `status-msg ${type}`;
}

// Prefill from storage on load
getSettings().then(({ serverUrl, apiKey }) => {
  serverUrlInput.value = serverUrl;
  apiKeyInput.value    = apiKey;
});

saveBtn.addEventListener('click', async () => {
  const serverUrl = serverUrlInput.value.trim();
  const apiKey    = apiKeyInput.value.trim();
  await saveSettings({ serverUrl, apiKey });
  chrome.runtime.sendMessage({ action: 'refreshCache' });
  showStatus('Saved', 'success');
  setTimeout(() => showStatus('', ''), 2000);
});

testBtn.addEventListener('click', async () => {
  const serverUrl = serverUrlInput.value.trim();
  const apiKey    = apiKeyInput.value.trim();
  testBtn.disabled = true;
  showStatus('Testing…', '');
  try {
    await apiFetch('/api/v1/tags', undefined, { serverUrl, apiKey });
    showStatus('✓ Connected', 'success');
  } catch (err) {
    showStatus(`✗ ${err.message}`, 'error');
  } finally {
    testBtn.disabled = false;
  }
});
```

- [ ] **Step 3: Manual test**

  1. Right-click extension icon → "Options"
  2. Enter a fake URL and key → click "Test Connection"
  3. Expected: red error message
  4. Enter correct URL and key → click "Test Connection"
  5. Expected: green "✓ Connected"
  6. Click "Save" → Expected: brief "Saved" text

- [ ] **Step 4: Commit**

```bash
git add options.html options.js
git commit -m "feat: add options page with save and test connection"
```

---

## Task 11: popup.html + popup.js — Scaffold, Instant Load, Not-Configured State

**Files:**
- Create: `popup.html`
- Create: `popup.js` (partial — UI scaffold, tab info, not-configured gate)

- [ ] **Step 1: Create popup.html**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Karakeep</title>
  <link rel="stylesheet" href="styles.css">
</head>
<body>
  <!-- Not-configured state (shown when settings are missing) -->
  <div class="unconfigured" id="unconfigured" style="display:none">
    <p>Configure Karakeep before saving.</p>
    <button id="openOptionsBtn">Open Settings</button>
  </div>

  <!-- Main form -->
  <div id="mainForm" style="display:none">
    <div class="header">
      <span class="header-title">Karakeep</span>
      <button class="header-gear" id="gearBtn" title="Settings">⚙</button>
    </div>

    <div class="form">
      <div class="page-row">
        <div class="page-title" id="pageTitle"></div>
        <select class="list-select" id="listSelect"></select>
      </div>

      <textarea class="note-textarea" id="noteInput" rows="3" placeholder="Add a note…"></textarea>

      <div class="tags-area">
        <div class="chips-row" id="chipsRow"></div>
        <input class="tag-input" id="tagInput" type="text" placeholder="Add tags…" autocomplete="off">
        <div class="suggestions" id="suggestions"></div>
      </div>

      <button class="save-btn" id="saveBtn">Save</button>
    </div>

    <div class="error-banner" id="errorBanner"></div>
  </div>

  <script type="module" src="popup.js"></script>
</body>
</html>
```

- [ ] **Step 2: Create popup.js — scaffold + instant load + not-configured gate**

```js
// popup.js
import { getSettings, getCache, searchTags } from './utils.js';

// ─── State ────────────────────────────────────────────────────────────────────
let currentUrl   = '';
let currentTitle = '';
let selectedTags = []; // [{ id, name }]
let cache        = { tags: [], lists: [], trie: null, invertedIndex: {} };

// ─── DOM refs ─────────────────────────────────────────────────────────────────
const unconfigured   = document.getElementById('unconfigured');
const mainForm       = document.getElementById('mainForm');
const pageTitleEl    = document.getElementById('pageTitle');
const listSelect     = document.getElementById('listSelect');
const noteInput      = document.getElementById('noteInput');
const tagInput       = document.getElementById('tagInput');
const chipsRow       = document.getElementById('chipsRow');
const suggestions    = document.getElementById('suggestions');
const saveBtn        = document.getElementById('saveBtn');
const errorBanner    = document.getElementById('errorBanner');
const gearBtn        = document.getElementById('gearBtn');
const openOptionsBtn = document.getElementById('openOptionsBtn');

// ─── Init ─────────────────────────────────────────────────────────────────────
async function init() {
  const settings = await getSettings();

  if (!settings.serverUrl || !settings.apiKey) {
    unconfigured.style.display = '';
    return;
  }

  mainForm.style.display = '';

  // Instant: get tab info immediately
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  currentUrl   = tab.url   ?? '';
  currentTitle = tab.title ?? '';
  pageTitleEl.textContent = currentTitle;

  // Try to get selected text from content script (non-blocking)
  chrome.tabs.sendMessage(tab.id, { action: 'getSelection' }, (resp) => {
    if (resp?.selection) noteInput.value = resp.selection;
  });

  // Load cache for list dropdown and tag search
  cache = await getCache();
  renderListDropdown(cache.lists);
}

function renderListDropdown(lists) {
  listSelect.innerHTML = '<option value="">No list</option>';
  for (const list of lists) {
    const opt = document.createElement('option');
    opt.value = list.id;
    opt.textContent = list.name;
    listSelect.appendChild(opt);
  }
}

gearBtn.addEventListener('click', () => chrome.runtime.openOptionsPage());
openOptionsBtn?.addEventListener('click', () => chrome.runtime.openOptionsPage());

init();
```

- [ ] **Step 3: Manual test — not configured**

  1. Clear storage via background DevTools: `chrome.storage.local.clear()`
  2. Click extension icon
  3. Expected: "Configure Karakeep before saving" message with "Open Settings" button

- [ ] **Step 4: Manual test — configured**

  1. Save settings in options
  2. Click extension icon on any page
  3. Expected: page title and list dropdown render immediately; note textarea is empty (or prefilled if text was selected)

- [ ] **Step 5: Commit**

```bash
git add popup.html popup.js
git commit -m "feat: add popup scaffold with instant load and not-configured gate"
```

---

## Task 12: popup.js — Tag Chips + Search-as-You-Type

**Files:**
- Modify: `popup.js`

- [ ] **Step 1: Append chip rendering and tag search logic to popup.js**

```js
// ─── Chips ────────────────────────────────────────────────────────────────────

function renderChips() {
  chipsRow.innerHTML = '';
  for (const tag of selectedTags) {
    const chip = document.createElement('span');
    chip.className = 'chip';
    chip.innerHTML = `${tag.name}<button class="chip-remove" data-id="${tag.id}" aria-label="Remove ${tag.name}">×</button>`;
    chipsRow.appendChild(chip);
  }
}

chipsRow.addEventListener('click', (e) => {
  if (e.target.classList.contains('chip-remove')) {
    const id = e.target.dataset.id;
    selectedTags = selectedTags.filter(t => t.id !== id);
    renderChips();
  }
});

function addTag(tag) {
  if (!tag || selectedTags.some(t => t.id === tag.id)) return;
  selectedTags.push(tag);
  renderChips();
}

function addRawTag(name) {
  const trimmed = name.trim();
  if (!trimmed) return;
  // Use name as both id and label for raw (not-yet-created) tags
  addTag({ id: trimmed, name: trimmed });
}

// ─── Suggestions ──────────────────────────────────────────────────────────────

function renderSuggestions(results) {
  suggestions.innerHTML = '';
  if (!results.length) {
    suggestions.classList.remove('open');
    return;
  }
  for (const tag of results) {
    const item = document.createElement('div');
    item.className = 'suggestion-item';
    item.textContent = tag.name;
    item.dataset.id   = tag.id;
    item.dataset.name = tag.name;
    item.addEventListener('mousedown', (e) => {
      e.preventDefault(); // prevent blur before click registers
      acceptTopSuggestion(tag);
    });
    suggestions.appendChild(item);
  }
  suggestions.classList.add('open');
}

function closeSuggestions() {
  suggestions.classList.remove('open');
  suggestions.innerHTML = '';
}

function acceptTopSuggestion(tag) {
  if (!tag) {
    // fallback: take first item in suggestions
    const first = suggestions.querySelector('.suggestion-item');
    if (!first) return;
    tag = { id: first.dataset.id, name: first.dataset.name };
  }
  addTag(tag);
  tagInput.value = '';
  closeSuggestions();
  tagInput.focus();
}

tagInput.addEventListener('input', () => {
  const q = tagInput.value.trim();
  if (!q) { closeSuggestions(); return; }
  const results = searchTags(q, cache.trie, cache.invertedIndex, cache.tags);
  renderSuggestions(results);
});

tagInput.addEventListener('keydown', (e) => {
  if (e.key === 'Tab' || (e.key === 'Enter' && suggestions.classList.contains('open'))) {
    e.preventDefault();
    const first = suggestions.querySelector('.suggestion-item');
    if (first) {
      acceptTopSuggestion({ id: first.dataset.id, name: first.dataset.name });
    }
    return;
  }
  if (e.key === 'Enter' && !suggestions.classList.contains('open')) {
    e.preventDefault();
    addRawTag(tagInput.value);
    tagInput.value = '';
    closeSuggestions();
    return;
  }
  if (e.key === 'Backspace' && !tagInput.value) {
    selectedTags.pop();
    renderChips();
  }
});

tagInput.addEventListener('blur', () => {
  // Delay so mousedown on suggestion fires first
  setTimeout(closeSuggestions, 150);
});
```

- [ ] **Step 2: Manual test**

  1. First populate tags cache: configure a real server, open background DevTools, run: `chrome.runtime.sendMessage({ action: 'refreshCache' }, console.log)`
  2. Open popup
  3. Type in tag input — expected: dropdown appears with up to 5 matching tags
  4. Press Tab — expected: tag chip appears, input clears, cursor returns to input
  5. Press Backspace on empty input — expected: last chip removed
  6. Type something with no match, press Enter — expected: raw text chip added

- [ ] **Step 3: Commit**

```bash
git add popup.js
git commit -m "feat: add tag chips and search-as-you-type to popup"
```

---

## Task 13: popup.js — Save Flow + Optimistic UI

**Files:**
- Modify: `popup.js`

- [ ] **Step 1: Append save handler to popup.js**

```js
// ─── Save ─────────────────────────────────────────────────────────────────────

function showError(msg) {
  errorBanner.textContent = msg;
  errorBanner.classList.add('visible');
}

function hideError() {
  errorBanner.classList.remove('visible');
  errorBanner.textContent = '';
}

saveBtn.addEventListener('click', async () => {
  hideError();

  // Optimistic UI
  saveBtn.disabled = true;
  saveBtn.textContent = 'Saved!';

  const payload = {
    url:         currentUrl,
    title:       currentTitle,
    description: noteInput.value.trim(),
    tagIds:      selectedTags.map(t => t.id),
    listId:      listSelect.value || null,
  };

  chrome.runtime.sendMessage({ action: 'createBookmark', payload }, (resp) => {
    if (resp?.ok) {
      setTimeout(() => window.close(), 800);
    } else {
      showError(resp?.error ?? 'Could not save — please try again.');
      saveBtn.disabled = false;
      saveBtn.textContent = 'Save';
    }
  });
});
```

- [ ] **Step 2: Manual test — success path**

  1. Configure a working server
  2. Open popup on any page
  3. Click "Save"
  4. Expected: button shows "Saved!" immediately, popup closes after ~800ms
  5. Verify bookmark appears in Karakeep

- [ ] **Step 3: Manual test — error path**

  1. Temporarily set a bad API key in storage: `chrome.storage.local.set({ settings: { serverUrl: 'https://karakeep.example.com', apiKey: 'bad' } })`
  2. Open popup and click Save
  3. Expected: button shows "Saved!" then quickly reverts to "Save" with a red banner at bottom

- [ ] **Step 4: Commit**

```bash
git add popup.js
git commit -m "feat: add optimistic save flow with error recovery to popup"
```

---

## Task 14: benchmark.js

**Files:**
- Create: `benchmark.js`

- [ ] **Step 1: Create benchmark.js**

```js
// benchmark.js — dev-only, NOT loaded by the extension
// Run in browser DevTools console (paste entire file) or with:
//   node --input-type=module < benchmark.js

// Inline Trie — no chrome.* dependencies
class TrieNode { constructor() { this.children = {}; this.entries = []; } }
class Trie {
  constructor() { this.root = new TrieNode(); }
  insert(word, id) {
    let node = this.root;
    for (const ch of word.toLowerCase()) {
      if (!node.children[ch]) node.children[ch] = new TrieNode();
      node = node.children[ch];
    }
    node.entries.push({ label: word, id });
  }
  search(prefix) {
    let node = this.root;
    for (const ch of prefix.toLowerCase()) {
      if (!node.children[ch]) return [];
      node = node.children[ch];
    }
    const results = [];
    const stack = [node];
    while (stack.length) {
      const n = stack.pop();
      results.push(...n.entries);
      for (const child of Object.values(n.children)) stack.push(child);
    }
    return results;
  }
}

function randomString(minLen, maxLen) {
  const len = minLen + Math.floor(Math.random() * (maxLen - minLen + 1));
  return Array.from({ length: len }, () =>
    String.fromCharCode(97 + Math.floor(Math.random() * 26))
  ).join('');
}

// Build trie with 10,000 random tags
const COUNT = 10_000;
const trie = new Trie();
for (let i = 0; i < COUNT; i++) {
  trie.insert(randomString(4, 12), `id-${i}`);
}
console.log(`Trie built with ${COUNT} entries.`);

// Run 100 searches
const SEARCHES = 100;
const latencies = [];
for (let i = 0; i < SEARCHES; i++) {
  const prefix = randomString(2, 4);
  const t0 = performance.now();
  trie.search(prefix);
  latencies.push(performance.now() - t0);
}

const min = Math.min(...latencies).toFixed(3);
const max = Math.max(...latencies).toFixed(3);
const avg = (latencies.reduce((a, b) => a + b, 0) / SEARCHES).toFixed(3);
console.log(`Search latency over ${SEARCHES} queries — min: ${min}ms  max: ${max}ms  avg: ${avg}ms`);
```

- [ ] **Step 2: Run benchmark**

```bash
node --input-type=module < benchmark.js
```

Expected output (approximate — numbers will vary):
```
Trie built with 10000 entries.
Search latency over 100 queries — min: 0.012ms  max: 2.100ms  avg: 0.085ms
```

- [ ] **Step 3: Commit**

```bash
git add benchmark.js
git commit -m "feat: add Trie benchmark (dev-only)"
```

---

## Final Verification Checklist

- [ ] Load unpacked extension — no errors on `chrome://extensions`
- [ ] Options page: save settings, test connection shows green checkmark
- [ ] Popup: opens instantly with page title, no flash/blank state
- [ ] Popup: select text on a page before opening → note field is prefilled
- [ ] Popup: tag search returns results, Tab accepts, chips render and are removable
- [ ] Popup: save succeeds → "Saved!" → auto-close after 800ms
- [ ] Popup: save fails → error banner appears, button re-enables
- [ ] Badge: green dot appears on pages that are bookmarked, disappears on others
- [ ] Ctrl+Shift+S on any page: no popup opens; badge updates immediately on the current tab if save succeeds
- [ ] Dark mode: toggle OS dark mode → popup/options update correctly
- [ ] Run `node test-utils.js` → all tests pass
