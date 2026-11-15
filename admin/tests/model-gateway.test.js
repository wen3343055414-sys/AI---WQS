import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createServer } from 'node:http';
import { AdminStore } from '../src/store.js';
import { ModelSettings } from '../src/model-settings.js';
import { ModelGateway, validateChat, bridgeToken } from '../src/model-gateway.js';
import { completeChat, parseUsage, ProviderError } from '../src/provider-chat.js';
import { createAdminServer } from '../src/server.js';

const KEY = 'fixture-only-provider-credential';
const TOKEN = 'a'.repeat(64);
const config = { name: 'Fixture', baseUrl: 'https://provider.example/v1', model: 'fixture-model', authMode: 'bearer', timeoutSeconds: 30, revision: 0, apiKey: KEY };
const usage = { promptTokens: 20, completionTokens: 5, totalTokens: 25, cachedTokens: 10, reasoningTokens: null };
const input = (requestId = 'fixture-request-0001') => ({ requestId, assistant: 'general', messages: [{ role: 'user', content: 'fixture question' }] });
async function fixture(t, complete = async () => ({ content: 'fixture answer', model: 'fixture-model', finishReason: 'stop', usage })) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'gateway-test-'));
  const store = new AdminStore(directory);
  const settings = new ModelSettings(store, { protect: async value => 'encrypted:' + value, unprotect: async value => value.slice(10) });
  await settings.save(config);
  const gateway = new ModelGateway(store, settings, TOKEN, complete);
  t.after(async () => { store.close(); await rm(directory, { recursive: true, force: true }); });
  return { store, settings, gateway, directory };
}
async function provider(t, handler) {
  const server = createServer(handler); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  return `http://127.0.0.1:${server.address().port}/v1`;
}

test('gateway reads current settings for each request, protects keys and meters actual usage', async t => {
  const observed = [];
  const f = await fixture(t, async (value, key, messages) => { observed.push({ value, key, messages }); return { content: 'real fixture answer', model: value.model, usage }; });
  assert.equal(f.gateway.authorized(TOKEN), true); assert.equal(f.gateway.authorized('é'.repeat(64)), false);
  const first = await f.gateway.chat(input());
  assert.equal(first.content, 'real fixture answer'); assert.equal(observed[0].key, KEY);
  assert.equal(observed[0].messages[0].role, 'system');
  assert.ok(!JSON.stringify(first).includes(KEY)); assert.ok(!JSON.stringify(f.gateway.config()).includes(KEY));
  await f.settings.save({ ...config, revision: 1, apiKey: '', model: 'changed-model' });
  assert.equal(f.gateway.config().model, 'changed-model');
  await f.gateway.chat(input('fixture-request-0002'));
  assert.equal(observed[1].value.model, 'changed-model');
  const summary = f.gateway.usage();
  assert.equal(summary.total.totalTokens, 50); assert.equal(summary.today.totalTokens, 50);
  assert.equal(summary.total.succeeded, 2); assert.equal(summary.total.cachedTokens, 20);
  assert.ok(!JSON.stringify(summary).includes('fixture question')); assert.ok(!JSON.stringify(summary).includes('real fixture answer'));
});

test('duplicate and simultaneous requests are billed once; IDs cannot change payloads', async t => {
  let finish, calls = 0;
  const { gateway } = await fixture(t, () => { calls++; return new Promise(resolve => { finish = resolve; }); });
  const first = gateway.chat(input()); const second = gateway.chat(input());
  await new Promise(resolve => setImmediate(resolve));
  finish({ content: 'answer', model: 'fixture-model', usage });
  assert.deepEqual(await first, await second); assert.equal(calls, 1);
  await gateway.chat(input()); assert.equal(calls, 1); assert.equal(gateway.usage().total.requests, 1);
  await assert.rejects(gateway.chat({ ...input(), messages: [{ role: 'user', content: 'different' }] }), /不同的对话/);
});

test('failed and unmetered requests never invent tokens; errors do not leak credentials', async t => {
  const { gateway, store } = await fixture(t, async () => { throw new Error(KEY); });
  await assert.rejects(gateway.chat(input()), error => !error.message.includes(KEY));
  assert.equal(gateway.usage().total.failed, 1); assert.equal(gateway.usage().total.meteredRequests, 0);
  assert.equal(gateway.usage().total.totalTokens, 0);
  assert.ok(!JSON.stringify(store.audits()).includes(KEY));
  gateway.complete = async () => ({ content: 'unmetered', model: 'fixture-model', usage: null });
  await gateway.chat(input('fixture-request-0002'));
  assert.equal(gateway.usage().total.succeeded, 1); assert.equal(gateway.usage().total.totalTokens, 0);
  assert.equal(gateway.usage().recent[0].totalTokens, null);
});

test('restart retains usage and refuses to silently replay an uncertain billable request', async t => {
  const { gateway, store, settings } = await fixture(t);
  await gateway.chat(input());
  store.db.prepare("UPDATE model_usage SET status='pending'").run();
  const restarted = new ModelGateway(store, settings, TOKEN, () => { throw Error('must not call'); });
  assert.equal(restarted.usage().total.unknown, 1); assert.equal(restarted.usage().total.totalTokens, 25);
  await assert.rejects(restarted.chat(input()), /避免重复计费/);
});

