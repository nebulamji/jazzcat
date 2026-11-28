// jazzcat city --explore (a preview, off by default): /look <place> from city_map + the live feed, /go cat N follows one
// Cat. Without the flag every command answers exactly as v0. The city_map answer is a trimmed copy of the live one
// (test/fixtures/city-map.json, read 2026-11-28). No network.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {parseCommand, runCommand, render, placeIndex, findPlace, followStep, whereIs, PLACES, HELP} from '../lib/city.js';

const BIN = new URL('../bin/jazzcat.mjs', import.meta.url).pathname;
const CITY_MAP = JSON.parse(fs.readFileSync(new URL('./fixtures/city-map.json', import.meta.url), 'utf8'));
const NOW = Date.UTC(2026, 10, 28, 8, 0), CAT1 = '0x1479be07e26976fd712db34f7bc1b8ac523f806e', BULL = '0x7ab58faae65efcf0037635382caa546eac233da6';
const SHORTENED = /0x[0-9a-fA-F]{2,10}(?:…|\.\.\.)/;
// A feed, newest first: #1 paid into Bull escrow 2 min ago (Bank of Music), #3 sealed a call 5 min ago, #2 was paid for a
// job 2 h ago (City Jobs), #1 sealed a call 3 h ago.
const events = () => [
  {kind: 'cat-spent', token: 1, tx: '0x11', to: BULL, block: 40, time: NOW - 120e3, line: 'JazzCat #1 spent 1 USDG → 0x7ab5…3da6'},
  {kind: 'call-sealed', token: 3, tx: '0x12', callId: 7, block: 39, time: NOW - 300e3, line: 'JazzCat #3 sealed call #7 in the Call Book'},
  {kind: 'job-paid', token: 2, tx: '0x13', block: 30, time: NOW - 2 * 3600e3, line: 'JazzCat #2 was paid 1 USDG for a market read'},
  {kind: 'call-sealed', token: 1, tx: '0x14', callId: 6, block: 20, time: NOW - 3 * 3600e3, line: 'JazzCat #1 sealed call #6 in the Call Book'},
];
const mcp = () => { const calls = []; return {calls, call: async (name, args) => { calls.push([name, args]); if (name === 'city_map') return CITY_MAP; throw Error('unexpected ' + name); }}; };

test('city_map\'s places line up with the map\'s 16 squares; the Group Lab is known but never drawn', () => {
  const idx = placeIndex(CITY_MAP);
  for (const p of PLACES) assert.ok(idx.get(p.id)?.onGrid, `${p.id} has its city_map entry`);
  assert.equal(idx.get('bank').cityId, 'bank-of-music'); assert.equal(idx.get('gig-board').cityId, 'city-jobs');
  assert.equal(idx.get('guard-post').cityId, 'guard-post', 'no square on the browser map yet: its own id');
  assert.equal(idx.get('group-lab').onGrid, false);
  assert.equal(PLACES.length, 16, 'the grid stays 4 by 4');
  assert.deepEqual(findPlace('group lab', idx), {id: 'group-lab', name: 'The Group Lab'});
  assert.equal(findPlace('credit-bureau', idx).id, 'credit'); assert.equal(findPlace('jobs', idx).id, 'gig-board'); assert.equal(findPlace('the airport', idx).id, 'airport');
  assert.equal(findPlace('group lab'), null, 'without city_map, only the map\'s own places');
  assert.equal(placeIndex({}).size, 0); assert.equal(placeIndex({places: [null, {name: 'no id'}]}).size, 0);
});

test('the parser: /go cat N follows, /go off stops, /go <place> is v0\'s', () => {
  assert.deepEqual(parseCommand('/go cat 1'), {cmd: 'go-cat', cat: 1, place: 'cat 1'});
  assert.deepEqual(parseCommand('/go #3'), {cmd: 'go-cat', cat: 3, place: '#3'});
  assert.deepEqual(parseCommand('/go off'), {cmd: 'go-off', place: 'off'}); assert.equal(parseCommand('/go STOP').cmd, 'go-off');
  assert.deepEqual(parseCommand('/go bank'), {cmd: 'go', place: 'bank'});
});

