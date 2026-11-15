import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { AdminStore } from '../src/store.js';
import { ModelSettings, ProbeError } from '../src/model-settings.js';
import { ModelRegistry } from '../src/model-registry.js';
import { ModelGateway } from '../src/model-gateway.js';
import { createAdminServer } from '../src/server.js';

const KEY = 'fixture-provider-key-not-real';
const vault = { protect: async key => `fixture-cipher:${Buffer.from(key).toString('base64')}`, unprotect: async cipher => Buffer.from(cipher.split(':')[1], 'base64').toString() };
const input = (extra = {}) => ({ name: '测试连接', preset: 'custom', protocol: 'openai', baseUrl: 'https://fixture.example/v1', authMode: 'bearer', enabled: true, timeoutSeconds: 30, monthlyTokenLimit: 0, revision: 0, apiKey: KEY, ...extra });
const chat = (extra = {}) => ({ requestId: 'request_fixture_0001', assistant: 'general', messages: [{ role: 'user', content: 'hello fixture' }], ...extra });
const usage = { promptTokens: 20, completionTokens: 5, totalTokens: 25, cachedTokens: 5, reasoningTokens: null };
async function fixture(t, probe = async () => ['catalog-model', 'second-model']) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'wqs-registry-test-'));
  const store = new AdminStore(directory), registry = new ModelRegistry(store, vault, probe);
  t.after(async () => { store.close(); await rm(directory, { recursive: true, force: true }); });
  return { store, registry };
}
function addModel(registry, provider, modelId = 'fixture-model', name = '测试模型') {
  return registry.addModel(provider.id, { providerRevision: provider.revision, modelId, name });
}

test('registry starts empty and migrates one encrypted legacy connection exactly once', async t => {
  const { store, registry } = await fixture(t);
  assert.equal(registry.list().providers.length, 0); assert.equal(registry.publicConfig().ready, false);
  // Simulate an installed v1.2 database, before the registry existed.
  store.db.exec('DROP TABLE ai_providers; DROP TABLE ai_models; DROP TABLE ai_routing;');
  const legacy = new ModelSettings(store, vault);
  await legacy.save({ name: '原有 DeepSeek', baseUrl: 'https://api.deepseek.com', model: 'saved-model-id', authMode: 'bearer', timeoutSeconds: 45, apiKey: KEY, revision: 0 });
  const cipher = legacy.row().key_cipher;
  let decryptions = 0;
  const upgraded = new ModelRegistry(store, { ...vault, unprotect() { decryptions++; throw Error('Migration must not decrypt'); } });
  const data = upgraded.list();
  assert.equal(data.providers.length, 1); assert.equal(data.models.length, 1);
  assert.equal(data.providers[0].preset, 'deepseek'); assert.equal(data.providers[0].hasApiKey, true);
  assert.equal(data.models[0].modelId, 'saved-model-id'); assert.equal(data.defaultModelKey, data.models[0].id);
  assert.equal(upgraded.row().key_cipher, cipher); assert.equal(decryptions, 0);
  assert.equal(new ModelRegistry(store, vault).list().providers.length, 1);
  assert.ok(!JSON.stringify(data).includes(KEY)); assert.ok(!JSON.stringify(data).includes('key_cipher'));
});

test('connections isolate credentials; blank preserves a key and changes need the correct revision', async t => {
  const { registry } = await fixture(t);
  const a = await registry.saveProvider(null, input({ name: '连接 A' }));
  const b = await registry.saveProvider(null, input({ name: '连接 B', apiKey: 'fixture-other-key' }));
  const cipher = registry.provider(a.id).key_cipher;
  const updated = await registry.saveProvider(a.id, { ...a, name: '连接 A 已更新' });
  assert.equal(registry.provider(a.id).key_cipher, cipher);
  assert.equal(await vault.unprotect(registry.provider(b.id).key_cipher), 'fixture-other-key');
  await assert.rejects(registry.saveProvider(a.id, { ...a, name: '过期编辑' }), /其他页面更新/);
  for (const change of [{ baseUrl: 'https://other.example/v1' }, { protocol: 'anthropic' }]) {
    await assert.rejects(registry.saveProvider(a.id, { ...updated, ...change }), /重新输入密钥/);
  }
  const cleared = await registry.saveProvider(a.id, { ...updated, clearKey: true });
  assert.equal(cleared.hasApiKey, false); assert.equal(registry.provider(a.id).key_cipher, null);
  assert.equal(registry.list().providers.find(p => p.id === b.id).hasApiKey, true);
});

