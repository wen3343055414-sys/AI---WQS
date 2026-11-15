import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createServer } from 'node:http';
import { WorkspaceStore } from '../src/store.js';
import { ModelClient } from '../src/model-client.js';
import { createInitialState, recordExchange, beginChat, finishChat, chatMessages, validateState } from '../public/core.js';

test('real replies persist alongside old demo history, without treating demos as model context', () => {
  const state = createInitialState();
  const sessionId = recordExchange(state, '', 'old demo question');
  const task = beginChat(state, sessionId, 'real question');
  const request = state.tasks[0];
  assert.equal(request.status, 'pending'); assert.equal(state.sessions[0].messages.length, 3);
  const history = chatMessages(state.sessions[0], request.userMessageId);
  assert.equal(history.length, 2); assert.ok(history.every(message => message.role === 'user'));
  finishChat(state, task.taskId, { requestId: request.requestId, model: 'real-model', content: 'real answer', usage: { totalTokens: 8 } });
  assert.equal(state.sessions[0].messages.at(-1).demo, false); assert.equal(state.tasks[0].status, 'success');
  assert.equal(state.sessions[0].messages[1].demo, true); assert.ok(validateState(state));
  assert.throws(() => finishChat(state, task.taskId, {}));
});

test('regenerate replaces the selected answer only after success', () => {
  const state = createInitialState(), { sessionId, taskId } = beginChat(state, '', 'question');
  const task = state.tasks[0];
  finishChat(state, taskId, { requestId: task.requestId, model: 'fixture', content: 'first' });
  const message = state.sessions[0].messages.at(-1);
  const again = { ...task, id: 'task-regenerated', requestId: 'request-regenerated', status: 'pending', replaceMessageId: message.id };
  state.tasks.unshift(again);
  finishChat(state, again.id, { requestId: again.requestId, model: 'fixture', content: 'second' });
  assert.equal(state.sessions[0].messages.length, 2); assert.equal(state.sessions[0].messages.at(-1).content, 'second');
  assert.ok(validateState(state)); assert.equal(state.sessions[0].id, sessionId);
});

test('model client authenticates, deduplicates and persists cached replies across restart', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'model-client-test-'));
  const tokenFile = path.join(directory, 'token'); const token = 'b'.repeat(64); await writeFile(tokenFile, token);
  let calls = 0;
  const server = createServer((req, res) => {
    assert.equal(req.headers['x-model-bridge'], token);
    if (req.url.endsWith('/config')) { res.end(JSON.stringify({ ready: true, model: 'fixture' })); return; }
    calls++; let raw = ''; req.on('data', chunk => raw += chunk); req.on('end', () => res.end(JSON.stringify({ requestId: JSON.parse(raw).requestId, content: 'answer', model: 'fixture' })));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const store = new WorkspaceStore(directory);
  t.after(async () => { await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }); store.close(); await rm(directory, { recursive: true, force: true }); });
  const options = { baseUrl: `http://127.0.0.1:${server.address().port}/internal/model`, tokenFile };
  const client = new ModelClient(store, options), input = { requestId: 'fixture-request-0001', assistant: 'general', messages: [{ role: 'user', content: 'question' }] };
  assert.equal((await client.config()).ready, true);
  const [one, two] = await Promise.all([client.chat(input), client.chat(input)]); assert.deepEqual(one, two); assert.equal(calls, 1);
  const restarted = new ModelClient(store, options); assert.deepEqual(await restarted.chat(input), one); assert.equal(calls, 1);
  await assert.rejects(restarted.chat({ ...input, assistant: 'writing' }), /不同的对话/);
  const unavailable = new ModelClient(store, {}); assert.equal((await unavailable.config()).ready, false);
});
