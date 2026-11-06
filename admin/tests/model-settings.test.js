import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import os from 'node:os';
import { AdminStore } from '../src/store.js';
import { ModelSettings, WindowsKeyVault, normalizeBaseUrl, allowedAddress, probeModels } from '../src/model-settings.js';

const KEY = 'fixture-only-not-a-real-provider-key';
const fakeVault = { protect: async value => `fixture-cipher:${Buffer.from(value).toString('base64')}`, unprotect: async value => Buffer.from(value.split(':')[1], 'base64').toString() };
const base = (extra = {}) => ({ name: '测试接口', baseUrl: 'https://provider.example/v1', model: 'test-model', authMode: 'bearer', timeoutSeconds: 30, revision: 0, ...extra });
async function fixture(t, probe = async () => ['test-model']) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'model-settings-test-'));
  const store = new AdminStore(directory);
  const settings = new ModelSettings(store, fakeVault, probe);
  t.after(async () => { store.close(); await rm(directory, { recursive: true, force: true }); });
  return { store, settings };
}
async function provider(t, handler) {
  const server = createServer(handler);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  return `http://127.0.0.1:${server.address().port}/v1`;
}

test('model settings start empty and never expose saved key material', async t => {
  const { store, settings } = await fixture(t);
  assert.equal(settings.read().configured, false);
  const saved = await settings.save(base({ apiKey: KEY }));
  assert.equal(saved.hasApiKey, true); assert.equal(saved.revision, 1);
  assert.ok(!JSON.stringify(saved).includes(KEY));
  assert.equal(saved.apiKey, undefined); assert.equal(saved.key_cipher, undefined);
  assert.ok(!store.db.prepare('SELECT config FROM model_settings').get().config.includes(KEY));
  assert.ok(!JSON.stringify(store.audits()).includes(KEY));
});

test('blank key preserves the saved credential; replacing and clearing are explicit', async t => {
  const { settings } = await fixture(t);
  await settings.save(base({ apiKey: KEY }));
  const cipher = settings.row().key_cipher;
  await settings.save(base({ revision: 1, model: 'other-model' }));
  assert.equal(settings.row().key_cipher, cipher);
  await settings.save(base({ revision: 2, apiKey: 'fixture-replacement' }));
  assert.notEqual(settings.row().key_cipher, cipher);
  const cleared = await settings.save(base({ revision: 3, clearKey: true }));
  assert.equal(cleared.hasApiKey, false);
  assert.equal(settings.row().key_cipher, null);
});

test('switching providers cannot silently reuse an existing credential', async t => {
  const { settings } = await fixture(t);
  await settings.save(base({ apiKey: KEY }));
  await assert.rejects(settings.save(base({ revision: 1, baseUrl: 'https://other.example/v1' })), /重新输入密钥/);
  assert.equal(settings.read().baseUrl, 'https://provider.example/v1');
  assert.equal(settings.read().revision, 1);
});

test('stale and concurrent saves do not overwrite newer settings', async t => {
  const { settings, store } = await fixture(t);
  await settings.save(base());
  await assert.rejects(settings.save(base()), /其他页面更新/);
  let finishEncryption;
  const delayed = new ModelSettings(store, { protect: () => new Promise(resolve => { finishEncryption = resolve; }) });
  const pending = delayed.save(base({ revision: 1, apiKey: KEY }));
  await settings.save(base({ revision: 1, name: '更新后的接口' }));
  finishEncryption('fixture-cipher');
  await assert.rejects(pending, /其他页面更新/);
  assert.equal(settings.read().name, '更新后的接口');
});

test('validation rejects unsafe addresses, credential URLs and invalid limits', async t => {
  const { settings } = await fixture(t);
  for (const url of ['file:///etc/passwd', 'https://user:secret@provider.example/v1', 'https://provider.example/v1?token=secret', 'https://provider.example/v1#secret', 'http://provider.example/v1', 'https://169.254.169.254', 'https://[::ffff:169.254.169.254]', 'http://0.0.0.0:8080']) assert.throws(() => normalizeBaseUrl(url));
  assert.equal(normalizeBaseUrl('https://provider.example/v1/'), 'https://provider.example/v1');
  assert.equal(normalizeBaseUrl('http://127.0.0.1:11434/v1'), 'http://127.0.0.1:11434/v1');
  assert.throws(() => normalizeBaseUrl('https://provider.example/v1/chat/completions'), /Base URL/);
  for (const change of [{ timeoutSeconds: 1 }, { timeoutSeconds: 999 }, { apiKey: 'bad\nkey' }, { clearKey: true, apiKey: KEY }, { authMode: 'custom' }]) await assert.rejects(settings.save(base(change)));
});

