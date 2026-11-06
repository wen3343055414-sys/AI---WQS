import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request as httpRequest } from 'node:http';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createWorkbenchGateway } from '../src/workbench-gateway.js';

const REPO = path.resolve(import.meta.dirname, '../..');
const PUBLIC = 'workbench-fixture.example';
const PASSWORD = 'fixture-workbench-independent-password';
const listen = async server => { await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); return `http://127.0.0.1:${server.address().port}`; };
const close = server => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });

function request(base, target, { method = 'GET', body, headers = {}, chunks } = {}) {
  return new Promise((resolve, reject) => {
    const content = body === undefined ? undefined : JSON.stringify(body);
    const req = httpRequest(base, { path: target, method, headers: {
      ...(content === undefined ? {} : { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(content) }), ...headers,
    } }, response => {
      const received = [];
      response.on('data', chunk => received.push(chunk));
      response.on('error', reject);
      response.on('end', () => {
        const text = Buffer.concat(received).toString('utf8');
        let data; try { data = JSON.parse(text); } catch { data = text; }
        resolve({ status: response.statusCode, headers: response.headers, data, text });
      });
    });
    req.on('error', reject);
    if (chunks) for (const chunk of chunks) req.write(chunk);
    req.end(content);
  });
}

async function actualWorkbench(t, options = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'wqs-workbench-gateway-'));
  const child = spawn(process.execPath, ['src/server.js'], { cwd: REPO, windowsHide: true,
    env: { ...process.env, HOST: '127.0.0.1', PORT: '0', DATA_DIR: directory, APP_VERSION: 'gateway-fixture', MODEL_GATEWAY_URL: '', MODEL_GATEWAY_TOKEN_FILE: '', COOKIE_SECURE: '' },
    stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) { const exited = once(child, 'exit'); child.kill(); await exited; }
    await rm(directory, { recursive: true, force: true });
  });
  const upstreamOrigin = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Fixture startup timed out')), 5000);
    child.stdout.on('data', data => { const address = String(data).match(/http:\/\/127\.0\.0\.1:\d+/); if (address) { clearTimeout(timer); resolve(address[0]); } });
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('exit', code => { clearTimeout(timer); reject(new Error(`Fixture exited: ${code}`)); });
  });
  const gateway = createWorkbenchGateway({ upstreamOrigin, allowedHost: hostname => hostname === PUBLIC, ...options });
  const base = await listen(gateway);
  t.after(() => close(gateway));
  return { upstreamOrigin, base, gateway };
}

