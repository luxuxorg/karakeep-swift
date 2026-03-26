// utils.js
// IMPORTANT: No top-level chrome.* API calls anywhere in this file.

// ─── URL Helpers ──────────────────────────────────────────────────────────────

/**
 * Normalizes a URL for consistent storage and lookup.
 * - Lowercases the host
 * - Strips the fragment (#...)
 * - Removes trailing slashes from non-root paths
 * - Query params are kept as-is (order is preserved, not sorted)
 * @param {string} url
 * @returns {string}
 */
export function normalizeUrl(url) {
  try {
    const u = new URL(url);
    u.hostname = u.hostname.toLowerCase();
    u.hash = '';
    if (u.pathname !== '/' && u.pathname.endsWith('/')) {
      u.pathname = u.pathname.replace(/\/+$/, '');
    }
    return u.toString();
  } catch {
    return url;
  }
}

/**
 * Returns true if the server URL is safe for API key transport.
 * HTTPS is always allowed. HTTP is allowed only for localhost dev.
 * @param {string} serverUrl
 * @returns {boolean}
 */
export function isAllowedOrigin(serverUrl) {
  try {
    const { protocol, hostname } = new URL(serverUrl);
    if (protocol === 'https:') return true;
    if (protocol === 'http:' && (hostname === 'localhost' || hostname === '127.0.0.1')) return true;
    return false;
  } catch {
    return false;
  }
}

/**
 * Derives the optional host permission pattern for a server URL.
 * Returns null for localhost — those are covered by static host_permissions
 * and never need a runtime permission request.
 * @param {string} serverUrl
 * @returns {string|null}
 */
export function serverOriginPattern(serverUrl) {
  try {
    const { protocol, hostname } = new URL(serverUrl);
    if (protocol === 'http:' && (hostname === 'localhost' || hostname === '127.0.0.1')) return null;
    if (protocol === 'https:') return `https://${hostname}/*`;
    return null;
  } catch {
    return null;
  }
}

/**
 * Returns true if the extension already holds permission to access the server URL.
 * Always true for localhost (static permission).
 * @param {string} serverUrl
 * @returns {Promise<boolean>}
 */
export async function hasServerPermission(serverUrl) {
  const pattern = serverOriginPattern(serverUrl);
  if (!pattern) return true;
  return chrome.permissions.contains({ origins: [pattern] });
}

/**
 * Requests the host permission for the server URL if not already granted.
 * MUST be called from a user-gesture handler (button click).
 * Returns { granted: boolean } — never throws.
 * @param {string} serverUrl
 * @returns {Promise<{ granted: boolean }>}
 */
export async function requestServerPermission(serverUrl) {
  const pattern = serverOriginPattern(serverUrl);
  if (!pattern) return { granted: true };
  if (await chrome.permissions.contains({ origins: [pattern] })) return { granted: true };
  const granted = await chrome.permissions.request({ origins: [pattern] });
  return { granted };
}

// ─── Trie ────────────────────────────────────────────────────────────────────

class TrieNode {
  constructor() {
    this.children = {}; // char → TrieNode
    this.entries = [];  // [{ label, id }] stored at the terminal node for each inserted word
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
    function deserializeNode(nodeData) {
      const node = new TrieNode();
      node.entries = nodeData.entries || [];
      for (const [ch, childData] of Object.entries(nodeData.children || {})) {
        node.children[ch] = deserializeNode(childData);
      }
      return node;
    }
    trie.root = deserializeNode(data);
    return trie;
  }
}

// ─── Inverted Index ───────────────────────────────────────────────────────────

/**
 * Builds a plain-object inverted index over 2–4 char substrings of tag names.
 * @param {Array<{id: string, name: string}>} tags
 * @returns {{ [fragment: string]: string[] }}
 */
export function buildInvertedIndex(tags) {
  // Use Sets during construction for O(1) dedup, convert to arrays for storage
  const sets = {};
  for (const { id, name } of tags) {
    const lower = name.toLowerCase();
    for (let start = 0; start < lower.length; start++) {
      for (let len = 2; len <= 4 && start + len <= lower.length; len++) {
        const fragment = lower.slice(start, start + len);
        if (!sets[fragment]) sets[fragment] = new Set();
        sets[fragment].add(id);
      }
    }
  }
  // Convert Sets to arrays for JSON-serializable storage
  const index = {};
  for (const [fragment, set] of Object.entries(sets)) {
    index[fragment] = Array.from(set);
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
        const tag = allTags.find(t => t.id === id);
        // Post-filter: ensure the full query is actually a substring of the tag name
        if (tag && tag.name.toLowerCase().includes(q)) {
          seen.add(id);
          results.push(tag);
        }
      }
      if (results.length >= 5) return results;
    }
  }

  return results;
}

