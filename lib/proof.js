// jazzcat/proof (from texel-proof): open checks for Texel outputs (https://texel.run). No key, no account, no server of ours
// needed, no dependencies (the Merkle root is rebuilt by ./keccak.js, tested against @openzeppelin/merkle-tree).
//
//   verify(output, tx)  reads the output from Texel by its id, fingerprints its file (sha256), finds the USDG
//                       payment for it on Robinhood Chain and the wallet that signed it, and matches it to a receipt
//                       in Texel's own sealed hour, whose root it rebuilds and checks against the chain.
//   lint(body)          checks a POST /outputs body against Texel's live model list before you pay: fields Texel
//                       ignores without an error, sizes and lengths it does not take, and the price.
//
// What a proof says, and what it does not: Texel's receipts hold no file, no prompt and no wallet (a wallet code
// stands in its place), so the tie between an output and a wallet is the payment itself: USDG from that wallet to
// Texel Credits, signed by that wallet, at the output's price, within 3 minutes of it. That proves which wallet paid
// to make the file. It does not prove who wrote the prompt.
import {merkleRoot} from './keccak.js';

export const VERSION = 'texel-proof/1'; // the proof's format, unchanged from texel-proof, so ids stay the same
export const TEXEL = {
  api: 'https://texel.run/api/v1',
  hours: 'https://texel.run/receipts/hours',
  credits: '0x0f9ca8534fe3e2282d3e483861319381219445f0', // takes x402 payments for outputs
  receipts: '0x48c545fdd2ea5b286b319f03575683019c2f1ef5', // keeps the root of each hour of receipts
};
export const USDG = '0x5fc5360d0400a0fd4f2af552add042d716f1d168';
export const RPC = 'https://rpc.mainnet.chain.robinhood.com';
export const MAX_BYTES = 50 * 1024 * 1024;
export const WINDOW_MS = 3 * 60e3;

const T_TRANSFER = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const T_AUTH_USED = '0x98de503528ee59b575ef0c0a2576a82497bfc029a5685b209e9ec333479b10a5'; // EIP-3009 AuthorizationUsed
const SEALS = '0x7d75962b'; // seals(uint64) -> (bytes32 root, uint32 count, uint64 sealedAt)
const RECEIPT_TYPES = ['uint8', 'uint64', 'string', 'string', 'uint32', 'uint32', 'uint32', 'uint32', 'uint64', 'bool', 'bytes32'];
const FIELDS = new Set(['model', 'prompt', 'image', 'seconds', 'aspectRatio', 'width', 'height']);
const OUTPUT_ID = /^[A-Za-z0-9_-]{1,128}$/;
const TX = /^0x[0-9a-fA-F]{64}$/;

