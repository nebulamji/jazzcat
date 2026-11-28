// jazzcat city: New Jazz City in your terminal, read only (plan "Cats enter the City" P4-18; spec section 1).
// A map of the City's places, the Cats and agents seen at each from what really happened on chain, a live feed, and a
// command line: /look cat 1, /jobs, /go bank, /mode cat 1, /help. Data only from the City's own public feeds and its MCP:
//   - the 15-minute push, newjazzcity.pages.dev/city/mainnet-economy.json (decoded events, the Cats, the watch list);
//   - the live tail, newjazzcity.pages.dev/api/city/tail?from=N (raw chain logs, seconds old, one shared read per window);
//   - the MCP (cat_self, jobs_board, cat_mode, city_map) for /look and friends.
// Nothing here signs, pays or posts. No dependencies. Pure helpers below; bin/jazzcat.mjs runs the screen.

export const ECONOMY_URL = 'https://newjazzcity.pages.dev/city/mainnet-economy.json';
export const TAIL_URL = 'https://newjazzcity.pages.dev/api/city/tail';
export const MAP_URL = 'https://newjazzcity.pages.dev/city/';
export const USDG = '0x5fc5360d0400a0fd4f2af552add042d716f1d168';
const TRANSFER = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
export const LIVE_MS = 15 * 60 * 1000, RECENT_MS = 6 * 60 * 60 * 1000;

// The places, in a 4 by 4 grid (the open city's landmarks; the last four aren't drawn on the browser map yet).
export const PLACES = [
  {id: 'stage-door', name: 'Stage Door'}, {id: 'bank', name: 'Bank of Music'}, {id: 'title-gate', name: 'Title Gate'}, {id: 'call-book', name: 'The Call Book'},
  {id: 'gig-board', name: 'City Jobs'}, {id: 'bull-square', name: 'Bull Square'}, {id: 'market', name: 'Market Desk'}, {id: 'credit', name: 'Credit Bureau'},
  {id: 'holders', name: 'Holders Hall'}, {id: 'treasury', name: 'Jazz Treasury'}, {id: 'label', name: 'The Label'}, {id: 'risk', name: 'Risk & Reward'},
  {id: 'launchpads', name: 'Launchpads'}, {id: 'guard-post', name: 'Guard Post'}, {id: 'airport', name: 'The Airport'}, {id: 'portal', name: 'The Portal'},
];
const NAME = new Map(PLACES.map(p => [p.id, p.name]));
// Which place an event happens at, by its kind (the open city's event kinds, plus the tail's USDG payments).
export const KIND_PLACE = {'call-sealed': 'call-book', 'call-revealed': 'call-book', 'call-settled': 'call-book', 'job-paid': 'gig-board',
  'cat-spent': 'bank', 'pay-in': 'bank', 'network-pay': 'bank', 'cat-wallet': 'stage-door'};
export const placeOf = e => e?.place && NAME.has(e.place) ? e.place : KIND_PLACE[e?.kind] || 'stage-door';
export const placeName = id => NAME.get(id) || id;
export function findPlace(q) {
  const s = String(q || '').trim().toLowerCase().replace(/^the /, '');
  return PLACES.find(p => p.id === s || p.name.toLowerCase().replace(/^the /, '') === s) || PLACES.find(p => s && p.name.toLowerCase().includes(s)) || null;
}

const short = a => a ? `${String(a).slice(0, 6)}…${String(a).slice(-4)}` : '?';
const word = t => '0x' + String(t || '').slice(-40).toLowerCase();
const usdg = hex => { try { return Number(BigInt(hex)) / 1e6; } catch { return 0; } };
const fmt = n => n >= 100 ? n.toFixed(0) : n >= 1 ? n.toFixed(2) : n.toFixed(4).replace(/0+$/, '').replace(/\.$/, '');

// Everything shown in a terminal comes from the network (job titles are written by posters), so every string is cleaned
// first: no C0/C1 control characters (ESC sequences could clear the screen or plant a clickable link), no zero-width or
// bidirectional-override characters (look-alike text). Review 11-28.
export const clean = v => String(v ?? '').replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]/g, '');
// Transfers under a cent are not business: anyone can move 0 USDG "from" any wallet (transferFrom needs no allowance for
// 0), which is address poisoning, not a payment.
export const DUST_USDG = 0.01;

