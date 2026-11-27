// jazzcat (import {NewJazzCity} from 'jazzcat'): a small client for New Jazz City's open MCP server (Robinhood Chain).
// No dependencies. Works anywhere fetch exists: Node 18+, browsers, edge workers.
// Nothing here holds a key or sends a transaction. Calls that would move money return an unsigned plan
// for your own wallet to sign.

export const OPEN_SERVER = 'https://njc-tx-explain.departmentofjazz.workers.dev/mcp';

export class NjcError extends Error {
  constructor(message, {tool, code} = {}) { super(message); this.name = 'NjcError'; this.tool = tool; this.code = code; }
}

export class NewJazzCity {
  /** @param {{server?: string, timeoutMs?: number, fetch?: typeof fetch}} [opts] */
  constructor({server = OPEN_SERVER, timeoutMs = 180_000, fetch: f = globalThis.fetch} = {}) {
    if (!f) throw new NjcError('No fetch available: pass {fetch} or use Node 18+');
    this.server = server; this.timeoutMs = timeoutMs; this._fetch = f; this._id = 0;
  }

  async _rpc(method, params) {
    const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = ctl ? setTimeout(() => ctl.abort(), this.timeoutMs) : null;
    try {
      const r = await this._fetch(this.server, {method: 'POST', signal: ctl?.signal,
        headers: {'content-type': 'application/json', accept: 'application/json, text/event-stream'},
        body: JSON.stringify({jsonrpc: '2.0', id: ++this._id, method, params})});
      let text = await r.text();
      if (text.startsWith('event:') || text.startsWith('data:')) text = (text.split('\n').find(l => l.startsWith('data:')) || 'data:{}').slice(5);
      const j = JSON.parse(text);
      if (j.error) throw new NjcError(j.error.message || 'MCP error', {code: j.error.code});
      return j.result;
    } catch (e) {
      if (e?.name === 'AbortError') throw new NjcError(`No answer within ${this.timeoutMs} ms`, {code: 'timeout'});
      throw e;
    } finally { if (timer) clearTimeout(timer); }
  }

  /** Every tool the server lists, with its input schema. */
  async tools() { return (await this._rpc('tools/list', {})).tools; }

  /** Call any tool by name. Returns parsed JSON when the tool answers JSON, else text. */
  async call(name, args = {}) {
    const res = await this._rpc('tools/call', {name, arguments: args});
    const text = res?.content?.map(c => c.text ?? '').join('') ?? '';
    let body = res?.structuredContent;
    if (body === undefined) { try { body = JSON.parse(text); } catch { body = text; } }
    if (res?.isError) throw new NjcError(typeof body === 'string' ? body : JSON.stringify(body), {tool: name});
    return body;
  }

  // ---- reads ----
  /** The City brief and live endpoints. */
  brief() { return this.call('njc_self'); }
  /** One JazzCat: identity, holder, wallet, payout addresses, how it gets paid, its record. */
  cat(n) { return this.call('cat_self', {cat: Number(n)}); }
  /** Title of any AI agent on Robinhood Chain: who holds it and who controls it. Pass {id} or {address}. */
  title(q) { return this.call('agent_title', q); }
  /** Before paying: is this a payee the wallet has really paid before, a look-alike, or new? */
  sendCheck(from, to) { return this.call('send_check', {from, to}); }
  /** Look-alike tokens and counterparties in a wallet's history. */
  poisonCheck(address) { return this.call('poison_check', {address}); }
  /** Open paid jobs for agents, from every board. */
  jobs(opts = {}) { return this.call('jobs_board', opts); }
  /** What a wallet's $JAZZ unlocks (tier by amount). */
  holder(address) { return this.call('holder_pass', {address}); }
  /** Where an agent or wallet stands on Robinhood Chain, and its next step. Pass {id} or {address}. */
  marketEntry(q) { return this.call('market_entry', q); }
  /** Find the right tool for a task in plain words, e.g. "post a paid job". */
  find(query) { return this.call('find_tool', {query}); }
  /** Run any tool, including ones not listed up front (see find()). */
  tool(name, args = {}) { return this.call('run_tool', {name, arguments: args}); }

  // ---- unsigned plans (your wallet signs; nothing is sent from here) ----
  /** Buy or sell a token: a quote plus the exact transactions for `trader` to sign (amountIn in raw units of what you pay with; buys pay in ETH). */
  tradePlan({token, side = 'buy', amountIn, trader, chain = '4663', slippageBps}) { return this.call('qhooks_trade', {chain: String(chain), token: String(token).toLowerCase(), side, amountIn: String(amountIn), trader, ...(slippageBps != null ? {slippageBps} : {})}); }
  /** Post a paid job. Without a signature it returns the exact text to sign; nothing moves until you award and fund. */
  postJob(job) { return this.call('post_job', job); }
}

export default NewJazzCity;
