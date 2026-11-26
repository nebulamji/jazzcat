#!/usr/bin/env node
// jazzcat: put New Jazz City in your AI agent with one line.
//   npx jazzcat connect claude | codex | cursor | vscode | desktop
//   npx jazzcat mcp        stdio bridge to the New Jazz City MCP (what the configs run)
// No key, no sign-up. Anything that moves money comes back as a plan your own wallet signs.
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';

const URL_MCP = process.env.JAZZCAT_MCP_URL || 'https://njc-tx-explain.departmentofjazz.workers.dev/mcp';
const NAME = 'new-jazz-city';
const BRIDGE = {command: 'npx', args: ['-y', 'jazzcat', 'mcp']};
const say = s => process.stderr.write(s + '\n');

const PROMPTS = [
  'What can you do with New Jazz City? Group the tools.',
  'Read JazzCat #1: who holds it, what it was paid, its record.',
  'Show me open paid jobs for agents.',
  'Who controls agent 26026 on Robinhood Chain?',
];

function help() {
  say(`jazzcat: New Jazz City in your AI agent, one line.

  npx jazzcat connect claude     Claude Code
  npx jazzcat connect codex      Codex CLI
  npx jazzcat connect cursor     Cursor (this project)
  npx jazzcat connect vscode     VS Code (this project)
  npx jazzcat connect desktop    Claude Desktop
  npx jazzcat mcp                the bridge the configs run (stdio)
  npx jazzcat url                print the MCP address

No key, no sign-up. Anything that moves money comes back as a plan your own wallet signs.
MCP: ${URL_MCP}`);
}

function writeJson(file, mutate) {
  let cur = {};
  if (fs.existsSync(file)) { try { cur = JSON.parse(fs.readFileSync(file, 'utf8') || '{}'); } catch { say(`Not valid JSON, left alone: ${file}`); process.exit(1); } }
  const next = mutate(cur);
  fs.mkdirSync(path.dirname(file), {recursive: true});
  fs.writeFileSync(file, JSON.stringify(next, null, 2) + '\n');
}

function done(where) {
  say(`New Jazz City is connected (${where}). Start a fresh session, then try:`);
  for (const p of PROMPTS) say(`  - ${p}`);
}

function connect(target) {
  switch (target) {
    case 'claude': {
      try {
        execFileSync('claude', ['mcp', 'add', '--scope', 'user', NAME, '--', ...[BRIDGE.command, ...BRIDGE.args]], {stdio: 'inherit'});
        return done('Claude Code, user scope');
      } catch {
        say(`Couldn't run the claude CLI. Inside Claude Code, run:\n  claude mcp add --scope user ${NAME} -- npx -y jazzcat mcp`);
        process.exit(1);
      }
    }
    case 'codex': {
      const file = path.join(os.homedir(), '.codex', 'config.toml');
      const block = `\n[mcp_servers.${NAME}]\ncommand = "npx"\nargs = ["-y", "jazzcat", "mcp"]\n`;
      const cur = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
      if (cur.includes(`[mcp_servers.${NAME}]`)) return done(`already in ${file}`);
      fs.mkdirSync(path.dirname(file), {recursive: true});
      fs.appendFileSync(file, block);
      return done(file);
    }
    case 'cursor': {
      const file = path.join(process.cwd(), '.cursor', 'mcp.json');
      writeJson(file, c => ({...c, mcpServers: {...(c.mcpServers || {}), [NAME]: {...BRIDGE}}}));
      return done(file);
    }
    case 'vscode': {
      const file = path.join(process.cwd(), '.vscode', 'mcp.json');
      writeJson(file, c => ({...c, servers: {...(c.servers || {}), [NAME]: {type: 'stdio', ...BRIDGE}}}));
      return done(file);
    }
    case 'desktop': {
      const dir = process.platform === 'darwin' ? path.join(os.homedir(), 'Library', 'Application Support', 'Claude')
        : process.platform === 'win32' ? path.join(process.env.APPDATA || '', 'Claude') : path.join(os.homedir(), '.config', 'Claude');
      const file = path.join(dir, 'claude_desktop_config.json');
      writeJson(file, c => ({...c, mcpServers: {...(c.mcpServers || {}), [NAME]: {...BRIDGE}}}));
      return done(`${file} (restart Claude Desktop)`);
    }
    default:
      help(); process.exit(target ? 1 : 0);
  }
}

// stdio <-> Streamable HTTP bridge. Each JSON-RPC line on stdin is POSTed to the MCP; replies (JSON or SSE) go to stdout.
async function bridge() {
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
      const r = await fetch(URL_MCP, {method: 'POST', headers, body: JSON.stringify(msg)});
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

const [cmd, arg] = process.argv.slice(2);
if (cmd === 'connect') connect(arg);
else if (cmd === 'mcp') bridge();
else if (cmd === 'url') console.log(URL_MCP);
else { help(); process.exit(cmd ? 1 : 0); }
