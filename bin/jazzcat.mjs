#!/usr/bin/env node
// jazzcat: New Jazz City for your AI agent and your code.
//   npx jazzcat            set up every agent found: the MCP, and the JazzCats skill (or: connect <client>)
//   npx jazzcat mcp        stdio bridge to the New Jazz City MCP (what the configs run)
//   npx jazzcat proof …    prove a piece made on Texel (lib/proof.js)
//   npx jazzcat recipes …  New Jazz City's Oak recipes (lib/recipes.js)
//   npx jazzcat skill …    save the JazzCats skill (newjazzcity.pages.dev/skill.md) where your agent reads skills
// No key, no sign-up. Anything that moves money comes back as a plan your own wallet signs.
import {execFileSync, spawn} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import {createHash} from 'node:crypto';

const URL_MCP = process.env.JAZZCAT_MCP_URL || 'https://njc-tx-explain.departmentofjazz.workers.dev/mcp';
const NAME = 'new-jazz-city';
// The bridge is pinned to this exact version (slime's review): npx never fetches a different jazzcat than the one you ran.
const VERSION = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
const PKG = `jazzcat@${VERSION}`;
const BRIDGE = {command: 'npx', args: ['-y', PKG, 'mcp']};
// The City's MCP is read-only by default: tools that prepare a trade, a job step or another action you sign are listed
// only for a connection that opts in (?actions=on, or the header x-njc-actions: on). --actions, or yes to the question.
const URL_MCP_ACTIONS = URL_MCP + (URL_MCP.includes('?') ? '&' : '?') + 'actions=on';
const BRIDGE_ACTIONS = {command: 'npx', args: ['-y', PKG, 'mcp', '--actions']};
const cityUrl = actions => actions ? URL_MCP_ACTIONS : URL_MCP, cityBridge = actions => actions ? BRIDGE_ACTIONS : BRIDGE;
const say = s => process.stderr.write(s + '\n');
const URL_SKILL = process.env.JAZZCAT_SKILL_URL || 'https://newjazzcity.pages.dev/skill.md';
// The holder agent server (a Cat's holder signs in on the pair page and gets a jc_ token) and that page.
const URL_HOLDER = process.env.JAZZCAT_HOLDER_MCP_URL || 'https://newjazzcity.pages.dev/mcp';
const URL_PAIR = 'https://newjazzcity.pages.dev/pair/';
const HOLDER_NAME = 'jazzcats';
const TOKEN_RE = /^jc_[0-9a-f]{64}$/; // exactly what the agent server issues (jc_ + 32 random bytes in hex) and accepts
// Where each agent reads skills from: <dir>/jazzcats/SKILL.md.
const SKILL_DIRS = {
  claude: () => path.join(os.homedir(), '.claude', 'skills'),
  codex: () => path.join(process.env.CODEX_HOME || path.join(os.homedir(), '.codex'), 'skills'),
  agents: () => path.join(os.homedir(), '.agents', 'skills'),
};


function help() {
  say(`jazzcat: New Jazz City for your AI agent and your code.

One command sets up every agent on this computer (Claude Code, Codex, Cursor, VS Code, Claude Desktop):
  npx jazzcat                    add the New Jazz City MCP to each agent found, and save the JazzCats skill where it reads skills
  npx jazzcat --dry-run          show what it would change; write nothing
  npx jazzcat --no-skill         the MCP only
  npx jazzcat --actions          let your agent prepare trades and job steps for you to sign (read-only otherwise)
Then it asks whether you hold a JazzCat. On yes it opens the pair page, where you sign in with the wallet that holds the Cat
(nothing is paid), and you paste the jc_ token it shows (hidden; never printed). Each agent gets a "jazzcats" entry with it.
  npx jazzcat --holder-token-stdin   for agents: read the jc_ token from stdin instead of asking
  npx jazzcat connect <client>   one agent: claude | codex | cursor | vscode | desktop (Cursor and VS Code: this project)
An entry that is already there is never overwritten: a different one is left as is, and it says so.

  npx jazzcat skill [claude|codex|agents]   only the skill (jazzcats/SKILL.md)
  npx jazzcat mcp                the bridge the configs run (stdio)
  npx jazzcat url                print the MCP address
  npx jazzcat city               New Jazz City in your terminal, read only: the places, who is where, the live feed, /look /jobs /mode

Prove a piece you made on Texel:
  npx jazzcat proof <file>                             find it in the public register
  npx jazzcat proof <file> <output-id> <payment-tx>    prove it: your file, the wallet that paid, Texel's receipt
  npx jazzcat proof <output-id> <payment-tx>           the same proof, without a file
  npx jazzcat proof lint '<request JSON>'              check a Texel request before you pay

Oak recipes for New Jazz City:
  npx jazzcat recipes                 list them
  npx jazzcat recipes <name>          print one
  npx jazzcat recipes --out <dir>     write them all, then: oak recipes add <dir>

In code: import {NewJazzCity} from 'jazzcat'

No key, no sign-up. Anything that moves money comes back as a plan your own wallet signs.
MCP: ${URL_MCP}`);
}

