import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { WorkspaceStore } from '../src/store.js';
import { PluginService } from '../src/plugins.js';
import { McpClient, mcpHttp, endpointUrl, publicAddress } from '../src/plugin-network.js';
import { createApi } from '../src/api.js';
import { mcpFixture } from '../scripts/testing/mcp-fixture.mjs';

async function setup(t, options = {}) {
  const directory = await mkdtemp(path.join(tmpdir(), 'wqs-mcp-'));
  const fixture = await mcpFixture(options);
  const store = new WorkspaceStore(directory);
  const owner = store.setup(randomBytes(18).toString('hex'));
  const bob = store.register({ account: 'mcp_bob', email: 'mcp-bob@example.test', password: randomBytes(18).toString('hex') });
  const service = new PluginService(store, { allowedLocal: [fixture.origin] });
  t.after(async () => { await fixture.close(); store.close(); await rm(directory, { recursive: true, force: true }); });
  return { directory, fixture, store, owner, bob, service };
}
const input = fixture => ({ kind: 'custom', name: 'GitHub 联调服务', endpoint: fixture.endpoint, authMode: 'bearer', token: fixture.token });

test('MCP connects with session negotiation, pagination and SSE, then executes the real advertised tool', async t => {
  const { service, fixture, owner } = await setup(t, { pagination: true, sse: true });
  const connection = await service.connect(owner.id, input(fixture));
  assert.equal(connection.status, 'connected'); assert.equal(connection.toolCount, 2);
  assert.equal(fixture.state.initializations, 1); assert.equal(fixture.state.notifications, 1); assert.equal(fixture.state.lists, 2);
  const called = await service.invoke(owner.id, connection.id, 'get_repository', { owner: 'octo', repo: 'sample' }, 'invoke_fixture_read_001', connection.revision);
  assert.equal(called.status, 'success');
  assert.equal(called.result.structuredContent.full_name, 'octo/sample');
  assert.equal(fixture.state.calls.length, 1);
  const same = await service.invoke(owner.id, connection.id, 'get_repository', { owner: 'octo', repo: 'sample' }, 'invoke_fixture_read_001', connection.revision);
  assert.deepEqual(same, called); assert.equal(fixture.state.calls.length, 1);
  await assert.rejects(service.invoke(owner.id, connection.id, 'get_repository', { owner: 'changed' }, 'invoke_fixture_read_001', connection.revision), /另一项操作/);
});

test('credentials are encrypted on disk and never appear in lists, tool responses, workspace exports or errors', async t => {
  const { service, fixture, store, owner, directory } = await setup(t);
  const connection = await service.connect(owner.id, input(fixture));
  const row = store.db.prepare('SELECT * FROM plugin_connections WHERE id=?').get(connection.id);
  assert.ok(row.credential && !row.credential.includes(fixture.token));
  assert.equal(service.secret(row), fixture.token);
  assert.equal((await readFile(path.join(directory, 'plugins.key'))).length, 32);
  assert.ok(!JSON.stringify([connection, service.list(owner.id), store.read(owner.id)]).includes(fixture.token));
  await assert.rejects(service.connect(owner.id, { ...input(fixture), endpoint: fixture.endpoint + '?token=leak' }), /HTTPS MCP 地址/);
  const invalid = await mcpFixture({ token: 'another-fixture-token' });
  t.after(() => invalid.close());
  const client = new McpClient(invalid.endpoint, { token: fixture.token, allowedLocal: [invalid.origin] });
  await assert.rejects(client.connect(), error => error.code === 'plugin_auth' && !error.message.includes(fixture.token) && !error.message.includes('another-fixture-token'));
  const restarted = new PluginService(store, { allowedLocal: [fixture.origin] });
  assert.equal(restarted.secret(row), fixture.token);
});