test('gateway serves the actual workbench and two independent public logins share its persistent workspace', { timeout: 20000 }, async t => {
  const f = await actualWorkbench(t);
  assert.equal((await request(f.base, '/api/setup', { method: 'POST', body: { password: PASSWORD }, headers: { Host: PUBLIC, Origin: `https://${PUBLIC}` } })).status, 404);
  assert.equal((await request(f.upstreamOrigin, '/api/setup', { method: 'POST', body: { password: PASSWORD } })).status, 200);
  for (const target of ['/', '/index.html', '/styles.css', '/app.js', '/core.js', '/sync.js', '/favicon.svg']) {
    const external = await request(f.base, target, { headers: { Host: PUBLIC } });
    const local = await request(f.upstreamOrigin, target === '/index.html' ? '/' : target);
    assert.equal(external.status, 200, target); assert.equal(external.text, local.text, target);
    assert.equal(external.headers['content-security-policy'], local.headers['content-security-policy']);
  }
  const initialStatus = await request(f.base, '/api/status', { headers: { Host: PUBLIC } });
  assert.equal(initialStatus.data.mode, 'server'); assert.equal(initialStatus.data.authenticated, false);
  assert.equal((await request(f.base, '/api/workspace', { headers: { Host: PUBLIC } })).status, 401);
  const login = async () => {
    const result = await request(f.base, '/api/login', { method: 'POST', body: { password: PASSWORD }, headers: { Host: PUBLIC, Origin: `https://${PUBLIC}`, 'Sec-Fetch-Site': 'same-origin' } });
    assert.equal(result.status, 200); assert.equal(result.headers['set-cookie'].length, 1);
    assert.match(result.headers['set-cookie'][0], /HttpOnly; SameSite=Strict; Path=\//); assert.match(result.headers['set-cookie'][0], /; Secure$/);
    return result.headers['set-cookie'][0].split(';')[0];
  };
  const first = await login(), second = await login();
  assert.notEqual(first, second);
  const headers = cookie => ({ Host: PUBLIC, Cookie: cookie, Origin: `https://${PUBLIC}`, 'Sec-Fetch-Site': 'same-origin' });
  for (const cookie of [first, second]) {
    const status = await request(f.base, '/api/status', { headers: headers(cookie) });
    assert.equal(status.data.serverId, initialStatus.data.serverId); assert.equal(status.data.authenticated, true);
  }
  const snapshot = (await request(f.base, '/api/workspace', { headers: headers(first) })).data;
  snapshot.state.prompts[0].title = 'Shared through the actual workbench';
  const saved = await request(f.base, '/api/workspace', { method: 'PUT', body: { state: snapshot.state, baseRevision: snapshot.revision }, headers: headers(first) });
  assert.equal(saved.status, 200); assert.equal(saved.data.revision, snapshot.revision + 1);
  const otherDevice = (await request(f.base, '/api/workspace', { headers: headers(second) })).data;
  assert.equal(otherDevice.state.prompts[0].title, 'Shared through the actual workbench');
  assert.equal(otherDevice.revision, saved.data.revision);
  assert.equal((await request(f.base, '/api/workspace', { method: 'PUT', body: { state: snapshot.state, baseRevision: snapshot.revision }, headers: headers(second) })).status, 409);
  assert.equal((await request(f.base, '/api/workspace', { method: 'PUT', body: { state: snapshot.state, baseRevision: saved.data.revision }, headers: { ...headers(first), Origin: 'https://attacker.invalid' } })).status, 403);
  assert.equal((await request(f.base, '/api/logout', { method: 'POST', body: {}, headers: { ...headers(first), 'Sec-Fetch-Site': 'cross-site' } })).status, 403);
  assert.equal((await request(f.base, '/api/logout', { method: 'POST', body: {}, headers: headers(second) })).status, 200);
  assert.equal((await request(f.base, '/api/workspace', { headers: headers(second) })).status, 401);
  assert.equal((await request(f.base, '/api/workspace', { headers: headers(first) })).status, 200);
  assert.equal((await request(f.base, '/api/model-config', { headers: headers(first) })).status, 200);
});

test('two independent LAN HTTP logins share the actual workspace without unusable Secure cookies', { timeout: 20000 }, async t => {
  const lanHost = '192.168.50.12:3200', origin = `http://${lanHost}`;
  const clients = [];
  const f = await actualWorkbench(t, { allowedHost: hostname => hostname === '192.168.50.12', secureHost: () => false,
    allowedClient: address => { clients.push(address); return address === '127.0.0.1'; } });
  assert.equal((await request(f.upstreamOrigin, '/api/setup', { method: 'POST', body: { password: PASSWORD } })).status, 200);
  const login = async () => {
    const result = await request(f.base, '/api/login', { method: 'POST', body: { password: PASSWORD }, headers: { Host: lanHost, Origin: origin, 'Sec-Fetch-Site': 'same-origin' } });
    assert.equal(result.status, 200);
    assert.ok(!result.headers['set-cookie'][0].includes('; Secure'));
    assert.match(result.headers['set-cookie'][0], /HttpOnly; SameSite=Strict; Path=\//);
    return result.headers['set-cookie'][0].split(';')[0];
  };
  const first = await login(), second = await login();
  assert.notEqual(first, second);
  const headers = cookie => ({ Host: lanHost, Origin: origin, Cookie: cookie, 'Sec-Fetch-Site': 'same-origin' });
  const firstStatus = (await request(f.base, '/api/status', { headers: headers(first) })).data;
  const secondStatus = (await request(f.base, '/api/status', { headers: headers(second) })).data;
  assert.equal(firstStatus.authenticated, true); assert.equal(secondStatus.authenticated, true);
  assert.equal(firstStatus.serverId, secondStatus.serverId);
  const snapshot = (await request(f.base, '/api/workspace', { headers: headers(first) })).data;
  snapshot.state.prompts[0].title = 'Shared across LAN browser sessions';
  const saved = await request(f.base, '/api/workspace', { method: 'PUT', body: { state: snapshot.state, baseRevision: snapshot.revision }, headers: headers(first) });
  assert.equal(saved.status, 200);
  const other = (await request(f.base, '/api/workspace', { headers: headers(second) })).data;
  assert.equal(other.state.prompts[0].title, 'Shared across LAN browser sessions');
  assert.equal(other.revision, saved.data.revision);
  assert.equal((await request(f.base, '/api/workspace', { method: 'PUT', body: { state: snapshot.state, baseRevision: saved.data.revision }, headers: { ...headers(second), Origin: 'http://attacker.invalid' } })).status, 403);
  assert.ok(clients.length > 0 && clients.every(address => address === '127.0.0.1'));
});

test('gateway strips unrelated credentials and unsafe response headers while preserving public origin and secure workbench cookies', async t => {
  let received, upstreamCalls = 0;
  const upstream = createServer((req, res) => {
    upstreamCalls++;
    received = req.headers;
    req.resume(); req.on('end', () => {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Security-Policy': "default-src 'self'", 'X-Content-Type-Options': 'nosniff',
        'Set-Cookie': ['ai_wqs_admin_session=private-admin; HttpOnly', `wqs_session=${'b'.repeat(64)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=604800; Domain=attacker.invalid`, 'tracking=private'],
        'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Credentials': 'true', Location: 'https://attacker.invalid', Server: 'private-fixture' });
      res.end(JSON.stringify({ ok: true }));
    });
  });
  const upstreamOrigin = await listen(upstream); t.after(() => close(upstream));
  let host = PUBLIC, enabled = true, clientAllowed = true;
  const gateway = createWorkbenchGateway({ upstreamOrigin, allowedHost: hostname => hostname === host, isEnabled: () => enabled, allowedClient: () => clientAllowed });
  const base = await listen(gateway); t.after(() => close(gateway));
  const result = await request(base, '/api/health', { headers: { Host: PUBLIC, Origin: `https://${PUBLIC}`, 'Sec-Fetch-Site': 'same-origin',
    Cookie: `ai_wqs_admin_session=private-admin; tracking=private; wqs_session=${'a'.repeat(64)}`,
    Authorization: 'Bearer fixture-private', 'X-Admin-CSRF': 'private-csrf', 'X-Forwarded-Host': 'attacker.invalid', 'X-Forwarded-Proto': 'http' } });
  assert.equal(result.status, 200); assert.equal(received.host, PUBLIC); assert.equal(received.origin, `https://${PUBLIC}`); assert.equal(received['sec-fetch-site'], 'same-origin');
  assert.equal(received.cookie, `wqs_session=${'a'.repeat(64)}`);
  for (const name of ['authorization', 'x-admin-csrf', 'x-forwarded-host', 'x-forwarded-proto']) assert.equal(received[name], undefined);
  assert.equal(result.headers['set-cookie'].length, 1); assert.match(result.headers['set-cookie'][0], /; Secure$/); assert.ok(!result.headers['set-cookie'][0].includes('Domain='));
  for (const name of ['location', 'server', 'access-control-allow-origin', 'access-control-allow-credentials']) assert.equal(result.headers[name], undefined);
  assert.equal(result.headers['content-security-policy'], "default-src 'self'");
  assert.equal((await request(base, '/', { headers: { Host: 'attacker.invalid' } })).status, 421);
  host = 'new-workbench-fixture.example';
  assert.equal((await request(base, '/', { headers: { Host: PUBLIC } })).status, 421);
  assert.equal((await request(base, '/', { headers: { Host: host } })).status, 200);
  enabled = false;
  assert.equal((await request(base, '/api/status')).status, 503);
  enabled = true; clientAllowed = false;
  const previousCalls = upstreamCalls;
  assert.equal((await request(base, '/api/status')).status, 403);
  assert.equal(upstreamCalls, previousCalls);
});

