import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createServer } from 'node:http';
import { WorkspaceStore } from '../src/store.js';
import { ModelClient } from '../src/model-client.js';
import {
  createInitialState, recordExchange, beginChat, finishChat, chatMessages, validateState,
  beginChatPlan, chatPlanMessages, pendingChatSteps, finishChatPlanStep, failChatPlanStep, retryChatPlanStep,
} from '../public/core.js';

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

test('chosen model persists with its request and invalid selections cannot partially mutate a chat', () => {
  const state = createInitialState();
  state.settings.modelKey = 'model_fixture_alpha';
  beginChat(state, '', 'chosen model question', 'AI 对话', state.settings.modelKey);
  state.settings.modelKey = 'model_fixture_beta';
  const restored = JSON.parse(JSON.stringify(state));
  assert.equal(restored.tasks[0].modelKey, 'model_fixture_alpha');
  assert.equal(restored.settings.modelKey, 'model_fixture_beta');
  assert.ok(validateState(restored));
  const before = structuredClone(state);
  assert.throws(() => beginChat(state, state.sessions[0].id, 'invalid model question', 'AI 对话', 'arbitrary-key'), /模型标识/);
  assert.deepEqual(state, before);
  restored.settings.modelKey = 'arbitrary-key';
  assert.equal(validateState(restored), false);
});

const models = [
  { key: 'model_alpha', id: 'alpha', name: 'Alpha', provider: 'First' },
  { key: 'model_beta', id: 'beta', name: 'Beta', provider: 'Second' },
];
const team = {
  members: [{ modelKey: 'model_alpha', role: 'analysis' }, { modelKey: 'model_beta', role: 'review' }],
  leadKey: 'model_beta',
};
function planReply(task, index, content) {
  const step = task.chatPlan.steps[index];
  return { requestId: step.requestId, model: step.modelKey, modelKey: step.modelKey, content };
}

test('group replies use independent context, keep member order, and support a targeted follow-up', () => {
  const state = createInitialState();
  const setup = { ...team, mode: 'group' };
  const { sessionId, taskId } = beginChatPlan(state, '', 'Plan a launch', 'AI 对话', setup, models);
  const session = state.sessions[0], task = state.tasks[0];
  const firstInput = chatPlanMessages(session, task, 0);
  assert.deepEqual(firstInput, chatPlanMessages(session, task, 1));
  assert.deepEqual(pendingChatSteps(task), [0, 1]);
  finishChatPlanStep(state, taskId, 1, planReply(task, 1, 'Beta’s proposal'));
  assert.deepEqual(chatPlanMessages(session, task, 0), firstInput, 'another reply must not change an in-flight request');
  finishChatPlanStep(state, taskId, 0, planReply(task, 0, 'Alpha’s proposal'));
  assert.deepEqual(session.messages.slice(1).map(message => message.author.name), ['Alpha', 'Beta']);
  assert.equal(task.status, 'success');

  const snapshot = structuredClone(state);
  assert.throws(() => beginChatPlan(state, sessionId, 'Invalid team', 'AI 对话', setup, models.slice(0, 1)), /停用/);
  assert.deepEqual(state, snapshot);
  beginChatPlan(state, sessionId, 'Refine the budget', 'AI 对话', setup, models, 'model_beta');
  const followUp = state.tasks[0];
  assert.equal(session.messages.at(-1).mention, 'Beta');
  assert.deepEqual(followUp.chatPlan.steps.map(step => step.modelKey), ['model_beta']);
  const history = chatPlanMessages(session, followUp, 0);
  assert.deepEqual(history.map(message => message.role), ['user', 'assistant', 'user']);
  assert.match(history[1].content, /【Alpha】.*【Beta】/s);
  assert.equal(history.at(-1).content, 'Refine the budget');
  assert.ok(validateState(JSON.parse(JSON.stringify(state))));
});

test('collaboration preserves completed steps across recovery and sends their results to the selected lead', () => {
  const state = createInitialState();
  const { taskId } = beginChatPlan(state, '', 'Review this launch', 'AI 对话', { ...team, mode: 'collaborate' }, models);
  const session = state.sessions[0], task = state.tasks[0];
  assert.equal(task.chatPlan.steps.at(-1).modelKey, 'model_beta');
  assert.match(chatPlanMessages(session, task, 0).at(-1).content, /分工是「分析」/);
  assert.match(chatPlanMessages(session, task, 1).at(-1).content, /分工是「审校」/);
  assert.throws(() => chatPlanMessages(session, task, 2), /先完成/);
  finishChatPlanStep(state, taskId, 0, planReply(task, 0, 'Launch constraints'));
  const requestId = task.chatPlan.steps[1].requestId;
  failChatPlanStep(state, taskId, 1, 'Connection lost', true);
  assert.equal(task.chatPlan.steps[1].requestId, requestId);
  assert.deepEqual(pendingChatSteps(task), [1]);

  const restored = JSON.parse(JSON.stringify(state));
  const resumed = restored.tasks[0];
  failChatPlanStep(restored, taskId, 1, 'Provider unavailable', false);
  assert.equal(resumed.status, 'failed');
  assert.deepEqual(pendingChatSteps(resumed), []);
  retryChatPlanStep(restored, taskId, 1);
  assert.notEqual(resumed.chatPlan.steps[1].requestId, requestId);
  assert.deepEqual(pendingChatSteps(resumed), [1]);
  finishChatPlanStep(restored, taskId, 1, planReply(resumed, 1, 'Review findings'));
  assert.deepEqual(pendingChatSteps(resumed), [2]);
  const input = chatPlanMessages(restored.sessions[0], resumed, 2).at(-1).content;
  assert.match(input, /【Alpha · 分析】\nLaunch constraints.*【Beta · 审校】\nReview findings/s);
  finishChatPlanStep(restored, taskId, 2, planReply(resumed, 2, 'Final recommendations'));
  assert.equal(resumed.status, 'success');
  assert.equal(restored.sessions[0].messages.at(-1).author.role, 'summary');
  assert.ok(validateState(restored));
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