// ─── Storage Helpers ──────────────────────────────────────────────────────────

const STORAGE_KEYS = {
  SETTINGS:           'settings',
  TAGS:               'tags',
  LISTS:              'lists',
  TAG_TRIE:           'tagTrie',
  TAG_INVERTED_INDEX: 'tagInvertedIndex',
  // Minimal index: { [normalizedUrl]: bookmarkId } — no full bookmark content stored locally
  BOOKMARKED_INDEX:   'bookmarkedIndex',
  LAST_USED_TAGS:     'lastUsedTags',
};

/**
 * Returns settings, preferring a session-only API key over the permanently stored one.
 * This lets users supply the key for this browser session without writing it to disk.
 * @returns {Promise<{ serverUrl: string, apiKey: string }>}
 */
export async function getSettings() {
  const [localResult, sessionResult] = await Promise.all([
    chrome.storage.local.get(STORAGE_KEYS.SETTINGS),
    (chrome.storage.session?.get('sessionApiKey') ?? Promise.resolve({})),
  ]);
  const settings = { ...(localResult[STORAGE_KEYS.SETTINGS] ?? { serverUrl: '', apiKey: '' }) };
  if (sessionResult.sessionApiKey) settings.apiKey = sessionResult.sessionApiKey;
  return settings;
}

/** Stores the API key for this browser session only (cleared when the browser closes). */
export async function saveSessionApiKey(apiKey) {
  await (chrome.storage.session?.set({ sessionApiKey: apiKey }) ?? Promise.resolve());
}

/** Returns true if an API key is permanently stored in local storage. */
export async function hasPermanentApiKey() {
  const result = await chrome.storage.local.get(STORAGE_KEYS.SETTINGS);
  return !!(result[STORAGE_KEYS.SETTINGS]?.apiKey);
}

/** Removes the permanently stored API key without touching the server URL or session key. */
export async function clearPermanentApiKey() {
  const result = await chrome.storage.local.get(STORAGE_KEYS.SETTINGS);
  const s = { ...(result[STORAGE_KEYS.SETTINGS] ?? {}), apiKey: '' };
  await chrome.storage.local.set({ [STORAGE_KEYS.SETTINGS]: s });
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
 *   bookmarkedIndex: { [normalizedUrl: string]: string },
 *   lastUsedTags: string[]
 * }>}
 */
export async function getCache() {
  const keys = [
    STORAGE_KEYS.TAGS,
    STORAGE_KEYS.LISTS,
    STORAGE_KEYS.TAG_TRIE,
    STORAGE_KEYS.TAG_INVERTED_INDEX,
    STORAGE_KEYS.BOOKMARKED_INDEX,
    STORAGE_KEYS.LAST_USED_TAGS,
  ];
  const result = await chrome.storage.local.get(keys);
  return {
    tags:            result[STORAGE_KEYS.TAGS]               ?? [],
    lists:           result[STORAGE_KEYS.LISTS]              ?? [],
    trie:            result[STORAGE_KEYS.TAG_TRIE]
                       ? Trie.deserialize(result[STORAGE_KEYS.TAG_TRIE])
                       : new Trie(),
    invertedIndex:   result[STORAGE_KEYS.TAG_INVERTED_INDEX] ?? {},
    bookmarkedIndex: result[STORAGE_KEYS.BOOKMARKED_INDEX]   ?? {},
    lastUsedTags:    result[STORAGE_KEYS.LAST_USED_TAGS]     ?? [],
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
  if (!isAllowedOrigin(s.serverUrl)) {
    throw new Error('Server URL must use HTTPS. Local dev exception: http://localhost or http://127.0.0.1 only.');
  }
  if (!await hasServerPermission(s.serverUrl)) {
    throw new Error('Server permission missing. Open Settings to re-authorize this server.');
  }
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