test('gateway allows only fixed workbench routes and methods, never administration, traversal, redirects or a static status fallback', async t => {
  let statusReply = 'missing', calls = 0;
  const upstream = createServer((req, res) => {
    calls++; req.resume();
    if (req.url === '/api/status') {
      res.writeHead(statusReply === 'missing' ? 404 : 200, { 'Content-Type': 'application/json' });
      return res.end(statusReply === 'invalid' ? '{"mode":"local"}' : '{}');
    }
    res.writeHead(302, { Location: 'http://127.0.0.1:3100/' }); res.end();
  });
  const upstreamOrigin = await listen(upstream); t.after(() => close(upstream));
  const gateway = createWorkbenchGateway({ upstreamOrigin });
  const base = await listen(gateway); t.after(() => close(gateway));
  for (const target of ['/api/setup', '/api/session', '/api/websites', '/api/model-providers', '/internal/model/config', '/admin/', '/config.json', '/data/admin.sqlite', '/src/server.js', '/.env', '/%61pi/setup', '/api/../api/setup', '//api/status', 'http://attacker.invalid/api/status']) {
    assert.equal((await request(base, target)).status, 404, target);
  }
  assert.equal(calls, 0);
  for (const [target, method] of [['/', 'POST'], ['/api/login', 'GET'], ['/api/status', 'PUT'], ['/api/workspace', 'DELETE'], ['/api/chat', 'GET']]) assert.equal((await request(base, target, { method })).status, 405);
  assert.equal((await request(base, '/', { headers: { Connection: 'Upgrade', Upgrade: 'websocket' } })).status, 405);
  assert.equal(calls, 0);
  assert.equal((await request(base, '/')).status, 502);
  assert.equal((await request(base, '/api/status')).status, 502);
  statusReply = 'invalid'; assert.equal((await request(base, '/api/status')).status, 502);
});