test('flag off: every command answers exactly as v0, and nothing reads city_map', async () => {
  const city = mcp(), state = {events: events()};
  assert.match((await runCommand(parseCommand('/go cat 1'), {city, state, now: NOW}))[0], /^No place "cat 1"\. Places: /);
  assert.match((await runCommand(parseCommand('/go off'), {city, state, now: NOW}))[0], /^No place "off"/);
  assert.deepEqual(await runCommand(parseCommand('/look bank'), {city, state, now: NOW}), ['Bank of Music', '07:58 JazzCat #1 spent 1 USDG → ' + BULL]);
  assert.deepEqual(await runCommand(parseCommand('/look group lab'), {city, state}), [`No place "group lab". Places: ${PLACES.map(x => x.name).join(', ')}.`]);
  assert.deepEqual(await runCommand({cmd: 'help'}, {city, state}), HELP);
  assert.equal(state.follow, undefined); assert.deepEqual(city.calls, []);
  const f = render(state, {width: 100, height: 26, now: NOW});
  assert.match(f, /─ feed ─/); assert.doesNotMatch(f, /●/);
  assert.equal(f.split('\n').filter(l => l.startsWith('│ » ')).length, 0);
});

test('/look <place>: what it is for, who is there now and in the last 6 h, what just happened, its tools; one city_map read', async () => {
  const city = mcp(), state = {events: events()}, o = {city, state, explore: true, now: NOW};
  const bank = await runCommand(parseCommand('/look bank'), o);
  assert.equal(bank[0], 'Bank of Music: wallets and pay: where a Cat is paid on every chain, binding a payout account, money trails and ledgers');
  assert.equal(bank[1], 'Here now: #1');
  assert.equal(bank[2], `07:58 JazzCat #1 spent 1 USDG → ${BULL}`);
  assert.match(bank[3], /^Tools here: cat_legs, cat_bind_leg, cat_register_tx, money_trail, usdg_ledger, sol_trail \(\+2\)$/);
  const book = await runCommand(parseCommand('/look call book'), o);
  assert.equal(book[1], 'Here now: #3', '#1 sealed a call here 3 h ago but acted at the bank since: it is at the bank');
  assert.equal(book[2], '07:55 JazzCat #3 sealed call #7 in the Call Book'); assert.equal(book[3], '05:00 JazzCat #1 sealed call #6 in the Call Book');
  const jobs = await runCommand(parseCommand('/look jobs'), o);
  assert.equal(jobs[1], 'Nobody here now · stopped here in the last 6 h: #2');
  const both = await runCommand(parseCommand('/look jobs'), {...o, state: {places: state.places, events: [{kind: 'job-paid', token: 3, tx: '0x41', block: 50, time: NOW - 60e3, line: 'JazzCat #3 was paid'}, ...events()]}});
  assert.equal(both[1], 'Here now: #3 · stopped here in the last 6 h: #2');
  const moved = [{kind: 'call-sealed', token: 1, tx: '0x51', callId: 9, block: 51, time: NOW - 60e3, line: 'JazzCat #1 sealed call #9 in the Call Book'}, events()[0]];
  const passed = await runCommand(parseCommand('/look bank'), {...o, state: {places: state.places, events: moved}});
  assert.equal(passed[1], 'Nobody here now.', '#1 paid here, then sealed a call: it is at the Call Book now (never "nobody seen")');
  assert.equal(passed[2], `07:58 JazzCat #1 spent 1 USDG → ${BULL}`, 'its visit still shows');
  const label = await runCommand(parseCommand('/look label'), o);
  assert.deepEqual(label.slice(1, 2), ['Nobody here now.']);
  const lab = await runCommand(parseCommand('/look group lab'), o);
  assert.match(lab[0], /^The Group Lab \(not on the map yet\): the agents-only open-source build room/); assert.match(lab[1], /^Tools here: /);
  assert.deepEqual(city.calls.map(c => c[0]), ['city_map'], 'city_map read once, then kept');
  assert.match((await runCommand(parseCommand('/look moon'), o))[0], /^No place "moon"/);
  for (const l of [...bank, ...book, ...jobs, ...lab]) assert.doesNotMatch(l, SHORTENED);
});

