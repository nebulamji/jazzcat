// The jazzcat command: help, url, connect (into a temp project and a temp home), recipes and proof.
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync, writeFileSync, readFileSync, readdirSync} from 'node:fs';
import {createServer} from 'node:http';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const BIN = new URL('../bin/jazzcat.mjs', import.meta.url).pathname;
const PKG = 'jazzcat@' + JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version; // the pinned bridge
const CITY = 'https://njc-tx-explain.departmentofjazz.workers.dev/mcp';
const tmp = () => mkdtempSync(join(tmpdir(), 'jazzcat-cli-'));
// Every run gets a temporary HOME, an empty PATH and no CODEX_HOME/APPDATA unless a test sets them: the one command
// writes agent configs, so a test must never reach this machine's own.
const SAFE = () => ({HOME: tmp(), PATH: tmp(), CODEX_HOME: '', APPDATA: '', JAZZCAT_SKILL_URL: 'http://127.0.0.1:9/none'});
const run = (args, opts = {}) => spawnSync(process.execPath, [BIN, ...args], {encoding: 'utf8', timeout: 30000, ...opts, env: {...process.env, ...SAFE(), ...(opts.env || {})}});

test('help, url and an unknown command', () => {
  const h = run(['help']); assert.equal(h.status, 0); assert.match(h.stderr, /npx jazzcat connect <client>/); assert.match(h.stderr, /npx jazzcat --dry-run/); assert.match(h.stderr, /jazzcat proof <file>/); assert.match(h.stderr, /jazzcat recipes/);
  assert.equal(run(['url']).stdout.trim(), 'https://njc-tx-explain.departmentofjazz.workers.dev/mcp');
  assert.equal(run(['nope']).status, 1);
});

test('connect cursor and codex write one new-jazz-city entry that runs the bridge', () => {
  const cwd = tmp(), home = tmp(), env = {HOME: home, CODEX_HOME: '', PATH: tmp()};
  assert.equal(run(['connect', 'cursor', '--no-skill'], {cwd, env}).status, 0);
  assert.deepEqual(JSON.parse(readFileSync(join(cwd, '.cursor', 'mcp.json'), 'utf8')).mcpServers['new-jazz-city'], {url: CITY}, 'Cursor: the City over HTTP, no npx');
  assert.equal(run(['connect', 'codex', '--no-skill'], {env}).status, 0);
  assert.equal(run(['connect', 'codex', '--no-skill'], {env}).status, 0);
  const toml = readFileSync(join(home, '.codex', 'config.toml'), 'utf8');
  assert.equal(toml.split('[mcp_servers.new-jazz-city]').length, 2, 'added once, not twice');
});

test('recipes: list, one, an unknown one, --out', () => {
  const list = run(['recipes']); assert.equal(list.status, 0);
  assert.equal(list.stdout.trim().split('\n').length, readdirSync(new URL('../recipes/', import.meta.url)).length);
  assert.equal(JSON.parse(run(['recipes', 'fee-flow-buy']).stdout).name, 'fee-flow-buy');
  assert.equal(run(['recipes', 'nope']).status, 1);
  const out = join(tmp(), 'njc'); assert.equal(run(['recipes', '--out', out]).status, 0);
  assert.ok(readdirSync(out).every(f => /^[a-z0-9-]+\.recipe\.json$/.test(f)));
  assert.equal(run(['recipes', '--out']).status, 2);
});

test('proof: usage, a missing file, and a file looked up in a (local) register', async () => {
  assert.equal(run(['proof']).status, 2);
  assert.equal(run(['proof', '/no/such/file']).status, 2);
  const dir = tmp(), known = join(dir, 'known.mp4'), fresh = join(dir, 'fresh.mp4');
  writeFileSync(known, 'registered piece'); writeFileSync(fresh, 'a new piece');
  const sha = createHash('sha256').update('registered piece').digest('hex');
  const server = createServer((req, res) => { res.end(req.url === '/register.jsonl' ? JSON.stringify({n: 3, wallet: '0x' + 'ab'.repeat(20), file: {sha256: sha}, output: {id: 'img_1'}}) + '\n' : ''); });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const env = {JAZZCAT_REGISTER_URL: `http://127.0.0.1:${server.address().port}`};
  try {
    const run2 = args => new Promise(resolve => { const c = require_spawn(args, env); resolve(c); });
    const hit = await run2(['proof', known]); assert.equal(hit.status, 0, hit.stderr); assert.equal(JSON.parse(hit.stdout).registered[0].n, 3);
    const miss = await run2(['proof', fresh]); assert.equal(miss.status, 1); assert.match(JSON.parse(miss.stdout).why, /not in the public register/);
    assert.equal((await run2(['proof', known, 'img_1'])).status, 2, 'an output id needs its payment tx');
  } finally { server.close(); }
});

