import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { probeModels } from '../src/model-settings.js';
import { completeChat } from '../src/provider-chat.js';
import { parseReply } from '../src/model-protocols.js';
import { AdminStore } from '../src/store.js';
import { ModelRegistry } from '../src/model-registry.js';
import { ModelGateway } from '../src/model-gateway.js';
import { createAdminServer } from '../src/server.js';
import { ModelClient } from '../../src/model-client.js';
import { WorkspaceStore } from '../../src/store.js';

const KEY = 'fixture-native-protocol-key';
const TOKEN = 'f'.repeat(64);
const messages = [{ role: 'system', content: 'fixture system' }, { role: 'user', content: 'first turn' }, { role: 'assistant', content: 'previous reply' }, { role: 'user', content: 'next turn' }];
const vault = { protect: async value => `fixture:${value}`, unprotect: async value => value.slice(8) };
function reply(protocol) {
  if (protocol === 'anthropic') return { content: [{ type: 'thinking', thinking: 'private reasoning fixture' }, { type: 'text', text: 'provider fixture reply' }], stop_reason: 'end_turn', usage: { input_tokens: 10, cache_creation_input_tokens: 5, cache_read_input_tokens: 5, output_tokens: 5 } };
  if (protocol === 'gemini') return { candidates: [{ content: { parts: [{ text: 'private reasoning fixture', thought: true }, { text: 'provider fixture reply' }] }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 20, candidatesTokenCount: 3, thoughtsTokenCount: 2, totalTokenCount: 25, cachedContentTokenCount: 5 } };
  return { choices: [{ message: { content: 'provider fixture reply', reasoning_content: 'private reasoning fixture' }, finish_reason: 'stop' }], usage: { prompt_tokens: 20, completion_tokens: 5, total_tokens: 25, prompt_tokens_details: { cached_tokens: 5 } } };
}
async function provider(t, handler) {
  const server = createServer(handler);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  return `http://127.0.0.1:${server.address().port}`;
}
const config = (protocol, baseUrl) => ({ protocol, baseUrl, model: 'fixture-model', authMode: 'bearer', timeoutSeconds: 5 });

for (const protocol of ['openai', 'anthropic', 'gemini']) test(`${protocol} sends the native HTTP shape, protects credentials and normalizes real usage`, async t => {
  let observed;
  const baseUrl = await provider(t, async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk;
    observed = { url: req.url, headers: req.headers, body: JSON.parse(body) };
    res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(reply(protocol)));
  });
  const result = await completeChat(config(protocol, baseUrl + '/v1'), KEY, messages);
  assert.equal(result.content, 'provider fixture reply'); assert.equal(result.usage.totalTokens, 25);
  assert.equal(result.usage.promptTokens, 20); assert.equal(result.usage.completionTokens, 5);
  assert.equal(result.usage.cachedTokens, 5); assert.equal(result.finishReason, 'stop');
  assert.ok(!JSON.stringify(result).includes('private reasoning')); assert.ok(!observed.url.includes(KEY));
  if (protocol === 'openai') { assert.equal(observed.url, '/v1/chat/completions'); assert.equal(observed.headers.authorization, `Bearer ${KEY}`); assert.deepEqual(observed.body.messages, messages); }
  if (protocol === 'anthropic') { assert.equal(observed.url, '/v1/messages'); assert.equal(observed.headers['x-api-key'], KEY); assert.equal(observed.headers['anthropic-version'], '2023-06-01'); assert.equal(observed.headers.authorization, undefined); assert.equal(observed.body.system, 'fixture system'); assert.deepEqual(observed.body.messages, messages.slice(1)); }
  if (protocol === 'gemini') { assert.equal(observed.url, '/v1/models/fixture-model:generateContent'); assert.equal(observed.headers['x-goog-api-key'], KEY); assert.equal(observed.headers.authorization, undefined); assert.equal(observed.body.systemInstruction.parts[0].text, 'fixture system'); assert.equal(observed.body.contents[1].role, 'model'); assert.equal(result.usage.reasoningTokens, 2); }
});

test('OpenAI and MiniMax presets use the supported output limit without persisting separate reasoning', async t => {
  const requests = [];
  const baseUrl = await provider(t, async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk;
    requests.push(JSON.parse(body));
    res.end(JSON.stringify(reply('openai')));
  });
  for (const preset of ['openai', 'minimax']) {
    const result = await completeChat({ ...config('openai', baseUrl + '/v1'), preset }, KEY, messages);
    assert.equal(result.content, 'provider fixture reply');
    assert.ok(!JSON.stringify(result).includes('private reasoning'));
  }
  assert.ok(requests.every(r => r.max_completion_tokens === 4096 && r.max_tokens === undefined));
  assert.equal(requests[1].reasoning_split, true);
});