test('a save delayed by encryption cannot overwrite a newer edit from another registry', async t => {
  const { store, registry } = await fixture(t);
  const a = await registry.saveProvider(null, input());
  let finish;
  const delayed = new ModelRegistry(store, { protect: () => new Promise(resolve => { finish = resolve; }) });
  const pending = delayed.saveProvider(a.id, { ...a, apiKey: 'fixture-replacement-key' });
  await registry.saveProvider(a.id, { ...a, name: '并发修改' });
  finish('fixture-delayed-cipher');
  await assert.rejects(pending, /其他页面更新/);
  assert.equal(registry.list().providers[0].name, '并发修改');
});

test('model discovery preserves manual aliases and enabled choices, and keeps new models off', async t => {
  const { registry } = await fixture(t);
  const p = await registry.saveProvider(null, input());
  const m = addModel(registry, p, 'catalog-model', '我的写作模型');
  const before = registry.list().defaultModelKey;
  const result = await registry.testProvider(p.id, p.revision);
  assert.equal(result.ok, true); assert.equal(registry.list().models.length, 2);
  assert.equal(registry.model(m.id).display_name, '我的写作模型'); assert.equal(registry.model(m.id).enabled, 1);
  assert.equal(registry.list().models.find(m => m.modelId === 'second-model').enabled, false);
  assert.equal(registry.list().defaultModelKey, before);
  assert.throws(() => addModel(registry, p, 'catalog-model'), /已添加此模型/);
  const other = await registry.saveProvider(null, input({ name: '另一连接' }));
  assert.doesNotThrow(() => addModel(registry, other, 'catalog-model'));
});

test('a missing model directory permits manual configuration without claiming connection success', async t => {
  const { registry } = await fixture(t, async () => { throw new ProbeError('Not supported', 404); });
  const p = await registry.saveProvider(null, input());
  const result = await registry.testProvider(p.id, p.revision);
  assert.equal(result.ok, false); assert.equal(result.state, 'warning'); assert.match(result.message, /手动添加/);
  addModel(registry, p);
  assert.equal(registry.publicConfig().ready, true);
});

test('discovery reports omitted models at capacity and preserves previously saved choices', async t => {
  const { registry } = await fixture(t, async () => ['saved-model', 'new-model']);
  const p = await registry.saveProvider(null, input());
  addModel(registry, p, 'saved-model', '保留名称');
  registry.transaction(() => {
    const insert = registry.db.prepare('INSERT INTO ai_models VALUES (?,?,?,?,?,?,1,?)');
    for (let index = 1; index < 1000; index++) insert.run(`model_capacity_${index}`, p.id, `capacity-${index}`, `capacity ${index}`, 0, 'discovered', new Date().toISOString());
  });
  const result = await registry.testProvider(p.id, p.revision);
  assert.equal(result.ok, true); assert.equal(result.state, 'warning');
  assert.equal(result.addedModels, 0); assert.equal(result.skippedModels, 1);
  assert.match(result.message, /容量已满/);
  assert.equal(registry.list().models.length, 1000);
  assert.equal(registry.list().models.find(m => m.modelId === 'saved-model').name, '保留名称');
});

test('probe errors never echo key material and stale probe results are not stored', async t => {
  const { registry } = await fixture(t, async () => { throw Error(KEY); });
  const p = await registry.saveProvider(null, input());
  const result = await registry.testProvider(p.id, p.revision);
  assert.ok(!JSON.stringify(result).includes(KEY));
  let finish;
  registry.probe = () => new Promise(resolve => { finish = resolve; });
  const pending = registry.testProvider(p.id, p.revision);
  await new Promise(resolve => setImmediate(resolve));
  await registry.saveProvider(p.id, { ...p, name: '新配置' });
  finish(['stale-model']);
  await assert.rejects(pending, /其他页面更新/);
  assert.equal(registry.list().providers[0].lastTest, null);
  assert.equal(registry.list().models.length, 0);
});