// spawnSync would block the local register's event loop, so the proof runs are async.
import {spawn} from 'node:child_process';
function require_spawn(args, env) {
  return new Promise(resolve => {
    const c = spawn(process.execPath, [BIN, ...args], {env: {...process.env, ...SAFE(), ...env}});
    let stdout = '', stderr = ''; c.stdout.on('data', d => { stdout += d; }); c.stderr.on('data', d => { stderr += d; });
    c.on('close', status => resolve({status, stdout, stderr}));
  });
}

// The JazzCats skill, served from a local stand-in for newjazzcity.pages.dev/skill.md.
const SKILL = '---\nname: jazzcats\ndescription: For JazzCats holders.\n---\n\n# JazzCats\n\nSign in with your Cat.\n';
async function skillServer(body, status = 200) {
  const server = createServer((req, res) => { res.statusCode = status; res.setHeader('content-type', 'text/markdown'); res.end(body); });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  return {server, env: {JAZZCAT_SKILL_URL: `http://127.0.0.1:${server.address().port}/skill.md`}};
}
test('skill: saves jazzcats/SKILL.md where each agent reads skills; --dry-run writes nothing; refuses an error page', async () => {
  const {existsSync} = await import('node:fs');
  const ok = await skillServer(SKILL), home = tmp();
  try {
    const env = {...ok.env, HOME: home, CODEX_HOME: ''};
    const dry = await require_spawn(['skill', 'claude', '--dry-run'], env);
    assert.equal(dry.status, 0, dry.stderr); assert.match(dry.stderr, /Dry run: would add .*\.claude\/skills\/jazzcats\/SKILL\.md/);
    assert.equal(existsSync(join(home, '.claude', 'skills', 'jazzcats', 'SKILL.md')), false, 'a dry run writes nothing');
    for (const [target, dir] of [['claude', ['.claude', 'skills']], ['codex', ['.codex', 'skills']], ['agents', ['.agents', 'skills']]]) {
      const r = await require_spawn(['skill', target], env); assert.equal(r.status, 0, r.stderr);
      assert.equal(readFileSync(join(home, ...dir, 'jazzcats', 'SKILL.md'), 'utf8'), SKILL, target);
    }
    const again = await require_spawn(['skill'], env); assert.equal(again.status, 0); assert.match(again.stderr, /already up to date/, 'claude is the default, and an unchanged file is left alone');
    const codexHome = tmp(), c = await require_spawn(['skill', 'codex'], {...env, CODEX_HOME: codexHome});
    assert.equal(c.status, 0); assert.equal(readFileSync(join(codexHome, 'skills', 'jazzcats', 'SKILL.md'), 'utf8'), SKILL, 'CODEX_HOME is honored');
    assert.equal((await require_spawn(['skill', 'cursor'], env)).status, 2, 'an unknown agent is a usage mistake');
  } finally { ok.server.close(); }
  for (const [body, status] of [['<html>Not found</html>', 200], ['', 500]]) {
    const bad = await skillServer(body, status), h = tmp();
    try {
      const r = await require_spawn(['skill', 'agents'], {...bad.env, HOME: h}); assert.equal(r.status, 1, `${status} ${body}`);
      assert.equal(existsSync(join(h, '.agents', 'skills', 'jazzcats', 'SKILL.md')), false, 'nothing written on a bad download');
    } finally { bad.server.close(); }
  }
});
// ONE command (KB 11-27): npx jazzcat finds the agents on this computer, adds the MCP to each and saves the skill.
// HOME and PATH are temporary; a fake claude CLI records what it was asked, so no real config is touched.
import {mkdirSync, chmodSync, existsSync} from 'node:fs';
function fakeClaude() {
  const bin = tmp(), log = join(bin, 'calls.log'), mark = join(bin, 'added');
  writeFileSync(join(bin, 'claude'), `#!/bin/sh\necho "$@" >> '${log}'\nif [ "$1 $2" = "mcp get" ]; then [ -f '${mark}' ] && exit 0 || exit 1; fi\nif [ "$1 $2" = "mcp add" ]; then : > '${mark}'; fi\nexit 0\n`);
  chmodSync(join(bin, 'claude'), 0o755);
  return {bin, calls: () => existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n') : []};
}
test('one command: finds the agents, adds the MCP to each, saves the skill, and says what it can do now', async () => {
  const ok = await skillServer(SKILL), home = tmp(), claude = fakeClaude();
  mkdirSync(join(home, '.codex')); mkdirSync(join(home, '.cursor')); mkdirSync(join(home, '.config', 'Code', 'User'), {recursive: true}); mkdirSync(join(home, '.config', 'Claude'), {recursive: true});
  const env = {...ok.env, HOME: home, CODEX_HOME: '', PATH: claude.bin, APPDATA: ''};
  try {
    const dry = await require_spawn(['--dry-run'], env);
    assert.equal(dry.status, 0, dry.stderr); assert.match(dry.stderr, /Dry run: nothing is written/);
    assert.equal(existsSync(join(home, '.cursor', 'mcp.json')), false); assert.equal(existsSync(join(home, '.claude', 'skills')), false, 'a dry run writes nothing');
    const r = await require_spawn([], env);
    assert.equal(r.status, 0, r.stderr);
    assert.ok(claude.calls().includes(`mcp add --transport http --scope user new-jazz-city ${CITY}`), 'Claude Code: the City over HTTP, user scope');
    assert.ok(readFileSync(join(home, '.codex', 'config.toml'), 'utf8').includes(`[mcp_servers.new-jazz-city]\ncommand = "npx"\nargs = ["-y", "${PKG}", "mcp"]`), 'Codex: the bridge, pinned');
    assert.deepEqual(JSON.parse(readFileSync(join(home, '.cursor', 'mcp.json'), 'utf8')).mcpServers['new-jazz-city'], {url: CITY}, 'Cursor: the global config, over HTTP');
    assert.deepEqual(JSON.parse(readFileSync(join(home, '.config', 'Code', 'User', 'mcp.json'), 'utf8')).servers['new-jazz-city'], {type: 'http', url: CITY}, 'VS Code: the user config, over HTTP');
    assert.deepEqual(JSON.parse(readFileSync(join(home, '.config', 'Claude', 'claude_desktop_config.json'), 'utf8')).mcpServers['new-jazz-city'], {command: 'npx', args: ['-y', PKG, 'mcp']}, 'Claude Desktop: the bridge, pinned');
    assert.ok(JSON.parse(readFileSync(join(home, '.config', 'Claude', 'claude_desktop_config.json'), 'utf8')).mcpServers['new-jazz-city'], 'Claude Desktop');
    for (const d of [['.claude', 'skills'], ['.codex', 'skills'], ['.cursor', 'skills'], ['.copilot', 'skills']]) assert.equal(readFileSync(join(home, ...d, 'jazzcats', 'SKILL.md'), 'utf8'), SKILL, d.join('/'));
    assert.match(r.stderr, /Claude Desktop reads skills from the app/);
    assert.match(r.stderr, /Done\. Start a fresh session in your agent; it can now:/); assert.equal((r.stderr.match(/^  - /gm) || []).length, 3, 'three example asks');
    const again = await require_spawn(['connect'], env);
    assert.equal(again.status, 0, again.stderr); assert.equal((again.stderr.match(/MCP: already set/g) || []).length, 5, 'a second run changes nothing: ' + again.stderr);
    assert.equal(readFileSync(join(home, '.codex', 'config.toml'), 'utf8').split('[mcp_servers.new-jazz-city]').length, 2, 'never added twice');
    assert.equal(claude.calls().filter(c => c.startsWith('mcp add')).length, 1);
  } finally { ok.server.close(); }
});
test('one command never overwrites a different entry, skips the skill with --no-skill, and keeps the MCP when the skill download fails', async () => {
  const home = tmp(), env0 = {HOME: home, CODEX_HOME: '', PATH: tmp(), APPDATA: ''};
  mkdirSync(join(home, '.cursor')); const mine = {mcpServers: {'new-jazz-city': {url: 'https://example.com/mine'}, other: {command: 'x'}}};
  writeFileSync(join(home, '.cursor', 'mcp.json'), JSON.stringify(mine));
  const bad = await skillServer('<html>Not found</html>');
  try {
    const r = await require_spawn([], {...env0, ...bad.env});
    assert.match(r.stderr, /Cursor +MCP: left as is .*different "new-jazz-city" entry/, r.stderr);
    assert.deepEqual(JSON.parse(readFileSync(join(home, '.cursor', 'mcp.json'), 'utf8')), mine, 'the file is untouched');
    assert.match(r.stderr, /skill: not saved, .*didn't return the JazzCats skill/); assert.equal(existsSync(join(home, '.cursor', 'skills')), false);
  } finally { bad.server.close(); }
  mkdirSync(join(home, '.codex'));
  const n = await require_spawn(['--no-skill'], env0);
  assert.equal(n.status, 0, n.stderr); assert.doesNotMatch(n.stderr, /skill:/); assert.equal(existsSync(join(home, '.codex', 'skills')), false);
  assert.match(readFileSync(join(home, '.codex', 'config.toml'), 'utf8'), /mcp_servers\.new-jazz-city/);
  const none = await require_spawn([], {HOME: tmp(), CODEX_HOME: '', PATH: tmp(), APPDATA: ''});
  assert.equal(none.status, 1); assert.match(none.stderr, /No AI agents found/);
});

// Holder sign-in (KB 11-27 "how does it know I own a cat?"): the jc_ token from the pair page becomes a "jazzcats" entry in
// each agent, checked against the agent server first, never printed, user-level configs only. The agent server is a stub.
function spawnIn(args, env, input) {
  return new Promise(resolve => {
    const c = spawn(process.execPath, [BIN, ...args], {env: {...process.env, ...SAFE(), ...env}});
    let stdout = '', stderr = ''; c.stdout.on('data', d => { stdout += d; }); c.stderr.on('data', d => { stderr += d; });
    c.on('close', status => resolve({status, stdout, stderr})); c.stdin.end(input);
  });
}
const GOOD = 'jc_' + 'a1b2c3d4'.repeat(8), GOOD2 = 'jc_' + '9f8e7d6c'.repeat(8), BAD = 'jc_' + '0'.repeat(64);
async function holderServer() {
  const seen = [];
  const server = createServer((req, res) => { let b = ''; req.on('data', d => { b += d; }); req.on('end', () => {
    const auth = req.headers.authorization || ''; seen.push(auth); const ok = auth === `Bearer ${GOOD}` || auth === `Bearer ${GOOD2}`;
    res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({jsonrpc: '2.0', id: JSON.parse(b || '{}').id ?? 1, result: {tools: ok ? [{name: 'about'}, {name: 'make_call'}] : [{name: 'about'}]}})); }); });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  return {server, seen, env: {JAZZCAT_HOLDER_MCP_URL: `http://127.0.0.1:${server.address().port}/mcp`}};
}
function holderHome() {
  const home = tmp();
  for (const d of [['.codex'], ['.cursor'], ['.config', 'Code', 'User'], ['.config', 'Claude']]) mkdirSync(join(home, ...d), {recursive: true});
  return home;
}
test('holder sign-in: --holder-token-stdin writes a jazzcats entry to every agent found, never prints the token, replaces on re-sign-in', async () => {
  const hs = await holderServer(), home = holderHome(), claude = fakeClaude(), url = hs.env.JAZZCAT_HOLDER_MCP_URL;
  const env = {...hs.env, HOME: home, PATH: claude.bin};
  try {
    const r = await spawnIn(['--no-skill', '--holder-token-stdin'], env, GOOD + '\n');
    assert.equal(r.status, 0, r.stderr);
    assert.ok(!(r.stdout + r.stderr).includes(GOOD), 'the token is never printed');
    assert.match(r.stderr, /Your Cat is signed in/); assert.match(r.stderr, /Revoke it any time on https:\/\/newjazzcity\.pages\.dev\/pair\//); assert.match(r.stderr, /ends by itself when the Cat is sold/);
    // §11: no command line carries the token; Claude Code's entry is in ~/.claude.json.
    assert.ok(!claude.calls().includes(GOOD), 'no claude command line carries the token');
    assert.deepEqual(JSON.parse(readFileSync(join(home, '.claude.json'), 'utf8')).mcpServers.jazzcats, {type: 'http', url, headers: {Authorization: `Bearer ${GOOD}`}}, 'Claude Code: http entry with the header');
    assert.deepEqual(JSON.parse(readFileSync(join(home, '.cursor', 'mcp.json'), 'utf8')).mcpServers.jazzcats, {url, headers: {Authorization: `Bearer ${GOOD}`}});
    assert.deepEqual(JSON.parse(readFileSync(join(home, '.config', 'Code', 'User', 'mcp.json'), 'utf8')).servers.jazzcats, {type: 'http', url, headers: {Authorization: `Bearer ${GOOD}`}});
    assert.deepEqual(JSON.parse(readFileSync(join(home, '.config', 'Claude', 'claude_desktop_config.json'), 'utf8')).mcpServers.jazzcats, {command: 'npx', args: ['-y', PKG, 'mcp', 'holder'], env: {JAZZCAT_HOLDER_TOKEN: GOOD}});
    const toml = readFileSync(join(home, '.codex', 'config.toml'), 'utf8');
    assert.ok(toml.includes(`[mcp_servers.jazzcats]\ncommand = "npx"\nargs = ["-y", "${PKG}", "mcp", "holder"]\nenv = { JAZZCAT_HOLDER_TOKEN = "${GOOD}" }`), 'Codex holder entry: the pinned bridge');
    assert.match(toml, /\[mcp_servers\.new-jazz-city\]/, 'the City entry is kept');
    const {statSync} = await import('node:fs');
    for (const f of [join(home, '.cursor', 'mcp.json'), join(home, '.codex', 'config.toml')]) assert.equal(statSync(f).mode & 0o077, 0, `${f} is private (0600)`);
    // Signing in again: the earlier jazzcats entry is replaced, and it says so.
    const again = await spawnIn(['--no-skill', '--holder-token-stdin'], env, GOOD2 + '\n');
    assert.equal(again.status, 0, again.stderr); assert.match(again.stderr, /replaced your earlier "jazzcats" entry/);
    const toml2 = readFileSync(join(home, '.codex', 'config.toml'), 'utf8');
    assert.equal(toml2.split('[mcp_servers.jazzcats]').length, 2, 'one jazzcats block'); assert.ok(!toml2.includes(GOOD) && toml2.includes(GOOD2), 'the old token is gone');
    assert.equal(JSON.parse(readFileSync(join(home, '.claude.json'), 'utf8')).mcpServers.jazzcats.headers.Authorization, `Bearer ${GOOD2}`, 'Claude Code entry replaced in place');
  } finally { hs.server.close(); }
});
test('holder sign-in: a token the server refuses writes nothing; the y/N question; no question without a terminal', async () => {
  const hs = await holderServer(), home = holderHome(), env = {...hs.env, HOME: home};
  try {
    const bad = await spawnIn(['--no-skill', '--holder-token-stdin'], env, BAD + '\n');
    assert.equal(bad.status, 1); assert.match(bad.stderr, /didn't open a session/); assert.ok(!bad.stderr.includes(BAD));
    assert.equal(JSON.parse(readFileSync(join(home, '.cursor', 'mcp.json'), 'utf8')).mcpServers.jazzcats, undefined, 'nothing written');
    const junk = await spawnIn(['--no-skill', '--holder-token-stdin'], env, 'hello\n'); assert.equal(junk.status, 1); assert.match(junk.stderr, /not a jc_ token/);
    const upper = await spawnIn(['--no-skill', '--holder-token-stdin'], env, GOOD.toUpperCase().replace('JC_', 'jc_') + '\n'); assert.equal(upper.status, 1, 'only the server\'s own format (lowercase hex, 64)');
    const no = await spawnIn(['--no-skill', '--holder'], env, 'n\n'); assert.equal(no.status, 0); assert.match(no.stderr, /Do you hold a JazzCat\? \(y\/N\)/); assert.doesNotMatch(no.stderr, /signed in/);
    const yes = await spawnIn(['--no-skill', '--holder'], env, `y\n${GOOD}\n`);
    assert.equal(yes.status, 0, yes.stderr); assert.match(yes.stderr, /open https:\/\/newjazzcity\.pages\.dev\/pair\//); assert.match(yes.stderr, /Your Cat is signed in/); assert.ok(!yes.stderr.includes(GOOD));
    assert.ok(JSON.parse(readFileSync(join(home, '.cursor', 'mcp.json'), 'utf8')).mcpServers.jazzcats);
    const quiet = await spawnIn(['--no-skill'], {...env, HOME: holderHome()}, ''); assert.equal(quiet.status, 0); assert.doesNotMatch(quiet.stderr, /Do you hold a JazzCat/, 'an agent running it (no terminal) is never asked');
  } finally { hs.server.close(); }
});
test('the holder bridge: jazzcat mcp holder sends the token as a bearer, and says what to do without one', async () => {
  const hs = await holderServer();
  try {
    const r = await spawnIn(['mcp', 'holder'], {...hs.env, JAZZCAT_HOLDER_TOKEN: GOOD}, JSON.stringify({jsonrpc: '2.0', id: 7, method: 'tools/list'}) + '\n');
    assert.equal(JSON.parse(r.stdout.trim()).result.tools.length, 2); assert.equal(hs.seen.at(-1), `Bearer ${GOOD}`);
    const n = await spawnIn(['mcp', 'holder'], {...hs.env, JAZZCAT_HOLDER_TOKEN: ''}, JSON.stringify({jsonrpc: '2.0', id: 8, method: 'tools/list'}) + '\n');
    assert.match(JSON.parse(n.stdout.trim()).error.message, /JAZZCAT_HOLDER_TOKEN is not set/);
  } finally { hs.server.close(); }
});

// The City's MCP is read-only by default; --actions (or yes to the question) opts in: ?actions=on over HTTP, and the
// pinned bridge with --actions, which sends x-njc-actions: on. Without a terminal there is no question: read-only.
test('--actions: HTTP entries get ?actions=on, bridge entries run mcp --actions; the default is read-only', () => {
  const cwd = tmp(), home = tmp(), env = {HOME: home, CODEX_HOME: '', PATH: tmp()};
  const r = run(['connect', 'cursor', '--no-skill', '--actions'], {cwd, env});
  assert.equal(r.status, 0); assert.match(r.stderr, /Mode: your agent can prepare actions/);
  assert.deepEqual(JSON.parse(readFileSync(join(cwd, '.cursor', 'mcp.json'), 'utf8')).mcpServers['new-jazz-city'], {url: CITY + '?actions=on'});
  assert.equal(run(['connect', 'codex', '--no-skill', '--actions'], {env}).status, 0);
  assert.match(readFileSync(join(home, '.codex', 'config.toml'), 'utf8'), new RegExp(`args = \\["-y", "${PKG.replace('.', '\\.')}", "mcp", "--actions"\\]`));
  const plain = run(['connect', 'vscode', '--no-skill'], {cwd, env});
  assert.match(plain.stderr, /Mode: read-only\. To let your agent prepare trades and job steps for you to sign: npx jazzcat --actions/);
  assert.deepEqual(JSON.parse(readFileSync(join(cwd, '.vscode', 'mcp.json'), 'utf8')).servers['new-jazz-city'], {type: 'http', url: CITY}, 'no terminal, no flag: read-only');
});

test('--actions never replaces an existing read-only entry; it says how to switch', () => {
  const cwd = tmp(), env = {HOME: tmp(), CODEX_HOME: '', PATH: tmp()};
  assert.equal(run(['connect', 'cursor', '--no-skill'], {cwd, env}).status, 0);
  const r = run(['connect', 'cursor', '--no-skill', '--actions'], {cwd, env});
  assert.match(r.stderr, /left as is.*remove it and run npx jazzcat --actions/s);
  assert.deepEqual(JSON.parse(readFileSync(join(cwd, '.cursor', 'mcp.json'), 'utf8')).mcpServers['new-jazz-city'], {url: CITY}, 'untouched');
});

test('the bridge sends x-njc-actions: on only with --actions', async () => {
  const seen = [];
  const srv = createServer((req, res) => { seen.push(req.headers['x-njc-actions'] ?? null); req.resume(); req.on('end', () => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({jsonrpc: '2.0', id: 1, result: {tools: []}})); }); });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${srv.address().port}/mcp`;
  try {
    for (const extra of [['--actions'], []]) {
      // async spawn: spawnSync would block this process, and with it the server answering the bridge
      const stdout = await new Promise((resolve, reject) => {
        const c = spawn(process.execPath, [BIN, 'mcp', ...extra], {env: {...process.env, ...SAFE(), JAZZCAT_MCP_URL: url}});
        let o = ''; c.stdout.on('data', d => { o += d; }); c.on('error', reject); c.on('close', () => resolve(o));
        c.stdin.end(JSON.stringify({jsonrpc: '2.0', id: 1, method: 'tools/list', params: {}}) + '\n');
      });
      assert.equal(JSON.parse(stdout.trim().split('\n')[0]).id, 1, 'the answer passes through');
    }
    assert.deepEqual(seen, ['on', null]);
  } finally { srv.close(); }
});

// The question itself needs a terminal: util-linux `script` gives the command a pseudo-terminal (skipped where it's missing).
test('on a terminal: the actions question; y writes ?actions=on, a plain Enter stays read-only', {skip: spawnSync('script', ['--version']).status !== 0 && 'no util-linux script'}, async () => {
  for (const [answer, url] of [['y', CITY + '?actions=on'], ['', CITY]]) {
    const cwd = tmp(), cmd = `${JSON.stringify(process.execPath)} ${JSON.stringify(BIN)} connect cursor --no-skill`;
    const out = await new Promise(resolve => {
      const c = spawn('script', ['-qec', cmd, '/dev/null'], {cwd, env: {...process.env, ...SAFE(), PATH: '/usr/bin:/bin'}});
      let o = ''; c.stdout.on('data', d => { o += d; });
      setTimeout(() => c.stdin.write(answer + '\n'), 800); setTimeout(() => c.stdin.write('\n'), 1600); // then N to the holder question
      c.on('close', () => resolve(o)); setTimeout(() => c.kill(), 15000);
    });
    assert.match(out, /Let your agent prepare trades, job steps and other actions for you to sign\?/);
    assert.equal(JSON.parse(readFileSync(join(cwd, '.cursor', 'mcp.json'), 'utf8')).mcpServers['new-jazz-city'].url, url, `answer ${JSON.stringify(answer)}`);
  }
});

// tg-4d deep review §11 (jazzcat connect): re-signing in drops only the earlier jazzcats block; a following table whose
// header carries a comment, and [[array]] tables, are the user's own and are never deleted.
test('Codex re-sign-in keeps commented tables and [[array]] tables after the old jazzcats block', async () => {
  const hs = await holderServer(), home = holderHome(), env = {...hs.env, HOME: home, PATH: tmp()};
  const {writeFileSync: wf, mkdirSync: md} = await import('node:fs');
  md(join(home, '.codex'), {recursive: true});
  const mine = '[mcp_servers.jazzcats]\ncommand = "old"\n\n[mcp_servers.jazzcats.env]\nX = "1"\n\n[profiles.work] # my work profile\nmodel = "o3"\n\n[[hooks]]\nname = "pre"\n\n[[hooks]]\nname = "post"\n';
  wf(join(home, '.codex', 'config.toml'), mine);
  try {
    const r = await spawnIn(['connect', 'codex', '--no-skill', '--holder-token-stdin'], env, GOOD + '\n');
    assert.equal(r.status, 0, r.stderr);
    const toml = readFileSync(join(home, '.codex', 'config.toml'), 'utf8');
    assert.ok(toml.includes('[profiles.work] # my work profile\nmodel = "o3"'), 'the commented table is kept: ' + toml);
    assert.equal(toml.split('[[hooks]]').length, 3, 'both [[hooks]] tables are kept');
    assert.ok(toml.includes('name = "pre"') && toml.includes('name = "post"'));
    assert.ok(!toml.includes('command = "old"') && !toml.includes('X = "1"'), 'the old jazzcats block and its sub-table are gone');
    assert.equal(toml.split('[mcp_servers.jazzcats]').length, 2, 'exactly one jazzcats entry');
  } finally { hs.server.close(); }
});

// tg-4d deep review §11 (bridge): a call the City never answers times out with a JSON-RPC error instead of hanging the
// bridge, and the answers already written reach the client before the bridge exits.
test('the bridge times out a hung call and flushes every answer before it exits', async () => {
  const srv = createServer((req, res) => { let b = ''; req.on('data', d => { b += d; }); req.on('end', () => { const m = JSON.parse(b);
    if (m.method === 'hang') return; // never answers
    res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({jsonrpc: '2.0', id: m.id, result: {ok: m.id}})); }); });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  try {
    const out = await new Promise(resolve => {
      const c = spawn(process.execPath, [BIN, 'mcp'], {env: {...process.env, ...SAFE(), JAZZCAT_MCP_URL: `http://127.0.0.1:${srv.address().port}/mcp`, JAZZCAT_BRIDGE_TIMEOUT_MS: '500'}});
      let o = ''; c.stdout.on('data', d => { o += d; }); c.on('close', () => resolve(o));
      c.stdin.end([{jsonrpc: '2.0', id: 1, method: 'hang'}, {jsonrpc: '2.0', id: 2, method: 'tools/list'}].map(m => JSON.stringify(m)).join('\n') + '\n');
    });
    const lines = out.trim().split('\n').map(l => JSON.parse(l));
    assert.equal(lines.find(l => l.id === 1)?.error?.code, -32000, 'the hung call answers with an error');
    assert.match(lines.find(l => l.id === 1).error.message, /did not answer within/);
    assert.deepEqual(lines.find(l => l.id === 2)?.result, {ok: 2}, 'the next call still runs and its answer is flushed');
  } finally { srv.close(); }
});

