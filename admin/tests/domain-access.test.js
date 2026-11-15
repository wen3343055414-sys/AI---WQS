import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { AdminStore } from '../src/store.js';
import { LanAccess, probeWorkbench } from '../src/lan-access.js';
import { createAdminServer } from '../src/server.js';
import { DomainRegistry } from '../src/domain-registry.js';

async function fixture(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'wqs-domain-access-'));
  const store = new AdminStore(directory), access = new LanAccess(store);
  const domains = new DomainRegistry(store, { verifier: async () => ({ state: 'pending', dns: { state: 'pending', records: [] }, ssl: { state: 'pending' }, message: 'No DNS configured.' }) });
  const websiteRuntime = { target: 'workbench', available: true, lanAccess: access,
    workbench: { ready: true, setupRequired: false, version: 'fixture' },
    status: () => ({ available: true, localOrigin: 'http://127.0.0.1:3200', tunnel: { state: 'stopped' } }),
    async access() { return { ...access.read(), available: this.available, addresses: [{ address: '192.168.50.8', url: 'http://192.168.50.8:3200' }], workbench: this.workbench }; } };
  const { server } = createAdminServer({ root: path.resolve(import.meta.dirname, '..'), settings: { port: 0 }, store, domains, websiteRuntime, manager: {} });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  let cookie = '', csrf = '';
  async function request(url, input, headers = {}) {
    const response = await fetch(base + url, { method: input === undefined ? 'GET' : 'POST',
      headers: { Cookie: cookie, ...(input === undefined ? {} : { 'Content-Type': 'application/json', Origin: base, 'X-Admin-CSRF': csrf }), ...headers },
      body: input === undefined ? undefined : JSON.stringify(input) });
    const body = await response.json();
    if (response.headers.get('set-cookie')) cookie = response.headers.get('set-cookie').split(';')[0];
    if (body.csrf) csrf = body.csrf;
    return { response, status: response.status, body };
  }
  t.after(async () => { await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }); store.close(); await rm(directory, { recursive: true, force: true }); });
  return { request, access, domains, websiteRuntime, store, setup: () => request('/api/setup', { password: 'isolated-domain-access-password' }) };
}

test('domain and LAN actions require real independent authentication, Origin and CSRF', async t => {
  const f = await fixture(t);
  assert.equal((await f.request('/api/domains')).status, 401);
  assert.equal((await f.request('/api/domain-access', { enabled: true, revision: 0 })).status, 401);
  await f.setup();
  assert.equal((await f.request('/api/domains', { hostname: 'portal.my-real-site.com' }, { 'X-Admin-CSRF': '' })).status, 403);
  assert.equal((await f.request('/api/domain-access', { enabled: true, revision: 0 }, { Origin: 'https://attacker.invalid' })).status, 403);
  assert.equal(f.access.read().enabled, false);
  assert.equal((await f.request('/api/domains')).body.domains.length, 0);
});

test('LAN access persists revisions and never enables before actual workbench initialization', async t => {
  const f = await fixture(t); await f.setup();
  f.websiteRuntime.workbench.setupRequired = true;
  assert.equal((await f.request('/api/domain-access', { enabled: true, revision: 0 })).status, 409);
  f.websiteRuntime.workbench.setupRequired = false;
  const enabled = await f.request('/api/domain-access', { enabled: true, revision: 0 });
  assert.equal(enabled.status, 200); assert.equal(enabled.body.access.enabled, true);
  assert.equal((await f.request('/api/domain-access', { enabled: false, revision: 0 })).status, 409);
  assert.equal((await f.request('/api/domain-access', { enabled: false, revision: 1 })).body.access.enabled, false);
  assert.equal(new LanAccess(f.store).read().enabled, false);
  assert.equal(f.store.audits().filter(row => row.action === 'lan_access').length, 2);
});

test('domain binding configuration remains pending until verification; retired website editor cannot publish', async t => {
  const f = await fixture(t); await f.setup();
  let domain = (await f.request('/api/domains', { hostname: 'Portal.my-real-site.com' })).body;
  assert.equal(domain.hostname, 'portal.my-real-site.com'); assert.equal(domain.verification.state, 'pending');
  assert.equal(f.domains.defaultOrigin(), null);
  domain = (await f.request(`/api/domains/${domain.id}/verify`, { revision: domain.revision })).body;
  assert.equal(domain.verification.state, 'pending');
  assert.equal((await f.request('/api/websites')).status, 410);
  assert.equal((await f.request('/api/websites', { name: 'Do not create a builder site' })).status, 410);
  assert.equal((await f.request('/api/website-hosting/start', {})).status, 409);
  assert.equal((await f.request('/api/domain-access/check', {})).status, 200);
});

test('workbench health detection rejects static output and reports real server state only', async t => {
  let status = { mode: 'local' };
  const upstream = createServer((_, response) => { response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify(status)); });
  await new Promise(resolve => upstream.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { upstream.close(resolve); upstream.closeAllConnections(); }));
  const origin = `http://127.0.0.1:${upstream.address().port}`;
  assert.equal((await probeWorkbench(origin)).ready, false);
  status = { mode: 'server', serverId: '' };
  assert.equal((await probeWorkbench(origin)).ready, false);
  status = { mode: 'server', serverId: 'a'.repeat(32) };
  assert.equal((await probeWorkbench(origin)).ready, false);
  status = { mode: 'server', serverId: 'a'.repeat(32), setupRequired: false, version: 'fixture-actual' };
  assert.deepEqual(await probeWorkbench(origin), { ready: true, setupRequired: false, version: 'fixture-actual', message: '工作台已连接服务器。' });
});
