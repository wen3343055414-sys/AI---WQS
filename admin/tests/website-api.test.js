import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { AdminStore } from '../src/store.js';
import { WebsiteStore, createWebsiteServer } from '../src/websites.js';
import { createAdminServer } from '../src/server.js';

const draft = (extra = {}) => ({ name: '集成测试网站', slug: 'integration-site', description: 'fixture-only', files: [
  { path: 'index.html', content: '<!doctype html><title>Fixture</title><h1>Published original</h1><script src="app.js"></script>', encoding: 'utf8' },
  { path: 'app.js', content: 'document.title="Working fixture";', encoding: 'utf8' },
], ...extra });
const generated = () => ({ content: JSON.stringify({ files: [{ path: 'index.html', content: '<h1>Generated draft</h1>', encoding: 'utf8' }] }),
  finishReason: 'stop', model: 'fixture-generator', requestId: 'website_fixture_generation_01' });

async function fixture(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'wqs-website-api-test-'));
  const store = new AdminStore(directory), websites = new WebsiteStore(store);
  const visitor = createWebsiteServer({ websites, allowedHost: hostname => hostname === 'fixture.example' });
  await new Promise(resolve => visitor.listen(0, '127.0.0.1', resolve));
  const localOrigin = `http://127.0.0.1:${visitor.address().port}`;
  const tunnel = { status: () => ({ state: 'stopped', enabled: false, installed: true, url: null }),
    start: async () => ({ state: 'starting' }), stop: async () => ({ state: 'stopped' }) };
  const websiteRuntime = { available: true, localOrigin, tunnel,
    status() { return { available: this.available, localOrigin, publicOrigin: null, tunnel: tunnel.status() }; } };
  let modelReply = async () => generated();
  const modelCalls = [];
  const modelGateway = { active: 0, authorized: () => false, config: () => ({ ready: true, models: [{ key: 'model_fixture', name: 'Fixture' }] }),
    async chat(input, source) { modelCalls.push({ input, source }); return modelReply(input); } };
  const { server } = createAdminServer({ root: path.resolve(import.meta.dirname, '..'), store, websites, websiteRuntime,
    settings: { port: 0 }, manager: {}, modelSettings: {}, modelGateway });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  let cookie = '', csrf = '';
  async function request(url, { method = 'GET', body, headers = {} } = {}) {
    const response = await fetch(base + url, { method,
      headers: { Cookie: cookie, ...(method === 'POST' ? { 'Content-Type': 'application/json', Origin: base, 'X-Admin-CSRF': csrf } : {}), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body) });
    if (response.headers.get('set-cookie')) cookie = response.headers.get('set-cookie').split(';')[0];
    const content = await response.text();
    let data; try { data = JSON.parse(content); } catch { data = content; }
    if (data.csrf) csrf = data.csrf;
    return { status: response.status, response, data };
  }
  t.after(async () => {
    await Promise.all([server, visitor].map(listener => new Promise(resolve => { listener.close(resolve); listener.closeAllConnections(); })));
    store.close(); await rm(directory, { recursive: true, force: true });
  });
  const post = (url, body, headers) => request(url, { method: 'POST', body, headers });
  const setup = () => post('/api/setup', { password: 'fixture-independent-admin-password' });
  const create = async () => { const result = await post('/api/websites', draft()); assert.equal(result.status, 201); return result.data; };
  return { request, post, setup, create, localOrigin, websites, websiteRuntime, modelCalls,
    replyWith: implementation => { modelReply = implementation; } };
}

test('website administration requires independent login, matching origin and session CSRF', async t => {
  const f = await fixture(t);
  const health = (await f.request('/api/health')).data;
  assert.deepEqual(health.websites, { available: true, localOrigin: f.localOrigin, publicOrigin: null, state: 'stopped' });
  assert.equal(health.sites, undefined); assert.equal(health.csrf, undefined);
  assert.equal((await f.request('/api/websites')).status, 401);
  assert.equal((await f.post('/api/websites', draft())).status, 401);
  assert.equal((await f.setup()).status, 200);
  assert.equal((await f.post('/api/websites', draft(), { Origin: 'https://attacker.invalid' })).status, 403);
  assert.equal((await f.post('/api/websites', draft(), { 'X-Admin-CSRF': '' })).status, 403);
  assert.equal((await f.post('/api/websites', draft(), { 'Sec-Fetch-Site': 'cross-site' })).status, 403);
  assert.equal(f.websites.list().length, 0);
  const site = await f.create();
  assert.equal((await f.post(`/api/websites/${site.id}/publish`, site, { 'X-Admin-CSRF': '' })).status, 403);
  assert.equal((await f.post(`/api/websites/${site.id}/generate`, { prompt: 'generate', revision: site.revision, requestId: 'website_fixture_auth_01' }, { Origin: 'https://attacker.invalid' })).status, 403);
  assert.equal(f.modelCalls.length, 0);
  assert.equal((await f.request('/api/websites/site_abc')).status, 404);
});