test('gateway enforces declared and chunked body limits and reports real upstream unavailability', async t => {
  let receivedBytes = 0;
  const upstream = createServer((req, res) => { req.on('data', chunk => { receivedBytes += chunk.length; }); req.on('end', () => { res.writeHead(200); res.end('ok'); }); });
  const upstreamOrigin = await listen(upstream);
  const gateway = createWorkbenchGateway({ upstreamOrigin });
  const base = await listen(gateway); t.after(() => close(gateway));
  assert.equal((await request(base, '/api/chat', { method: 'POST', headers: { 'Content-Length': '600001' } })).status, 413);
  assert.equal(receivedBytes, 0);
  assert.equal((await request(base, '/api/workspace', { method: 'PUT', headers: { 'Content-Length': String(16 * 1024 * 1024 + 1) } })).status, 413);
  assert.equal((await request(base, '/api/chat', { method: 'POST', chunks: Array.from({ length: 11 }, () => Buffer.alloc(60000)) })).status, 413);
  assert.ok(receivedBytes <= 600000);
  await close(upstream);
  const unavailable = await request(base, '/api/status');
  assert.equal(unavailable.status, 502); assert.equal(unavailable.data.error, 'workbench_unavailable');
  assert.ok(!unavailable.text.includes('ECONNREFUSED')); assert.ok(!unavailable.text.includes(upstreamOrigin));
  for (const address of ['https://127.0.0.1:3000', 'http://attacker.invalid:3000', 'http://127.0.0.1:3100', 'http://127.0.0.1:3200', 'http://user:password@127.0.0.1:3000', 'http://127.0.0.1:3000/admin', 'http://127.0.0.1:3000/?url=anything']) assert.throws(() => createWorkbenchGateway({ upstreamOrigin: address }), /上游/);
});
