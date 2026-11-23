import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import { WorkspaceStore, HttpError } from '../src/store.js';
import { createApi } from '../src/api.js';
import { Intelligence } from '../src/intelligence.js';
import { feedUrl, parseFeed, requestFeed } from '../src/intel-feeds.js';

const now = Date.parse('2026-11-22T02:00:00Z');
const feed = (id, topic = 'technology') => ({ id, topic, name: id, tier: 'official', region: '全球', url: `https://news.example.org/${id}.xml` });
const item = (slug, title, published) => ({ title, published, url: `https://news.example.org/story/${slug}`, summary: '来自公开订阅源的摘要。' });
async function idle(service) {
  const until = Date.now() + 2000;
  while (service.jobs.size && Date.now() < until) await delay(5);
  assert.equal(service.jobs.size, 0);
}
async function database(t) {
  const dir = await mkdtemp(join(tmpdir(), 'intelligence-test-'));
  const store = new WorkspaceStore(dir);
  t.after(async () => { store.close(); await rm(dir, { recursive: true, force: true }); });
  const account = name => store.register({ account: name, email: `${name}@example.test`, password: 'fixture-password-123' }).id;
  return { store, account };
}

test('public RSS and Atom normalize tracking links, decode text safely and keep source timestamps', () => {
  const rss = `<?xml version="1.0"?><rss version="2.0"><channel>
    <item><title>新版本 &#x1F680;</title><link>https://public.example.org/report?utm_medium=rss&amp;z=2</link>
    <description><![CDATA[<p>实际摘要 &amp; 信息</p><script>bad()</script>]]></description><pubDate>22 Nov 2026 01:55:00 GMT</pubDate></item>
    <item><title>重复</title><link>https://public.example.org/report?z=2</link></item>
    <item><title>不可用链接</title><link>javascript:alert(1)</link></item>
    </channel></rss>`;
  assert.deepEqual(parseFeed(rss, 'https://public.example.org/rss.xml', now), [{ title: '新版本 🚀', url: 'https://public.example.org/report?z=2',
    summary: '实际摘要 & 信息', published: now - 300_000 }]);
  const atom = `<feed xmlns="http://www.w3.org/2005/Atom"><entry><title>Announcement</title>
    <link rel="self" href="/atom"/><link href="../release" rel="alternate"/><updated>2026-11-21T00:00:00Z</updated>
    <content type="html">&lt;b&gt;Public&lt;/b&gt; release</content></entry></feed>`;
  assert.equal(parseFeed(atom, 'https://public.example.org/feed/atom.xml', now)[0].url, 'https://public.example.org/release');
  assert.equal(parseFeed(atom, 'https://public.example.org/feed/atom.xml', now)[0].summary, 'Public release');
  assert.throws(() => parseFeed('<html>Request denied</html>', 'https://public.example.org/'), /有效/);
  assert.throws(() => parseFeed('<!DOCTYPE rss [<!ENTITY invalid "text">]><rss></rss>', 'https://public.example.org/'), /有效/);
});

test('custom subscriptions reject nonpublic addresses and embedded credentials before any HTTP request', async () => {
  for (const url of ['http://public.example.org/rss', 'https://localhost/feed', 'https://169.254.169.254/latest',
    'https://account:password@public.example.org/feed', 'https://public.example.org/feed?token=credential', 'https://public.example.org:9443/feed']) {
    assert.throws(() => feedUrl(url), /公开/);
  }
  await assert.rejects(requestFeed('https://private.example.org/feed', { resolver: async () => [{ address: '192.168.1.10', family: 4 }] }), /公网/);
});

test('scheduled collection deduplicates new stories, matches private keyword rules and keeps cached data on failure', async t => {
  const { store, account } = await database(t);
  const reader = account('reader'), other = account('other');
  let date = now, stage = 0;
  const requestLog = [];
  const sources = [feed('official'), feed('community')];
  const service = new Intelligence(store, {}, { feeds: sources, now: () => date, readFeed: async (url, options) => {
    requestLog.push({ url, etag: options.etag });
    if (stage === 2) throw new HttpError(502, 'fixture_busy', '信源返回 HTTP 429。', { retryMs: 900_000 });
    if (stage === 3) return { unchanged: true };
    return { stories: [item('historic', 'Open Source 旧消息', now - 1_000),
      ...(stage === 1 ? [item('fresh', 'Open Source 新发布', now + 180_000)] : [])], etag: 'sample-etag' };
  } });
  t.after(() => service.stop());
  service.addRule(reader, { keyword: 'Ｏｐｅｎ Source', topic: 'technology' });
  service.addRule(other, { keyword: 'Open Source', topic: 'world' });
  assert.equal(service.enqueue(), 2);
  await idle(service);
  assert.equal(service.overview(reader).alerts.length, 0, 'historical imports should stay quiet');
  assert.equal(service.overview(reader).articles.length, 1);
  assert.equal(service.enqueue(reader, true), 0, 'manual refresh should respect the per-source cooldown');
  stage = 1;
  date += 300_000;
  assert.equal(service.enqueue(), 2, 'automatic refresh should run without a browser visiting the page');
  await idle(service);
  let state = service.overview(reader);
  assert.deepEqual(state.articles.map(article => article.title), ['Open Source 新发布', 'Open Source 旧消息']);
  assert.deepEqual([state.articles[0].sourceId, ...state.articles[0].otherSources.map(row => row.sourceId)].sort(), ['community', 'official']);
  assert.equal(state.unread, 1);
  assert.equal(service.overview(other).unread, 0);
  assert.equal(requestLog[2].etag, 'sample-etag');
  const article = state.articles[0];
  service.saveArticle(reader, { id: article.id, saved: true });
  service.sourceAction(reader, article.sourceId, 'disable');
  state = service.overview(reader);
  assert.equal(state.saved[0].url, article.url);
  assert.equal(state.articles[0].saved, 1, 'duplicates of saved articles should be marked');
  assert.equal(service.overview(other).saved.length, 0);
  service.markAlerts(reader, state.alerts[0].alertId);
  assert.equal(service.overview(reader).unread, 0);
  stage = 2;
  date += 300_000;
  service.enqueue();
  await idle(service);
  state = service.overview(reader);
  assert.equal(state.articles.length, 2);
  assert.match(state.sources.find(source => source.enabled).error, /429/);
  assert.equal(service.enqueue(reader, true), 0);
  stage = 3;
  date += 900_000;
  service.enqueue();
  await idle(service);
  assert.equal(service.overview(reader).sources.find(source => source.enabled).error, null);
  assert.equal(service.overview(reader).alerts.length, 1);
});

