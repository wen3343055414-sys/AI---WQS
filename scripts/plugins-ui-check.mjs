import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomBytes } from 'node:crypto';
import { mcpFixture, bridgeFixture } from './testing/mcp-fixture.mjs';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_PATH ? pathToFileURL(process.env.PLAYWRIGHT_MODULE_PATH).href : 'playwright');
const directory = await mkdtemp(path.join(os.tmpdir(), 'wqs-plugin-ui-'));
const output = path.resolve('artifacts/auth');
await mkdir(output, { recursive: true });
const mcp = await mcpFixture({ sse: true, delayMs: 200 }), bridge = await bridgeFixture();
const tokenFile = path.join(directory, 'bridge-token'); await writeFile(tokenFile, bridge.token);
const child = spawn(process.execPath, ['src/server.js'], { env: { ...process.env, HOST: '127.0.0.1', PORT: '0', DATA_DIR: directory,
  APP_VERSION: 'plugin-preview', MODEL_GATEWAY_URL: bridge.origin + '/internal/model',
  MODEL_BRIDGE_TOKEN_FILE: tokenFile, MCP_ALLOWED_LOCAL_ORIGINS: mcp.origin }, stdio: ['ignore', 'pipe', 'pipe'] });
let browser, pageForFailure, contextForFailure, baseForFailure;
try {
  const base = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Plugin UI server startup timed out')), 10000);
    child.stdout.on('data', data => { const match = String(data).match(/http:\/\/127\.0\.0\.1:\d+/); if (match) { clearTimeout(timer); resolve(match[0]); } });
    child.once('error', reject); child.once('exit', code => { clearTimeout(timer); reject(new Error('Plugin UI server exited: ' + code)); });
  });
  baseForFailure = base;
  const password = randomBytes(18).toString('hex');
  assert.equal((await fetch(base + '/api/setup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) })).status, 200);
  browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage(), errors = [];
  pageForFailure = page; contextForFailure = context;
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(base + '/#plugins', { waitUntil: 'networkidle' });
  await page.locator('#auth-account').fill('admin'); await page.locator('#auth-password').fill(password);
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await page.locator('.server-access[open]').waitFor({ state: 'hidden' });
  await page.locator('[data-action="plugin-connect-github"]:enabled').waitFor();
  assert.equal(await page.getByText('内置工具', { exact: true }).count(), 0);
  assert.equal(await page.locator('.plugin-connection').count(), 0);
  assert.equal(await page.locator('.plugin-catalog-card').count(), 2);
  await page.locator('[data-action="plugin-connect-github"]').click();
  const form = page.locator('#plugin-connect-form');
  assert.equal(await form.locator('[name="endpoint"]').inputValue(), 'https://api.githubcopilot.com/mcp/');
  assert.equal(await form.locator('[name="endpoint"]').getAttribute('readonly'), '');
  assert.equal(await form.locator('[name="token"]').getAttribute('type'), 'password');
  assert.equal(await form.locator('a[href="https://github.com/settings/personal-access-tokens/new"]').count(), 1);
  await page.screenshot({ path: path.join(output, 'plugins-github-auth-desktop.png') });
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await page.locator('.plugin-catalog-card').filter({ has: page.getByRole('heading', { name: '自定义 MCP', exact: true }) }).getByRole('button', { name: '添加服务' }).click();
  await form.locator('[name="name"]').fill('GitHub 协作联调');
  await form.locator('[name="endpoint"]').fill(mcp.endpoint);
  await form.locator('[name="authMode"]').selectOption('bearer');
  await form.locator('[name="token"]').fill('invalid-fixture-token');
  await form.getByRole('button', { name: '连接并验证', exact: true }).click();
  await form.locator('#form-error').filter({ hasText: '认证失败' }).waitFor();
  assert.equal(await page.locator('.plugin-connection').count(), 0);
  await form.locator('[name="token"]').fill(mcp.token);
  await form.getByRole('button', { name: '连接并验证', exact: true }).click();
  await form.waitFor({ state: 'hidden' });
  const card = page.locator('.plugin-connection');
  await card.getByText('已连接', { exact: true }).waitFor();
  assert.equal(mcp.state.initializations, 1);
  const data = await (await context.request.get(base + '/api/plugins')).json();
  const id = data.connections[0].id;
  assert.equal(data.connections[0].toolCount, 2);
  assert.ok(!JSON.stringify(data).includes(mcp.token));
  assert.equal(await page.evaluate(value => JSON.stringify(localStorage).includes(value), mcp.token), false);
  await page.screenshot({ path: path.join(output, 'plugins-center-desktop.png'), fullPage: true });
  await card.getByRole('button', { name: '查看工具', exact: true }).click();
  await page.locator('#plugin-tools-form').waitFor();
  assert.equal(await page.locator('.plugin-tool-row').count(), 2);
  await page.screenshot({ path: path.join(output, 'plugins-tools-desktop.png') });
  await page.locator('[data-tool-name="get_repository"]').getByRole('button', { name: '执行工具', exact: true }).click();
  await page.locator('#plugin-call-args').fill('{"owner":"actual-owner","repo":"actual-repo"}');
  await page.getByRole('button', { name: '执行工具', exact: true }).click();
  await page.locator('[data-call-status="success"]').waitFor();
  assert.match(await page.locator('#plugin-call-result').innerText(), /actual-owner\/actual-repo/);
  assert.equal(mcp.state.calls.length, 1);
  assert.equal(await page.locator('#plugin-call-args').getAttribute('readonly'), '');
  assert.equal(await page.getByRole('button', { name: '执行工具', exact: true }).isDisabled(), true);
  await page.getByRole('button', { name: '准备新调用', exact: true }).click();
  assert.equal(await page.locator('#plugin-call-args').getAttribute('readonly'), null);
  assert.equal(mcp.state.calls.length, 1);
  await page.getByRole('button', { name: '关闭弹窗', exact: true }).click();
  await card.getByRole('button', { name: '查看工具', exact: true }).click();
  await page.getByRole('button', { name: '保存对话工具', exact: true }).click();
  await page.locator('#plugin-tools-form').waitFor({ state: 'hidden' });
  await card.getByRole('button', { name: '在对话中使用', exact: true }).click();
  await page.locator('#message-input').fill('读取 GitHub 仓库信息');
  await page.locator('#message-form button[type="submit"]').click();
  await page.locator('.plugin-approval').waitFor();
  assert.equal(mcp.state.calls.length, 1, 'planning must not execute tools');
  assert.match(await page.locator('.plugin-approval').innerText(), /get_repository/);
  assert.match(await page.locator('.plugin-approval pre').innerText(), /fixture-owner/);
  await page.screenshot({ path: path.join(output, 'plugins-approval-desktop.png'), fullPage: true });
  await page.getByRole('button', { name: '取消操作', exact: true }).click();
  await page.locator('.plugin-approval').waitFor({ state: 'hidden' });
  await page.locator('#message-form button[type="submit"]:enabled').waitFor();
  assert.match(await page.locator('.model-request-status').innerText(), /已取消/);
  assert.equal(mcp.state.calls.length, 1);
  assert.equal(bridge.state.calls.length, 1, 'cancel must not create another model request');
  await page.locator('#sidebar .sidebar-new-chat').click();
  await page.waitForFunction(() => location.hash === '#chat' && document.querySelector('#message-input')?.form.dataset.draft === 'new' && document.activeElement?.id === 'message-input');
  await page.locator('#message-input').fill('创建 GitHub issue');
  await page.locator('#message-form button[type="submit"]').click();
  await page.locator('.plugin-approval').waitFor();
  assert.match(await page.locator('.plugin-approval').innerText(), /create_issue/);
  const beforeApproval = mcp.state.calls.length;
  await page.getByRole('button', { name: '确认并执行', exact: true }).click();
  await page.locator('.plugin-approval').waitFor({ state: 'hidden' });
  await page.getByText('已读取插件返回结果：', { exact: false }).waitFor();
  assert.equal(mcp.state.calls.length, beforeApproval + 1);
  assert.equal(mcp.state.calls.at(-1).name, 'create_issue');
  assert.equal(mcp.state.calls.at(-1).arguments.title, '协作任务');
  await page.screenshot({ path: path.join(output, 'plugins-result-desktop.png'), fullPage: true });
  await page.goto(base + '/#plugins'); await page.getByText('已连接', { exact: true }).waitFor();
  await page.reload({ waitUntil: 'networkidle' }); await page.getByText('已连接', { exact: true }).waitFor();
  assert.equal((await (await context.request.get(base + '/api/plugins')).json()).connections[0].id, id);
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await page.waitForFunction(() => Math.abs(document.querySelector('.workspace').getBoundingClientRect().left) < 0.5);
    assert.ok(await page.locator('.main').evaluate(element => element.scrollWidth <= element.clientWidth), 'Plugin catalog must fit mobile');
    await page.screenshot({ path: path.join(output, 'plugins-center-mobile-' + width + '.png'), fullPage: true });
    await card.getByRole('button', { name: '查看工具', exact: true }).click();
    assert.ok(await page.locator('#dialog').evaluate(element => element.scrollWidth <= element.clientWidth && element.getBoundingClientRect().width <= innerWidth));
    await page.getByRole('button', { name: '关闭弹窗', exact: true }).click();
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  const bobPassword = randomBytes(18).toString('hex');
  assert.equal((await context.request.post(base + '/api/register', { data: { account: 'plugin_bob', email: 'plugin-bob@example.test', password: bobPassword } })).status(), 201);
  await page.reload({ waitUntil: 'networkidle' });
  await page.locator('[data-action="plugin-connect-github"]:enabled').waitFor();
  assert.equal(await page.locator('.plugin-connection').count(), 0);
  assert.equal((await (await context.request.get(base + '/api/plugins')).json()).connections.length, 0);
  assert.equal(await page.getByText('GitHub 协作联调', { exact: true }).count(), 0);
  assert.equal((await context.request.post(base + '/api/login', { data: { account: 'admin', password } })).status(), 200);
  await page.reload({ waitUntil: 'networkidle' }); await page.getByText('已连接', { exact: true }).waitFor();
  await card.getByRole('button', { name: '断开连接：GitHub 协作联调', exact: true }).click();
  await page.getByRole('button', { name: '断开连接', exact: true }).click();
  await card.waitFor({ state: 'hidden' });
  assert.equal((await (await context.request.get(base + '/api/plugins')).json()).connections.length, 0);
  assert.deepEqual(errors, []);
  console.log('MCP browser flow passed: real HTTP discovery and execution, auth failure, secret isolation, native tool catalog, manual calls, consent/cancel, model continuation, account isolation, persistence, disconnect, and desktop/320/390px layouts.');
} catch (error) {
  if (pageForFailure && contextForFailure && baseForFailure) {
    const data = await (await contextForFailure.request.get(baseForFailure + '/api/workspace')).json();
    console.log('Plugin UI diagnostics: ' + JSON.stringify({
      tasks: data.state?.tasks.map(task => ({ status: task.status, error: task.error, pluginIds: task.pluginIds })).slice(0, 3),
      bridgeCalls: bridge.state.calls.length, toolCalls: mcp.state.calls.length,
      ui: await pageForFailure.evaluate(() => ({ hash: location.hash, toast: document.querySelector('#toast')?.textContent,
        draft: document.querySelector('#message-form')?.dataset.draft,
        inputLength: document.querySelector('#message-input')?.value.length, disabled: document.querySelector('#message-form button[type="submit"]')?.disabled,
        viewport: innerWidth, main: { width: document.querySelector('.main')?.clientWidth, scrollWidth: document.querySelector('.main')?.scrollWidth },
        overflow: [...document.querySelectorAll('.main *')].filter(el => el.getBoundingClientRect().right > innerWidth + 1).slice(0, 12).map(el => ({ tag: el.tagName, cls: el.className, right: Math.round(el.getBoundingClientRect().right) })) }))
    }));
    await pageForFailure.evaluate(() => document.querySelectorAll('[data-plugin-secret]').forEach(input => { input.value = ''; }));
    await pageForFailure.screenshot({ path: path.join(output, 'plugins-failure.png'), fullPage: true });
  }
  throw error;
} finally {
  if (browser) await browser.close();
  if (child.exitCode === null && child.signalCode === null) { const stopped = once(child, 'exit'); child.kill(); await stopped; }
  await mcp.close(); await bridge.close();
  await rm(directory, { recursive: true, force: true });
}
