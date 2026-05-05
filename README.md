# Karakeep Swift

**The swift Karakeep-Plugin.**

This is a vibecoded Karakeep-Plugin, that reacts much faster, as it stores your tags and bookmark URLs locally. It's privacy friendly, as it doesn't read page contents, unless you open it. It's security hardened and even allows for only session based storage of the API-key. There is no support provided, but you can visit the [GitHub project](https://github.com/luxuxorg/karakeep-swift).

**Author:** Lutz Schmitt

A Manifest V3 Chrome extension for saving bookmarks to a self-hosted [Karakeep](https://karakeep.app) instance. Pure Vanilla JS — no build step, no dependencies.

---

## Setup

1. Load the folder as an unpacked extension in `chrome://extensions` (Developer mode) **or** install from the Chrome Web Store (unlisted link).
2. Click the extension icon → **Open Settings** (or the ⚙ button).
3. Enter your Karakeep server URL and API key, then click **Save**.

---

## Permission model

| Permission | Why |
|---|---|
| `storage` | Stores settings (server URL, API key) and local caches |
| `activeTab` | Reads the current tab's URL and title when the popup opens |
| `scripting` | Injects a one-off script to read selected text from the active tab |
| `alarms` | Periodic tag/list cache refresh (every 60 min) |
| `tabs` | Badge updates when navigating between tabs |

### Host permissions

| Pattern | Type | Why |
|---|---|---|
| `http://localhost/*` | Static | Local dev — granted at install, no prompt |
| `http://127.0.0.1/*` | Static | Local dev — granted at install, no prompt |
| `https://*/*` | Optional | Declared as requestable; only the specific configured server origin is ever requested at runtime |

The extension requests host access **only for the origin you configure** (e.g. `https://karakeep.example.com/*`). Chrome shows a narrow, origin-specific permission dialog in the Options page when you first save or test a new server URL — never during normal popup use.

If you change the server URL, the old origin's permission is automatically revoked and a new prompt is shown for the new origin.

---

## HTTPS enforcement

The API key is a bearer token. To prevent credential leakage:

- **HTTPS (`https://`)** is always accepted.
- **HTTP is allowed only for local development:**
  - `http://localhost`
  - `http://127.0.0.1`
- All other `http://` URLs are **blocked** with a clear error in both the options page and at the `apiFetch` level.

---

## What is stored locally (`chrome.storage.local`)

| Key | Contents | Purpose |
|---|---|---|
| `settings` | `{ serverUrl, apiKey }` | Extension configuration |
| `tags` | `[{ id, name }]` | Tag suggestions in the popup |
| `tagTrie` | Serialised trie | Fast prefix search |
| `tagInvertedIndex` | Fragment → id map | Substring search |
| `lists` | `[{ id, name }]` | List dropdown |
| `bookmarkedIndex` | `{ normalizedUrl: bookmarkId }` | Duplicate detection and update routing |
| `lastUsedTags` | `string[]` | Reused for Ctrl+Shift+K silent save |
| `lastBookmarkSync` | timestamp | Prevents redundant full syncs on startup |

**What is NOT stored locally:** bookmark titles, notes/descriptions, tag assignments, list assignments for individual bookmarks. These are fetched on-demand from the server when the popup opens on an already-saved URL.

---

## Auto-save

Auto-save on popup open has been **removed**. Bookmarks are created or updated only when the user explicitly clicks **Save** / **Update bookmark**.

---

## Selected-text capture

When the popup opens, a one-time script is injected into the active tab via `chrome.scripting.executeScript` to read `window.getSelection()`. No persistent content script runs on every page you visit. This fails silently on restricted pages (`chrome://`, `chrome-extension://`, etc.).

---

## URL normalisation

All bookmark URLs are normalised before storage and lookup:

- Host is lowercased (`Example.COM` → `example.com`)
- Fragment is stripped (`/page#section` → `/page`)
- Trailing slashes removed from non-root paths (`/path/` → `/path`)
- Query parameters are kept as-is (not sorted)

This prevents duplicate entries caused by capitalisation or fragment differences.

---

## Cache refresh schedule

| Event | What refreshes |
|---|---|
| Extension install | Tags + lists + full bookmark index (forced) |
| Browser startup | Full bookmark index (skipped if synced within 4 hours) |
| Alarm (every 60 min) | Tags + lists only |
| Settings save | Tags + lists + full bookmark index (forced) |

---

## Known limitations

- **Bookmark index can drift** if bookmarks are deleted or moved from another client between syncs. The drift self-corrects on the next browser startup or settings save.
- **Query parameter deduplication:** `https://example.com/page?a=1&b=2` and `?b=2&a=1` are treated as different URLs (query params are not sorted). This matches browser behaviour.
- **`chrome.storage.local` is unencrypted on disk.** Anyone with access to your OS user account and Chrome profile directory can read the stored API key and bookmark index. This is a limitation of the Chrome extension storage model, not specific to this extension.