const enc = new TextEncoder();
const hex = b => [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('');
// Web Crypto: global in browsers, edge workers and Node 20+; on Node 18 it sits behind a flag, so it comes from node:crypto
// there (Codex, jazzcat #1).
let subtleP;
const subtle = () => subtleP ??= globalThis.crypto?.subtle ? Promise.resolve(globalThis.crypto.subtle) : import('node:crypto').then(m => m.webcrypto.subtle);
export const sha256 = async data => hex(await (await subtle()).digest('SHA-256', typeof data === 'string' ? enc.encode(data) : data));
const addr = topic => '0x' + topic.slice(26).toLowerCase();
const hourName = ms => new Date(ms).toISOString().slice(0, 13); // 2026-11-26T20

/** JSON with sorted keys, so the same proof always hashes to the same id. */
export function canonical(v) {
  if (Array.isArray(v)) return '[' + v.map(canonical).join(',') + ']';
  if (v && typeof v === 'object') return '{' + Object.keys(v).filter(k => v[k] !== undefined).sort().map(k => JSON.stringify(k) + ':' + canonical(v[k])).join(',') + '}';
  return JSON.stringify(v);
}

export const RPCS = [RPC, 'https://robinhood-rpc.publicnode.com', 'https://4663.rpc.thirdweb.com', 'https://robinhood.drpc.org'];

/** One JSON-RPC call to Robinhood Chain, trying the next public endpoint when one is busy or down. */
export async function rpc(method, params, url = RPC) {
  let last = 'no endpoint answered';
  for (const u of [...new Set([url, ...RPCS])]) {
    try {
      const r = await fetch(u, {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({jsonrpc: '2.0', id: 1, method, params}), signal: AbortSignal.timeout(15000)});
      const j = await r.json();
      if (j && 'result' in j) return j.result;
      last = j?.error?.message || `HTTP ${r.status}`;
    } catch (e) { last = String(e.message || e); }
  }
  throw new Error(`Robinhood Chain: ${last}`);
}

/** balanceOf(wallet) on an ERC-20 or ERC-721 contract, as a BigInt. */
export async function balanceOf(token, wallet, url = RPC) {
  const data = '0x70a08231' + wallet.toLowerCase().replace(/^0x/, '').padStart(64, '0');
  return BigInt(await rpc('eth_call', [{to: token, data}, 'latest'], url) || '0x0');
}

/** One Texel output by id: its record, then its file. Outputs paid with x402 need no key: the id is the key. */
export async function readOutput(id, {withFile = true} = {}) {
  if (!OUTPUT_ID.test(String(id || ''))) return {ok: false, why: 'output is the Texel output id, from POST /api/v1/outputs (vid_…, img_…, ast_…).'};
  const r = await fetch(`${TEXEL.api}/outputs/${id}`, {signal: AbortSignal.timeout(30000)}).catch(() => null);
  if (!r?.ok) return {ok: false, why: r?.status === 404 || r?.status === 401 ? 'Texel has no output with that id that opens without a key. Only outputs paid with x402 do.' : 'Texel did not answer; try again.'};
  const o = await r.json();
  const output = {id: o.id, kind: o.kind, model: o.model, status: o.status, createdAt: o.createdAt, priceMicros: Number(o.price?.micros ?? NaN),
    free: !!o.free, seconds: o.seconds, aspectRatio: o.aspectRatio, width: o.width, height: o.height, failure: o.failure || undefined};
  const prompt = typeof o.prompt === 'string' ? o.prompt : null;
  if (output.id !== id) return {ok: false, why: 'Texel answered for a different output.'};
  if (output.status !== 'ready') return {ok: false, why: `This output is ${output.status}${output.failure ? ` (${output.failure})` : ''}.`, output};
  if (!withFile) return {ok: true, output, prompt};
  const f = await fetch(`${TEXEL.api}/outputs/${id}/file`, {signal: AbortSignal.timeout(60000)}).catch(() => null);
  if (!f?.ok) return {ok: false, why: 'Texel did not give the file. Texel serves an output\'s file for 24 hours after it is made, so prove it within a day.', output};
  const bytes = await f.arrayBuffer();
  if (!bytes.byteLength || bytes.byteLength > MAX_BYTES) return {ok: false, why: bytes.byteLength ? 'The file is over 50 MB.' : 'The file is empty.', output};
  return {ok: true, output, prompt, file: {sha256: await sha256(bytes), bytes: bytes.byteLength, contentType: f.headers.get('content-type') || 'application/octet-stream'}};
}

/** The payment for an output on Robinhood Chain: USDG to Texel Credits, signed by the paying wallet (EIP-3009),
 *  at the output's list price or 30% off (Texel's launch price), within 3 minutes of the output. */
export async function checkPayment(tx, output, url = RPC) {
  if (!TX.test(String(tx || ''))) return {ok: false, why: 'tx is the payment transaction (0x…), from the PAYMENT-RESPONSE header of Texel\'s answer.'};
  const rc = await rpc('eth_getTransactionReceipt', [tx], url);
  if (!rc || rc.status !== '0x1') return {ok: false, why: 'That is not a successful Robinhood Chain transaction.'};
  const logs = rc.logs || [];
  const tr = logs.find(l => l.address?.toLowerCase() === USDG && l.topics?.[0] === T_TRANSFER && addr(l.topics[2]) === TEXEL.credits);
  if (!tr) return {ok: false, why: 'That transaction is not a USDG payment to Texel Credits.'};
  const wallet = addr(tr.topics[1]);
  if (!logs.some(l => l.address?.toLowerCase() === USDG && l.topics?.[0] === T_AUTH_USED && addr(l.topics[1]) === wallet)) return {ok: false, why: 'That payment was not signed by the paying wallet itself (x402 / EIP-3009).'};
  const value = BigInt(tr.data), list = BigInt(Math.round(output.priceMicros || 0));
  if (!(value > 0n && (value === list || value * 10n === list * 7n))) return {ok: false, why: `The payment (${value} USDG micros) is not this output's price (${list}, or 30% off at launch).`};
  const blk = await rpc('eth_getBlockByNumber', [rc.blockNumber, false], url);
  const paidAt = Number(BigInt(blk.timestamp)) * 1000, made = Date.parse(output.createdAt);
  if (Math.abs(paidAt - made) > WINDOW_MS) return {ok: false, why: 'That payment was not made at the time of this output (more than 3 minutes apart).'};
  return {ok: true, wallet, tx: tx.toLowerCase(), usdgMicros: String(value), block: Number(BigInt(rc.blockNumber)), paidAt: new Date(paidAt).toISOString()};
}

// One sealed hour of Texel's receipts, read and checked: its root rebuilt here and compared with the Receipts contract, and
// how many paid receipts in it fit the output (same kind, model, seconds and credits). sealed: false when Texel has not
// sealed it yet (it does a few minutes after the hour ends).
async function sealedHour(h, output, url) {
  const name = hourName(h), hourSec = Math.floor(h / 3600e3) * 3600;
  if (Date.now() < (hourSec + 3600) * 1000) return {hour: name, sealed: false};
  const j = await fetch(`${TEXEL.hours}/${name}.json`, {signal: AbortSignal.timeout(20000)}).then(r => r.json()).catch(() => null);
  if (!j?.receipts) return {hour: name, sealed: false};
  const values = j.receipts.map(r => [1, r.hour, r.kind, r.item, r.width, r.height, r.seconds, r.characters, r.creditsMicros, r.free, r.code]);
  const root = values.length ? merkleRoot(values, RECEIPT_TYPES) : '0x' + '0'.repeat(64);
  const res = await rpc('eth_call', [{to: TEXEL.receipts, data: SEALS + hourSec.toString(16).padStart(64, '0')}, 'latest'], url);
  const chainRoot = '0x' + res.slice(2, 66), chainCount = Number(BigInt('0x' + res.slice(66, 130)));
  const fits = j.receipts.filter(r => r.kind === output.kind && r.item === output.model && !r.free
    && (output.kind !== 'video' || r.seconds === (output.seconds || 5)) && r.creditsMicros === output.priceMicros);
  return {hour: name, sealed: true, receipts: j.receipts.length, rootMatchesChain: root === chainRoot && chainCount === values.length, fits: fits.length, sealTx: j.seal?.txHash};
}

/** Texel's sealed hour of receipts: rebuild its root, check it against the Receipts contract, and find the receipts
 *  that fit this output (same kind, model, seconds and credits, not free). Texel seals an hour a few minutes after it ends. */
export async function checkReceipt(output, url = RPC) {
  const made = Date.parse(output.createdAt);
  const tried = [];
  for (const h of [made, made + 3600e3]) { // an output's receipt lands in the hour it finishes
    const row = await sealedHour(h, output, url);
    tried.push(row);
    if (!row.sealed) { if (Date.now() < Math.floor(h / 3600e3) * 3600e3 + 3600e3) break; continue; }
    if (row.fits) return {ok: row.rootMatchesChain, ...row};
  }
  const last = tried[tried.length - 1];
  return {ok: false, ...last, why: last?.sealed === false ? 'Texel has not sealed this hour of receipts yet (it does a few minutes after the hour ends). Check again then.' : 'No receipt in Texel\'s sealed hours fits this output.'};
}

// How the payment is tied to this output. Texel's output record names no payment (no transaction, nonce or payer), so a
// payment that fits on price and time could be another output's (Codex, jazzcat #1). It is tied by elimination: any other
// paid output that this payment could belong to was made within WINDOW_MS of it and finished soon after, so its receipt
// is in a sealed hour overlapping [paidAt - WINDOW_MS, paidAt + WINDOW_MS + FINISH_MS]. When those hours hold exactly one
// paid receipt that fits (this output's own), the payment is this output's.
export const FINISH_MS = 15 * 60e3;
export async function tie(output, paid, url = RPC) {
  if (output.free) return {tied: false, why: 'Texel made this output free, so no payment paid for it.'};
  const from = Date.parse(paid.paidAt) - WINDOW_MS, to = Date.parse(paid.paidAt) + WINDOW_MS + FINISH_MS, hours = [];
  for (let h = Math.floor(from / 3600e3) * 3600e3; h <= to; h += 3600e3) hours.push(await sealedHour(h, output, url));
  const counted = hours.map(({hour, sealed, fits, rootMatchesChain}) => ({hour, sealed, fits: fits ?? null, rootMatchesChain: rootMatchesChain ?? null}));
  if (hours.some(x => !x.sealed)) return {tied: false, pending: true, hours: counted, why: 'Texel has not sealed every hour this payment could belong to yet (it seals each a few minutes after the hour ends). Check again then.'};
  if (hours.some(x => !x.rootMatchesChain)) return {tied: false, hours: counted, why: 'A sealed hour of Texel\'s receipts does not match the root on Robinhood Chain.'};
  const fits = hours.reduce((n, x) => n + x.fits, 0);
  if (fits === 1) return {tied: true, hours: counted, how: 'This is the only paid output of its kind, model, length and price in the sealed hours around the payment, so the payment is its own.'};
  return {tied: false, hours: counted, why: fits ? `${fits} paid outputs of this kind, model, length and price were made around this payment, so it can't be tied to this one output alone.` : 'No paid receipt in the sealed hours around this payment fits this output.'};
}

/** The whole proof for one output and its payment. ok is true only when the payment is tied to this output (tie above):
 *  the file, the payment, its timing, and Texel's sealed receipts all check. The proof itself (everything but ok, says,
 *  tie and checkedAt) is texel-proof's format, so its id does not change. */
export async function verify(outputId, tx, {url = RPC} = {}) {
  const o = await readOutput(outputId);
  if (!o.ok) return {ok: false, step: 'output', why: o.why};
  const pay = await checkPayment(tx, o.output, url);
  if (!pay.ok) return {ok: false, step: 'payment', why: pay.why};
  const receipt = await checkReceipt(o.output, url).catch(e => ({ok: false, why: String(e.message || e)}));
  const tied = await tie(o.output, pay, url).catch(e => ({tied: false, why: String(e.message || e)}));
  const out = o.output;
  const proof = {
    standard: VERSION,
    output: {id: out.id, kind: out.kind, model: out.model, seconds: out.seconds, aspectRatio: out.aspectRatio, width: out.width, height: out.height, createdAt: out.createdAt, priceMicros: out.priceMicros},
    file: o.file,
    prompt: o.prompt ? {sha256: await sha256(o.prompt), characters: o.prompt.length} : undefined,
    paid: pay,
    receipt,
  };
  const id = await sha256(canonical(proof));
  return {ok: tied.tied, id, ...(tied.tied ? {says: say(proof)} : {step: 'tie', why: tied.why, ...(tied.pending ? {pending: true} : {})}), tie: tied, ...proof, checkedAt: new Date().toISOString()};
}

export function say(p) {
  const r = p.receipt?.ok ? ` Texel's sealed receipts for ${p.receipt.hour}:00 UTC hold its receipt, the only paid one of its kind around the payment, and that hour's root matches Robinhood Chain.` : '';
  return `Wallet ${p.paid.wallet} paid ${Number(p.paid.usdgMicros) / 1e6} USDG on Robinhood Chain to make Texel output ${p.output.id} (${p.output.model}) at ${p.paid.paidAt}. The file Texel serves for it has sha256 ${p.file.sha256}.${r}`;
}

/** Check a POST /outputs body before paying. Returns {ok, problems[], notes[], price} against Texel's live models. */
export async function lint(body, {models} = {}) {
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { return {ok: false, problems: ['The body is not JSON.']}; } }
  const list = models || (await fetch(`${TEXEL.api}/models`, {signal: AbortSignal.timeout(15000)}).then(r => r.json())).data;
  const problems = [], notes = [];
  const m = list.find(x => x.id === body?.model);
  if (!m) return {ok: false, problems: [`model must be one of: ${list.map(x => x.id).join(', ')}.`]};
  for (const k of Object.keys(body)) if (!FIELDS.has(k)) problems.push(`Texel ignores "${k}" without an error, so your output would be made without it.`);
  const p = body.prompt;
  if (m.kind === '3d') {
    if (!body.image) problems.push(`${m.id} makes a 3D asset from an image: send "image", the id of one of your image outputs or a data URL of a PNG, JPEG or WebP.`);
    notes.push(`${m.id} runs about ${m.typicalSeconds} s. On 11-26 it timed out twice on 640–900 px PNGs; a failed output gives its credits back as Texel credit to the paying wallet, which only a texel.run sign-in can refund.`);
  } else {
    if (body.image !== undefined) problems.push(`Texel ignores "image" for ${m.kind} models (${m.id}); only 3D models take an image.`);
    if (typeof p !== 'string' || !p.trim()) problems.push('prompt is required.');
    else if (p.length > (m.kind === 'voice' ? 1000 : 2000)) problems.push(`prompt is ${p.length} characters; Texel takes up to ${m.kind === 'voice' ? '1,000 for a voice' : '2,000'}.`);
  }
  if (m.kind === 'video') {
    if (body.seconds !== undefined && !(m.videoSeconds || []).includes(body.seconds)) problems.push(`seconds must be one of ${(m.videoSeconds || []).join(', ')} for ${m.id}.`);
    if (body.aspectRatio !== undefined && m.videoAspectRatios && !m.videoAspectRatios.includes(body.aspectRatio)) problems.push(`aspectRatio must be one of ${m.videoAspectRatios.join(', ')} for ${m.id}.`);
  } else if (body.seconds !== undefined) problems.push(`Texel ignores "seconds" for ${m.kind} models.`);
  if ((body.width !== undefined || body.height !== undefined) && m.kind === 'image' && m.imageSizes && !m.imageSizes.some(s => s.width === body.width && s.height === body.height))
    problems.push(`${m.id} takes these sizes: ${m.imageSizes.map(s => `${s.width}x${s.height}`).join(', ')}.`);
  let units = 1;
  if (m.kind === 'video') units = (body.seconds || 5) / 5;
  else if (m.kind === 'voice') units = Math.max(1, Math.ceil((p || '').length / 1000));
  else if (m.unit === '1 megapixel') units = Math.max(1, ((body.width || 1024) * (body.height || 1024)) / 1e6);
  const list$ = +(m.priceUsd * units).toFixed(6);
  return {ok: problems.length === 0, model: m.id, kind: m.kind, problems, notes, price: {listUsd: list$, x402Usdg: +(list$ * 0.7).toFixed(6), basis: `${m.priceUsd} per ${m.unit} (x402 pays 30% off at launch)`}};
}

