// test-utils.js — run with: node test-utils.js
// Import only the Trie class (will fail until utils.js exists)
import { Trie, buildInvertedIndex, searchTags } from './utils.js';

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

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