test('saved drafts preview through the visitor origin; publishing and exports use persistent real files', async t => {
  const f = await fixture(t); await f.setup();
  let site = await f.create();
  const listing = (await f.request('/api/websites')).data;
  assert.equal(listing.hosting.localOrigin, f.localOrigin); assert.equal(listing.hosting.available, true);
  assert.equal(listing.sites[0].files, undefined);
  assert.equal((await fetch(`${f.localOrigin}/${site.slug}/`)).status, 404);
  const preview = await f.post(`/api/websites/${site.id}/preview`, { revision: site.revision });
  assert.equal(preview.status, 200); assert.ok(preview.data.url.startsWith(f.localOrigin + '/__preview/'));
  const previewHome = await fetch(preview.data.url);
  assert.match(await previewHome.text(), /Published original/);
  assert.ok(!previewHome.headers.get('content-security-policy').includes('allow-same-origin'));
  assert.match(await (await fetch(preview.data.url + 'app.js')).text(), /Working fixture/);
  const exported = await f.request(`/api/websites/${site.id}/export`);
  assert.equal(exported.status, 200); assert.match(exported.response.headers.get('content-disposition'), /attachment; filename="integration-site.json"/);
  assert.equal(exported.data.schemaVersion, 1); assert.equal(exported.data.files[1].path, 'app.js');
  site = (await f.post(`/api/websites/${site.id}/publish`, { revision: site.revision })).data;
  assert.equal(site.published, true); assert.equal(site.publishedRevision, site.revision);
  const home = await fetch(`${f.localOrigin}/${site.slug}/`);
  assert.equal(home.status, 200); assert.match(await home.text(), /Published original/);
  assert.match(home.headers.get('content-security-policy'), /sandbox allow-scripts/);
  assert.ok(home.headers.get('content-security-policy').includes('allow-same-origin'));
  assert.equal(home.headers.get('access-control-allow-credentials'), null);
  for (const endpoint of ['/api/session', '/api/websites', '/api/model-providers', '/internal/model/config', '/config.json']) assert.equal((await fetch(f.localOrigin + endpoint)).status, 404, endpoint);
  site = (await f.post(`/api/websites/${site.id}`, { ...site, files: [{ path: 'index.html', content: '<h1>Unpublished changes</h1>' }] })).data;
  assert.notEqual(site.publishedRevision, site.revision);
  assert.match(await (await fetch(`${f.localOrigin}/${site.slug}/`)).text(), /Published original/);
  f.websiteRuntime.available = false;
  assert.equal((await f.post(`/api/websites/${site.id}/publish`, { revision: site.revision })).status, 503);
  assert.equal((await f.post(`/api/websites/${site.id}/preview`, { revision: site.revision })).status, 503);
  assert.match(f.websites.visitor(site.slug)[0].content, /Published original/);
});

test('website generation calls the injected model and saves only a draft without publishing', async t => {
  const f = await fixture(t); await f.setup();
  let site = await f.create();
  site = (await f.post(`/api/websites/${site.id}/publish`, { revision: site.revision })).data;
  const result = await f.post(`/api/websites/${site.id}/generate`, { prompt: 'Change the website heading', revision: site.revision, modelKey: 'model_fixture', requestId: 'website_fixture_generation_01' });
  assert.equal(result.status, 200); assert.equal(result.data.model, 'fixture-generator');
  assert.equal(result.data.site.files[0].content, '<h1>Generated draft</h1>');
  assert.notEqual(result.data.site.publishedRevision, result.data.site.revision);
  assert.equal(f.modelCalls.length, 1); assert.equal(f.modelCalls[0].source, 'website');
  assert.equal(f.modelCalls[0].input.modelKey, 'model_fixture');
  assert.ok(f.modelCalls[0].input.messages[0].content.includes('Change the website heading'));
  assert.match(await (await fetch(`${f.localOrigin}/${site.slug}/`)).text(), /Published original/);
  assert.equal((await f.post(`/api/websites/${site.id}/publish`, { revision: result.data.site.revision })).status, 200);
  assert.match(await (await fetch(`${f.localOrigin}/${site.slug}/`)).text(), /Generated draft/);
});

test('malformed or truncated model output and stale requests leave drafts and published snapshots intact', async t => {
  const f = await fixture(t); await f.setup();
  let site = await f.create();
  site = (await f.post(`/api/websites/${site.id}/publish`, { revision: site.revision })).data;
  for (const reply of [{ ...generated(), content: 'invalid JSON' }, { ...generated(), content: '{"files":[]}' }, { ...generated(), finishReason: 'length' }]) {
    f.replyWith(async () => reply);
    const result = await f.post(`/api/websites/${site.id}/generate`, { prompt: 'Generate fixture', revision: site.revision, requestId: 'website_fixture_failure_01' });
    assert.equal(result.status, 502); assert.deepEqual(f.websites.get(site.id), site);
  }
  const calls = f.modelCalls.length;
  assert.equal((await f.post(`/api/websites/${site.id}/generate`, { prompt: 'Stale fixture', revision: site.revision - 1, requestId: 'website_fixture_stale_01' })).status, 409);
  assert.equal(f.modelCalls.length, calls);
  let resolveModel, entered;
  const started = new Promise(resolve => { entered = resolve; });
  f.replyWith(() => { entered(); return new Promise(resolve => { resolveModel = resolve; }); });
  const pending = f.post(`/api/websites/${site.id}/generate`, { prompt: 'Concurrent fixture', revision: site.revision, requestId: 'website_fixture_concurrent_01' });
  await started;
  const saved = await f.post(`/api/websites/${site.id}`, { ...site, name: 'Preserve concurrent edit' });
  assert.equal(saved.status, 200);
  resolveModel(generated());
  assert.equal((await pending).status, 409);
  assert.deepEqual(f.websites.get(site.id), saved.data);
  assert.match(await (await fetch(`${f.localOrigin}/${site.slug}/`)).text(), /Published original/);
});
