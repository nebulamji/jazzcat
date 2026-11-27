// Node 18 keeps Web Crypto behind a flag, so there is no global crypto there: the proof's hashing still works (Codex #1).
// (Each test file runs in its own process, so taking the global away here touches no other test.)
import test from 'node:test';
import assert from 'node:assert/strict';

test('sha256 works with no global crypto', async () => {
  Object.defineProperty(globalThis, 'crypto', {value: undefined, configurable: true, writable: true});
  const {sha256} = await import('../lib/proof.js');
  assert.equal(await sha256('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.equal(await sha256(new TextEncoder().encode('abc')), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});
