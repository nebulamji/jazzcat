// Live checks against the real services (npm run test:live): only fast, read-only calls, nothing signed or sent.
//   1. the library against New Jazz City's open MCP server
//   2. a real sealed hour of Texel receipts: its root rebuilt here and checked against Texel's Receipts contract
//   3. the public register: entry #1's file found by its fingerprint
import assert from 'node:assert/strict';
import {NewJazzCity, NjcError} from 'jazzcat';
import {TEXEL, rpc, lookup} from 'jazzcat/proof';
import {merkleRoot} from '../lib/keccak.js';

const t0 = Date.now(), city = new NewJazzCity({timeoutMs: 60_000});
const tools = await city.tools();
assert.ok(tools.some(t => t.name === 'cat_self'), 'tools/list has cat_self');
assert.ok(JSON.stringify(await city.find('post a paid job')).includes('post_job'), 'find_tool routes to post_job');
await assert.rejects(() => city.title({}), e => e instanceof NjcError, 'a tool error becomes NjcError');
console.log(`live 1: library PASS (${tools.length} tools listed)`);

const RECEIPT = ['uint8', 'uint64', 'string', 'string', 'uint32', 'uint32', 'uint32', 'uint32', 'uint64', 'bool', 'bytes32'];
let checked = 0;
for (let back = 2; back <= 48 && !checked; back++) {
  const h = Math.floor(Date.now() / 3600e3) * 3600e3 - back * 3600e3, name = new Date(h).toISOString().slice(0, 13);
  const j = await fetch(`${TEXEL.hours}/${name}.json`).then(r => r.ok ? r.json() : null).catch(() => null);
  if (!j?.receipts?.length) continue;
  const values = j.receipts.map(r => [1, r.hour, r.kind, r.item, r.width, r.height, r.seconds, r.characters, r.creditsMicros, r.free, r.code]);
  const res = await rpc('eth_call', [{to: TEXEL.receipts, data: '0x7d75962b' + (h / 1000).toString(16).padStart(64, '0')}, 'latest']);
  assert.equal(merkleRoot(values, RECEIPT), '0x' + res.slice(2, 66), `hour ${name}: rebuilt root = the root on chain`);
  console.log(`live 2: Texel hour ${name} PASS (${values.length} receipts, root matches Robinhood Chain)`); checked++;
}
assert.ok(checked, 'found a sealed Texel hour with receipts in the last two days');

const hit = await lookup('a6040a0488a544f1b7f4d70f032203cea1cf4ba335150cde3f42eb69d8cb4822');
assert.equal(hit[0]?.n, 1, 'register entry #1');
console.log(`live 3: register PASS (entry #1, ${hit[0].page})`);
console.log(`live: all PASS in ${Date.now() - t0} ms`);
