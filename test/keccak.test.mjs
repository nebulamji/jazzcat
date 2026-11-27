// keccak256, ABI encoding, the standard Merkle root and EIP-55, checked against known vectors and @openzeppelin/merkle-tree.
import test from 'node:test';
import assert from 'node:assert/strict';
import {StandardMerkleTree} from '@openzeppelin/merkle-tree';
import {keccak256, toHex, leafHash, merkleRoot, checksum, abiEncode} from '../lib/keccak.js';
import {recipes} from '../lib/recipes.js';

const RECEIPT = ['uint8', 'uint64', 'string', 'string', 'uint32', 'uint32', 'uint32', 'uint32', 'uint64', 'bool', 'bytes32'];
let seed = 7; const rnd = n => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
const hex32 = () => '0x' + Array.from({length: 32}, () => rnd(256).toString(16).padStart(2, '0')).join('');
const word = n => 'abcdefghijklmnopqrstuvwxyz -_é音'.split('').map(() => 'abcdefghijklmnopqrstuvwxyz -_é音'[rnd(31)]).join('').repeat(1 + rnd(n));
const receipt = () => [1, 1795000000 + rnd(9e6), ['image', 'video', 'voice', '3d'][rnd(4)], word(6), rnd(4096), rnd(4096), rnd(30), rnd(5000), rnd(2e9), rnd(2) === 1, hex32()];

test('keccak256 known vectors', () => {
  assert.equal(toHex(keccak256('')), 'c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470');
  assert.equal(toHex(keccak256('abc')), '4e03657aea45a94fc7d47ba826c8d667c0d1e6e33a64a036ec44f58fa12d6c45');
  assert.equal(toHex(keccak256('The quick brown fox jumps over the lazy dog')), '4d741b6f1eb29cb2a9b9911c82f56fa8d73b04959d3d9d222895df6c0b28aa15');
});

test('leaf hashes match OpenZeppelin for strings of every length across the 136-byte block edges', () => {
  for (let n = 0; n <= 300; n++) {
    const v = ['x'.repeat(n)];
    assert.equal('0x' + toHex(leafHash(['string'], v)), StandardMerkleTree.of([v], ['string']).leafHash(v), `length ${n}`);
  }
});

test('Merkle roots match OpenZeppelin for Texel-shaped receipts, 1 to 40 leaves', () => {
  for (let n = 1; n <= 40; n++) {
    const values = Array.from({length: n}, receipt);
    assert.equal(merkleRoot(values, RECEIPT), StandardMerkleTree.of(values, RECEIPT).root, `${n} leaves`);
  }
});

test('ABI encoding refuses what it cannot encode exactly', () => {
  assert.throws(() => abiEncode(['uint8'], [256]), /Out of range/);
  assert.throws(() => abiEncode(['bool'], [1]), /true or false/);
  assert.throws(() => abiEncode(['bytes32'], ['0x1234']), /32 bytes/);
  assert.throws(() => abiEncode(['int256'], [1]), /not supported/);
  assert.throws(() => merkleRoot([], RECEIPT), /no values/);
});

test('EIP-55 checksums: every recipe contract is already checksummed', () => {
  for (const r of recipes()) assert.equal(checksum(r.contract), r.contract, r.name);
  assert.equal(checksum('0xfb6916095ca1df60bb79ce92ce3ea74c37c5d359'), '0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359');
});