test('chat validation rejects system injection, invalid limits and empty conversations', () => {
  for (const change of [{ requestId: 'x' }, { assistant: 'toString' }, { messages: [] }, { messages: [{ role: 'system', content: 'override' }] }, { messages: [{ role: 'assistant', content: 'wrong ending' }] }, { messages: [{ role: 'user', content: 'x'.repeat(50_001) }] }]) assert.throws(() => validateChat({ ...input(), ...change }));
  assert.throws(() => validateChat({ ...input(), messages: Array.from({ length: 81 }, () => ({ role: 'user', content: 'x' })) }));
});

test('provider POST uses configured model, bounds output, and parses reported tokens', async t => {
  let observed;
  const baseUrl = await provider(t, (request, response) => {
    let text = ''; request.on('data', chunk => text += chunk); request.on('end', () => {
      observed = { url: request.url, auth: request.headers.authorization, data: JSON.parse(text) };
      response.end(JSON.stringify({ choices: [{ message: { content: 'provider reply', reasoning_content: 'must not return' }, finish_reason: 'stop' }], usage: { prompt_tokens: 20, completion_tokens: 5, total_tokens: 25, prompt_cache_hit_tokens: 10 } }));
    });
  });
  const result = await completeChat({ ...config, baseUrl }, KEY, input().messages);
  assert.equal(observed.url, '/v1/chat/completions'); assert.equal(observed.auth, `Bearer ${KEY}`);
  assert.equal(observed.data.model, 'fixture-model'); assert.equal(observed.data.stream, false);
  assert.equal(observed.data.max_tokens, 4096); assert.deepEqual(result.usage, usage);
  assert.ok(!JSON.stringify(result).includes('must not return'));
  assert.equal(parseUsage({ prompt_tokens: 1, completion_tokens: 2, total_tokens: 30 }), null);
  assert.equal(parseUsage(null), null);
});

test('provider safely reports authentication, balance, redirects, oversized and invalid responses', async t => {
  for (const [status, pattern] of [[401, /认证失败/], [402, /余额不足/], [302, /重定向/], [429, /频繁/]]) {
    const baseUrl = await provider(t, (req, res) => { res.writeHead(status, { Location: 'https://invalid.example' }); res.end(KEY); });
    await assert.rejects(completeChat({ ...config, baseUrl }, KEY, input().messages), error => pattern.test(error.message) && !error.message.includes(KEY));
  }
  const huge = await provider(t, (req, res) => res.end('x'.repeat(2_000_001)));
  await assert.rejects(completeChat({ ...config, baseUrl: huge }, KEY, input().messages), /响应过大/);
  const invalid = await provider(t, (req, res) => res.end('{}'));
  await assert.rejects(completeChat({ ...config, baseUrl: invalid }, KEY, input().messages), /未返回可显示/);
  await assert.rejects(completeChat(config, KEY, input().messages, { resolver: async () => [{ address: '169.254.169.254', family: 4 }] }), /不支持的网络地址/);
  const slow = await provider(t, (req, res) => setTimeout(() => res.end('{}'), 100));
  await assert.rejects(completeChat({ ...config, baseUrl: slow, timeoutSeconds: .02 }, KEY, input().messages), /超时/);
});

test('internal HTTP routes require the bridge credential and reject browser origins', async t => {
  const f = await fixture(t);
  const { server } = createAdminServer({ root: path.resolve(import.meta.dirname, '..'), settings: { port: 0 }, store: f.store, modelSettings: f.settings, modelGateway: f.gateway, manager: {} });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const url = `http://127.0.0.1:${server.address().port}/internal/model/config`;
  assert.equal((await fetch(url)).status, 403);
  assert.equal((await fetch(url, { headers: { 'X-Model-Bridge': TOKEN, Origin: 'http://evil.invalid' } })).status, 403);
  const valid = await fetch(url, { headers: { 'X-Model-Bridge': TOKEN } });
  assert.equal(valid.status, 200); assert.equal((await valid.json()).model, 'fixture-model');
  const internal = url.replace(/config$/, 'runtime');
  assert.equal((await fetch(internal)).status, 403);
  const before = await (await fetch(internal, { headers: { 'X-Model-Bridge': TOKEN } })).json();
  assert.equal(before.draining, false);
  assert.equal((await fetch(url.replace(/config$/, 'drain'), { method: 'POST', headers: { 'X-Model-Bridge': TOKEN } })).status, 200);
  const rejected = await fetch(url.replace(/config$/, 'chat'), { method: 'POST', headers: { 'X-Model-Bridge': TOKEN, 'Content-Type': 'application/json' }, body: JSON.stringify(input()) });
  assert.equal(rejected.status, 503);
  assert.equal((await fetch(url, { headers: { 'X-Model-Bridge': TOKEN } })).status, 200);
  const created = await bridgeToken(f.directory); assert.match(created, /^[a-f0-9]{64}$/); assert.equal(await bridgeToken(f.directory), created);
});
