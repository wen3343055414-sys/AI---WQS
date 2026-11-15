import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { WorkspaceStore } from '../src/store.js';
import { ModelClient } from '../src/model-client.js';
import { createApi } from '../src/api.js';

const listen = async server => { await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); return `http://127.0.0.1:${server.address().port}`; };
const close = server => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });

test('authenticated model calls bind accounts, isolate reply caches and preserve original-owner request IDs', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'wqs-account-model-'));
  const store = new WorkspaceStore(directory);
  const legacy = store.setup('fixture-legacy-password');
  const bob = store.register({ account: 'BobFixture', email: 'bob@example.test', password: 'fixture-bob-password' });
  const carol = store.register({ account: 'CarolFixture', email: 'carol@example.test', password: 'fixture-carol-password' });
  const cookies = new Map([legacy, bob, carol].map(user => [user.id, `wqs_session=${store.createSession(user.id)}`]));
  const token = 'c'.repeat(64), tokenFile = path.join(directory, 'fixture-token');
  await writeFile(tokenFile, token);
  const calls = [];
  const bridge = createServer(async (req, res) => {
    assert.equal(req.headers['x-model-bridge'], token);
    let raw = ''; for await (const chunk of req) raw += chunk;
    const input = JSON.parse(raw); calls.push(input);
    res.end(JSON.stringify({ requestId: input.requestId, content: `fixture reply ${calls.length}`, model: 'fixture' }));
  });
  const bridgeUrl = await listen(bridge);
  const options = { baseUrl: bridgeUrl + '/internal/model', tokenFile };
  const client = new ModelClient(store, options);
  const api = createApi(store, 'account-model-fixture', client);
  const server = createServer(async (req, res) => {
    await api(req, res, new URL(req.url, 'http://fixture.invalid').pathname, (status, value) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(value)); });
  });
  const base = await listen(server);
  t.after(async () => { await close(server); await close(bridge); store.close(); await rm(directory, { recursive: true, force: true }); });
  const input = { requestId: 'request_same_across_accounts', assistant: 'general', messages: [{ role: 'user', content: 'same fixture question' }] };
  const post = (user, body) => fetch(base + '/api/chat', { method: 'POST', headers: { Origin: base, Cookie: cookies.get(user.id), 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  assert.equal((await post(bob, input)).status, 401);
  assert.equal((await post(bob, { ...input, userId: legacy.id })).status, 401);
  assert.equal(calls.length, 0);
  const responses = await Promise.all([post(bob, { ...input, userId: bob.id }), post(carol, { ...input, userId: carol.id })]);
  assert.ok(responses.every(r => r.status === 200));
  const [b, c] = await Promise.all(responses.map(r => r.json()));
  assert.notEqual(b.content, c.content); assert.equal(b.requestId, input.requestId); assert.equal(c.requestId, input.requestId);
  assert.notEqual(calls[0].requestId, calls[1].requestId);
  assert.ok(calls.every(call => call.userId === undefined && call.requestId !== input.requestId));
  assert.equal(calls.length, 2);
  const restarted = new ModelClient(store, options);
  assert.deepEqual(await restarted.chat(input, bob.id), b);
  assert.equal(calls.length, 2);
  assert.equal((await post(bob, { ...input, userId: bob.id, assistant: 'writing' })).status, 409);
  const old = await post(legacy, input);
  assert.equal(old.status, 200); assert.equal((await old.json()).requestId, input.requestId);
  assert.equal(calls[2].requestId, input.requestId);
  assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM model_replies').get().n, 3);
});