// ---- a file on your own machine (Node) -------------------------------------------------------------------------------
/** The public texel-proof register: numbered entries, fingerprints only, never files. */
export const REGISTER = 'https://texel-proof.departmentofjazz.workers.dev';

/** sha256 and size of a local file, read as a stream. */
export async function fingerprint(path) {
  const [{createReadStream}, {stat}, {createHash}] = await Promise.all([import('node:fs'), import('node:fs/promises'), import('node:crypto')]);
  const s = await stat(path);
  if (!s.isFile()) throw new Error(`Not a file: ${path}`);
  const h = createHash('sha256');
  for await (const chunk of createReadStream(path)) h.update(chunk);
  return {sha256: h.digest('hex'), bytes: s.size};
}

/** The register's entries for a file fingerprint (the first wallet to register a file holds it). */
export async function lookup(sha, {register = REGISTER} = {}) {
  if (!/^[0-9a-f]{64}$/.test(String(sha || ''))) throw new Error('lookup takes a sha256 in hex.');
  const r = await fetch(`${register}/register.jsonl`, {signal: AbortSignal.timeout(30000)});
  if (!r.ok) throw new Error(`The register answered ${r.status}.`);
  const out = [];
  for (const line of (await r.text()).split('\n')) {
    if (!line.trim()) continue;
    let e; try { e = JSON.parse(line); } catch { continue; }
    if (e?.file?.sha256 === sha) out.push({n: e.n, wallet: e.wallet, output: e.output, paid: e.paid, proof: e.proof, page: `${register}/c/${e.n}`});
  }
  return out;
}

/** Prove a local file. With {output, tx}: the whole proof, plus whether your file is the one Texel serves for that output.
 *  Without: the file's fingerprint and its entries in the public register. */
export async function proveFile(path, {output, tx, register = REGISTER} = {}) {
  const file = await fingerprint(path);
  if (output || tx) {
    const p = await verify(output, tx);
    if (!p.ok) return {ok: false, file, step: p.step, why: p.why};
    const same = p.file?.sha256 === file.sha256;
    return {ok: same, file, sameFileAsTexel: same, ...(same ? {says: p.says} : {why: 'Your file is not the file Texel serves for this output: their fingerprints differ.'}), proof: p};
  }
  const registered = await lookup(file.sha256, {register});
  if (!registered.length) return {ok: false, file, registered, why: 'This file is not in the public register.', next: 'jazzcat proof <file> <output-id> <payment-tx> proves it from Texel and Robinhood Chain.'};
  const e = registered[0];
  return {ok: true, file, registered, says: `Register entry #${e.n}: wallet ${e.wallet} registered this file (Texel output ${e.output?.id ?? '?'}). ${e.page}`};
}
