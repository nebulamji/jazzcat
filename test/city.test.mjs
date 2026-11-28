// jazzcat city: the tail's Cat payments decoded, events merged once, who is where (live and earlier), the frame, the command
// line and its commands, and the command itself in line mode and screen mode from a fixture (no network).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {decodeTail, mergeEvents, presence, render, parseCommand, runCommand, placeOf, findPlace, PLACES, USDG} from '../lib/city.js';

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
  assert.match(ev[0].line, /JazzCat #1 was paid 1\.50 USDG by 0x7777…7777/);
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
