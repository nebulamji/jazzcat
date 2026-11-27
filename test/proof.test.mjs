// jazzcat/proof (from texel-proof), offline: Texel, Robinhood Chain and the register are faked. The sealed hour's root
// on the fake chain is built with @openzeppelin/merkle-tree, so a proof that passes here rebuilt it the same way.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {StandardMerkleTree} from '@openzeppelin/merkle-tree';
import {verify, lint, proveFile, lookup, fingerprint, canonical, TEXEL, REGISTER} from 'jazzcat/proof';

const USDG = '0x5fc5360d0400a0fd4f2af552add042d716f1d168', WALLET = '0x' + 'ab'.repeat(20), TX = '0x' + 'cd'.repeat(32);
const T_TRANSFER = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const T_AUTH_USED = '0x98de503528ee59b575ef0c0a2576a82497bfc029a5685b209e9ec333479b10a5';
const RECEIPT = ['uint8', 'uint64', 'string', 'string', 'uint32', 'uint32', 'uint32', 'uint32', 'uint64', 'bool', 'bytes32'];
const pad = a => '0x' + a.replace(/^0x/, '').padStart(64, '0');
const FILE = new TextEncoder().encode('a five second video of a cat at a piano');
const madeMs = Math.floor(Date.now() / 3600e3) * 3600e3 - 2 * 3600e3 + 10 * 60e3; // ten minutes into an hour that is sealed
const hourSec = Math.floor(madeMs / 3600e3) * 3600, hourName = new Date(madeMs).toISOString().slice(0, 13);
const OUT = {id: 'vid_test-1', kind: 'video', model: 'pruna-video', status: 'ready', createdAt: new Date(madeMs).toISOString(), price: {micros: 150000}, seconds: 5, aspectRatio: '16:9', prompt: 'a cat at a piano'};
const receipts = [
  {hour: hourSec, kind: 'video', item: 'pruna-video', width: 0, height: 0, seconds: 5, characters: 0, creditsMicros: 150000, free: false, code: pad('77')},
  {hour: hourSec, kind: 'image', item: 'flux', width: 1024, height: 1024, seconds: 0, characters: 0, creditsMicros: 20000, free: false, code: pad('78')}];
const values = receipts.map(r => [1, r.hour, r.kind, r.item, r.width, r.height, r.seconds, r.characters, r.creditsMicros, r.free, r.code]);

function chain({root = StandardMerkleTree.of(values, RECEIPT).root, paidMs = madeMs + 20e3, micros = 105000} = {}) {
  return async (url, init = {}) => {
    url = String(url);
    if (url === `${TEXEL.api}/outputs/${OUT.id}`) return Response.json(OUT);
    if (url === `${TEXEL.api}/outputs/${OUT.id}/file`) return new Response(FILE, {headers: {'content-type': 'video/mp4'}});
    if (url === `${TEXEL.hours}/${hourName}.json`) return Response.json({receipts, seal: {txHash: '0x' + '9'.repeat(64)}});
    if (url.startsWith(`${TEXEL.hours}/`)) return new Response('no', {status: 404});
    if (init.method === 'POST' && init.body) {
      const {method, params} = JSON.parse(init.body), ok = result => Response.json({jsonrpc: '2.0', id: 1, result});
      if (method === 'eth_getTransactionReceipt') return ok(params[0] !== TX ? null : {status: '0x1', blockNumber: '0x10', logs: [
        {address: USDG, topics: [T_TRANSFER, pad(WALLET), pad(TEXEL.credits)], data: pad(micros.toString(16))},
        {address: USDG, topics: [T_AUTH_USED, pad(WALLET), pad('01')], data: '0x'}]});
      if (method === 'eth_getBlockByNumber') return ok({timestamp: '0x' + Math.floor(paidMs / 1000).toString(16)});
      if (method === 'eth_call') return ok(root + values.length.toString(16).padStart(64, '0') + '0'.repeat(64));
    }
    return new Response('not faked: ' + url, {status: 500});
  };
}
const withFetch = async (f, run) => { const keep = globalThis.fetch; globalThis.fetch = f; try { return await run(); } finally { globalThis.fetch = keep; } };
const tmp = mkdtempSync(join(tmpdir(), 'jazzcat-'));
const file = (name, bytes) => { const p = join(tmp, name); writeFileSync(p, bytes); return p; };