test('connection test decrypts only for the request and stores a safe model summary', async t => {
  let received;
  const { settings } = await fixture(t, async (config, key) => { received = key; return ['test-model', 'another-model']; });
  await settings.save(base({ apiKey: KEY }));
  const result = await settings.test(1);
  assert.equal(received, KEY); assert.equal(result.ok, true); assert.equal(result.models.length, 2);
  assert.equal(result.modelAvailable, true);
  assert.ok(!JSON.stringify(settings.read()).includes(KEY));
  assert.equal(settings.read().lastTest.state, 'success');
  await settings.save(base({ revision: 1, model: 'new-model' }));
  assert.equal(settings.read().lastTest, null);
});

test('provider errors cannot echo secrets into the UI or audit log', async t => {
  const { settings, store } = await fixture(t, async () => { throw new Error(`provider echoed ${KEY}`); });
  await settings.save(base({ apiKey: KEY }));
  const result = await settings.test(1);
  assert.equal(result.ok, false);
  assert.ok(!JSON.stringify(result).includes(KEY));
  assert.ok(!JSON.stringify(store.audits()).includes(KEY));
});

test('testing enforces saved revisions, key presence and one active check', async t => {
  let complete;
  const { settings } = await fixture(t, () => new Promise(resolve => { complete = resolve; }));
  await assert.rejects(settings.test(0), /先保存/);
  await settings.save(base());
  await assert.rejects(settings.test(1), /先保存 API 密钥/);
  await settings.save(base({ revision: 1, authMode: 'none' }));
  await assert.rejects(settings.test(1), /配置已变化/);
  const first = settings.test(2);
  await assert.rejects(settings.test(2), /正在检测/);
  await settings.save(base({ revision: 2, name: '检测期间已修改', authMode: 'none' }));
  complete(['test-model']);
  await assert.rejects(first, /配置已更新/);
  assert.equal(settings.read().lastTest, null);
});

test('model probe appends /models and sends Bearer authentication to the saved address', async t => {
  let observed;
  const baseUrl = await provider(t, (request, response) => { observed = { url: request.url, auth: request.headers.authorization, method: request.method }; response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify({ data: [{ id: 'test-model' }, { id: KEY }] })); });
  const models = await probeModels(base({ baseUrl }), KEY);
  assert.deepEqual(models, ['test-model']);
  assert.deepEqual(observed, { url: '/v1/models', auth: `Bearer ${KEY}`, method: 'GET' });
});

test('model probe never follows redirects with credentials', async t => {
  let forwarded = false;
  const other = await provider(t, (request, response) => { forwarded = true; response.end('{}'); });
  const baseUrl = await provider(t, (request, response) => { response.writeHead(302, { Location: `${other}/models` }); response.end(); });
  await assert.rejects(probeModels(base({ baseUrl }), KEY), /密钥未转发/);
  assert.equal(forwarded, false);
});

test('model probe rejects metadata DNS answers, bad JSON and oversized responses', async t => {
  await assert.rejects(probeModels(base(), KEY, { resolver: async () => [{ address: '169.254.169.254', family: 4 }] }), /不支持的网络地址/);
  assert.equal(allowedAddress('::ffff:a9fe:a9fe', 'https:'), false);
  assert.equal(allowedAddress('fe80::1', 'https:'), false);
  const invalid = await provider(t, (req, res) => res.end('{invalid'));
  await assert.rejects(probeModels(base({ baseUrl: invalid }), KEY), /不是兼容的模型列表/);
  const oversized = await provider(t, (req, res) => res.end('x'.repeat(1_000_001)));
  await assert.rejects(probeModels(base({ baseUrl: oversized }), KEY), /响应过大/);
});

test('model probe has an absolute connection deadline and safe authorization failures', async t => {
  const slow = await provider(t, (req, res) => setTimeout(() => res.end('{"data":[]}'), 120));
  await assert.rejects(probeModels(base({ baseUrl: slow, timeoutSeconds: .025 }), KEY), /超时/);
  const denied = await provider(t, (req, res) => { res.writeHead(401); res.end(`echo ${KEY}`); });
  await assert.rejects(probeModels(base({ baseUrl: denied }), KEY), error => error.message.includes('认证失败') && !error.message.includes(KEY));
});

test('Windows DPAPI performs a real local round trip without plaintext persistence', { skip: process.platform !== 'win32' }, async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'model-vault-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(path.join(directory, 'config.json'), JSON.stringify({ python: process.env.AI_WQS_TEST_PYTHON || 'python' }));
  const vault = new WindowsKeyVault(path.resolve(import.meta.dirname, '..'), { deploymentRoot: directory });
  const encrypted = await vault.protect(KEY);
  assert.notEqual(encrypted, KEY); assert.ok(!encrypted.includes(KEY));
  assert.equal(await vault.unprotect(encrypted), KEY);
});
