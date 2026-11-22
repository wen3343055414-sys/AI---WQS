import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createAdminServer } from '../admin/src/server.js';
import { AdminStore } from '../admin/src/store.js';
import { ModelRegistry } from '../admin/src/model-registry.js';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_PATH ? pathToFileURL(process.env.PLAYWRIGHT_MODULE_PATH).href : 'playwright');
const directory = await mkdtemp(path.join(tmpdir(), 'wqs-admin-layout-'));
const output = path.resolve('artifacts/auth');
await mkdir(output, { recursive: true });
const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve('http://127.0.0.1:' + server.address().port)));
const close = server => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
const provider = createServer((req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({ data: [{ id: 'fixture-model' }] }));
});
const providerOrigin = await listen(provider);
const store = new AdminStore(directory);
const registry = new ModelRegistry(store, { protect: async value => 'fixture:' + value, unprotect: async value => value.slice(8) });
const connection = await registry.saveProvider(null, {
  name: '联调模型服务', preset: 'custom', protocol: 'openai', baseUrl: providerOrigin + '/v1',
  authMode: 'none', enabled: true, timeoutSeconds: 5, monthlyTokenLimit: 0, revision: 0,
});
registry.addModel(connection.id, { providerRevision: connection.revision, modelId: 'fixture-model', name: '联调模型' });
const sha = 'a'.repeat(40), timestamp = new Date().toISOString();
const containers = ['frontend', 'backend'].map(service => ({
  name: 'preview-' + service, state: 'running', status: 'Up (healthy)',
  service, image: 'ai-wqs-' + service + ':' + sha + '-models-v1',
  ports: service === 'frontend' ? '127.0.0.1:3000->8080/tcp' : '',
}));
let scheduled = true, logSources = [], observedActions = [];
const manager = {
  async overview() {
    return {
      updatedAt: timestamp, project: 'ai-wqs-preview', branch: 'main',
      repository: 'example/fixture', appUrl: 'http://127.0.0.1:3000',
      deployment: { sha, previous: 'b'.repeat(40), updatedAt: timestamp, lastBackup: timestamp },
      admin: { port: 3100, pid: 42, revision: sha, uptimeSeconds: 40000, memoryBytes: 64000000 },
      host: { cpuCount: 8, memoryTotal: 16000000000, memoryUsed: 7000000000, uptimeSeconds: 40000 },
      docker: { available: true }, application: { healthy: true }, containers,
      stats: containers.map(container => ({ name: container.name, cpu: '0.2%', memory: '42 MiB / 2 GiB', memoryPercent: '2.1%' })),
      backups: { files: [{ name: 'workspace-20261122T100000.sqlite', size: 64000, modifiedAt: timestamp }], databaseBytes: 74000 },
      scheduler: { exists: true, enabled: scheduled }, maintenance: {},
    };
  },
  async logs(source) {
    logSources.push(source);
    if (source === 'backend') await new Promise(resolve => setTimeout(resolve, 250));
    return '联调日志 · ' + source;
  },
  async action(action) {
    observedActions.push(action);
    if (action === 'pause') scheduled = false;
    if (action === 'resume') scheduled = true;
    return { message: action === 'update' ? '检查完成，当前运行 ' + sha.slice(0, 12) + '。' : '操作完成', output: '联调任务输出' };
  },
};
const access = {
  available: true, enabled: true, revision: 0, gatewayPort: 3200, localUrl: 'http://127.0.0.1:3000',
  primaryUrl: 'http://192.0.2.9:3200', workbench: { ready: true, setupRequired: false, version: sha },
  addresses: [{ name: 'Wi-Fi', address: '192.0.2.9', url: 'http://192.0.2.9:3200', prefixLength: 24, dhcp: true }],
  firewall: { state: 'allowed' },
};
const codeRoot = path.resolve(import.meta.dirname, '../admin');
const { server } = createAdminServer({
  root: codeRoot, settings: { port: 0, revision: sha, codeRoot }, store, manager, modelSettings: registry,
  websiteRuntime: { available: true, access: async () => access },
});
const base = await listen(server);
let browser;
try {
  browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
  const page = await context.newPage();
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  const password = randomBytes(18).toString('hex');
  await page.goto(base);
  await page.getByRole('heading', { name: '设置管理密码' }).waitFor();
  assert.equal(await page.locator('#auth-form h2, #auth-view .eyebrow').count(), 0);
  await page.screenshot({ path: path.join(output, 'admin-login-desktop.png') });
  await page.locator('#password').fill(password);
  await page.locator('#password-confirm').fill(password);
  await page.getByRole('button', { name: '设置密码并登录' }).click();
  await page.locator('#metric-status').filter({ hasText: '运行正常' }).waitFor();
  assert.equal(await page.locator('#page-overview .panel-disclosure[open]').count(), 0);
  await page.screenshot({ path: path.join(output, 'admin-overview-desktop.png'), fullPage: true });

  const navigate = async id => {
    const toggle = page.locator('#admin-menu');
    if (await toggle.isVisible()) await toggle.click();
    await page.locator(`#admin-sidebar .nav-item[data-page="${id}"]`).click();
    await page.locator('#page-' + id).waitFor();
  };
  await navigate('services');
  assert.equal(await page.locator('#detailed-services .service-row').count(), 2);
  await page.getByRole('button', { name: '停止服务', exact: true }).click();
  await page.getByRole('dialog', { name: '停止工作台' }).waitFor();
  await page.keyboard.press('Escape');
  assert.deepEqual(observedActions, []);
  await navigate('logs');
  await page.locator('#log-source').selectOption('frontend');
  await page.locator('#log-output').filter({ hasText: '联调日志 · frontend' }).waitFor();
  await page.locator('#log-source').selectOption('update');
  await page.locator('#log-output').filter({ hasText: '联调日志 · update' }).waitFor();
  assert.ok(logSources.includes('backend'));
  await navigate('backups');
  await page.getByRole('link', { name: '下载', exact: true }).waitFor();
  await page.locator('#page-backups summary').click();
  await page.getByText('每天及升级前自动备份，保留最近 30 份。暂停自动更新时可手动备份。', { exact: true }).waitFor();
  await navigate('deployment');
  await page.getByText('跟随分支', { exact: true }).last().waitFor({ state: 'visible' });
  assert.equal(await page.locator('#current-sha').innerText(), sha.slice(0, 12));
  await page.locator('#page-deployment summary').click();
  await page.getByText('前端容器版本', { exact: true }).waitFor();
  await page.getByRole('button', { name: '检查并更新', exact: true }).click();
  await page.locator('#deployment-jobs [data-job]').filter({ hasText: '当前运行 aaaaaaaaaaaa' }).waitFor({ timeout: 15000 });
  await page.locator('#deployment-jobs [data-job]').first().click();
  await page.getByText('联调任务输出', { exact: true }).waitFor();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '暂停自动更新', exact: true }).click();
  await page.getByRole('button', { name: '恢复自动更新', exact: true }).waitFor({ timeout: 15000 });
  await navigate('audit');
  assert.ok(await page.locator('#audit-table tr').count() > 0);
  await navigate('api-settings');
  await page.locator('#provider-config-form').waitFor();
  assert.equal(await page.locator('#provider-api-key').isDisabled(), true);
  const providerTab = page.getByRole('tab', { name: '服务商', exact: true });
  await providerTab.focus();
  await page.keyboard.press('ArrowRight');
  await page.getByRole('tabpanel', { name: '模型', exact: true }).waitFor();
  await page.keyboard.press('End');
  await page.getByRole('tabpanel', { name: '用量与限额' }).waitFor();
  await page.keyboard.press('Home');
  await page.getByRole('tabpanel', { name: '服务商' }).waitFor();
  await page.screenshot({ path: path.join(output, 'admin-models-desktop.png'), fullPage: true });

  await navigate('websites');
  const search = page.getByRole('searchbox', { name: '搜索域名或 IP' });
  await search.fill('no-match');
  await page.getByText('没有匹配的地址', { exact: true }).waitFor();
  assert.equal(await search.evaluate(element => element === document.activeElement), true);
  await search.fill('');
  await page.getByRole('button', { name: '添加域名', exact: false }).click();
  await page.getByRole('dialog', { name: '添加域名' }).waitFor();
  await page.locator('#domain-hostname').fill('workbench.example.test');
  await page.locator('#domain-add-submit').click();
  await page.getByRole('dialog', { name: '添加域名' }).waitFor({ state: 'hidden' });
  const domain = page.locator('.dm-table tr').filter({ hasText: 'workbench.example.test' });
  await domain.getByRole('button', { name: '详情' }).click();
  await page.getByRole('dialog', { name: 'workbench.example.test' }).waitFor();
  await page.keyboard.press('Escape');
  await page.getByRole('tab', { name: '局域网', exact: true }).click();
  await page.getByRole('button', { name: '停用局域网访问', exact: true }).waitFor();
  await page.getByRole('tab', { name: 'HTTPS', exact: true }).click();
  await page.getByRole('tabpanel', { name: 'HTTPS', exact: true }).waitFor();
  await page.getByRole('tab', { name: '域名', exact: true }).click();
  await page.screenshot({ path: path.join(output, 'admin-access-desktop.png'), fullPage: true });

  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 800 });
    const toggle = page.locator('#admin-menu');
    await toggle.waitFor();
    await toggle.click();
    assert.equal(await page.locator('#admin-main').evaluate(element => element.inert), true);
    await page.keyboard.press('Escape');
    assert.equal(await toggle.evaluate(element => element === document.activeElement), true);
    for (const id of ['overview', 'services', 'logs', 'backups', 'deployment', 'audit', 'api-settings', 'websites']) {
      await navigate(id);
      assert.equal(await toggle.getAttribute('aria-expanded'), 'false');
      assert.ok(await page.locator('body').evaluate(body => body.scrollWidth <= innerWidth), 'Admin ' + id + ' must fit ' + width + 'px');
    }
    if (width === 320) {
      await navigate('overview');
      await page.screenshot({ path: path.join(output, 'admin-overview-mobile-320.png'), fullPage: true });
    }
  }
  assert.deepEqual(errors, []);
  console.log('Admin browser verification passed: setup, responsive navigation, status, logs, versions, actions, provider tabs and domain editing.');
} finally {
  if (browser) await browser.close();
  await close(server); await close(provider); store.close();
  await rm(directory, { recursive: true, force: true });
}