test('/look <place> when city_map can\'t be read: v0\'s answer, never "Could not"', async () => {
  const city = {call: async () => { throw Error('MCP down'); }}, state = {events: events()};
  assert.deepEqual(await runCommand(parseCommand('/look bank'), {city, state, explore: true, now: NOW}), ['Bank of Music', `07:58 JazzCat #1 spent 1 USDG → ${BULL}`]);
  const empty = {call: async () => ({places: []})};
  assert.deepEqual(await runCommand(parseCommand('/look label'), {city: empty, state, explore: true, now: NOW}), ['The Label: nothing seen here lately.']);
});

test('/go cat N follows one Cat: where it is from the feed only, its events alone in the feed, its mark on the map', async () => {
  const state = {events: events(), noteRoom: 6}, o = {city: mcp(), state, explore: true, now: NOW};
  const n = await runCommand(parseCommand('/go cat 1'), o);
  assert.equal(n[0], 'Following JazzCat #1: last at Bank of Music, 07:58. /go off stops.');
  assert.deepEqual(state.follow, {cat: 1, place: 'bank', id: whereIs(state.events, 1).id});
  state.notes = n;
  const f = render(state, {width: 100, height: 26, now: NOW});
  assert.match(f, /feed: JazzCat #1 only, last at Bank of Music · \/go off/);
  assert.match(f, /●#1/); assert.match(f, / #3 /); assert.doesNotMatch(f, /JazzCat #3 sealed|JazzCat #2 was paid/, 'the feed holds only #1');
  assert.match(f, /JazzCat #1 sealed call #6/);
  assert.ok(f.split('\n').every(l => [...l].length === 100));
  assert.deepEqual(await runCommand(parseCommand('/go off'), o), ['Stopped following JazzCat #1.']); assert.equal(state.follow, null);
  assert.deepEqual(await runCommand(parseCommand('/go off'), o), ['Not following a Cat.']);
});

test('/go: a Cat the feed hasn\'t seen is said so plainly, never placed; out of range is refused', async () => {
  const state = {events: events()}, o = {city: mcp(), state, explore: true, now: NOW};
  const n = await runCommand(parseCommand('/go cat 500'), o);
  assert.match(n[0], /^Following JazzCat #500: not in the live feed/); assert.equal(n.length, 1);
  assert.deepEqual(state.follow, {cat: 500, place: null, id: null});
  assert.match(render(state, {width: 100, height: 26, now: NOW}), /feed: JazzCat #500 only, not in the feed/);
  assert.match((await runCommand(parseCommand('/go cat 9999'), o))[0], /^No JazzCat #9999: JazzCats are #1 to #5,678\./);
  const old = {events: [{kind: 'call-sealed', token: 2, tx: '0x9', block: 1, time: NOW - 30 * 3600e3, line: 'JazzCat #2 sealed call #1'}]};
  assert.match((await runCommand(parseCommand('/go cat 2'), {...o, state: old}))[0], /last at The Call Book, 11-27 02:00 \(not in the last 6 h\)/);
});

test('following: a note when the Cat acts at a different place; none on the first read or at the same place', async () => {
  const state = {events: events()}, o = {city: mcp(), state, explore: true, now: NOW};
  await runCommand(parseCommand('/go cat 1'), o);
  assert.deepEqual(followStep(state, NOW), [], 'nothing new');
  state.events = [{kind: 'cat-spent', token: 1, tx: '0x21', to: BULL, block: 41, time: NOW - 60e3, line: 'JazzCat #1 spent 0.02 USDG → 0x7ab5…3da6'}, ...state.events];
  assert.deepEqual(followStep(state, NOW), [], 'a new event at the same place shows in the feed, no note');
  state.events = [{kind: 'call-sealed', token: 1, tx: '0x22', callId: 8, block: 42, time: NOW - 30e3, line: 'JazzCat #1 sealed call #8 in the Call Book'}, ...state.events];
  assert.deepEqual(followStep(state, NOW), ['JazzCat #1 moved to The Call Book (07:59): JazzCat #1 sealed call #8 in the Call Book']);
  assert.deepEqual(followStep(state, NOW), [], 'once');
  const unseen = {events: events()};
  await runCommand(parseCommand('/go cat 7'), {...o, state: unseen});
  unseen.events = [{kind: 'pay-in', token: 7, tx: '0x31', block: 43, time: NOW, line: 'JazzCat #7 was paid 1 USDG'}, ...unseen.events];
  assert.deepEqual(followStep(unseen, NOW), [], 'first sighting sets the place, no "moved"');
  assert.equal(unseen.follow.place, 'bank');
  assert.deepEqual(followStep({events: events()}, NOW), [], 'not following: nothing');
});

test('explore\'s frame shows a command\'s whole answer and keeps the feed; every line the same width at any size', async () => {
  const state = {events: events(), noteRoom: 6}, o = {city: mcp(), state, explore: true, now: NOW};
  state.notes = await runCommand(parseCommand('/look bank'), o);
  for (const [width, height] of [[60, 24], [80, 24], [120, 40]]) {
    const lines = render(state, {width, height, now: NOW}).split('\n');
    assert.equal(lines.length, height, `${width}x${height}`);
    assert.ok(lines.every(l => [...l].length === width), `${width}x${height}`);
    assert.equal(lines.filter(l => l.startsWith('│ » ')).length, 4, 'all four lines of /look');
  }
  assert.equal(render({...state, noteRoom: undefined}, {width: 80, height: 24, now: NOW}).split('\n').filter(l => l.startsWith('│ » ')).length, 3, 'v0 keeps 3');
});

test('jazzcat city --go N: line mode prints only that Cat\'s lines, from before the newest 12 too; --go needs a Cat', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jc-explore-')), file = path.join(dir, 'f.json'), t = Date.now();
  const ev = [{kind: 'call-sealed', token: 1, tx: '0xa1', callId: 1, block: 1, time: t - 600e3, line: 'JazzCat #1 sealed call #1 in the Call Book'}];
  for (let i = 0; i < 20; i++) ev.push({kind: 'call-sealed', token: 3, tx: '0xb' + i, callId: 100 + i, block: 10 + i, time: t - 300e3 + i * 1000, line: `JazzCat #3 sealed call #${100 + i}`});
  fs.writeFileSync(file, JSON.stringify({economy: {asOfBlock: 50, events: ev}, tail: {logs: []}}));
  const env = {...process.env, JAZZCAT_CITY_FIXTURE: file};
  const run = (...a) => spawnSync(process.execPath, [BIN, 'city', '--once', '--line', ...a], {encoding: 'utf8', timeout: 20000, env});
  const one = run('--go', '1');
  assert.equal(one.status, 0, one.stderr);
  assert.match(one.stdout, /» Following JazzCat #1: last at The Call Book/);
  assert.match(one.stdout, /The Call Book +JazzCat #1 sealed call #1/, 'older than the newest 12 of the whole feed, still printed');
  assert.doesNotMatch(one.stdout, /JazzCat #3/);
  const none = run('--go', '500');
  assert.equal(none.status, 0); assert.match(none.stdout, /» Following JazzCat #500: not in the live feed/); assert.doesNotMatch(none.stdout, /sealed/);
  const all = run();
  assert.equal(all.status, 0); assert.doesNotMatch(all.stdout, /»|JazzCat #1 sealed/, 'without --go: v0, the newest 12 of the feed');
  assert.equal((all.stdout.match(/JazzCat #3 sealed/g) || []).length, 12);
  for (const bad of [['--go'], ['--go', 'x'], ['--go', '0'], ['--go', '5679']]) {
    const r = run(...bad); assert.equal(r.status, 2, bad.join(' ')); assert.match(r.stderr, /usage: jazzcat city --go/);
  }
});
