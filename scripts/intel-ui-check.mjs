import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { WorkspaceStore } from '../src/store.js';
import { createApi } from '../src/api.js';
import { Intelligence } from '../src/intelligence.js';
import { parseFeed } from '../src/intel-feeds.js';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_PATH ? pathToFileURL(process.env.PLAYWRIGHT_MODULE_PATH).href : 'playwright');
const directory = await mkdtemp(join(tmpdir(), 'wqs-intel-ui-'));
const output = resolve('artifacts/auth');
await mkdir(output, { recursive: true });
const store = new WorkspaceStore(directory);
let clock = Date.now(), updated = false;
const feeds = [
  { id: 'technology', topic: 'technology', name: '项目发布公告', tier: 'official', region: '全球' },
  { id: 'policy', topic: 'policy', name: '公共采购公告', tier: 'official', region: '亚洲' },
  { id: 'markets', topic: 'markets', name: '经济与市场公报', tier: 'official', region: '欧洲' },
  { id: 'world', topic: 'world', name: '国际机构新闻', tier: 'media', region: '全球' },
  { id: 'research', topic: 'research', name: '研究技术期刊', tier: 'research', region: '全球' },
].map(row => ({ ...row, url: `https://public.example.org/${row.id}.xml` }));
const data = {
  technology: [['开放模型发布新的本地推理工具', '本次更新公开了示例、推理配置和兼容性说明，便于评估本地部署成本。'],
    ['模型评测套件加入多语言检索任务', '评测关注跨语言引用和长文本检索，可用于对比已有知识库方案。']],
  policy: [['开放采购公告发布新的数字化试点征询', '公告披露了技术要求与申请时间，建议对照原文核验参与条件。']],
  markets: [['最新市场公报更新制造业采购指标', '报告给出地区分项和月度变化，后续可以结合供应链公告观察。']],
  world: [['国际机构公布跨境数据合作进展', '公开材料列出了参与方、工作范围和下一次磋商日期。']],
  research: [['研究团队公开低功耗边缘设备的测试数据', '论文和数据附录提供了测试条件与可复现实验设置。']],
  custom: [['新增公开信源的有效信息', '这条信息由测试订阅源提供。']],
};
function readFeed(url) {
  const key = new URL(url).pathname.slice(1).split('.')[0];
  const rows = [...(data[key] || [])].map(([title, summary], index) => ({ title, summary, date: clock - 600_000 - index * 360_000, slug: `${key}-${index}` }));
  if (updated && key === 'technology') rows.unshift({ title: 'Edge Compute 公布开发测试进展', summary: '订阅关键词匹配到了新消息。', date: clock, slug: 'technology-new' });
  const xml = `<rss><channel>${rows.map(row => `<item><title>${row.title}</title><description>${row.summary}</description>
    <link>https://public.example.org/story/${row.slug}</link><pubDate>${new Date(row.date).toUTCString()}</pubDate></item>`).join('')}</channel></rss>`;
  return { stories: parseFeed(xml, url, clock) };
}
const modelCalls = [];
const model = { config: async () => ({ ready: true, model: 'fixture-model', provider: '联调模型' }), chat: async input => {
  modelCalls.push(input);
  return { content: '### 关键变化\n- 开放模型新增本地推理配置和示例 [1]。\n\n### 待核验\n- 对照发布记录确认机器配置要求 [1]。', model: 'fixture-model' };
} };
const intelligence = new Intelligence(store, model, { feeds, readFeed, now: () => clock });
const api = createApi(store, 'intelligence-ui', model, { intelligence });
const types = { html: 'text/html', js: 'text/javascript', css: 'text/css', svg: 'image/svg+xml' };
const server = createServer(async (request, response) => {
  const pathname = new URL(request.url, 'http://localhost').pathname;
  const send = (status, body) => { response.writeHead(status, { 'Content-Type': 'application/json' }); response.end(JSON.stringify(body)); };
  if (await api(request, response, pathname, send)) return;
  const name = pathname === '/' ? 'index.html' : pathname.slice(1);
  if (!/^[a-z-]+\.(html|js|css|svg)$/.test(name)) { send(404, {}); return; }
  try {
    const body = await readFile(new URL('../public/' + name, import.meta.url));
    response.writeHead(200, { 'Content-Type': types[name.split('.').at(-1)] + '; charset=utf-8' });
    response.end(body);
  } catch { send(404, {}); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
let browser;
try {
  browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 940 }, acceptDownloads: true });
  const response = await context.request.post(base + '/api/register', { data: { account: 'intelligence_fixture', email: 'fixture@example.test', password: randomBytes(18).toString('hex') } });
  assert.equal(response.status(), 201);
  const page = await context.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const picture = name => page.screenshot({ path: join(output, `intel-${name}.png`), animations: 'disabled' });
  const view = name => page.getByRole('navigation', { name: '信息视图' }).getByRole('button', { name, exact: true });
  const list = page.locator('[data-intel-list]');
  await page.goto(base + '/#home');
  await page.getByRole('heading', { name: '信息收集与分析', exact: true }).waitFor();
  await list.getByRole('link', { name: '开放模型发布新的本地推理工具' }).waitFor();
  assert.equal(await list.locator('.intel-story').count(), 6);
  assert.equal(await page.locator('#workspace-rail a[href="#home"]').getAttribute('title'), '信息收集与分析');
  await picture('overview-desktop');

  await page.getByRole('button', { name: '政策与采购', exact: true }).click();
  assert.equal(await list.locator('.intel-story').count(), 1);
  await page.getByRole('button', { name: '全部', exact: true }).click();
  await page.getByRole('searchbox', { name: '搜索信息' }).fill('本地推理');
  assert.equal(await list.locator('.intel-story').count(), 1);
  await list.getByRole('button', { name: '收藏信息', exact: true }).click();
  await list.getByRole('button', { name: '取消收藏', exact: true }).waitFor();
  await list.getByRole('button', { name: '选入简报', exact: true }).click();
  await page.getByRole('button', { name: '按主题整理', exact: true }).click();
  const brief = page.locator('.intel-brief');
  await brief.getByRole('heading', { name: 'AI 与技术简报' }).waitFor();
  assert.equal(await brief.locator('.intel-cite').first().getAttribute('href'), 'https://public.example.org/story/technology-0');
  await page.getByRole('button', { name: '生成 AI 简报', exact: true }).click();
  await brief.getByRole('heading', { name: '关键变化', exact: true }).waitFor();
  assert.equal(modelCalls.length, 1);
  assert.match(modelCalls[0].messages[0].content, /开放模型发布新的本地推理工具/);
  const exported = page.waitForEvent('download');
  await brief.getByRole('button', { name: '下载简报', exact: true }).click();
  assert.match((await exported).suggestedFilename(), /简报\.md$/);
  await page.getByRole('searchbox', { name: '搜索信息' }).fill('');
  await page.locator('.intel-aside').getByRole('button', { name: '订阅关键词', exact: true }).click();
  const rule = page.locator('[data-intel-form="subscriptions"]');
  await rule.getByLabel('关键词', { exact: true }).fill('Edge Compute');
  await rule.getByLabel('主题', { exact: true }).selectOption('technology');
  await rule.getByRole('button', { name: '保存订阅', exact: true }).click();
  await rule.waitFor({ state: 'hidden' });
  await picture('brief-desktop');

  updated = true;
  clock += 360_000;
  assert.equal(intelligence.enqueue(), feeds.length);
  await page.locator('#toast').filter({ hasText: '订阅提醒 · Edge Compute' }).waitFor({ timeout: 15_000 });
  await page.locator('[data-intel-action="view"][data-id="alerts"]').click();
  await list.getByRole('link', { name: 'Edge Compute 公布开发测试进展' }).waitFor();
  await list.getByRole('button', { name: '全部已读', exact: true }).click();
  await list.getByText('全部提醒', { exact: true }).waitFor();

  await page.locator('[data-intel-action="add-source"]').first().click();
  const source = page.locator('[data-intel-form="sources"]');
  await source.getByLabel('RSS 或 Atom 地址').fill('https://public.example.org/custom.xml');
  await source.getByLabel('信源名称').fill('我的公开订阅源');
  await source.getByLabel('主题').selectOption('policy');
  await source.getByRole('button', { name: '添加信源', exact: true }).click();
  await source.waitFor({ state: 'hidden' });
  await view('信源').click();
  await list.getByRole('link', { name: '我的公开订阅源', exact: true }).waitFor();
  const custom = list.locator('.intel-source-row').filter({ hasText: '我的公开订阅源' });
  await custom.getByRole('button', { name: '看信息' }).click();
  await list.getByRole('link', { name: '新增公开信源的有效信息' }).waitFor();
  await page.reload();
  await view('收藏').click();
  await list.getByRole('link', { name: '开放模型发布新的本地推理工具' }).waitFor();
  await brief.getByRole('heading', { name: '关键变化', exact: true }).waitFor();
  assert.match(await page.locator('.intel-aside').innerText(), /Edge Compute/);

  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 860 });
    await view('信息流').click();
    assert.ok(await page.locator('.main').evaluate(el => el.scrollWidth <= el.clientWidth));
    if (width === 390) await picture('overview-mobile');
    await view('简报').click();
    assert.equal(await page.evaluate(() => document.activeElement.textContent), '分析简报');
    await brief.getByRole('heading', { name: '关键变化', exact: true }).waitFor();
    await page.evaluate(() => window.scrollTo(0, 0));
  }
  assert.deepEqual(errors, []);
  console.log('Intelligence browser checks passed: collection and search, bookmark, sourced brief and export, private subscriptions and unread alerts, custom RSS, persistence and 320/390px widths.');
} finally {
  if (browser) await browser.close();
  intelligence.stop();
  await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
  store.close();
  await rm(directory, { recursive: true, force: true });
}
