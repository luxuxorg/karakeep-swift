// test-utils.js — run with: node test-utils.js
// Import only the Trie class (will fail until utils.js exists)
import { Trie, buildInvertedIndex, searchTags, getSettings, saveSettings, getCache, apiFetch, normalizeUrl, isAllowedOrigin } from './utils.js';

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
const reparsed = Trie.deserialize(JSON.parse(JSON.stringify(serialized)));
assert(reparsed.search('dev').length === 2, 'serialize() survives JSON round-trip');

const t2 = Trie.deserialize(serialized);
const roundTrip = t2.search('dev');
assert(roundTrip.length === 2, 'deserialize() round-trip: search("dev") returns 2');
assert(t2.search('react').length === 1, 'deserialize() round-trip: search("react") returns 1');

// Case-insensitive search test
const tCase = new Trie();
tCase.insert('DevTools', 'id-case');
assert(tCase.search('dev').length === 1, 'search is case-insensitive (mixed-case insert)');
assert(tCase.search('DEV').length === 1, 'search is case-insensitive (uppercase query)');

// --- buildInvertedIndex tests ---
console.log('\nbuildInvertedIndex');

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

// Edge cases
assert(searchTags('', trie3, idx, tags).length === 0, 'searchTags("") returns empty');
assert(searchTags('d', trie3, idx, tags).length >= 0, 'searchTags single char does not crash');

// Query longer than 4 chars — no false positives
const r6 = searchTags('typex', trie3, idx, tags);
assert(r6.length === 0, 'searchTags("typex") returns no false positives (typescript does not match)');

// Stronger cap test
assert(r4.length === 5, 'searchTags returns exactly 5 results when more exist');

// Prefix ordering: a tag matching by prefix appears before one matching only by substring
const orderedTags = [
  { id: 'prefix-match', name: 'developer' },
  { id: 'substr-match', name: 'webdev' },
];
const orderedTrie = new Trie();
const orderedIdx = buildInvertedIndex(orderedTags);
orderedTags.forEach(tag => orderedTrie.insert(tag.name, tag.id));
const ordered = searchTags('dev', orderedTrie, orderedIdx, orderedTags);
assert(ordered[0].id === 'prefix-match', 'prefix match appears before substring-only match');

// buildInvertedIndex: duplicate id does not appear twice in a bucket
const dupTags = [{ id: 'dup', name: 'hello' }, { id: 'dup', name: 'world' }];
const dupIdx = buildInvertedIndex(dupTags);
// Both 'hel' and 'wor' fragments exist; for a fragment that only one name produces, id appears once
const helloFragmentBucket = dupIdx['hel'] ?? [];
assert(helloFragmentBucket.filter(id => id === 'dup').length === 1, 'duplicate id appears only once per bucket');

// --- normalizeUrl tests ---
console.log('\nnormalizeUrl');
assert(normalizeUrl('https://Example.COM/path') === 'https://example.com/path', 'lowercases host');
assert(normalizeUrl('https://example.com/path#section') === 'https://example.com/path', 'strips fragment');
assert(normalizeUrl('https://example.com/path/') === 'https://example.com/path', 'strips trailing slash');
assert(normalizeUrl('https://example.com/') === 'https://example.com/', 'preserves root slash');
assert(normalizeUrl('https://example.com/path?q=1') === 'https://example.com/path?q=1', 'preserves query');
assert(normalizeUrl('not-a-url') === 'not-a-url', 'returns input unchanged on parse failure');

// --- isAllowedOrigin tests ---
console.log('\nisAllowedOrigin');
assert(isAllowedOrigin('https://karakeep.example.com') === true, 'HTTPS allowed');
assert(isAllowedOrigin('http://localhost') === true, 'http://localhost allowed');
assert(isAllowedOrigin('http://127.0.0.1') === true, 'http://127.0.0.1 allowed');
assert(isAllowedOrigin('http://example.com') === false, 'plain HTTP blocked');
assert(isAllowedOrigin('http://192.168.1.1') === false, 'local network HTTP blocked');
assert(isAllowedOrigin('ftp://example.com') === false, 'FTP blocked');
assert(isAllowedOrigin('not-a-url') === false, 'invalid URL blocked');

// --- Storage helpers + apiFetch tests ---
console.log('\nStorage helpers (mocked chrome.storage)');

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
assert(typeof c1.bookmarkedIndex === 'object' && !Array.isArray(c1.bookmarkedIndex), 'getCache() cold: bookmarkedIndex is {}');
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

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