test('briefs use authorized source snapshots and recover existing subscriptions and briefs after service reinitialization', async t => {
  const { store, account } = await database(t);
  const reader = account('reader'), other = account('other');
  let modelActive = false;
  const calls = [];
  const model = { config: async () => ({ ready: modelActive }), chat: async (input, userId) => {
    calls.push({ input, userId });
    return { content: '### 关键变化\n有新文件发布 [1]。', model: 'fixture-model' };
  } };
  const options = { feeds: [], now: () => now, readFeed: async () => ({ stories: [item('private-catalog', '示例政策文件', now)] }) };
  const service = new Intelligence(store, model, options);
  const sourceId = service.addSource(reader, { name: '政策目录', topic: 'policy', url: 'https://public.example.org/policy.xml' });
  await idle(service);
  assert.deepEqual(service.overview(other).sources, []);
  assert.equal(service.overview(reader).sources[0].id, sourceId);
  const id = service.overview(reader).articles[0].id;
  await assert.rejects(service.makeBrief(other, { ids: [id] }), /重新选择/);
  await assert.rejects(service.makeBrief(reader, { ids: [id], ai: true }), /请先配置模型/);
  const organized = await service.makeBrief(reader, { ids: [id] });
  assert.match(organized.body, /政策与采购.*\n- \[1\] 示例政策文件/);
  assert.equal(organized.refs[0].url, item('private-catalog').url);
  modelActive = true;
  const analysis = await service.makeBrief(reader, { ids: [id], ai: true });
  assert.equal(analysis.model, 'fixture-model');
  assert.equal(calls[0].userId, reader);
  assert.match(calls[0].input.messages[0].content, /示例政策文件/);
  assert.equal(calls[0].input.tools, undefined);
  service.addRule(reader, { keyword: '政策' });
  service.saveArticle(reader, { id, saved: true });
  service.sourceAction(reader, sourceId, 'remove');
  service.stop();
  const restored = new Intelligence(store, model, options);
  assert.equal(restored.overview(reader).saved[0].id, id);
  assert.equal(restored.overview(reader).rules[0].keyword, '政策');
  assert.equal(restored.overview(reader).briefs[0].id, analysis.id);
  assert.deepEqual(restored.overview(other).briefs, []);
});

test('intelligence HTTP routes require authentication and account-bound writes; polling can skip unchanged snapshots', async t => {
  const { store, account } = await database(t);
  const reader = account('reader'), token = store.createSession(reader);
  const model = { config: async () => ({ ready: false }) };
  const intelligence = new Intelligence(store, model, { feeds: [] });
  const api = createApi(store, 'intel-fixture', model, { intelligence });
  const server = createServer(async (request, response) => {
    const send = (status, body) => { response.writeHead(status, { 'Content-Type': 'application/json' }); response.end(JSON.stringify(body)); };
    if (!await api(request, response, new URL(request.url, 'http://localhost').pathname, send)) send(404, {});
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }); intelligence.stop(); });
  const url = `http://127.0.0.1:${server.address().port}/api/intelligence`;
  const headers = { Cookie: 'wqs_session=' + token, 'Content-Type': 'application/json' };
  assert.equal((await fetch(url)).status, 401);
  const view = await (await fetch(url, { headers })).json();
  const poll = await (await fetch(`${url}?since=${view.revision}`, { headers })).json();
  assert.deepEqual(poll, { unchanged: true });
  const post = body => fetch(url + '/subscriptions', { method: 'POST', headers, body: JSON.stringify(body) });
  assert.equal((await post({ userId: reader + 1, keyword: 'AI' })).status, 401);
  const changed = await (await post({ userId: reader, keyword: 'AI' })).json();
  assert.notEqual(changed.revision, view.revision);
  assert.equal(changed.rules[0].keyword, 'AI');
});
