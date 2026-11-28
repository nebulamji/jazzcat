// jazzcat city: the tail's Cat payments decoded, events merged once, who is where (live and earlier), the frame, the command
// line and its commands, and the command itself in line mode and screen mode from a fixture (no network).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {decodeTail, mergeEvents, presence, render, parseCommand, runCommand, placeOf, findPlace, PLACES, USDG, hhmm, clean, fullAddresses, lineOf} from '../lib/city.js';

const BIN = new URL('../bin/jazzcat.mjs', import.meta.url).pathname;
const T = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef', pad = a => '0x' + a.slice(2).toLowerCase().padStart(64, '0');
const CAT1 = '0x1479be07e26976fd712db34f7bc1b8ac523f806e', OTHER = '0x' + '7'.repeat(40), NOW = Date.UTC(2026, 10, 28, 1, 0);
const tail = {head: 200, to: 199, catWallets: {1: CAT1}, times: {100: NOW - 60000, 101: NOW - 30000},
  logs: [{address: USDG, topics: [T, pad(OTHER), pad(CAT1)], data: '0x' + (1_500_000).toString(16), transactionHash: '0xa', blockNumber: '0x64'},
    {address: USDG, topics: [T, pad(CAT1), pad(OTHER)], data: '0x' + (250_000).toString(16), transactionHash: '0xb', blockNumber: '0x65'},
    {address: USDG, topics: [T, pad(OTHER), pad('0x' + '8'.repeat(40))], data: '0x1', transactionHash: '0xc', blockNumber: '0x65'},
    {address: '0x' + '9'.repeat(40), topics: [T, pad(OTHER), pad(CAT1)], data: '0x1', transactionHash: '0xd', blockNumber: '0x65'}]};