const HOME = () => os.homedir();
const appData = () => process.env.APPDATA || path.join(HOME(), 'AppData', 'Roaming');
const codexHome = () => process.env.CODEX_HOME || path.join(HOME(), '.codex');
const desktopDir = () => process.platform === 'darwin' ? path.join(HOME(), 'Library', 'Application Support', 'Claude')
  : process.platform === 'win32' ? path.join(appData(), 'Claude') : path.join(HOME(), '.config', 'Claude');
const vscodeUserDir = () => process.platform === 'darwin' ? path.join(HOME(), 'Library', 'Application Support', 'Code', 'User')
  : process.platform === 'win32' ? path.join(appData(), 'Code', 'User') : path.join(HOME(), '.config', 'Code', 'User');
function which(cmd) {
  for (const dir of String(process.env.PATH || '').split(path.delimiter).filter(Boolean))
    for (const ext of process.platform === 'win32' ? ['.cmd', '.exe', ''] : ['']) {
      const f = path.join(dir, cmd + ext);
      try { if (fs.statSync(f).isFile()) return f; } catch {}
    }
  return null;
}
const short = f => f.startsWith(HOME() + path.sep) ? '~' + f.slice(HOME().length) : f;
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// Each agent: how we find it, where its New Jazz City entry goes, and where it reads skills (null: none on disk).
// `connect` with no client sets up every agent found; `connect <client>` sets up that one (Cursor and VS Code: this project).
const AGENTS = {
  claude: {label: 'Claude Code', found: () => !!which('claude') || fs.existsSync(path.join(HOME(), '.claude')), skills: () => SKILL_DIRS.claude()},
  codex: {label: 'Codex', found: () => !!which('codex') || fs.existsSync(codexHome()), skills: () => SKILL_DIRS.codex()},
  cursor: {label: 'Cursor', found: () => fs.existsSync(path.join(HOME(), '.cursor')), skills: () => path.join(HOME(), '.cursor', 'skills')},
  vscode: {label: 'VS Code', found: () => fs.existsSync(vscodeUserDir()), skills: () => path.join(HOME(), '.copilot', 'skills')},
  desktop: {label: 'Claude Desktop', found: () => fs.existsSync(desktopDir()), skills: null},
};
const HOLDER_ASKS = [
  'Show my Cat: who holds it, its wallet and its record.',
  'Make a sealed call with my Cat on a coin, up for the next hour.',
  'Show me open paid jobs my Cat can take.',
];
const ASKS = [
  'What can you do with New Jazz City? Group the tools.',
  'Show me open paid jobs for agents.',
  'Read JazzCat #1: who holds it, what it was paid, its record.',
];

