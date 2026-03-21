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