test('plugin connections and call ledgers cannot be accessed or changed by another account', async t => {
  const { service, fixture, owner, bob } = await setup(t);
  const connection = await service.connect(owner.id, input(fixture));
  assert.equal(service.list(bob.id).length, 0);
  assert.throws(() => service.detail(bob.id, connection.id), /不存在/);
  assert.throws(() => service.disconnect(bob.id, connection.id), /不存在/);
  await assert.rejects(service.invoke(bob.id, connection.id, 'get_repository', {}, 'invoke_other_account', connection.revision), /不存在/);
  assert.equal(fixture.state.calls.length, 0);
  const disabled = service.configure(owner.id, connection.id, { revision: connection.revision, enabled: false });
  await assert.rejects(service.invoke(owner.id, connection.id, 'get_repository', {}, 'invoke_disabled_case', disabled.revision), /已停用/);
  assert.throws(() => service.configure(owner.id, connection.id, { revision: connection.revision, selectedTools: ['get_repository'] }), /配置已变化/);
  assert.equal(fixture.state.calls.length, 0);
});

test('unknown tools, redirects, metadata addresses, mapped IPv6 and DNS rebinding never receive credentials', async t => {
  const { service, fixture, owner } = await setup(t);
  const connection = await service.connect(owner.id, input(fixture));
  await assert.rejects(service.invoke(owner.id, connection.id, 'execute_unadvertised', {}, 'invoke_unknown_tool', connection.revision), /未提供/);
  for (const address of ['127.0.0.1', '169.254.169.254', '10.0.0.1', '100.64.0.1', '192.168.1.1', '::1', '::ffff:127.0.0.1', '2002:7f00:1::1', '2001:0db8::1']) assert.equal(publicAddress(address), false, address);
  assert.equal(publicAddress('8.8.8.8'), true);
  assert.equal(publicAddress('2606:4700:4700::1111'), true);
  for (const url of ['http://example.com/mcp', 'https://u:p@example.com/mcp', 'https://example.com/mcp#fragment', 'https://127.0.0.1/mcp']) assert.throws(() => endpointUrl(url));
  await assert.rejects(mcpHttp('https://example.com/mcp', { jsonrpc: '2.0', id: 1, method: 'initialize' }, { resolver: async () => [{ address: '169.254.169.254', family: 4 }] }), /未获准/);
  let arrived = 0;
  const redirect = createServer((req, res) => { arrived++; res.writeHead(302, { Location: fixture.endpoint }); res.end(); });
  await new Promise(resolve => redirect.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { redirect.close(resolve); redirect.closeAllConnections(); }));
  const origin = 'http://127.0.0.1:' + redirect.address().port;
  await assert.rejects(new McpClient(origin + '/mcp', { token: fixture.token, allowedLocal: [origin] }).connect(), /重定向/);
  assert.equal(arrived, 1); assert.equal(fixture.state.calls.length, 0);
});

test('timeouts and restart mark uncertain operations without ever replaying them', async t => {
  const { service, fixture, owner, store } = await setup(t, { delayMs: 90 });
  const connection = await service.connect(owner.id, input(fixture));
  service.clients.get(connection.id).client.options.timeoutMs = 25;
  const result = await service.invoke(owner.id, connection.id, 'create_issue', { owner: 'octo', repo: 'sample', title: 'one issue' }, 'invoke_timeout_case', connection.revision);
  assert.equal(result.status, 'unknown');
  assert.equal(fixture.state.calls.length, 1);
  const restored = new PluginService(store, { allowedLocal: [fixture.origin] });
  const again = await restored.invoke(owner.id, connection.id, 'create_issue', { owner: 'octo', repo: 'sample', title: 'one issue' }, 'invoke_timeout_case', connection.revision);
  assert.equal(again.status, 'unknown'); assert.equal(fixture.state.calls.length, 1);
  store.db.prepare("UPDATE plugin_invocations SET status='running' WHERE request_id=?").run('invoke_timeout_case');
  const afterCrash = new PluginService(store, { allowedLocal: [fixture.origin] });
  assert.equal((await afterCrash.invoke(owner.id, connection.id, 'create_issue', { owner: 'octo', repo: 'sample', title: 'one issue' }, 'invoke_timeout_case', connection.revision)).status, 'unknown');
  assert.equal(fixture.state.calls.length, 1);
});

