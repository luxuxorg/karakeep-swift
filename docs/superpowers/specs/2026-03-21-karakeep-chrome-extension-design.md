# Karakeep Chrome Extension — Design Spec
**Date:** 2026-03-21
**Status:** Approved

---

## Overview

A Chrome Extension (Manifest V3) for the Karakeep self-hosted bookmark manager. Minimal, focused workflow: save the current page with a note, tags, and list assignment. Pure Vanilla JS, no build step, ES modules throughout.

---

## File Structure & Responsibilities

```
karakeep-chrome-plugin/
├── manifest.json          # MV3, ES module service worker, keyboard shortcut
├── utils.js               # Trie, inverted index, storage helpers, apiFetch
├── background.js          # import utils.js — cache refresh, badge, shortcut, message router
├── content.js             # getSelection() responder (no imports, declared content script)
├── popup.html             # <script type="module" src="popup.js">
├── popup.js               # import utils.js — UI, tag search, optimistic save
├── options.html           # <script type="module" src="options.js">
├── options.js             # import utils.js — settings form, test connection
├── styles.css             # shared, system dark/light via prefers-color-scheme
└── benchmark.js           # dev-only, not loaded by extension
```

---

## manifest.json

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

**Notes:**
- `scripting` permission is NOT included — `content.js` is a declared content script, not dynamically injected
- `utils.js` is imported via ES `import` from `background.js` and `popup.js` — it is not separately declared in the manifest; it must be present at the extension root

---

## utils.js (shared module)

`utils.js` must contain **no top-level `chrome.*` API calls** — all chrome API access happens inside exported functions only. This ensures the module is safe to import in any context (extension pages, service worker, and benchmark.js).

### Exports

#### `Trie` class
- `insert(word, id)` — adds a tag string with its associated tag ID
- `search(prefix)` → `Array<{label: string, id: string}>` — returns all entries whose label starts with `prefix`
- `serialize()` → plain JSON-serializable object (trie node tree as nested plain objects)
- `static deserialize(nodes)` → `Trie` — reconstructs a live `Trie` instance from serialized nodes; used by `getCache()` when loading from storage

#### `buildInvertedIndex(tags)`
- Input: raw tag array `[{id: string, name: string}, ...]`
- Splits each tag name into all 2–4 char substrings (sliding window)
- Returns a plain object `{ [fragment: string]: string[] }` mapping fragment → array of tag IDs
- This format is directly JSON-serializable for storage and is the authoritative type throughout the system

#### `searchTags(query, trie, invertedIndex, allTags)`
- `trie`: live `Trie` instance (as returned by `getCache()`)
- `invertedIndex`: plain object `{ [fragment: string]: string[] }` (as returned by `getCache()`)
- `allTags`: raw tag array for label/ID lookup
- Returns max 5 tag objects `{id, name}`, ranked: prefix matches first, then substring-only matches
- Deduplicates by tag ID

#### `getSettings()` → `Promise<{ serverUrl: string, apiKey: string }>`
Reads `chrome.storage.local` key `settings`. Returns `{ serverUrl: '', apiKey: '' }` if not set.

#### `saveSettings(settings)` → `Promise<void>`
Writes `{ serverUrl, apiKey }` to `chrome.storage.local` key `settings`.

#### `getCache()` → `Promise<{ tags, lists, trie, invertedIndex, bookmarkedUrls, lastUsedTags }>`
- Reads all cache keys from `chrome.storage.local` in one call
- Deserializes stored trie nodes into a live `Trie` instance via `Trie.deserialize(stored.tagTrie)`
- Returns `invertedIndex` as-is (already a plain object `{ [fragment]: string[] }`)
- Returns `bookmarkedUrls` as `string[]`, `lastUsedTags` as `string[]`
- **Cold cache fallbacks** (first install, before first `refreshCache` completes): `trie` → `new Trie()`, `invertedIndex` → `{}`, `tags` → `[]`, `lists` → `[]`, `bookmarkedUrls` → `[]`, `lastUsedTags` → `[]`

#### `apiFetch(path, options?, settings?)` → `Promise<any>`
- If `settings` is omitted, calls `getSettings()` internally
- Prepends `settings.serverUrl` to `path`
- Attaches `Authorization: Bearer <apiKey>` header
- Returns parsed JSON on success; throws `Error` with a human-readable message on HTTP error or network failure

### `chrome.storage.local` keys

