import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { request as httpRequest } from 'node:http';
import { AdminStore } from '../src/store.js';
import { WebsiteStore, createWebsiteServer } from '../src/websites.js';

const draft = (extra = {}) => ({ name: '我的网站', slug: 'my-site', description: '公开介绍', files: [
  { path: 'index.html', content: '<!doctype html><title>Original</title><link rel="stylesheet" href="assets/main.css"><script src="assets/main.js"></script><h1>Original content</h1>' },
  { path: 'assets/main.css', content: 'h1{color:blue}' },
  { path: 'assets/main.js', content: 'document.title="Working JavaScript"' },
  { path: 'about/index.html', content: '<h1>About</h1>' },
  { path: 'assets/pixel.png', content: 'iVBORw0KGgo=', encoding: 'base64' },
], ...extra });

async function fixture(t, options = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'wqs-websites-test-'));
  const store = new AdminStore(directory), websites = new WebsiteStore(store);
  const server = createWebsiteServer({ websites, ...options });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const raw = (url, headers = {}, method = 'GET') => new Promise((resolve, reject) => {
    const request = httpRequest(base, { path: url, method, headers }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, content: Buffer.concat(chunks) }));
    });
    request.on('error', reject); request.end();
  });
  t.after(async () => { await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }); store.close(); await rm(directory, { recursive: true, force: true }); });
  return { directory, store, websites, server, base, raw };
}

test('website drafts persist in the existing admin database without changing owner data', async t => {
  const f = await fixture(t);
  const created = f.websites.create(draft());
  assert.match(created.id, /^site_[a-f0-9]{24}$/);
  assert.equal(created.revision, 1); assert.equal(created.published, false);
  assert.equal(created.files[0].encoding, 'utf8');
  assert.equal(f.websites.list()[0].files, undefined);
  assert.equal(f.websites.list()[0].name, '我的网站');
  const secondStore = new AdminStore(f.directory);
  try {
    const reopened = new WebsiteStore(secondStore);
    assert.deepEqual(reopened.get(created.id), created);
    assert.ok(secondStore.db.prepare("SELECT name FROM sqlite_master WHERE name='owner'").get());
  } finally { secondStore.close(); }
  assert.ok(f.store.audits().some(row => row.action === 'website-create' && row.detail === created.id));
  assert.ok(!JSON.stringify(f.store.audits()).includes('Original content'));
});

test('publication snapshots stay live through draft edits and survive database reopen', async t => {
  const f = await fixture(t);
  let site = f.websites.create(draft());
  assert.equal((await f.raw('/my-site/')).status, 404);
  site = f.websites.publish(site.id, site);
  assert.equal(site.publishedRevision, 2); assert.equal(site.revision, 2);
  assert.equal(site.publishedRevision, site.revision);
  assert.match((await f.raw('/my-site/')).content.toString(), /Original content/);
  site = f.websites.save(site.id, { ...site, slug: 'new-name', files: [{ path: 'index.html', content: '<h1>Updated draft</h1>' }] });
  assert.notEqual(site.publishedRevision, site.revision);
  assert.equal(site.publishedSlug, 'my-site');
  assert.match((await f.raw('/my-site/')).content.toString(), /Original content/);
  assert.equal((await f.raw('/new-name/')).status, 404);
  assert.throws(() => f.websites.create(draft({ slug: 'my-site' })), error => error.status === 409);
  const reopened = new AdminStore(f.directory);
  try { assert.match(new WebsiteStore(reopened).visitor('my-site')[0].content, /Original content/); }
  finally { reopened.close(); }
  site = f.websites.publish(site.id, site);
  assert.equal(site.publishedRevision, site.revision);
  assert.equal((await f.raw('/my-site/')).status, 404);
  assert.match((await f.raw('/new-name/')).content.toString(), /Updated draft/);
  const unpublished = f.websites.unpublish(site.id, { revision: site.revision, confirmation: site.id });
  assert.equal(unpublished.published, false); assert.equal((await f.raw('/new-name/')).status, 404);
  assert.equal(unpublished.files[0].content, '<h1>Updated draft</h1>');
});

