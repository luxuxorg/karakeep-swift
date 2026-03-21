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
