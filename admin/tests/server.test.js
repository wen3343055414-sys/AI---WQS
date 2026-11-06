import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { request as httpRequest } from 'node:http';
import { AdminStore } from '../src/store.js';
import { createAdminServer } from '../src/server.js';

const root = path.resolve(import.meta.dirname, '..');
const PASSWORD = 'fixture-admin-password-2026';
async function fixture(t, managerOverrides = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'ai-admin-test-'));
  const store = new AdminStore(directory);
  const calls = [];
  const manager = { overview: async () => ({ containers: [], stats: [] }), logs: async () => 'fixture log',
    action: async action => { calls.push(action); return { message: '操作完成', output: 'fixture output' }; },
    ...managerOverrides };
  const { server } = createAdminServer({ root, settings: { port: 0 }, store, manager });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  let cookie = '', csrf = '';
  async function request(url, { method = 'GET', body, headers = {} } = {}) {
    const response = await fetch(base + url, { method,
      headers: { Cookie: cookie, ...(method === 'POST' ? { 'Content-Type': 'application/json', Origin: base, 'X-Admin-CSRF': csrf } : {}), ...headers },
      body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
    });
    if (response.headers.get('set-cookie')) cookie = response.headers.get('set-cookie').split(';')[0];
    const content = await response.text();
    let data;
    try { data = JSON.parse(content); } catch { data = content; }
    if (data.csrf) csrf = data.csrf;
    return { response, data, status: response.status };
  }
  const setup = () => request('/api/setup', { method: 'POST', body: { password: PASSWORD } });
  t.after(async () => { await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }); store.close(); await rm(directory, { recursive: true, force: true }); });
  return { request, setup, store, directory, calls, base };
}

test('health is public; service data and operations require independent admin login', async t => {
  const f = await fixture(t);
  assert.equal((await f.request('/api/health')).data.mode, 'admin');
  assert.equal((await f.request('/api/session')).data.setupRequired, true);
  for (const endpoint of ['/api/overview', '/api/logs', '/api/backups/workspace-test.sqlite', '/api/model-settings']) assert.equal((await f.request(endpoint)).status, 401);
  assert.equal((await f.request('/api/actions', { method: 'POST', body: { action: 'stop', confirmation: 'stop' } })).status, 401);
  assert.deepEqual(f.calls, []);
});

test('setup validates origin and password, saves a hash, and sets a protected session cookie', async t => {
  const f = await fixture(t);
  assert.equal((await f.request('/api/setup', { method: 'POST', body: { password: PASSWORD }, headers: { Origin: 'https://evil.invalid' } })).status, 403);
  assert.equal((await f.request('/api/setup', { method: 'POST', body: { password: 'weak' } })).status, 400);
  const setup = await f.setup();
  assert.equal(setup.status, 200);
  assert.match(setup.response.headers.get('set-cookie'), /HttpOnly; SameSite=Strict/);
  assert.match(setup.data.csrf, /^[a-f0-9]{48}$/);
  assert.notEqual(f.store.db.prepare('SELECT hash FROM owner').get().hash, PASSWORD);
  assert.equal((await f.request('/api/session')).data.authenticated, true);
  assert.equal((await f.setup()).status, 409);
});

test('login checks the independent password and logout invalidates the old cookie', async t => {
  const f = await fixture(t); await f.setup();
  assert.equal((await f.request('/api/logout', { method: 'POST', body: {} })).status, 200);
  assert.equal((await f.request('/api/overview')).status, 401);
  assert.equal((await f.request('/api/login', { method: 'POST', body: { password: 'incorrect-password' } })).status, 401);
  assert.equal((await f.request('/api/login', { method: 'POST', body: { password: PASSWORD } })).status, 200);
  assert.equal((await f.request('/api/overview')).status, 200);
});

test('operations reject missing CSRF, foreign origins, shell commands, and unknown actions', async t => {
  const f = await fixture(t); await f.setup();
  const body = { action: 'stop', confirmation: 'stop' };
  assert.equal((await f.request('/api/actions', { method: 'POST', body, headers: { 'X-Admin-CSRF': '' } })).status, 403);
  assert.equal((await f.request('/api/actions', { method: 'POST', body, headers: { 'X-Admin-CSRF': 'é'.repeat(48) } })).status, 403);
  assert.equal((await f.request('/api/actions', { method: 'POST', body, headers: { Origin: 'https://evil.invalid' } })).status, 403);
  assert.equal((await f.request('/api/actions', { method: 'POST', body: { action: 'docker rm -f all', confirmation: 'docker rm -f all' } })).status, 400);
  assert.equal((await f.request('/api/actions', { method: 'POST', body: { action: 'stop' } })).status, 400);
  assert.deepEqual(f.calls, []);
});