// The tail's raw logs → the payments that touched a Cat's own wallet (USDG in or out), one event per transaction, Cat and
// direction with the amounts summed (a batch pays in many logs). Everything else is left to the 15-minute push, which
// decodes it the City's way; where both describe the same payment, the push's event wins (mergeEvents).
export function decodeTail(tail) {
  const byWallet = new Map(Object.entries(tail?.catWallets || {}).map(([n, w]) => [String(w).toLowerCase(), Number(n)]));
  const agg = new Map();
  for (const l of tail?.logs || []) {
    if (String(l.address).toLowerCase() !== USDG || l.topics?.[0] !== TRANSFER) continue;
    const from = word(l.topics[1]), to = word(l.topics[2]), amount = usdg(l.data);
    if (!(amount > 0)) continue;
    let block; try { block = Number(BigInt(l.blockNumber)); } catch { continue; }
    const inCat = byWallet.get(to), outCat = byWallet.get(from), cat = inCat ?? outCat; if (cat == null || (inCat && outCat)) continue;
    const dir = inCat ? 'in' : 'out', k = `${l.transactionHash}|${cat}|${dir}`;
    const e = agg.get(k) || {dir, token: cat, amount: 0, parties: new Set(), tx: l.transactionHash, block, time: tail.times?.[block] ?? null};
    e.amount += amount; e.parties.add(dir === 'in' ? from : to); agg.set(k, e);
  }
  const out = [];
  for (const e of agg.values()) {
    if (e.amount < DUST_USDG) continue;
    const who = e.parties.size === 1 ? short([...e.parties][0]) : `${e.parties.size} wallets`;
    out.push(e.dir === 'in'
      ? {kind: 'pay-in', src: 'tail', token: e.token, amount: e.amount, asset: 'USDG', tx: e.tx, block: e.block, time: e.time, line: `JazzCat #${e.token} was paid ${fmt(e.amount)} USDG by ${who}`}
      : {kind: 'cat-spent', src: 'tail', token: e.token, amount: e.amount, asset: 'USDG', tx: e.tx, block: e.block, time: e.time, line: `JazzCat #${e.token} spent ${fmt(e.amount)} USDG → ${who}`});
  }
  return out;
}

// One list of events, newest first, each payment once, at most `keep`. A payment is its tx, its Cat and its direction
// (paid in: pay-in, job-paid, network-pay; out: cat-spent); when the push and the tail both have it, the push's event wins
// (it names the payer and what it was for). Other events are keyed by tx, kind and Cat.
const IN_KINDS = new Set(['pay-in', 'job-paid', 'network-pay']);
const eventKey = e => IN_KINDS.has(e.kind) ? `${e.tx}|${e.token ?? ''}|in` : e.kind === 'cat-spent' ? `${e.tx}|${e.token ?? ''}|out` : `${e.tx}|${e.kind}|${e.token ?? ''}`;
export function mergeEvents(list, add, keep = 300) {
  const by = new Map();
  for (const e of [...(list || []), ...(add || [])]) {
    const k = eventKey(e), had = by.get(k);
    if (!had || (had.src === 'tail' && e.src !== 'tail')) by.set(k, e);
  }
  return [...by.values()].sort((a, b) => (b.block || 0) - (a.block || 0)).slice(0, keep);
}

// Who is where now: each actor at the place of its last action in the live window.
export function presence(events, now = Date.now(), windowMs = LIVE_MS) {
  const at = new Map(), seen = new Set();
  for (const e of events || []) {
    if (!e.time || now - e.time > windowMs) continue;
    const who = e.token != null ? `#${e.token}` : e.agent ? String(e.agent).slice(0, 10) : null;
    if (!who || seen.has(who)) continue; seen.add(who);
    const p = placeOf(e); if (!at.has(p)) at.set(p, []); at.get(p).push(who);
  }
  return at;
}

const clip = (s, n) => { s = clean(s); return s.length <= n ? s.padEnd(n) : s.slice(0, Math.max(0, n - 1)) + '…'; };
export const hhmm = t => { const d = new Date(Number(t)); return t && Number.isFinite(d.getTime()) ? d.toISOString().slice(11, 16) : '--:--'; };

// One frame of the screen, as plain text (lines joined by \n). state: {events, head, catCount, notes, input}.
export function render(state, {width = 80, height = 24, now = Date.now()} = {}) {
  const w = Math.max(60, width), inner = w - 2, colW = Math.floor(inner / 4), at = presence(state.events, now);
  // Who acted in the last 6 hours but not the last 15 minutes shows dim, as ~#1, at the place of its last action.
  const liveWho = new Set([...at.values()].flat()), seen = presence(state.events, now, RECENT_MS);
  for (const [p, who] of seen) for (const x of who) if (!liveWho.has(x)) { if (!at.has(p)) at.set(p, []); at.get(p).push('~' + x); }
  const recent = new Set([...seen.values()].flat()).size;
  const top = ` New Jazz City · Robinhood Chain · block ${state.head ? Number(state.head).toLocaleString('en-US') : '…'} · ${liveWho.size} live now · ${recent} seen in 6 h `;
  const bar = label => ('─' + label).padEnd(inner, '─').slice(0, inner);
  const lines = ['┌' + bar(top) + '┐'];
  for (let r = 0; r < 4; r++) {
    const row = PLACES.slice(r * 4, r * 4 + 4);
    lines.push('│' + clip(row.map(p => clip(' ' + p.name, colW)).join(''), inner) + '│');
    lines.push('│' + clip(row.map(p => clip('  ' + (at.get(p.id) || []).join(' '), colW)).join(''), inner) + '│');
  }
  lines.push('├' + bar(' feed ') + '┤');
  const notes = (state.notes || []).slice(-3);
  const room = Math.max(3, height - lines.length - 3 - notes.length);
  const feed = (state.events || []).slice(0, room).map(e => `${hhmm(e.time)} ${clip(placeName(placeOf(e)), 14)} ${e.line || e.kind}`);
  for (const l of feed) lines.push('│' + clip(' ' + l, inner) + '│');
  for (let i = feed.length; i < room; i++) lines.push('│' + ' '.repeat(inner) + '│');
  for (const n of notes) lines.push('│' + clip(' » ' + n, inner) + '│');
  lines.push('├' + '─'.repeat(inner) + '┤');
  lines.push('│' + clip(' > ' + (state.input || ''), inner) + '│');
  lines.push('└' + '─'.repeat(inner) + '┘');
  return lines.join('\n');
}