test('native model discovery paginates on the same endpoint and filters unsupported Gemini methods', async t => {
  const urls = [];
  const base = await provider(t, (req, res) => {
    urls.push(req.url); assert.equal(req.headers['x-goog-api-key'], KEY); assert.ok(!req.url.includes(KEY));
    const second = new URL(req.url, 'http://fixture.invalid').searchParams.get('pageToken');
    res.end(JSON.stringify(second ? { models: [{ name: 'models/second-chat', supportedGenerationMethods: ['generateContent'] }] } :
      { models: [{ name: 'models/first-chat', supportedGenerationMethods: ['generateContent'] }, { name: 'models/embedding-only', supportedGenerationMethods: ['embedContent'] }], nextPageToken: 'cursor&/fixture' }));
  });
  assert.deepEqual(await probeModels(config('gemini', base + '/v1beta'), KEY), ['first-chat', 'second-chat']);
  assert.equal(urls.length, 2); assert.match(urls[1], /pageToken=cursor%26%2Ffixture/);
});

test('Anthropic model list uses its own credentials and native IDs', async t => {
  const base = await provider(t, (req, res) => {
    assert.equal(req.headers['x-api-key'], KEY); assert.equal(req.headers.authorization, undefined);
    assert.match(req.url, /^\/v1\/models\?limit=100/);
    res.end(JSON.stringify({ data: [{ id: 'claude-fixture' }, { id: KEY }, null], has_more: false }));
  });
  assert.deepEqual(await probeModels(config('anthropic', base + '/v1'), KEY), ['claude-fixture']);
});

test('native malformed replies, inconsistent usage and reasoning-only output never invent a response', async t => {
  for (const protocol of ['anthropic', 'gemini']) {
    assert.equal(parseReply(config(protocol, ''), null).usage, null);
    const data = reply(protocol);
    if (protocol === 'gemini') data.usageMetadata.totalTokenCount = 999;
    else data.usage.output_tokens = -1;
    assert.equal(parseReply(config(protocol, ''), data).usage, null);
    const base = await provider(t, (req, res) => res.end(JSON.stringify(protocol === 'anthropic'
      ? { content: [null, { type: 'thinking', thinking: 'hidden' }], stop_reason: 'end_turn' }
      : { candidates: [{ content: { parts: [null, { thought: true, text: 'hidden' }] }, finishReason: 'STOP' }] })));
    await assert.rejects(completeChat(config(protocol, base + '/v1'), KEY, messages), /未返回可显示/);
  }
});

test('workbench client reaches all three protocols through the authenticated server and caches replies once', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'wqs-multiple-http-'));
  const adminStore = new AdminStore(path.join(directory, 'admin')), workspace = new WorkspaceStore(path.join(directory, 'workspace'));
  t.after(async () => { adminStore.close(); workspace.close(); await rm(directory, { recursive: true, force: true }); });
  let calls = 0;
  const base = await provider(t, async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk;
    const protocol = req.url.split('/')[1];
    if (req.method === 'POST') { calls++; res.end(JSON.stringify(reply(protocol))); }
    else res.end(JSON.stringify(protocol === 'gemini' ? { models: [{ name: 'models/fixture-model' }] } : { data: [{ id: 'fixture-model' }] }));
  });
  const registry = new ModelRegistry(adminStore, vault), modelKeys = [];
  for (const protocol of ['openai', 'anthropic', 'gemini']) {
    const p = await registry.saveProvider(null, { name: protocol, preset: 'custom', protocol, baseUrl: `${base}/${protocol}/v1`, authMode: 'bearer', apiKey: KEY, timeoutSeconds: 5, monthlyTokenLimit: 0, enabled: true, revision: 0 });
    modelKeys.push(registry.addModel(p.id, { providerRevision: p.revision, modelId: 'fixture-model', name: protocol }).id);
  }
  const gateway = new ModelGateway(adminStore, registry, TOKEN);
  const { server } = createAdminServer({ root: path.resolve(import.meta.dirname, '..'), settings: { port: 0, bridgeToken: TOKEN }, store: adminStore, modelSettings: registry, modelGateway: gateway, manager: {} });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const tokenFile = path.join(directory, 'fixture-bridge-token'); await writeFile(tokenFile, TOKEN);
  const settings = { baseUrl: `http://127.0.0.1:${server.address().port}/internal/model`, tokenFile };
  const client = new ModelClient(workspace, settings);
  const catalog = await client.config(); assert.equal(catalog.models.length, 3); assert.equal(catalog.ready, true); assert.ok(!JSON.stringify(catalog).includes(KEY));
  const requests = modelKeys.map((modelKey, index) => ({ requestId: `request_protocol_${index}_fixture`, modelKey, assistant: 'general', messages: messages.slice(1) }));
  for (const request of requests) { const result = await client.chat(request); assert.equal(result.modelKey, request.modelKey); assert.equal(result.usage.totalTokens, 25); }
  const restarted = new ModelClient(workspace, settings);
  for (const request of requests) await restarted.chat(request);
  assert.equal(calls, 3); assert.equal(gateway.usage().total.totalTokens, 75); assert.equal(gateway.usage().byProvider.length, 3);
  assert.equal(adminStore.db.prepare('PRAGMA table_info(model_usage)').all().some(c => c.name === 'messages'), false);
});