test('the tail: USDG paid to or spent by a Cat\'s own wallet; other transfers and fake tokens are not', () => {
  const ev = decodeTail(tail);
  assert.equal(ev.length, 2);
  assert.deepEqual([ev[0].kind, ev[0].token, ev[0].amount, ev[0].time], ['pay-in', 1, 1.5, NOW - 60000]);
  assert.match(ev[0].line, /JazzCat #1 was paid 1\.50 USDG by 0x7{40}$/, 'the payer in full');
  assert.deepEqual([ev[1].kind, ev[1].amount], ['cat-spent', 0.25]); assert.match(ev[1].line, /spent 0\.25 USDG/);
  assert.deepEqual(decodeTail({}), []);
});

test('events merge once, newest first; each kind has its place', () => {
  const a = decodeTail(tail), m = mergeEvents(a, a);
  assert.equal(m.length, 2); assert.equal(m[0].tx, '0xb');
  assert.equal(placeOf({kind: 'call-sealed'}), 'call-book'); assert.equal(placeOf({kind: 'job-paid'}), 'gig-board');
  assert.equal(placeOf({kind: 'pay-in'}), 'bank'); assert.equal(placeOf({kind: 'mystery'}), 'stage-door'); assert.equal(placeOf({kind: 'x', place: 'portal'}), 'portal');
  assert.equal(findPlace('bank')?.id, 'bank'); assert.equal(findPlace('call book')?.id, 'call-book'); assert.equal(findPlace('the title gate')?.id, 'title-gate'); assert.equal(findPlace('moon'), null);
});

test('who is where: the place of each actor\'s last action in the window; old events don\'t count', () => {
  const ev = [{token: 1, kind: 'call-sealed', time: NOW - 60000, block: 3}, {token: 1, kind: 'pay-in', time: NOW - 120000, block: 2}, {token: 2, kind: 'job-paid', time: NOW - 3600e3, block: 1}];
  const at = presence(ev, NOW);
  assert.deepEqual([...at.entries()], [['call-book', ['#1']]]);
  assert.deepEqual([...presence(ev, NOW, 2 * 3600e3).entries()], [['call-book', ['#1']], ['gig-board', ['#2']]]);
});

test('the frame: every place, live and earlier actors, the feed, the prompt; every line the same width', () => {
  const state = {head: 124663901, events: [{token: 1, kind: 'call-sealed', time: NOW - 60000, block: 3, line: 'JazzCat #1 sealed a call'},
    {token: 2, kind: 'job-paid', time: NOW - 3600e3, block: 1, line: 'JazzCat #2 was paid for a job'}], notes: ['hello'], input: '/look cat 1'};
  for (const width of [60, 80, 120]) {
    const f = render(state, {width, height: 30, now: NOW}), lines = f.split('\n');
    assert.ok(lines.every(l => [...l].length === width), `width ${width}`);
    for (const p of PLACES) assert.ok(f.includes(p.name.slice(0, 10)), p.name);
  }
  const f = render(state, {width: 100, height: 30, now: NOW});
  assert.match(f, /124,663,901 · 1 live now · 2 seen in 6 h/); assert.match(f, / #1 /); assert.match(f, /~#2/);
  assert.match(f, /The Call Book +JazzCat #1 sealed a call/); assert.match(f, /» hello/); assert.match(f, /> \/look cat 1/);
});

test('the command line', () => {
  assert.deepEqual(parseCommand('/look cat 12'), {cmd: 'look-cat', cat: 12});
  assert.deepEqual(parseCommand('/look #3'), {cmd: 'look-cat', cat: 3});
  assert.deepEqual(parseCommand('/look bank'), {cmd: 'look-place', place: 'bank'});
  assert.deepEqual(parseCommand('/jobs qa'), {cmd: 'jobs', lane: 'qa'});
  assert.deepEqual(parseCommand('/mode cat 1'), {cmd: 'mode', cat: 1});
  assert.deepEqual(parseCommand('hello city'), {cmd: 'say', text: 'hello city'});
  assert.equal(parseCommand('/q').cmd, 'quit'); assert.equal(parseCommand('/dance').cmd, 'unknown'); assert.equal(parseCommand('  '), null);
});

test('commands read through the MCP and say plainly what they found; nothing signs', async () => {
  const calls = [], city = {call: async (name, args) => { calls.push(name);
    if (name === 'cat_self') return {identity: {agent: 26026, wallet: CAT1, holder: '0xFf12'}, record: {paidWork: {rows: 4, usdgReported: 8}}};
    if (name === 'jobs_board') return {jobs: [{pay: '1', asset: 'USDG', title: 'A wallet safety read'}]};
    if (name === 'cat_mode') return {now: {mode: 'auto', jobs: {lanes: ['qa', 'reads']}, sets: []}};
    throw Error('unexpected ' + name); }};
  assert.match((await runCommand({cmd: 'look-cat', cat: 1}, {city}))[0], /JazzCat #1 · agent 26026/);
  assert.match((await runCommand({cmd: 'jobs'}, {city}))[0], /1 USDG · A wallet safety read/);
  assert.match((await runCommand({cmd: 'mode', cat: 1}, {city}))[0], /JazzCat #1: auto · lanes qa, reads/);
  assert.match((await runCommand({cmd: 'say', text: 'hi'}, {city}))[0], /Chat opens later/);
  assert.match((await runCommand({cmd: 'go', place: 'moon'}, {city}))[0], /No place/);
  assert.deepEqual(calls, ['cat_self', 'jobs_board', 'cat_mode']);
});

test('jazzcat city --once: line mode and screen mode from a fixture, no network', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jc-city-')), file = path.join(dir, 'fixture.json');
  fs.writeFileSync(file, JSON.stringify({economy: {asOfBlock: 99, events: [{kind: 'call-sealed', token: 3, tx: '0xe', block: 98, time: Date.now() - 60000, line: 'JazzCat #3 sealed a call'}]}, tail: {...tail, times: {100: Date.now() - 30000, 101: Date.now() - 20000}}}));
  const env = {...process.env, JAZZCAT_CITY_FIXTURE: file};
  const line = spawnSync(process.execPath, [BIN, 'city', '--once', '--line'], {encoding: 'utf8', timeout: 20000, env});
  assert.equal(line.status, 0, line.stderr);
  assert.match(line.stdout, /New Jazz City · Robinhood Chain · block 200/);
  assert.match(line.stdout, /The Call Book +JazzCat #3 sealed a call/); assert.match(line.stdout, /Bank of Music +JazzCat #1 was paid 1\.50 USDG/);
  const help = spawnSync(process.execPath, [BIN, 'help'], {encoding: 'utf8', timeout: 20000});
  assert.match(help.stdout + help.stderr, /npx jazzcat city/);
});

test('review 11-28: network strings are cleaned before they reach a terminal (no ESC, OSC links, zero-width)', () => {
  const evil = 'Claim \x1b]8;;https://evil.example/claim\x07your $JAZZ\x1b]8;;\x07\x1b[2J​‮';
  const f = render({events: [{kind: 'job-paid', token: 1, time: NOW - 1000, block: 1, line: evil}], notes: [evil], input: ''}, {width: 100, height: 26, now: NOW});
  assert.doesNotMatch(f, /[\x1b\x07​‮]/); assert.match(f, /Claim ]8;;https:\/\/evil\.example\/claimyour \$JAZZ]8;;\[2J/);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jc-city-')), file = path.join(dir, 'f.json');
  fs.writeFileSync(file, JSON.stringify({economy: {asOfBlock: 1, events: [{kind: 'job-paid', token: 1, tx: '0xe', block: 1, time: Date.now(), line: evil}]}, tail: {logs: []}}));
  const r = spawnSync(process.execPath, [BIN, 'city', '--once', '--line'], {encoding: 'utf8', timeout: 20000, env: {...process.env, JAZZCAT_CITY_FIXTURE: file}});
  assert.equal(r.status, 0); assert.doesNotMatch(r.stdout, /[\x1b\x07]/);
});
test('review 11-28: zero and sub-cent transfers are not payments; a batch is one payment; the push\'s event wins', () => {
  const log = (from, to, amt, tx, block = '0x64') => ({address: USDG, topics: [T, pad(from), pad(to)], data: '0x' + amt.toString(16), transactionHash: tx, blockNumber: block});
  const t = {catWallets: {1: CAT1}, times: {100: NOW}, logs: [log(OTHER, CAT1, 0, '0xz1'), log(CAT1, '0x' + '5'.repeat(40), 0, '0xz2'), log(OTHER, CAT1, 9_000, '0xdust'),
    log(OTHER, CAT1, 700_000, '0xbatch'), log('0x' + '6'.repeat(40), CAT1, 700_000, '0xbatch'), log(OTHER, CAT1, 600_000, '0xbatch')]};
  const ev = decodeTail(t);
  assert.equal(ev.length, 1, 'zero-value and dust gone; the batch is one event');
  assert.equal(ev[0].tx, '0xbatch'); assert.equal(Math.round(ev[0].amount * 1e6), 2_000_000); assert.match(ev[0].line, /paid 2\.00 USDG by 2 wallets/);
  const push = {kind: 'job-paid', token: 1, tx: '0xbatch', block: 100, time: NOW, line: 'JazzCat #1 was paid 2 USDG by Bucks for a read'};
  for (const m of [mergeEvents([push], ev), mergeEvents(ev, [push])]) { assert.equal(m.length, 1); assert.equal(m[0].line, push.line); }
});
test('review 11-28: a bad time never throws, and SIGTERM restores the terminal', async () => {
  assert.doesNotThrow(() => render({events: [{kind: 'pay-in', token: 1, time: 1e20, block: 1, line: 'x'}], notes: [], input: ''}, {width: 80, height: 24, now: NOW}));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jc-city-')), file = path.join(dir, 'f.json');
  fs.writeFileSync(file, JSON.stringify({economy: {asOfBlock: 1, events: []}, tail: {logs: []}}));
  // A real pseudo-terminal (util-linux script) of its own, logged to a file: wait for the first frame (the alternate screen),
  // not a fixed sleep, then SIGTERM the city (script's child). The screen must come back, and the exit is 143, not 0.
  const out = path.join(dir, 'out.txt');
  const r = spawnSync('bash', ['-c', `script -qfec '${process.execPath} ${BIN} city' ${out} >/dev/null </dev/null & p=$!; for i in $(seq 1 150); do grep -q $'\\x1b\\[?1049h' ${out} 2>/dev/null && break; sleep 0.1; done; kill -TERM $(pgrep -P $p); wait $p; echo EXIT=$?; cat ${out}`], {encoding: 'utf8', timeout: 30000, env: {...process.env, JAZZCAT_CITY_FIXTURE: file, TERM: 'xterm'}});
  assert.match(r.stdout, /EXIT=143/, 'a SIGTERM exits 143, not 0');
  assert.match(r.stdout, /\x1b\[\?1049h/, 'entered the alternate screen'); assert.match(r.stdout, /\x1b\[\?25h\x1b\[\?1049l/, 'and left it on SIGTERM');
});

test('review round 2: two spends in one tx stay two; a Cat-to-Cat payment shows on both Cats; calls in one tx stay apart; dust by exact cents; ISO and future times', () => {
  const p1 = {kind: 'cat-spent', token: 1, tx: '0x6b', to: '0xd893', block: 5, time: NOW, line: 'spent 0.01'}, p2 = {kind: 'cat-spent', token: 1, tx: '0x6b', to: '0xf425', block: 5, time: NOW, line: 'spent 4.99'};
  assert.equal(mergeEvents([p1, p2], []).length, 2, 'two push spends in one tx');
  const c1 = {kind: 'call-sealed', token: 1, tx: '0x7c', callId: 300320, block: 6}, c2 = {kind: 'call-sealed', token: 1, tx: '0x7c', callId: 300321, block: 6};
  assert.equal(mergeEvents([c1, c2], []).length, 2, 'two calls in one tx');
  const CAT2 = '0x' + '2'.repeat(40), log = (from, to, amt, tx) => ({address: USDG, topics: [T, pad(from), pad(to)], data: '0x' + amt.toString(16), transactionHash: tx, blockNumber: '0x64'});
  const cc = decodeTail({catWallets: {1: CAT1, 2: CAT2}, times: {100: NOW}, logs: [log(CAT2, CAT1, 5_000_000, '0xcc')]});
  assert.deepEqual(cc.map(e => [e.kind, e.token]).sort(), [['cat-spent', 2], ['pay-in', 1]]);
  assert.match(cc.find(e => e.kind === 'pay-in').line, /paid 5\.00 USDG by JazzCat #2/);
  const cents = decodeTail({catWallets: {1: CAT1}, times: {100: NOW}, logs: [log(OTHER, CAT1, 1000, '0xd'), log(OTHER, CAT1, 2000, '0xd'), log(OTHER, CAT1, 7000, '0xd')]});
  assert.equal(cents.length, 1, 'exactly one cent is not dust');
  assert.equal(decodeTail({catWallets: {1: CAT1}, logs: [log(CAT1, CAT1, 5_000_000, '0xs')]}).length, 0, 'a self-transfer is nothing');
  assert.equal(hhmm('2026-11-28T10:00:00Z'), '10:00'); assert.equal(hhmm(Date.UTC(2026, 10, 28, 9, 30)), '09:30'); assert.equal(hhmm('nope'), '--:--');
  assert.equal(presence([{token: 1, kind: 'pay-in', time: NOW + 3600e3}], NOW).size, 0, 'a future-dated event is not live');
  assert.equal(clean('a­b؜c\u{e0041}d️e'), 'abcde');
});


// Addresses in full (address poisoning, the City's rule): never 0x1479…806e in anything we print.
const SHORTENED = /0x[0-9a-fA-F]{2,10}(?:…|\.\.\.)/, PARTIAL = /0x[0-9a-fA-F]{1,39}(?![0-9a-fA-F])/;
test('addresses in full: the push\'s short forms become the event\'s own full address, or "a wallet"; the tail never shortens', () => {
  const spent = {kind: 'cat-spent', token: 1, from: CAT1, to: '0x0409f370a3c1127cd99eb99aab912bdd00f4048b', line: 'JazzCat #1 spent 1 USDG → 0x0409…048b'};
  assert.equal(lineOf(spent), 'JazzCat #1 spent 1 USDG → 0x0409f370a3c1127cd99eb99aab912bdd00f4048b');
  const opened = {kind: 'cat-wallet', token: 1, wallet: CAT1, line: "JazzCat #1's own wallet is open on chain (0x1479…806e)"};
  assert.equal(lineOf(opened), `JazzCat #1's own wallet is open on chain (${CAT1})`);
  assert.equal(fullAddresses('paid 0xdead…beef and 0x1479...806e', {to: CAT1}), `paid a wallet and ${CAT1}`, 'no field fits: never guessed');
  assert.equal(fullAddresses('to 0x1479…806e', {a: CAT1, b: CAT1.toUpperCase().replace('0X', '0x')}), `to ${CAT1}`, 'the same address twice is one');
  for (const e of decodeTail(tail)) assert.doesNotMatch(e.line, SHORTENED);
});
test('addresses in full: a frame cuts before an address, never inside it, at any width', () => {
  const ev = [{kind: 'cat-spent', token: 1, tx: '0x1', block: 2, time: NOW - 1000, to: '0x0409f370a3c1127cd99eb99aab912bdd00f4048b', line: 'JazzCat #1 spent 1 USDG → 0x0409…048b'},
    {kind: 'pay-in', token: 1, tx: '0x' + 'ab'.repeat(32), block: 1, time: NOW - 2000, line: `JazzCat #1 was paid 2 USDG by ${OTHER} in 0x${'ab'.repeat(32)}`}];
  for (const width of [60, 72, 80, 100, 140]) {
    const f = render({events: ev, notes: [`wallet ${CAT1}`], input: ''}, {width, height: 26, now: NOW});
    assert.doesNotMatch(f, SHORTENED, `width ${width}`); assert.doesNotMatch(f, PARTIAL, `width ${width}: a cut address`);
    assert.ok(f.split('\n').every(l => [...l].length === width), `width ${width}`);
  }
  assert.match(render({events: ev, notes: [], input: ''}, {width: 140, height: 26, now: NOW}), /→ 0x0409f370a3c1127cd99eb99aab912bdd00f4048b/);
  assert.equal(presence([{agent: OTHER, kind: 'network-pay', time: NOW}], NOW).size, 0, 'an agent with no name is not placed by an address prefix');
  assert.deepEqual([...presence([{agent: OTHER, agentName: 'Bucks', kind: 'network-pay', time: NOW}], NOW).values()], [['Bucks']]);
});
test('addresses in full: line mode prints the push\'s short forms in full', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jc-city-')), file = path.join(dir, 'f.json');
  fs.writeFileSync(file, JSON.stringify({economy: {asOfBlock: 1, events: [{kind: 'cat-wallet', token: 1, wallet: CAT1, tx: '0xe', block: 1, time: Date.now(), line: "JazzCat #1's own wallet is open on chain (0x1479…806e)"}]}, tail: {...tail, times: {100: Date.now() - 30000, 101: Date.now() - 20000}}}));
  const r = spawnSync(process.execPath, [BIN, 'city', '--once', '--line'], {encoding: 'utf8', timeout: 20000, env: {...process.env, JAZZCAT_CITY_FIXTURE: file}});
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, new RegExp(`open on chain \\(${CAT1}\\)`)); assert.match(r.stdout, /paid 1\.50 USDG by 0x7{40}/);
  assert.doesNotMatch(r.stdout, SHORTENED);
});