test('authenticated plugin HTTP routes enforce actor binding, never export secrets, and disconnect credentials', async t => {
  const { service, fixture, owner, bob, store } = await setup(t);
  const api = createApi(store, 'fixture', { config: async () => ({ ready: false }) }, { plugins: service });
  const server = createServer(async (req, res) => {
    const send = (status, value) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(value)); };
    if (!await api(req, res, new URL(req.url, 'http://localhost').pathname, send)) send(404, {});
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const origin = 'http://127.0.0.1:' + server.address().port;
  const ownerCookie = 'wqs_session=' + store.createSession(owner.id), bobCookie = 'wqs_session=' + store.createSession(bob.id);
  const request = (url, body, cookie = ownerCookie, extra = {}) => fetch(origin + url, {
    method: body ? 'POST' : 'GET', headers: { Cookie: cookie, ...(body ? { 'Content-Type': 'application/json' } : {}), ...extra }, body: body ? JSON.stringify(body) : undefined,
  });
  assert.equal((await fetch(origin + '/api/plugins')).status, 401);
  assert.equal((await request('/api/plugins/connect', { ...input(fixture), userId: bob.id })).status, 401);
  const connected = await request('/api/plugins/connect', { ...input(fixture), userId: owner.id });
  assert.equal(connected.status, 201); const connection = await connected.json();
  assert.equal((await request('/api/plugins/' + connection.id, null, bobCookie)).status, 404);
  assert.equal((await request('/api/plugins/' + connection.id + '/disconnect', { userId: owner.id }, ownerCookie, { Origin: 'https://evil.invalid' })).status, 403);
  const listed = await (await request('/api/plugins')).text(); assert.ok(!listed.includes(fixture.token));
  assert.equal((await request('/api/chat', { userId: owner.id, tools: [], requestId: 'request_fake_tools', assistant: 'general', messages: [{ role: 'user', content: 'test' }] })).status, 400);
  assert.equal((await request('/api/plugins/' + connection.id + '/disconnect', { userId: owner.id })).status, 200);
  assert.equal(service.list(owner.id).length, 0);
  assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM plugin_connections').get().n, 0);
});

test('corrupted encryption key marks persisted connections unavailable without deleting workspace data', async t => {
  const { service, fixture, store, owner, directory } = await setup(t);
  const connection = await service.connect(owner.id, input(fixture));
  await writeFile(path.join(directory, 'plugins.key'), 'invalid-fixture-key');
  const restarted = new PluginService(store, { allowedLocal: [fixture.origin] });
  assert.equal(restarted.detail(owner.id, connection.id).status, 'error');
  await assert.rejects(restarted.invoke(owner.id, connection.id, 'get_repository', {}, 'invoke_bad_key_fixture', connection.revision));
  assert.equal(fixture.state.calls.length, 0);
  assert.ok(store.read(owner.id));
});
test('credential echoed by a remote tool is never returned or persisted as a tool result', async t => {
  const token = 'fixture-echo-' + randomBytes(16).toString('hex');
  const { service, fixture, store, owner } = await setup(t, { token,
    result: () => ({ content: [{ type: 'text', text: 'credential=' + token }] }) });
  const connection = await service.connect(owner.id, input(fixture));
  const result = await service.invoke(owner.id, connection.id, 'get_repository', {}, 'invoke_secret_echo_fixture', connection.revision);
  assert.ok(['error', 'unknown'].includes(result.status));
  assert.ok(!JSON.stringify(result).includes(token));
  const stored = store.db.prepare('SELECT result,error_message FROM plugin_invocations WHERE user_id=?').all(owner.id);
  assert.ok(!JSON.stringify(stored).includes(token));
});