test('verify: the file, the wallet that paid and Texel\'s sealed receipt, with the root rebuilt as OpenZeppelin builds it', async () => {
  const p = await withFetch(chain(), () => verify(OUT.id, TX));
  assert.equal(p.ok, true); assert.equal(p.standard, 'texel-proof/1');
  assert.equal(p.file.sha256, createHash('sha256').update(FILE).digest('hex'));
  assert.equal(p.paid.wallet, WALLET); assert.equal(p.paid.usdgMicros, '105000');
  assert.equal(p.receipt.ok, true); assert.equal(p.receipt.rootMatchesChain, true); assert.equal(p.receipt.fits, 1);
  assert.match(p.says, new RegExp(`Wallet ${WALLET} paid 0.105 USDG`));
  const {id, says, checkedAt, ok, ...proof} = p;
  assert.equal(id, createHash('sha256').update(canonical(proof)).digest('hex'), 'the id is the sha256 of the canonical proof');
});

test('verify: a root that does not match the chain, a wrong price, a late payment, a bad tx', async () => {
  assert.equal((await withFetch(chain({root: pad('dead')}), () => verify(OUT.id, TX))).receipt.rootMatchesChain, false);
  assert.match((await withFetch(chain({micros: 1}), () => verify(OUT.id, TX))).why, /not this output's price/);
  assert.match((await withFetch(chain({paidMs: madeMs + 10 * 60e3}), () => verify(OUT.id, TX))).why, /more than 3 minutes/);
  assert.match((await withFetch(chain(), () => verify(OUT.id, '0x' + '00'.repeat(32)))).why, /not a successful/);
  assert.match((await verify('../etc/passwd', TX)).why, /output is the Texel output id/);
});

test('proof <file> <output> <tx>: holds only when your file is the one Texel serves', async () => {
  const same = await withFetch(chain(), () => proveFile(file('same.mp4', FILE), {output: OUT.id, tx: TX}));
  assert.equal(same.ok, true); assert.equal(same.sameFileAsTexel, true);
  const other = await withFetch(chain(), () => proveFile(file('other.mp4', new TextEncoder().encode('something else')), {output: OUT.id, tx: TX}));
  assert.equal(other.ok, false); assert.match(other.why, /fingerprints differ/); assert.equal(other.proof.ok, true);
});

test('proof <file>: its fingerprint, looked up in the public register', async () => {
  const p = file('piece.mp4', FILE), {sha256, bytes} = await fingerprint(p);
  assert.equal(bytes, FILE.length);
  const jsonl = [{n: 1, wallet: WALLET, file: {sha256}, output: {id: OUT.id}}, {n: 2, wallet: '0x' + '1'.repeat(40), file: {sha256: 'f'.repeat(64)}}].map(e => JSON.stringify(e)).join('\n') + '\nnot json\n';
  const reg = async u => String(u) === `${REGISTER}/register.jsonl` ? new Response(jsonl) : new Response('no', {status: 404});
  const hit = await withFetch(reg, () => proveFile(p));
  assert.equal(hit.ok, true); assert.equal(hit.registered[0].page, `${REGISTER}/c/1`); assert.match(hit.says, /Register entry #1/);
  const miss = await withFetch(reg, () => proveFile(file('new.png', new Uint8Array([1, 2, 3]))));
  assert.equal(miss.ok, false); assert.match(miss.next, /jazzcat proof <file> <output-id> <payment-tx>/);
  await assert.rejects(lookup('nope'), /sha256/);
});

test('lint: fields Texel ignores, sizes and lengths it does not take, and the price, before you pay', async () => {
  const models = [{id: 'pruna-video', kind: 'video', priceUsd: 0.15, unit: '5 seconds', videoSeconds: [5, 10], videoAspectRatios: ['16:9', '9:16']},
    {id: 'flux', kind: 'image', priceUsd: 0.02, unit: '1 megapixel', imageSizes: [{width: 1024, height: 1024}]}];
  const good = await lint({model: 'pruna-video', prompt: 'a cat at a piano', seconds: 10}, {models});
  assert.equal(good.ok, true); assert.equal(good.price.listUsd, 0.3); assert.equal(good.price.x402Usdg, 0.21);
  const bad = await lint('{"model":"pruna-video","prompt":"x","seconds":7,"duration":5}', {models});
  assert.equal(bad.ok, false); assert.ok(bad.problems.some(p => /ignores "duration"/.test(p))); assert.ok(bad.problems.some(p => /seconds must be one of 5, 10/.test(p)));
  assert.match((await lint({model: 'flux', prompt: 'x', width: 640, height: 480}, {models})).problems[0], /takes these sizes/);
  assert.match((await lint({model: 'nope'}, {models})).problems[0], /model must be one of/);
  assert.equal((await lint('not json', {models})).ok, false);
});