test('revision conflicts and explicit destructive confirmations prevent accidental overwrites', async t => {
  const { websites } = await fixture(t);
  let site = websites.create(draft());
  const stale = site;
  site = websites.save(site.id, { ...site, name: 'New name' });
  for (const action of ['save', 'publish', 'unpublish', 'remove', 'preview']) assert.throws(() => websites[action](site.id, { ...stale, confirmation: site.id }), error => error.status === 409);
  for (const action of ['unpublish', 'remove']) assert.throws(() => websites[action](site.id, { revision: site.revision }), error => error.status === 400);
  assert.equal(websites.get(site.id).name, 'New name');
  assert.throws(() => websites.get('invalid'), error => error.status === 404);
  websites.remove(site.id, { revision: site.revision, confirmation: site.id });
  assert.equal(websites.list().length, 0);
  assert.throws(() => websites.get(site.id), error => error.status === 404);
});

test('file validation rejects filesystem paths, duplicate names, unsupported types and oversize content', async t => {
  const { websites } = await fixture(t);
  for (const name of ['../config.json', '/index.html', 'C:/index.html', 'assets/../../index.html', 'assets\\index.html', '.env', 'assets/.hidden.txt', 'bad%20name.html', 'bad?.html', 'bad#.html', 'assets//style.css', 'file.exe', ' file.html']) {
    assert.throws(() => websites.create(draft({ files: [{ path: name, content: 'text' }] })), error => error.status === 400, name);
  }
  assert.throws(() => websites.create(draft({ files: [{ path: 'index.html', content: 'a' }, { path: 'INDEX.HTML', content: 'b' }] })), error => error.status === 400);
  assert.throws(() => websites.create(draft({ files: [{ path: 'a.png', content: 'not-base64', encoding: 'base64' }] })), error => error.status === 400);
  assert.throws(() => websites.create(draft({ files: [{ path: 'a.png', content: 'raw bytes' }] })), error => error.status === 400);
  assert.throws(() => websites.create(draft({ files: [{ path: 'index.html', content: 'a'.repeat(5 * 1024 * 1024 + 1) }] })), error => error.status === 413);
  assert.throws(() => websites.create(draft({ files: Array.from({ length: 101 }, (_, i) => ({ path: `${i}.txt`, content: 'a' })) })), error => error.status === 400);
  for (const slug of ['../admin', '__preview', 'api', 'UPPER', '-bad', 'bad-', 'a'.repeat(61)]) assert.throws(() => websites.create(draft({ slug })), error => error.status === 400);
  let empty = websites.create(draft({ files: [] }));
  assert.throws(() => websites.publish(empty.id, empty), error => error.status === 400);
  empty = websites.save(empty.id, { ...empty, files: [{ path: 'index.html', content: '  ' }] });
  assert.throws(() => websites.publish(empty.id, empty), error => error.status === 400);
});

test('visitor server serves real relative assets and nested pages with safe MIME and HEAD behavior', async t => {
  const f = await fixture(t);
  const site = f.websites.create(draft()); f.websites.publish(site.id, site);
  const home = await f.raw('/my-site/?ignored=yes');
  assert.equal(home.status, 200); assert.equal(home.headers['content-type'], 'text/html; charset=utf-8');
  assert.equal(home.headers['x-content-type-options'], 'nosniff');
  assert.match(home.headers['content-security-policy'], /sandbox allow-scripts allow-forms allow-popups allow-downloads/);
  assert.ok(home.headers['content-security-policy'].includes('allow-same-origin'));
  assert.equal(home.headers['set-cookie'], undefined); assert.equal(home.headers['access-control-allow-origin'], '*');
  assert.equal(home.headers['cross-origin-resource-policy'], 'cross-origin');
  assert.equal(home.headers['access-control-allow-credentials'], undefined);
  assert.equal((await f.raw('/my-site/assets/main.css')).headers['content-type'], 'text/css; charset=utf-8');
  const javascript = await f.raw('/my-site/assets/main.js', { Origin: 'null', Cookie: 'ai_wqs_admin_session=private-fixture' });
  assert.match(javascript.content.toString(), /Working JavaScript/);
  assert.equal(javascript.headers['access-control-allow-origin'], '*');
  assert.equal(javascript.headers['set-cookie'], undefined);
  assert.ok(!javascript.content.toString().includes('private-fixture'));
  assert.match((await f.raw('/my-site/about/')).content.toString(), /About/);
  const binary = await f.raw('/my-site/assets/pixel.png');
  assert.deepEqual(binary.content, Buffer.from('iVBORw0KGgo=', 'base64')); assert.equal(binary.headers['content-type'], 'image/png');
  const head = await f.raw('/my-site/', {}, 'HEAD'); assert.equal(head.status, 200); assert.equal(head.content.length, 0);
  assert.equal(Number(head.headers['content-length']), home.content.length);
  const redirect = await f.raw('/my-site?from=link'); assert.equal(redirect.status, 308); assert.equal(redirect.headers.location, '/my-site/?from=link');
  assert.equal((await f.raw('/my-site/assets/')).status, 404);
});

