// keccak256 (Ethereum's hash), ABI encoding for the plain types the proof needs, the root of an OpenZeppelin standard
// Merkle tree, and EIP-55 address checksums. No dependencies: test/keccak.test.mjs checks every one of them against
// @openzeppelin/merkle-tree.

const MASK = (1n << 64n) - 1n;
const RC = [0x0000000000000001n, 0x0000000000008082n, 0x800000000000808an, 0x8000000080008000n, 0x000000000000808bn,
  0x0000000080000001n, 0x8000000080008081n, 0x8000000000008009n, 0x000000000000008an, 0x0000000000000088n,
  0x0000000080008009n, 0x000000008000000an, 0x000000008000808bn, 0x800000000000008bn, 0x8000000000008089n,
  0x8000000000008003n, 0x8000000000008002n, 0x8000000000000080n, 0x000000000000800an, 0x800000008000000an,
  0x8000000080008081n, 0x8000000000008080n, 0x0000000080000001n, 0x8000000080008008n];
// Rotation offsets, indexed x + 5y.
const R = [0, 1, 62, 28, 27, 36, 44, 6, 55, 20, 3, 10, 43, 25, 39, 41, 45, 15, 21, 8, 18, 2, 61, 56, 14];
const rotl = (v, n) => n === 0 ? v : ((v << BigInt(n)) | (v >> BigInt(64 - n))) & MASK;

function permute(A) {
  const C = new Array(5), B = new Array(25);
  for (let round = 0; round < 24; round++) {
    for (let x = 0; x < 5; x++) C[x] = A[x] ^ A[x + 5] ^ A[x + 10] ^ A[x + 15] ^ A[x + 20];
    for (let x = 0; x < 5; x++) {
      const D = C[(x + 4) % 5] ^ rotl(C[(x + 1) % 5], 1);
      for (let y = 0; y < 25; y += 5) A[x + y] ^= D;
    }
    for (let x = 0; x < 5; x++) for (let y = 0; y < 5; y++) B[y + 5 * ((2 * x + 3 * y) % 5)] = rotl(A[x + 5 * y], R[x + 5 * y]);
    for (let x = 0; x < 5; x++) for (let y = 0; y < 5; y++)
      A[x + 5 * y] = B[x + 5 * y] ^ ((~B[(x + 1) % 5 + 5 * y] & MASK) & B[(x + 2) % 5 + 5 * y]);
    A[0] ^= RC[round];
  }
}

const enc = new TextEncoder();
/** keccak256 of bytes (a Uint8Array) or of a string's UTF-8 bytes. Returns 32 bytes. */
export function keccak256(data) {
  const bytes = typeof data === 'string' ? enc.encode(data) : data;
  const rate = 136, padded = new Uint8Array(bytes.length + (rate - (bytes.length % rate)));
  padded.set(bytes); padded[bytes.length] ^= 0x01; padded[padded.length - 1] ^= 0x80;
  const A = new Array(25).fill(0n);
  for (let off = 0; off < padded.length; off += rate) {
    for (let i = 0; i < rate / 8; i++) {
      let lane = 0n;
      for (let b = 7; b >= 0; b--) lane = (lane << 8n) | BigInt(padded[off + i * 8 + b]);
      A[i] ^= lane;
    }
    permute(A);
  }
  const out = new Uint8Array(32);
  for (let i = 0; i < 4; i++) { let lane = A[i]; for (let b = 0; b < 8; b++) { out[i * 8 + b] = Number(lane & 0xffn); lane >>= 8n; } }
  return out;
}

export const toHex = b => [...b].map(x => x.toString(16).padStart(2, '0')).join('');
export function fromHex(h) {
  const s = String(h).replace(/^0x/i, '');
  if (s.length % 2 || /[^0-9a-f]/i.test(s)) throw new Error(`Not hex: ${String(h).slice(0, 20)}`);
  return Uint8Array.from(s.match(/../g) || [], x => parseInt(x, 16));
}
const concat = parts => { const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; } return out; };
function word(n, bits = 256) {
  n = BigInt(n);
  if (n < 0n || n >= (1n << BigInt(bits))) throw new Error(`Out of range for uint${bits}: ${n}`);
  const out = new Uint8Array(32);
  for (let i = 31; i >= 0 && n > 0n; i--) { out[i] = Number(n & 0xffn); n >>= 8n; }
  return out;
}

/** abi.encode for uintN, bool, address, bytes32, string and bytes (what Texel's receipts use). */
export function abiEncode(types, values) {
  if (types.length !== values.length) throw new Error('abiEncode: types and values differ in length');
  const heads = [], tails = [], headLen = 32 * types.length;
  let tailLen = 0;
  types.forEach((t, i) => {
    const v = values[i];
    if (t === 'string' || t === 'bytes') {
      const b = t === 'string' ? enc.encode(String(v)) : fromHex(v);
      const padded = new Uint8Array(Math.ceil(b.length / 32) * 32); padded.set(b);
      heads.push(word(headLen + tailLen));
      const tail = concat([word(b.length), padded]); tails.push(tail); tailLen += tail.length;
    } else if (/^uint(\d+)$/.test(t)) heads.push(word(v, Number(t.slice(4))));
    else if (t === 'bool') { if (typeof v !== 'boolean') throw new Error('abiEncode: bool takes true or false'); heads.push(word(v ? 1 : 0)); }
    else if (t === 'address') { const b = fromHex(v); if (b.length !== 20) throw new Error('abiEncode: address is 20 bytes'); heads.push(concat([new Uint8Array(12), b])); }
    else if (t === 'bytes32') { const b = fromHex(v); if (b.length !== 32) throw new Error('abiEncode: bytes32 is 32 bytes'); heads.push(b); }
    else throw new Error(`abiEncode: ${t} is not supported`);
  });
  return concat([...heads, ...tails]);
}

const cmp = (a, b) => { for (let i = 0; i < 32; i++) if (a[i] !== b[i]) return a[i] - b[i]; return 0; };
const hashPair = (a, b) => keccak256(cmp(a, b) <= 0 ? concat([a, b]) : concat([b, a]));
/** A leaf of an OpenZeppelin standard Merkle tree: keccak256(keccak256(abi.encode(value))). */
export const leafHash = (types, value) => keccak256(keccak256(abiEncode(types, value)));
/** The root of OpenZeppelin's StandardMerkleTree.of(values, types) (leaves sorted), as 0x hex. */
export function merkleRoot(values, types) {
  if (!values.length) throw new Error('merkleRoot: no values');
  const leaves = values.map(v => leafHash(types, v)).sort(cmp);
  const tree = new Array(2 * leaves.length - 1);
  leaves.forEach((l, i) => { tree[tree.length - 1 - i] = l; });
  for (let i = tree.length - 1 - leaves.length; i >= 0; i--) tree[i] = hashPair(tree[2 * i + 1], tree[2 * i + 2]);
  return '0x' + toHex(tree[0]);
}

/** An address with its EIP-55 checksum. */
export function checksum(address) {
  const a = String(address).toLowerCase().replace(/^0x/, '');
  if (!/^[0-9a-f]{40}$/.test(a)) throw new Error(`Not an address: ${address}`);
  const h = toHex(keccak256(a));
  return '0x' + [...a].map((c, i) => parseInt(h[i], 16) >= 8 ? c.toUpperCase() : c).join('');
}