// The command line: "/look cat 12", "/jobs", "/go bank", "/mode cat 1", "/help", "/quit"; anything else is chat (later).
export function parseCommand(line) {
  const t = String(line || '').trim();
  if (!t) return null;
  if (!t.startsWith('/')) return {cmd: 'say', text: t};
  const [c, ...rest] = t.slice(1).split(/\s+/), arg = rest.join(' ');
  const cat = (arg.match(/^(?:cat\s*)?#?(\d{1,4})$/i) || [])[1];
  switch (c.toLowerCase()) {
    case 'look': return cat ? {cmd: 'look-cat', cat: Number(cat)} : arg ? {cmd: 'look-place', place: arg} : {cmd: 'help'};
    case 'jobs': return {cmd: 'jobs', lane: arg || null};
    case 'go': return {cmd: 'go', place: arg};
    case 'mode': return cat ? {cmd: 'mode', cat: Number(cat)} : {cmd: 'help'};
    case 'map': return {cmd: 'map'};
    case 'help': case '?': return {cmd: 'help'};
    case 'quit': case 'exit': case 'q': return {cmd: 'quit'};
    default: return {cmd: 'unknown', text: t};
  }
}
export const HELP = ['/look cat 1 · a Cat: holder, wallet, record', '/look bank · what happened at a place', '/jobs [lane] · open paid work',
  '/mode cat 1 · auto or manual', '/go <place> · center on a place', '/map · the browser map', '/quit'];

// Run one command against the MCP (an object with call(name, args), like jazzcat's NewJazzCity). Returns note lines.
export async function runCommand(c, {city, state}) {
  if (!c) return [];
  if (c.cmd === 'help') return HELP;
  if (c.cmd === 'say') return ['Chat opens later. Commands start with / (try /help).'];
  if (c.cmd === 'unknown') return [`Unknown: ${c.text}. Try /help.`];
  if (c.cmd === 'map') return [`The browser map: ${MAP_URL}`];
  if (c.cmd === 'go' || c.cmd === 'look-place') {
    const p = findPlace(c.place); if (!p) return [`No place "${c.place}". Places: ${PLACES.map(x => x.name).join(', ')}.`];
    const here = (state?.events || []).filter(e => placeOf(e) === p.id).slice(0, 3).map(e => `${hhmm(e.time)} ${e.line || e.kind}`);
    return [`${p.name}${here.length ? '' : ': nothing seen here lately.'}`, ...here];
  }
  if (c.cmd === 'look-cat') {
    const s = await city.call('cat_self', {cat: c.cat});
    const id = s.identity || {}, rec = s.record || {};
    return [`JazzCat #${c.cat} · agent ${id.agent ?? '?'} · wallet ${id.wallet || '?'}`,
      `holder ${id.holder || 'reading…'} · paid work ${rec.paidWork?.rows ?? '?'} rows, ${rec.paidWork?.usdgReported ?? '?'} USDG reported`];
  }
  if (c.cmd === 'jobs') {
    const b = await city.call('jobs_board', c.lane ? {lane: c.lane} : {});
    const jobs = b.jobs || b.open || b.board || [];
    return jobs.length ? jobs.slice(0, 4).map(j => clip(`${j.pay || j.amount || ''} ${j.asset || ''} · ${j.title || j.id || 'job'}`.trim(), 100)) : ['No open jobs right now.'];
  }
  if (c.cmd === 'mode') {
    const m = await city.call('cat_mode', {cat: c.cat});
    const n = m.now || {};
    return [`JazzCat #${c.cat}: ${n.mode || '?'}${n.jobs?.lanes?.length ? ' · lanes ' + [].concat(n.jobs.lanes).join(', ') : ''}${n.sets?.length ? ' · ' + n.sets.length + ' schedule(s)' : ''}`];
  }
  return [];
}