test('model selection, defaults and usage stay attributed to the requested connection', async t => {
  const { registry, store } = await fixture(t);
  const a = await registry.saveProvider(null, input({ name: 'A' })), b = await registry.saveProvider(null, input({ name: 'B', protocol: 'gemini' }));
  const ma = addModel(registry, a, 'same-id'), mb = addModel(registry, b, 'same-id');
  const calls = [];
  const gateway = new ModelGateway(store, registry, '', async (config, key) => { calls.push({ config, key }); return { content: 'fixture reply', usage }; });
  const first = await gateway.chat(chat()); assert.equal(first.providerId, a.id);
  const selected = await gateway.chat(chat({ requestId: 'request_fixture_0002', modelKey: mb.id }));
  assert.equal(selected.providerId, b.id); assert.equal(calls[1].config.protocol, 'gemini');
  assert.ok(!JSON.stringify(gateway.config()).includes('baseUrl')); assert.ok(!JSON.stringify(gateway.config()).includes(KEY));
  registry.setDefault(mb.id, registry.list().revision);
  assert.equal((await gateway.chat(chat())).providerId, a.id); assert.equal(calls.length, 2, 'An old request must not be replayed on a different default');
  await assert.rejects(gateway.chat(chat({ modelKey: mb.id })), /同一请求编号/);
  const meter = gateway.usage();
  assert.equal(meter.byProvider.find(p => p.providerId === a.id).totalTokens, 25);
  assert.equal(meter.byProvider.find(p => p.providerId === b.id).totalTokens, 25);
  assert.equal(meter.byModel.find(m => m.modelKey === ma.id).requests, 1);
  assert.equal(registry.read().model, 'same-id');
});

test('disabling and deleting a default connection does not silently switch providers or erase usage', async t => {
  const { registry, store } = await fixture(t);
  const a = await registry.saveProvider(null, input()), b = await registry.saveProvider(null, input({ name: '备用' }));
  const ma = addModel(registry, a), mb = addModel(registry, b);
  const gateway = new ModelGateway(store, registry, '', async () => ({ content: 'fixture reply', usage }));
  await gateway.chat(chat());
  const off = await registry.saveProvider(a.id, { ...a, enabled: false });
  assert.equal(gateway.config().ready, false); assert.equal(gateway.config().models.length, 1);
  await assert.rejects(gateway.chat(chat({ requestId: 'request_disabled_default' })), /停用/);
  assert.throws(() => registry.setDefault(ma.id, registry.list().revision), /停用/);
  await gateway.chat(chat({ requestId: 'request_selected_backup', modelKey: mb.id }));
  assert.throws(() => registry.removeProvider(a.id, off.revision, 'wrong'), /确认/);
  registry.removeProvider(a.id, off.revision, a.id);
  assert.equal(registry.list().defaultModelKey, null); assert.equal(registry.list().models.length, 1);
  assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM model_usage').get().n, 2);
  assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM model_settings').get().n, 0);
  assert.equal(registry.provider(b.id).key_cipher !== null, true);
});

test('native protocols cannot become an incompatible legacy rollback default', async t => {
  const { registry, store } = await fixture(t);
  const p = await registry.saveProvider(null, input({ protocol: 'anthropic' }));
  addModel(registry, p);
  assert.equal(registry.publicConfig().ready, true);
  assert.equal(JSON.parse(store.db.prepare('SELECT config FROM model_settings').get().config).model, '');
  assert.throws(() => registry.setDefault('', registry.list().revision), /有效/);
});

test('monthly limits use reported tokens per provider and reject before another billable call', async t => {
  const { registry, store } = await fixture(t);
  const p = await registry.saveProvider(null, input({ monthlyTokenLimit: 25 }));
  addModel(registry, p);
  let calls = 0;
  const gateway = new ModelGateway(store, registry, '', async () => { calls++; return { content: 'fixture reply', usage }; });
  await gateway.chat(chat());
  await assert.rejects(gateway.chat(chat({ requestId: 'request_over_monthly_limit' })), /月 Token 限额/);
  assert.equal(calls, 1); assert.equal(gateway.usage().total.requests, 1);
  const updated = await registry.saveProvider(p.id, { ...p, monthlyTokenLimit: 0 });
  gateway.complete = async () => ({ content: 'unmetered fixture', usage: null });
  await gateway.chat(chat({ requestId: 'request_unknown_token_usage' }));
  const meter = gateway.usage().byProvider[0];
  assert.equal(meter.totalTokens, 25); assert.equal(meter.unknownRequests, 1); assert.equal(updated.hasApiKey, true);
});

