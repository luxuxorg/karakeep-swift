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
