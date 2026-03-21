// utils.js
// IMPORTANT: No top-level chrome.* API calls anywhere in this file.

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
    tags:           result[STORAGE_KEYS.TAGS]               ?? [],
    lists:          result[STORAGE_KEYS.LISTS]              ?? [],
    trie:           result[STORAGE_KEYS.TAG_TRIE]
                      ? Trie.deserialize(result[STORAGE_KEYS.TAG_TRIE])
                      : new Trie(),
    invertedIndex:  result[STORAGE_KEYS.TAG_INVERTED_INDEX] ?? {},
    bookmarkedUrls: result[STORAGE_KEYS.BOOKMARKED_URLS]    ?? [],
    lastUsedTags:   result[STORAGE_KEYS.LAST_USED_TAGS]     ?? [],
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