test('legacy usage migration preserves totals and only attributes known historical identities', async t => {
  const { store } = await fixture(t);
  store.db.exec('DROP TABLE ai_providers; DROP TABLE ai_models; DROP TABLE ai_routing;');
  const legacy = new ModelSettings(store, vault);
  await legacy.save({ name: 'DeepSeek', baseUrl: 'https://api.deepseek.com', model: 'saved-model-id', authMode: 'bearer', timeoutSeconds: 30, apiKey: KEY, revision: 0 });
  store.db.exec(`CREATE TABLE model_usage (request_id TEXT PRIMARY KEY,fingerprint TEXT NOT NULL,started_at TEXT NOT NULL,finished_at TEXT,
    provider TEXT NOT NULL,model TEXT NOT NULL,config_revision INTEGER NOT NULL,source TEXT NOT NULL,status TEXT NOT NULL,error_message TEXT,
    prompt_tokens INTEGER,completion_tokens INTEGER,total_tokens INTEGER,cached_tokens INTEGER,reasoning_tokens INTEGER,latency_ms INTEGER);`);
  for (const [id, provider] of [['request_history_1','DeepSeek'],['request_history_2','Earlier Provider']]) store.db.prepare('INSERT INTO model_usage VALUES (?,?,?,NULL,?,?,1,?, ?,NULL,20,5,25,5,NULL,100)').run(id, 'fingerprint', new Date().toISOString(), provider, 'saved-model-id', 'workbench', 'success');
  const registry = new ModelRegistry(store, vault), gateway = new ModelGateway(store, registry);
  assert.equal(gateway.usage().total.totalTokens, 50);
  assert.equal(store.db.prepare('SELECT provider_id FROM model_usage WHERE request_id=?').get('request_history_1').provider_id, 'provider_legacy');
  assert.equal(store.db.prepare('SELECT provider_id FROM model_usage WHERE request_id=?').get('request_history_2').provider_id, null);
});

test('monthly budget and daily usage change at midnight in Beijing rather than UTC', async t => {
  const { registry, store } = await fixture(t);
  const p = await registry.saveProvider(null, input({ monthlyTokenLimit: 25 }));
  addModel(registry, p);
  let now = Date.parse('2026-10-31T15:59:50Z'), calls = 0;
  t.mock.method(Date, 'now', () => now);
  const gateway = new ModelGateway(store, registry, '', async () => { calls++; return { content: 'fixture reply', usage }; });
  await gateway.chat(chat());
  await assert.rejects(gateway.chat(chat({ requestId: 'request_previous_month_limit' })), /月 Token 限额/);
  now = Date.parse('2026-10-31T16:00:00Z');
  await gateway.chat(chat({ requestId: 'request_beijing_new_month' }));
  await assert.rejects(gateway.chat(chat({ requestId: 'request_new_month_limit' })), /月 Token 限额/);
  const meter = gateway.usage();
  assert.equal(calls, 2); assert.equal(meter.monthStart, '2026-10-31T16:00:00.000Z');
  assert.equal(meter.total.totalTokens, 50); assert.equal(meter.today.totalTokens, 25);
  assert.equal(meter.byProvider[0].monthlyTokens, 25);
});

test('registry HTTP operations retain independent authentication and CSRF checks', async t => {
  const { registry, store } = await fixture(t);
  const { server } = createAdminServer({ root: path.resolve(import.meta.dirname, '..'), settings: { port: 0 }, store, modelSettings: registry, manager: {} });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const base = `http://127.0.0.1:${server.address().port}`;
  assert.equal((await fetch(base + '/api/model-providers')).status, 401);
  const setup = await fetch(base + '/api/setup', { method: 'POST', headers: { Origin: base, 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'fixture-registry-password' }) });
  const cookie = setup.headers.get('set-cookie').split(';')[0], { csrf } = await setup.json();
  const headers = { Origin: base, Cookie: cookie, 'Content-Type': 'application/json', 'X-Admin-CSRF': csrf };
  const bad = await fetch(base + '/api/model-providers', { method: 'POST', headers: { ...headers, 'X-Admin-CSRF': '' }, body: JSON.stringify(input()) });
  assert.equal(bad.status, 403);
  const response = await fetch(base + '/api/model-providers', { method: 'POST', headers, body: JSON.stringify(input()) });
  assert.equal(response.status, 200); const p = await response.json(); assert.ok(!JSON.stringify(p).includes(KEY));
  const add = await fetch(`${base}/api/model-providers/${p.id}/models`, { method: 'POST', headers, body: JSON.stringify({ providerRevision: p.revision, modelId: 'http-model' }) });
  assert.equal(add.status, 200); const m = await add.json();
  const data = await (await fetch(base + '/api/model-providers', { headers })).json();
  assert.equal(data.defaultModelKey, m.id); assert.equal(data.models.length, 1);
  assert.equal((await fetch(base + '/api/model-routing', { method: 'POST', headers: { ...headers, Origin: 'https://foreign.invalid' }, body: JSON.stringify({ modelKey: m.id, revision: data.revision }) })).status, 403);
});