| Key | Type | Description |
|-----|------|-------------|
| `settings` | `{ serverUrl: string, apiKey: string }` | User configuration |
| `tags` | `Array<{id: string, name: string}>` | Raw tags from API |
| `lists` | `Array<{id: string, name: string}>` | Raw lists from API |
| `tagTrie` | serialized plain object (from `trie.serialize()`) | Prefix search index, reconstructed via `Trie.deserialize()` |
| `tagInvertedIndex` | `{ [fragment: string]: string[] }` | Substring search index, used directly |
| `bookmarkedUrls` | `string[]` | All saved URLs for badge check |
| `lastUsedTags` | `string[]` | Tag IDs used in the most recent save (popup or silent) |

---

## background.js

Imports `utils.js` as an ES module. Registers the following listeners:

### `chrome.runtime.onMessage` listener

Handles all messages from popup.js and options.js:

| `action` | Behaviour |
|----------|-----------|
| `'createBookmark'` | Calls `createBookmark(payload.url, payload.title, payload.description, payload.tagIds, payload.listId)`, returns `{ ok: true }` on success or `{ ok: false, error: message }` on failure via `sendResponse` |
| `'refreshCache'` | Triggers an immediate cache refresh (same function used by the alarm), returns `{ ok: true }` |

The listener must call `return true` to keep the message channel open for async `sendResponse`.

### Cache Refresh
- Triggers immediately on `chrome.runtime.onInstalled`
- `chrome.alarms.create('refreshCache', { periodInMinutes: 10 })` on `onInstalled`
- On alarm `'refreshCache'`: fetch `/api/v1/tags`, `/api/v1/lists`, and all pages of `/api/v1/bookmarks` in parallel (see Pagination below)
- Store raw tag and list arrays, then build + persist Trie (via `trie.serialize()`) and inverted index (plain object) to storage
- Update `bookmarkedUrls` from the full bookmarks response

**Pagination for `/api/v1/bookmarks`:**
The extension fetches all pages using a cursor/offset loop until the API returns an empty page or signals end of results. The exact pagination mechanism (cursor vs. page number) should follow the Karakeep API docs. If the API does not support pagination, a single request with a high `limit` parameter (e.g., `limit=10000`) is used. This ensures `bookmarkedUrls` covers all existing bookmarks, not just those saved by this extension.

### Badge Logic
- Listeners: `chrome.tabs.onActivated`, `chrome.tabs.onUpdated` (filter: `status === 'complete'`)
- Reads `bookmarkedUrls` from storage — **no live API call**
- URL found → `chrome.action.setBadgeText({ text: '', tabId })` + `chrome.action.setBadgeBackgroundColor({ color: '#22c55e', tabId })` (green background with empty text renders as a colored dot)
- URL not found → `chrome.action.setBadgeText({ text: '', tabId })` + `chrome.action.setBadgeBackgroundColor({ color: [0,0,0,0], tabId })` (transparent, no badge visible)

### Ctrl+Shift+S Silent Save
- Registered as command `"silent-save"` in manifest
- Gets current tab URL + title via `chrome.tabs.query({ active: true, currentWindow: true })`
- Calls `createBookmark(url, title, '', lastUsedTags, null)` where `lastUsedTags` is read from storage
- The `chrome.commands.onCommand` handler **must wrap the entire call in try/catch (or `.catch(() => {})`)** to prevent an unhandled promise rejection from terminating the service worker
- On success: cache and badge are updated (see `createBookmark` below)
- On failure: silently swallowed. No user-visible feedback. No badge change. (Considered out of scope for v1.)

### `createBookmark(url, title, description, tagIds, listId)`
- `POST /api/v1/bookmarks` with JSON body `{ url, title, description, tagIds, listId }`
- On success:
  1. Append `url` to `bookmarkedUrls` in storage
  2. Trigger badge update for any tab currently showing that URL
  3. Persist `tagIds` as `lastUsedTags` in storage — **this applies to both popup saves and silent saves**, ensuring the most recently used tags are always available for the next silent save
- On failure: throws; caller handles error reporting

---

## popup.html + popup.js

### On Open (instant load)
1. `chrome.tabs.query({ active: true, currentWindow: true })` → render URL + title immediately (no waiting for cache)
2. `chrome.tabs.sendMessage(tabId, { action: 'getSelection' })` → if response contains a non-empty `selection`, prefill the note textarea with it
3. Load cache via `getCache()` → populate list dropdown with `lists`; load `trie` and `invertedIndex` for tag search

