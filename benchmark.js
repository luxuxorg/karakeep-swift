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