test('visitor server never exposes administration, writes, traversal paths or arbitrary rebinding hosts', async t => {
  let publicHost = 'current.trycloudflare.com';
  const f = await fixture(t, { allowedHost: host => host === publicHost });
  const site = f.websites.create(draft()); f.websites.publish(site.id, site);
  for (const route of ['/', '/api/session', '/api/websites', '/config.json', '/data/admin.sqlite', '/src/server.js']) {
    const result = await f.raw(route, { Cookie: 'ai_wqs_admin_session=fixture-private-cookie' });
    assert.equal(result.status, 404, route);
    assert.equal(result.headers['access-control-allow-origin'], undefined);
    assert.equal(result.headers['set-cookie'], undefined);
  }
  for (const route of ['/my-site/../config.json', '/my-site/%2e%2e/config.json', '/my-site/%2E%2E%2Fconfig.json', '/my-site/%252e%252e/config.json', '/my-site/%5cconfig.json', '/my-site/%00index.html', '/my-site/%zz', '//my-site/index.html']) assert.equal((await f.raw(route)).status, 400, route);
  assert.equal((await f.raw('/my-site/', {}, 'POST')).status, 405);
  assert.equal((await f.raw('/my-site/assets/main.js', {}, 'OPTIONS')).status, 405);
  assert.equal((await f.raw('/my-site/', { Host: 'attacker.invalid' })).status, 421);
  assert.equal((await f.raw('/my-site/', { Host: publicHost })).status, 200);
  publicHost = 'replacement.trycloudflare.com';
  assert.equal((await f.raw('/my-site/', { Host: 'current.trycloudflare.com' })).status, 421);
  assert.equal((await f.raw('/my-site/', { Host: publicHost })).status, 200);
  const health = await f.raw('/_health', { Host: publicHost });
  assert.deepEqual(JSON.parse(health.content), { status: 'ok', mode: 'websites' });
  assert.equal(health.headers['access-control-allow-origin'], undefined);
});

test('draft previews are unguessable, immutable, expiring and absent after restart or deletion', async t => {
  const f = await fixture(t);
  let site = f.websites.create(draft());
  const preview = f.websites.preview(site.id, site);
  assert.match(preview.path, /^\/__preview\/[a-f0-9]{64}\/$/);
  assert.ok(Date.parse(preview.expiresAt) > Date.now());
  const previewHome = await f.raw(preview.path);
  assert.match(previewHome.content.toString(), /Original content/);
  assert.ok(!previewHome.headers['content-security-policy'].includes('allow-same-origin'));
  const previewAsset = await f.raw(preview.path + 'assets/main.css', { Origin: 'null' });
  assert.match(previewAsset.content.toString(), /blue/);
  assert.equal(previewAsset.headers['access-control-allow-origin'], '*');
  assert.equal(previewAsset.headers['access-control-allow-credentials'], undefined);
  site = f.websites.save(site.id, { ...site, files: [{ path: 'index.html', content: 'Different draft' }] });
  assert.match((await f.raw(preview.path)).content.toString(), /Original content/);
  const token = preview.path.split('/')[2];
  assert.equal(new WebsiteStore(f.store).previewFiles(token), null);
  f.websites.previews.get(token).expires = Date.now() - 1;
  assert.equal((await f.raw(preview.path)).status, 404);
  const removed = f.websites.preview(site.id, site);
  f.websites.remove(site.id, { revision: site.revision, confirmation: site.id });
  assert.equal((await f.raw(removed.path)).status, 404);
  assert.equal((await f.raw('/__preview/not-a-token/')).status, 404);
});
