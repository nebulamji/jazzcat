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
const tmp = () => mkdtempSync(join(tmpdir(), 'jazzcat-cli-'));
const run = (args, opts = {}) => spawnSync(process.execPath, [BIN, ...args], {encoding: 'utf8', timeout: 30000, ...opts, env: {...process.env, ...(opts.env || {})}});

test('help, url and an unknown command', () => {
  const h = run([]); assert.equal(h.status, 0); assert.match(h.stderr, /npx jazzcat connect claude/); assert.match(h.stderr, /jazzcat proof <file>/); assert.match(h.stderr, /jazzcat recipes/);
  assert.equal(run(['url']).stdout.trim(), 'https://njc-tx-explain.departmentofjazz.workers.dev/mcp');
  assert.equal(run(['nope']).status, 1);
});

test('connect cursor and codex write one new-jazz-city entry that runs the bridge', () => {
  const cwd = tmp(), home = tmp();
  assert.equal(run(['connect', 'cursor'], {cwd}).status, 0);
  assert.deepEqual(JSON.parse(readFileSync(join(cwd, '.cursor', 'mcp.json'), 'utf8')).mcpServers['new-jazz-city'], {command: 'npx', args: ['-y', 'jazzcat', 'mcp']});
  assert.equal(run(['connect', 'codex'], {env: {HOME: home}}).status, 0);
  assert.equal(run(['connect', 'codex'], {env: {HOME: home}}).status, 0);
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
    const c = spawn(process.execPath, [BIN, ...args], {env: {...process.env, ...env}});
    let stdout = '', stderr = ''; c.stdout.on('data', d => { stdout += d; }); c.stderr.on('data', d => { stderr += d; });
    c.on('close', status => resolve({status, stdout, stderr}));
  });
}