// tg-4d deep review §11: the holder token never goes on a command line (any local user can read another process's argv).
// Claude Code's user-scope entry is written straight into its config (~/.claude.json), atomically, keeping every other key.
test('holder sign-in: the token never reaches argv; Claude Code gets the entry in ~/.claude.json, other keys kept', async () => {
  const hs = await holderServer(), home = holderHome(), claude = fakeClaude(), url = hs.env.JAZZCAT_HOLDER_MCP_URL;
  const {writeFileSync: wf} = await import('node:fs');
  wf(join(home, '.claude.json'), JSON.stringify({numStartups: 7, projects: {'/x': {allowedTools: []}}, mcpServers: {other: {type: 'http', url: 'https://other.example/mcp'}}}));
  try {
    const r = await spawnIn(['--no-skill', '--holder-token-stdin'], {...hs.env, HOME: home, PATH: claude.bin}, GOOD + '\n');
    assert.equal(r.status, 0, r.stderr);
    assert.ok(!claude.calls().includes(GOOD), 'no claude command line carries the token: ' + claude.calls());
    const cfg = JSON.parse(readFileSync(join(home, '.claude.json'), 'utf8'));
    assert.deepEqual(cfg.mcpServers.jazzcats, {type: 'http', url, headers: {Authorization: `Bearer ${GOOD}`}});
    assert.equal(cfg.numStartups, 7); assert.deepEqual(cfg.projects, {'/x': {allowedTools: []}}); assert.equal(cfg.mcpServers.other.url, 'https://other.example/mcp');
    const {statSync} = await import('node:fs'); assert.equal(statSync(join(home, '.claude.json')).mode & 0o077, 0, '~/.claude.json stays private');
  } finally { hs.server.close(); }
});