test('concurrent actions are excluded and the completed job and audit persist', async t => {
  let finish;
  const f = await fixture(t, { action: () => new Promise(resolve => { finish = resolve; }) }); await f.setup();
  assert.equal((await f.request('/api/actions', { method: 'POST', body: { action: 'backup', confirmation: 'backup' } })).status, 202);
  assert.equal((await f.request('/api/actions', { method: 'POST', body: { action: 'stop', confirmation: 'stop' } })).status, 409);
  finish({ message: '已备份', output: 'snapshot.sqlite' });
  await new Promise(resolve => setImmediate(resolve));
  const overview = (await f.request('/api/overview')).data;
  assert.equal(overview.jobs[0].status, 'success');
  assert.equal(overview.jobs[0].output, 'snapshot.sqlite');
  assert.ok(overview.audit.some(row => row.action === 'backup' && row.result === 'success'));
});

test('failed operations report failure without claiming success', async t => {
  const f = await fixture(t, { action: async () => { throw new Error('Docker is unavailable'); } }); await f.setup();
  await f.request('/api/actions', { method: 'POST', body: { action: 'start', confirmation: 'start' } });
  await new Promise(resolve => setImmediate(resolve));
  const overview = (await f.request('/api/overview')).data;
  assert.equal(overview.jobs[0].status, 'failed');
  assert.equal(overview.jobs[0].message, 'Docker is unavailable');
});

test('source files, configuration, database and path traversal are never static assets', async t => {
  const f = await fixture(t);
  for (const target of ['/config.json', '/data/admin.sqlite', '/src/server.js', '/.env', '/%2e%2e/config.json']) assert.equal((await f.request(target)).status, 404);
  const page = await f.request('/'); assert.equal(page.status, 200);
  assert.ok(page.data.includes('智作台服务端')); assert.ok(page.data.includes('API 接口设置'));
  assert.match(page.response.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  assert.equal((await f.request('/styles.css')).status, 200);
  assert.equal((await f.request('/favicon.svg')).status, 200);
});

test('model settings routes require CSRF and return only nonsecret persisted settings', async t => {
  const f = await fixture(t); await f.setup();
  assert.equal((await f.request('/api/model-settings')).data.configured, false);
  const input = { name: '本机模型', baseUrl: 'http://127.0.0.1:11434/v1', model: 'fixture-model', authMode: 'none', timeoutSeconds: 30, revision: 0 };
  assert.equal((await f.request('/api/model-settings', { method: 'POST', body: input, headers: { 'X-Admin-CSRF': '' } })).status, 403);
  const saved = await f.request('/api/model-settings', { method: 'POST', body: input });
  assert.equal(saved.status, 200); assert.equal(saved.data.configured, true); assert.equal(saved.data.hasApiKey, false);
  assert.equal(saved.data.apiKey, undefined);
  assert.equal((await f.request('/api/model-settings/test', { method: 'POST', body: { revision: 0 } })).status, 409);
});

test('DNS rebinding hosts and expired sessions are rejected', async t => {
  const f = await fixture(t); await f.setup();
  const rejected = await new Promise((resolve, reject) => {
    httpRequest(`${f.base}/api/overview`, { headers: { Host: 'attacker.invalid' } }, response => { response.resume(); resolve(response.statusCode); }).on('error', reject).end();
  });
  assert.equal(rejected, 421);
  f.store.db.prepare('UPDATE sessions SET expires=0').run();
  assert.equal((await f.request('/api/overview')).status, 401);
});

test('backup downloads use attachments, are audited and remove the temporary copy', async t => {
  let cleaned = false;
  const directory = await mkdtemp(path.join(os.tmpdir(), 'admin-backup-fixture-'));
  const file = path.join(directory, 'snapshot.sqlite'); await writeFile(file, 'SQLite fixture');
  const f = await fixture(t, { downloadBackup: async () => ({ file, size: 14, cleanup: async () => { cleaned = true; await rm(directory, { recursive: true, force: true }); } }) }); await f.setup();
  const downloaded = await f.request('/api/backups/workspace-fixture123.sqlite');
  assert.equal(downloaded.status, 200);
  assert.match(downloaded.response.headers.get('content-disposition'), /attachment/);
  assert.equal(downloaded.data, 'SQLite fixture');
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.ok(cleaned);
  assert.ok(f.store.audits().some(row => row.action === 'download'));
});

test('request bodies and log bounds are validated', async t => {
  const f = await fixture(t); await f.setup();
  assert.equal((await f.request('/api/logs?lines=999999')).status, 400);
  assert.equal((await f.request('/api/logs?lines=abc')).status, 400);
  assert.equal((await f.request('/api/actions', { method: 'POST', body: '{broken' })).status, 400);
  assert.equal((await f.request('/api/actions', { method: 'POST', body: { value: 'x'.repeat(9000) } })).status, 413);
});

test('owner and sessions survive restart; interrupted jobs are marked honestly', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'admin-store-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  let store = new AdminStore(directory); await store.setup(PASSWORD);
  const session = store.createSession(); store.createJob('update'); store.close();
  store = new AdminStore(directory);
  assert.ok(await store.checkPassword(PASSWORD)); assert.ok(store.session(session.token));
  assert.equal(store.jobs()[0].status, 'interrupted'); store.close();
});
