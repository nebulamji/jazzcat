// The library export (import {NewJazzCity} from 'jazzcat'), offline: a fake MCP server.
import test from 'node:test';
import assert from 'node:assert/strict';
import Default, {NewJazzCity, NjcError, OPEN_SERVER} from 'jazzcat';

const server = (reply, seen = []) => async (url, init) => {
  const body = JSON.parse(init.body); seen.push({url, body, headers: init.headers});
  const r = reply(body);
  return new Response(typeof r === 'string' ? r : JSON.stringify({jsonrpc: '2.0', id: body.id, ...r}), {status: 200});
};

test('the default export and the named export are the same client, aimed at the open server', () => {
  assert.equal(Default, NewJazzCity);
  assert.equal(new NewJazzCity({fetch: async () => {}}).server, OPEN_SERVER);
  assert.match(OPEN_SERVER, /^https:\/\/njc-tx-explain\.departmentofjazz\.workers\.dev\/mcp$/);
});

test('call() sends tools/call and prefers structuredContent, then JSON text, then plain text', async () => {
  const seen = [];
  const city = new NewJazzCity({fetch: server(b => b.params.name === 'cat_self' ? {result: {structuredContent: {cat: 1}, content: [{type: 'text', text: 'ignored'}]}}
    : b.params.name === 'jobs_board' ? {result: {content: [{type: 'text', text: '{"jobs":[]}'}]}} : {result: {content: [{type: 'text', text: 'plain words'}]}}, seen)});
  assert.deepEqual(await city.cat('1'), {cat: 1});
  assert.equal(seen[0].body.method, 'tools/call'); assert.deepEqual(seen[0].body.params, {name: 'cat_self', arguments: {cat: 1}});
  assert.deepEqual(await city.jobs(), {jobs: []});
  assert.equal(await city.brief(), 'plain words');
  assert.equal(seen[0].headers.accept, 'application/json, text/event-stream');
});

test('an SSE answer is read; a tool error and an RPC error become NjcError', async () => {
  const sse = new NewJazzCity({fetch: async (u, i) => new Response(`event: message\ndata: ${JSON.stringify({jsonrpc: '2.0', id: JSON.parse(i.body).id, result: {tools: [{name: 'cat_self'}]}})}\n\n`)});
  assert.deepEqual(await sse.tools(), [{name: 'cat_self'}]);
  const bad = new NewJazzCity({fetch: server(() => ({result: {isError: true, content: [{type: 'text', text: 'Pass exactly one of id or address.'}]}}))});
  await assert.rejects(bad.title({}), e => e instanceof NjcError && e.tool === 'agent_title' && /exactly one/.test(e.message));
  const rpc = new NewJazzCity({fetch: server(() => ({error: {code: -32601, message: 'Method not found'}}))});
  await assert.rejects(rpc.tools(), e => e instanceof NjcError && e.code === -32601);
});

test('an SSE answer with a notification first still gives the response to this request (Codex, jazzcat #1)', async () => {
  const sse = (lines, crlf = false) => new NewJazzCity({fetch: async (u, i) => { const id = JSON.parse(i.body).id;
    return new Response(lines(id).join(crlf ? '\r\n' : '\n'), {headers: {'content-type': 'text/event-stream'}}); }});
  const note = {jsonrpc: '2.0', method: 'notifications/message', params: {level: 'info', data: 'working'}};
  const lines = id => ['event: message', `data: ${JSON.stringify(note)}`, '', 'event: message', `data: ${JSON.stringify({jsonrpc: '2.0', id, result: {tools: [{name: 'cat_self'}]}})}`, '', ''];
  assert.deepEqual(await sse(lines).tools(), [{name: 'cat_self'}]);
  assert.deepEqual(await sse(lines, true).tools(), [{name: 'cat_self'}]);
  await assert.rejects(sse(() => ['event: message', `data: ${JSON.stringify(note)}`, '', '']).tools(), e => e instanceof NjcError && e.code === 'no-response');
});

test('calls running at once each get their own answer', async () => {
  const city = new NewJazzCity({fetch: async (u, i) => { const b = JSON.parse(i.body); await new Promise(r => setTimeout(r, b.params.arguments.cat === 1 ? 30 : 1));
    return new Response(`event: message\ndata: ${JSON.stringify({jsonrpc: '2.0', id: b.id, result: {structuredContent: {cat: b.params.arguments.cat}}})}\n\n`); }});
  assert.deepEqual(await Promise.all([city.cat(1), city.cat(2)]), [{cat: 1}, {cat: 2}]);
});

test('a slow server times out as NjcError; plans are only ever asked for, never sent', async () => {
  const slow = new NewJazzCity({timeoutMs: 20, fetch: (u, i) => new Promise((_, rej) => i.signal.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), {name: 'AbortError'}))))});
  await assert.rejects(slow.tools(), e => e instanceof NjcError && e.code === 'timeout');
  const seen = [];
  const city = new NewJazzCity({fetch: server(() => ({result: {structuredContent: {transactions: []}}}), seen)});
  await city.tradePlan({token: '0x1F243C6638A6BECD787F326B240227687A3835BC', amountIn: 10n ** 15n, trader: '0x' + '1'.repeat(40)});
  assert.deepEqual(seen[0].body.params, {name: 'qhooks_trade', arguments: {chain: '4663', token: '0x1f243c6638a6becd787f326b240227687a3835bc', side: 'buy', amountIn: '1000000000000000', trader: '0x' + '1'.repeat(40)}});
});