### Layout (style B — compact with tag chips)
- **Header row:** extension name (left) + gear icon that opens options page (right)
- **Content row:** page title truncated (left, ~60% width) | list dropdown (right, ~40% width)
- **Note:** full-width textarea, ~3 rows
- **Tags area:** tag chips displayed above the input; text input below for typing; suggestion dropdown appears below the input
- **Save button:** full-width, primary colour
- **Error banner:** hidden by default; shown at bottom on API failure

### Tag Search-as-You-Type
- Each keystroke: `searchTags(query, trie, invertedIndex, tags)` → up to 5 suggestions rendered in a dropdown
- **`Tab`** (when dropdown open) → accept top suggestion → append chip, clear input, close dropdown, focus input
- **`Enter`** (when dropdown open) → same as Tab
- **`Enter`** (when dropdown closed and input non-empty) → add raw input text as a new tag chip
- **`Backspace`** on empty input → remove the last chip
- **Click suggestion** → same as Tab
- **Click `×` on chip** → remove that chip

### Save Flow
1. User clicks Save
2. **Optimistic UI:** disable Save button, set button text to "Saved!" immediately
3. Send `chrome.runtime.sendMessage({ action: 'createBookmark', payload: { url, title, description, tagIds, listId } })`
4. Receive response:
   - `{ ok: true }` → wait 800 ms → `window.close()`
   - `{ ok: false, error }` → show red error banner at bottom of popup with `error` message; re-enable Save button; restore button text to "Save"

### Not-Configured State
- On open, before rendering the form: check `settings.serverUrl` and `settings.apiKey`
- If either is missing → replace popup body with a single banner: "Configure Karakeep in extension options" + button/link that calls `chrome.runtime.openOptionsPage()`

---

## options.html + options.js

- Two labelled input fields: **Server URL** (e.g. `https://karakeep.example.com`) and **API Key**
- On load: prefill fields from `getSettings()`
- **Save** button:
  1. Calls `saveSettings({ serverUrl, apiKey })`
  2. Sends `chrome.runtime.sendMessage({ action: 'refreshCache' })` to trigger cache rebuild
  3. Shows brief "Saved" confirmation text
- **Test Connection** button:
  1. Reads `serverUrl` and `apiKey` directly from the DOM input fields (not from storage — may not be saved yet)
  2. Calls `apiFetch('/api/v1/tags', undefined, { serverUrl, apiKey })` — settings passed explicitly as third argument so unsaved field values are used
  3. Success → show green "✓ Connected" next to button
  4. Failure → show red "✗ [error message]" next to button

---

## content.js

Declared content script (`"run_at": "document_idle"`, `"matches": ["<all_urls>"]`). No ES module imports.

```js
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.action === 'getSelection') {
    sendResponse({ selection: window.getSelection().toString() });
  }
});
```

~6 lines. No state. No side effects.

---

## styles.css

- CSS custom properties for all colours, toggled via `@media (prefers-color-scheme: dark)`
- Popup fixed width: 320px
- Tag chips: pill-shaped (`border-radius: 999px`), removable with inline `×` button
- Suggestion dropdown: `position: absolute`, `z-index: 100`, below tag input, max 5 items, scrollable if needed
- Error banner: `position: fixed; bottom: 0; left: 0; right: 0`, red background, auto-hidden
- Badge appearance controlled entirely via `chrome.action.setBadgeBackgroundColor` (no text glyph used)

---

## benchmark.js (dev-only)

Not referenced by the extension. Safe to run in browser DevTools console or Node.js because:
- It does **not** import `utils.js` — it re-implements `Trie` inline (a copy of the class with no `chrome.*` references)
- This avoids any `chrome.storage` import-time side-effects

Algorithm:
1. Generate 10,000 random lowercase strings of length 4–12
2. Insert all into a local `Trie` instance
3. Run 100 searches with random 2–4 char prefixes, measuring each with `performance.now()`
4. Log to console: min, max, avg latency in milliseconds

---

## API Endpoints Used

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/v1/tags` | Fetch all tags for cache; used by options Test Connection |
| GET | `/api/v1/lists` | Fetch all lists for dropdown |
| GET | `/api/v1/bookmarks` | Fetch all bookmarked URLs for badge cache (paginated) |
| POST | `/api/v1/bookmarks` | Create new bookmark |

---

## Out of Scope (v1)

- Browsing / searching existing bookmarks from popup
- Editing or deleting bookmarks
- Sync across devices (handled by server)
- Offline queue for failed saves
- User-visible feedback for silent save failures (Ctrl+Shift+S)