// One JSON config: add our entry; an identical one is left as is; a different one is never overwritten, and we say so.
function jsonEntry(file, key, entry, dry) {
  let cur = {};
  if (fs.existsSync(file)) { try { cur = JSON.parse(fs.readFileSync(file, 'utf8') || '{}'); } catch { return {status: 'failed', where: file, note: 'not valid JSON, left alone'}; } }
  const had = cur?.[key]?.[NAME];
  if (had && same(had, entry)) return {status: 'already', where: file};
  if (had) return {status: 'left', where: file, note: `it already has a different "${NAME}" entry (${JSON.stringify(had)}); left as is. Remove it to replace it.`};
  if (dry) return {status: 'would add', where: file};
  fs.mkdirSync(path.dirname(file), {recursive: true});
  fs.writeFileSync(file, JSON.stringify({...cur, [key]: {...(cur[key] || {}), [NAME]: entry}}, null, 2) + '\n');
  return {status: 'added', where: file};
}
const codexBlock = actions => `\n[mcp_servers.${NAME}]\ncommand = "npx"\nargs = ["-y", "${PKG}", "mcp"${actions ? ', "--actions"' : ''}]\n`;
// An entry that's already there is never replaced; when it's the other mode, the note says how to switch.
const switchNote = actions => actions ? ` To let it prepare actions instead, remove it and run npx jazzcat --actions.` : '';
function addMcp(client, {dry, project = false, actions = false}) {
  const r = addMcpEntry(client, {dry, project, actions});
  return actions && r.status === 'left' ? {...r, note: r.note + switchNote(actions)} : r;
}
function addMcpEntry(client, {dry, project, actions}) {
  const URL_MCP = cityUrl(actions), BRIDGE = cityBridge(actions), CODEX_BLOCK = codexBlock(actions);
  switch (client) {
    case 'claude': {
      if (!which('claude')) return {status: 'failed', where: 'Claude Code', note: `no claude CLI on PATH. Inside Claude Code run: claude mcp add --transport http --scope user ${NAME} ${URL_MCP}`};
      const has = spawnQuiet('claude', ['mcp', 'get', NAME]) === 0;
      if (has) return {status: 'already', where: 'Claude Code, user scope', note: `an entry named ${NAME} exists; left as is (claude mcp get ${NAME} shows it).${actions ? ` If it's the read-only one: claude mcp remove ${NAME}, then npx jazzcat --actions.` : ''}`};
      if (dry) return {status: 'would add', where: 'Claude Code, user scope'};
      return spawnQuiet('claude', ['mcp', 'add', '--transport', 'http', '--scope', 'user', NAME, URL_MCP]) === 0
        ? {status: 'added', where: 'Claude Code, user scope'} : {status: 'failed', where: 'Claude Code', note: `claude mcp add failed. Run: claude mcp add --transport http --scope user ${NAME} ${URL_MCP}`};
    }
    case 'codex': {
      const file = path.join(codexHome(), 'config.toml'), cur = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
      if (cur.includes(CODEX_BLOCK.trim())) return {status: 'already', where: file};
      if (cur.includes(`[mcp_servers.${NAME}]`)) return {status: 'left', where: file, note: `it already has a different [mcp_servers.${NAME}] block; left as is. Remove it to replace it.`};
      if (dry) return {status: 'would add', where: file};
      fs.mkdirSync(path.dirname(file), {recursive: true}); fs.appendFileSync(file, CODEX_BLOCK);
      return {status: 'added', where: file};
    }
    case 'cursor': return jsonEntry(project ? path.join(process.cwd(), '.cursor', 'mcp.json') : path.join(HOME(), '.cursor', 'mcp.json'), 'mcpServers', {url: URL_MCP}, dry);
    case 'vscode': return jsonEntry(project ? path.join(process.cwd(), '.vscode', 'mcp.json') : path.join(vscodeUserDir(), 'mcp.json'), 'servers', {type: 'http', url: URL_MCP}, dry);
    case 'desktop': { const r = jsonEntry(path.join(desktopDir(), 'claude_desktop_config.json'), 'mcpServers', {...BRIDGE}, dry); return r.status === 'added' ? {...r, note: 'restart Claude Desktop'} : r; }
  }
}
function spawnQuiet(cmd, args) { try { execFileSync(cmd, args, {stdio: 'ignore', timeout: 60000}); return 0; } catch (e) { return e.status ?? 1; } }

// The skill text, fetched once per run: the JazzCats skill or an error, never an error page saved as a skill.
let skillText = null;
async function fetchSkill() {
  if (skillText) return skillText;
  const r = await fetch(URL_SKILL, {headers: {accept: 'text/markdown, text/plain', 'user-agent': 'jazzcat/1'}, signal: AbortSignal.timeout(20000)});
  if (!r.ok) throw new Error(`${URL_SKILL} answered ${r.status}`);
  const text = await r.text();
  if (text.length > 256 * 1024 || !/^---\r?\n[\s\S]*?^name:\s*jazzcats\s*$[\s\S]*?^---\s*$/m.test(text)) throw new Error(`${URL_SKILL} didn't return the JazzCats skill (no "name: jazzcats" front matter)`);
  return (skillText = text);
}
// Save it as <dir>/jazzcats/SKILL.md: added, updated (an older copy of the same skill; we say so) or already up to date.
function saveSkill(dir, text, dry) {
  const file = path.join(dir, 'jazzcats', 'SKILL.md'), cur = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
  if (cur === text) return {status: 'already', where: file};
  if (dry) return {status: cur == null ? 'would add' : 'would update', where: file};
  fs.mkdirSync(path.dirname(file), {recursive: true}); fs.writeFileSync(file, text);
  return {status: cur == null ? 'added' : 'updated', where: file, note: cur == null ? null : 'replaced an older copy of the JazzCats skill'};
}

const STATUS_WORDS = {added: 'added', replaced: 'replaced', already: 'already set', left: 'left as is', failed: 'not done', 'would add': 'would add', 'would update': 'would update', updated: 'updated'};
const line = (label, what, r) => `  ${label.padEnd(15)} ${what}: ${STATUS_WORDS[r.status] || r.status}${r.where ? ` (${short(r.where)})` : ''}${r.note ? `, ${r.note}` : ''}`;

// npx jazzcat skill [claude|codex|agents] [--dry-run]: only the skill, into one agent's folder.
async function skill(args) {
  const dry = args.includes('--dry-run'), rest = args.filter(a => a !== '--dry-run'), target = rest[0] || 'claude';
  if (!SKILL_DIRS[target] || rest.length > 1) { say(`usage: jazzcat skill [${Object.keys(SKILL_DIRS).join('|')}] [--dry-run]`); process.exit(2); }
  let text; try { text = await fetchSkill(); } catch (e) { say(`Couldn't get the skill: ${e.message}. Nothing written.`); process.exit(1); }
  const r = saveSkill(SKILL_DIRS[target](), text, dry);
  say(r.status === 'already' ? `The JazzCats skill is already up to date at ${r.where}.` : dry ? `Dry run: ${r.status} ${r.where}. Nothing written.` : `${r.status === 'added' ? 'Saved' : 'Updated'} the JazzCats skill: ${r.where}. Start a fresh session to load it.`);
}

// ---- Holder sign-in: "Do you hold a JazzCat?" -> the pair page -> the jc_ token -> the jazzcats entry in each agent ----
// The token is never printed. Entries go in each agent's user-level config, never a project file that could be committed.
let input = null;
function nextLine({hidden = false} = {}) {
  if (!input) {
    input = {lines: [], waiters: [], muted: false, rl: readline.createInterface({input: process.stdin, output: process.stderr, terminal: !!process.stdin.isTTY})};
    const w = input.rl._writeToOutput?.bind(input.rl);
    if (w) input.rl._writeToOutput = s => { if (!input.muted) w(s); };
    input.rl.on('line', l => input.waiters.length ? input.waiters.shift()(l) : input.lines.push(l));
    input.rl.on('close', () => { input.closed = true; while (input.waiters.length) input.waiters.shift()(null); });
  }
  if (input.lines.length) return Promise.resolve(input.lines.shift());
  if (input.closed) return Promise.resolve(null);
  input.muted = hidden && !!process.stdin.isTTY;
  return new Promise(r => input.waiters.push(l => { if (input.muted) process.stderr.write('\n'); input.muted = false; r(l); }));
}
async function ask(q, opts) { process.stderr.write(q); const l = await nextLine(opts); return l == null ? null : l.trim(); }
const closeInput = () => { input?.rl.close(); };
async function readStdinToken() { let all = ''; for await (const c of process.stdin) all += c; return all.split(/\r?\n/)[0].trim(); }
function openBrowser(url) {
  const [cmd, args] = process.platform === 'darwin' ? ['open', [url]] : process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : ['xdg-open', [url]];
  if (process.platform !== 'win32' && !which(cmd)) return false;
  try { const c = spawn(cmd, args, {stdio: 'ignore', detached: true}); c.on('error', () => {}); c.unref(); return true; } catch { return false; }
}
// A token opens a session when the agent server lists more than `about` for it.
async function tokenWorks(token) {
  try {
    const r = await fetch(URL_HOLDER, {method: 'POST', headers: {'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: `Bearer ${token}`, 'user-agent': 'jazzcat/1'},
      body: JSON.stringify({jsonrpc: '2.0', id: 1, method: 'tools/list', params: {}}), signal: AbortSignal.timeout(20000)});
    const text = await r.text(), data = (r.headers.get('content-type') || '').includes('text/event-stream') ? text.split('\n').filter(l => l.startsWith('data:')).map(l => l.slice(5)).join('') : text;
    const tools = JSON.parse(data)?.result?.tools || [];
    return tools.some(t => t.name !== 'about');
  } catch { return false; }
}
// A file that holds the token is readable by its owner only (an existing file keeps its mode on write, so set it).
const private_ = f => { try { fs.chmodSync(f, 0o600); } catch {} };
const HOLDER_BRIDGE = t => ({command: 'npx', args: ['-y', PKG, 'mcp', 'holder'], env: {JAZZCAT_HOLDER_TOKEN: t}});
function holderJson(file, key, entry) {
  let cur = {};
  if (fs.existsSync(file)) { try { cur = JSON.parse(fs.readFileSync(file, 'utf8') || '{}'); } catch { return {status: 'failed', where: file, note: 'not valid JSON, left alone'}; } }
  const had = !!cur?.[key]?.[HOLDER_NAME];
  fs.mkdirSync(path.dirname(file), {recursive: true});
  fs.writeFileSync(file, JSON.stringify({...cur, [key]: {...(cur[key] || {}), [HOLDER_NAME]: entry}}, null, 2) + '\n', {mode: 0o600});
  private_(file);
  return {status: had ? 'replaced' : 'added', where: file, note: had ? `replaced your earlier "${HOLDER_NAME}" entry` : null};
}
function holderEntry(client, token) {
  const header = {Authorization: `Bearer ${token}`};
  switch (client) {
    case 'claude': {
      if (!which('claude')) return {status: 'failed', where: 'Claude Code', note: 'no claude CLI on PATH'};
      const had = spawnQuiet('claude', ['mcp', 'get', HOLDER_NAME]) === 0;
      if (had) spawnQuiet('claude', ['mcp', 'remove', '--scope', 'user', HOLDER_NAME]);
      return spawnQuiet('claude', ['mcp', 'add', '--transport', 'http', '--scope', 'user', HOLDER_NAME, URL_HOLDER, '--header', `Authorization: Bearer ${token}`]) === 0
        ? {status: had ? 'replaced' : 'added', where: 'Claude Code, user scope', note: had ? `replaced your earlier "${HOLDER_NAME}" entry` : null} : {status: 'failed', where: 'Claude Code', note: 'claude mcp add failed'};
    }
    case 'codex': {
      const file = path.join(codexHome(), 'config.toml'), cur = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
      // Drop an earlier [mcp_servers.jazzcats] block (and its sub-tables), then add ours: the stdio bridge with the token in env.
      const out = [], lines = cur.split('\n'); let skip = false, had = false;
      for (const l of lines) { const h = /^\s*\[([^\]]+)\]\s*$/.exec(l); if (h) { skip = h[1] === `mcp_servers.${HOLDER_NAME}` || h[1].startsWith(`mcp_servers.${HOLDER_NAME}.`); if (skip) had = true; } if (!skip) out.push(l); }
      const block = `\n[mcp_servers.${HOLDER_NAME}]\ncommand = "npx"\nargs = ["-y", "${PKG}", "mcp", "holder"]\nenv = { JAZZCAT_HOLDER_TOKEN = "${token}" }\n`;
      fs.mkdirSync(path.dirname(file), {recursive: true}); fs.writeFileSync(file, out.join('\n').replace(/\n+$/, '\n') + block, {mode: 0o600}); private_(file);
      return {status: had ? 'replaced' : 'added', where: file, note: had ? `replaced your earlier "${HOLDER_NAME}" entry` : null};
    }
    case 'cursor': return holderJson(path.join(HOME(), '.cursor', 'mcp.json'), 'mcpServers', {url: URL_HOLDER, headers: header});
    case 'vscode': return holderJson(path.join(vscodeUserDir(), 'mcp.json'), 'servers', {type: 'http', url: URL_HOLDER, headers: header});
    case 'desktop': return holderJson(path.join(desktopDir(), 'claude_desktop_config.json'), 'mcpServers', HOLDER_BRIDGE(token));
  }
}
async function holderSignIn(clients, {fromStdin}) {
  let token;
  if (fromStdin) token = await readStdinToken();
  else {
    const yes = await ask('\nDo you hold a JazzCat? (y/N) ');
    if (!/^y(es)?$/i.test(yes || '')) return null;
    say(`Sign in with your Cat: open ${URL_PAIR}, connect the wallet that holds it, press Sign in and sign the message. Nothing is paid and nothing moves.`);
    if (openBrowser(URL_PAIR)) say('(Opened it in your browser.)');
    token = await ask('Paste the jc_ token the page shows (it stays hidden): ', {hidden: true});
  }
  if (!TOKEN_RE.test(token || '')) { say('That is not a jc_ token, so nothing was written. Run npx jazzcat again when you have it.'); return false; }
  if (!await tokenWorks(token)) { say(`That token didn't open a session (expired or revoked?), so nothing was written. Sign in again on ${URL_PAIR}.`); return false; }
  say('Your Cat is signed in:');
  let any = false;
  for (const c of clients) { const r = holderEntry(c, token); if (['added', 'replaced'].includes(r.status)) any = true; say(line(AGENTS[c].label, HOLDER_NAME, r)); }
  say(`Revoke it any time on ${URL_PAIR} (your sign-ins, Revoke). Access also ends by itself when the Cat is sold: the server checks who holds it.`);
  return any;
}

// npx jazzcat / npx jazzcat connect [client] [--no-skill] [--dry-run] [--actions] [--holder-token-stdin]
async function connect(args) {
  const dry = args.includes('--dry-run'), noSkill = args.includes('--no-skill'), fromStdin = args.includes('--holder-token-stdin'), askHolder = fromStdin || args.includes('--holder') || !!process.stdin.isTTY;
  const rest = args.filter(a => !a.startsWith('--'));
  const picked = rest[0];
  if (picked && !AGENTS[picked]) { help(); process.exit(1); }
  const clients = picked ? [picked] : Object.keys(AGENTS).filter(c => AGENTS[c].found());
  if (!clients.length) {
    say(`No AI agents found on this computer (looked for ${Object.values(AGENTS).map(a => a.label).join(', ')}).\nPick one: npx jazzcat connect claude | codex | cursor | vscode | desktop`);
    process.exit(1);
  }
  let actions = args.includes('--actions');
  if (!actions && !dry && !fromStdin && process.stdin.isTTY) {
    const yes = await ask('Let your agent prepare trades, job steps and other actions for you to sign? You sign every one yourself; read-only otherwise. (y/N) ');
    actions = /^y(es)?$/i.test(yes || '');
  }
  let text = null, skillErr = null;
  if (!noSkill && clients.some(c => AGENTS[c].skills)) { try { text = await fetchSkill(); } catch (e) { skillErr = e.message; } }
  say(dry ? 'Dry run: nothing is written.' : 'Setting up New Jazz City:');
  let ok = 0;
  const savedSkill = new Set();
  for (const c of clients) {
    const a = AGENTS[c], m = addMcp(c, {dry, project: !!picked, actions});
    if (['added', 'already', 'would add', 'left'].includes(m.status)) ok++;
    say(line(a.label, 'MCP', m));
    if (noSkill) continue;
    if (!a.skills) { say(`  ${''.padEnd(15)} skill: ${c === 'desktop' ? 'Claude Desktop reads skills from the app, not a folder (Settings → Capabilities)' : 'none on disk'}`); continue; }
    if (skillErr) { say(`  ${''.padEnd(15)} skill: not saved, ${skillErr}`); continue; }
    const dir = a.skills(); if (savedSkill.has(dir)) continue; savedSkill.add(dir);
    say(line('', 'skill', saveSkill(dir, text, dry)));
  }
  const missing = picked ? [] : Object.keys(AGENTS).filter(c => !clients.includes(c)).map(c => AGENTS[c].label);
  if (missing.length) say(`Not found: ${missing.join(', ')}.`);
  say(actions ? 'Mode: your agent can prepare actions (trades, job steps) for you to sign. Nothing is ever signed or sent for you.'
    : 'Mode: read-only. To let your agent prepare trades and job steps for you to sign: npx jazzcat --actions');
  if (dry) { if (askHolder) say(`Then it would ask whether you hold a JazzCat, and sign you in through ${URL_PAIR}.`); return; }
  if (!ok) process.exit(1);
  const signedIn = askHolder ? await holderSignIn(clients, {fromStdin}) : null;
  closeInput();
  say(`\nDone. Start a fresh session in your agent; it can now:`);
  for (const q of signedIn ? HOLDER_ASKS : ASKS) say(`  - ${q}`);
  if (signedIn === false && fromStdin) process.exit(1);
}

// stdio <-> Streamable HTTP bridge. Each JSON-RPC line on stdin is POSTed to the MCP; replies (JSON or SSE) go to stdout.
async function bridge(target, actions = false) {
  const holder = target === 'holder', url = holder ? URL_HOLDER : URL_MCP, token = holder ? process.env.JAZZCAT_HOLDER_TOKEN || '' : '';
  let session = null;
  const out = m => process.stdout.write(JSON.stringify(m) + '\n');
  const fail = (id, message) => { if (id !== undefined && id !== null) out({jsonrpc: '2.0', id, error: {code: -32000, message}}); };
  const queue = [];
  let busy = false;
  async function send(line) {
    let msg; try { msg = JSON.parse(line); } catch { return; }
    try {
      const headers = {'content-type': 'application/json', accept: 'application/json, text/event-stream', 'user-agent': 'jazzcat/1'};
      if (session) headers['mcp-session-id'] = session;
      if (!holder && actions) headers['x-njc-actions'] = 'on';
      if (holder) { if (!TOKEN_RE.test(token)) return fail(msg.id, 'JAZZCAT_HOLDER_TOKEN is not set to a jc_ token: run npx jazzcat and sign in with your Cat.'); headers.authorization = `Bearer ${token}`; }
      const r = await fetch(url, {method: 'POST', headers, body: JSON.stringify(msg)});
      const sid = r.headers.get('mcp-session-id'); if (sid) session = sid;
      if (r.status === 202 || r.status === 204) return;
      const type = r.headers.get('content-type') || '';
      const text = await r.text();
      if (!r.ok && !text) return fail(msg.id, `New Jazz City answered ${r.status}`);
      if (type.includes('text/event-stream')) {
        for (const block of text.split(/\r?\n\r?\n/)) {
          const data = block.split(/\r?\n/).filter(l => l.startsWith('data:')).map(l => l.slice(5).trimStart()).join('\n');
          if (data) { try { out(JSON.parse(data)); } catch {} }
        }
      } else if (text) {
        const j = JSON.parse(text); (Array.isArray(j) ? j : [j]).forEach(out);
      }
    } catch (e) { fail(msg.id, `Couldn't reach New Jazz City: ${e.message}`); }
  }
  async function pump() { if (busy) return; busy = true; while (queue.length) await send(queue.shift()); busy = false; }
  const rl = readline.createInterface({input: process.stdin});
  rl.on('line', l => { if (l.trim()) { queue.push(l); pump(); } });
  rl.on('close', async () => { while (busy || queue.length) await new Promise(r => setTimeout(r, 50)); process.exit(0); });
}

// jazzcat proof: prints the proof as JSON; exits 0 when it holds, 1 when it doesn't, 2 on a usage mistake.
async function proof(args) {
  const P = await import('../lib/proof.js');
  const register = process.env.JAZZCAT_REGISTER_URL || P.REGISTER;
  const print = o => { console.log(JSON.stringify(o, null, 2)); process.exit(o.ok ? 0 : 1); };
  const usage = () => { say(`usage:
  jazzcat proof <file>
  jazzcat proof <file> <output-id> <payment-tx>
  jazzcat proof <output-id> <payment-tx>
  jazzcat proof lint '<request JSON>'`); process.exit(2); };
  const [a, b, c] = args;
  if (!a) return usage();
  if (a === 'lint') return b ? print(await P.lint(b)) : usage();
  if (fs.existsSync(a)) {
    if (b && !c) return usage();
    return print(await P.proveFile(a, {output: b, tx: c, register}));
  }
  if (b && /^0x[0-9a-fA-F]{64}$/.test(b) && !c) return print(await P.verify(a, b));
  say(`No file at ${a}.`); usage();
}

async function recipesCmd(args) {
  const R = await import('../lib/recipes.js');
  if (args[0] === '--out') {
    if (!args[1]) { say('usage: jazzcat recipes --out <dir>'); process.exit(2); }
    const written = R.writeRecipes(args[1]);
    say(`Wrote ${written.length} recipes to ${args[1]}. Add them to Oak with:\n  oak recipes add ${args[1]}`);
    return;
  }
  if (args[0]) {
    const r = R.recipe(args[0]);
    if (!r) { say(`No recipe named ${args[0]}. jazzcat recipes lists them.`); process.exit(1); }
    console.log(JSON.stringify(r, null, 2));
    return;
  }
  const all = R.recipes(), w = Math.max(...all.map(r => r.name.length));
  for (const r of all) console.log(`${r.name.padEnd(w)}  ${r.kind === 'read' ? 'read' : 'tx  '}  ${r.description}`);
  say(`\n${all.length} recipes for Robinhood Chain. Print one: jazzcat recipes <name>. For Oak: jazzcat recipes --out <dir>, then oak recipes add <dir>.`);
}

// jazzcat city: New Jazz City in the terminal, read only (lib/city.js). A full screen on a terminal; feed lines otherwise.
//   --once   one frame (or, without a terminal, the feed once) and exit
//   --line   feed lines only, even on a terminal
// JAZZCAT_CITY_FIXTURE=<file with {economy, tail}> reads that instead of the network (tests).
async function cityCmd(args) {
  const C = await import('../lib/city.js'), {NewJazzCity} = await import('../lib/sdk.js');
  const once = args.includes('--once'), lineMode = args.includes('--line') || !process.stdout.isTTY;
  const fixture = process.env.JAZZCAT_CITY_FIXTURE ? JSON.parse(fs.readFileSync(process.env.JAZZCAT_CITY_FIXTURE, 'utf8')) : null;
  const get = async url => fixture ? (url.startsWith(C.ECONOMY_URL) ? fixture.economy : fixture.tail)
    : (await fetch(url, {headers: {'user-agent': 'jazzcat-city/1'}, signal: AbortSignal.timeout(20000)})).json();
  const city = new NewJazzCity({timeoutMs: 60_000});
  const econ = await get(C.ECONOMY_URL);
  const state = {events: C.mergeEvents([], econ.events || []), head: econ.asOfBlock, notes: [], input: ''};
  let from = Number(econ.asOfBlock || 0), printed = new Set();
  const key = e => `${e.tx}|${e.kind}|${e.token ?? ''}|${e.src || ''}`;
  const pull = async () => {
    try { const t = await get(`${C.TAIL_URL}?from=${from}`); state.head = t.head || state.head; from = Math.max(from, Number(t.to || from));
      state.events = C.mergeEvents(state.events, C.decodeTail(t)); } catch {}
  };
  await pull();
  const stamp = C.hhmm;
  if (lineMode) {
    const emit = () => { for (const e of [...state.events].reverse()) { if (printed.has(key(e))) continue; printed.add(key(e));
      console.log(`${stamp(e.time)}  ${C.placeName(C.placeOf(e)).padEnd(14)}  ${C.clean(e.line || e.kind)}`); } };
    console.log(`New Jazz City · Robinhood Chain · block ${state.head ?? '…'} (read only; map: ${C.MAP_URL})`);
    for (const e of state.events.slice(12)) printed.add(key(e)); // the newest 12 to start
    emit(); if (once) return;
    setInterval(async () => { await pull(); emit(); }, 5000);
    return;
  }
  const out = process.stdout, draw = () => { try { out.write('\x1b[H\x1b[2J' + C.render(state, {width: out.columns || 80, height: out.rows || 24})); } catch (e) { state.notes.push('Could not draw: ' + String(e.message).slice(0, 80)); } };
  if (once) { console.log(C.render(state, {width: out.columns || 80, height: out.rows || 24})); return; }
  out.write('\x1b[?1049h\x1b[?25l'); // the alternate screen, no cursor
  // The terminal comes back on every way out: Ctrl-C, /quit, SIGTERM, SIGHUP, a crash (review 11-28).
  let restored = false; const restore = () => { if (!restored) { restored = true; out.write('\x1b[?25h\x1b[?1049l'); } };
  const leave = code => { restore(); process.exit(code); };
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => leave(0));
  process.on('uncaughtException', e => { restore(); console.error(e); process.exit(1); }); process.on('unhandledRejection', e => { restore(); console.error(e); process.exit(1); });
  process.on('exit', restore); out.on('resize', draw);
  readline.emitKeypressEvents(process.stdin); process.stdin.setRawMode?.(true);
  process.stdin.on('keypress', async (ch, k) => {
    if (k?.ctrl && k.name === 'c') return leave(0);
    if (k?.name === 'return') {
      const c = C.parseCommand(state.input); state.input = '';
      if (c?.cmd === 'quit') return leave(0);
      try { state.notes.push(...await C.runCommand(c, {city, state})); } catch (e) { state.notes.push('Could not: ' + String(e.message || e).slice(0, 120)); }
      state.notes = state.notes.slice(-6);
    } else if (k?.name === 'backspace') state.input = state.input.slice(0, -1);
    else if (ch && !k?.ctrl && !k?.meta && ch.length === 1 && ch >= ' ') state.input += ch;
    draw();
  });
  draw(); setInterval(async () => { await pull(); draw(); }, 5000);
}

const [cmd, ...rest] = process.argv.slice(2);
const arg = rest[0];
if (!cmd || cmd === 'connect' || ['--dry-run', '--no-skill', '--holder-token-stdin', '--holder', '--actions'].includes(cmd)) await connect(cmd === 'connect' ? rest : process.argv.slice(2));
else if (cmd === 'mcp') bridge(arg, rest.includes('--actions'));
else if (cmd === 'url') console.log(URL_MCP);
else if (cmd === 'proof') await proof(rest);
else if (cmd === 'recipes') await recipesCmd(rest);
else if (cmd === 'skill') await skill(rest);
else if (cmd === 'city') await cityCmd(rest);
else if (cmd === 'help' || cmd === '--help' || cmd === '-h') help();
else { help(); process.exit(1); }
