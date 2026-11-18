import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { WorkspaceStore } from '../src/store.js';
import { PluginService } from '../src/plugins.js';
import { PluginAgent } from '../src/plugin-agent.js';
import { ModelClient } from '../src/model-client.js';
import { mcpFixture, bridgeFixture } from '../scripts/testing/mcp-fixture.mjs';
import { createInitialState, beginChat, validateState } from '../public/core.js';

async function setup(t, options = {}) {
  const directory = await mkdtemp(path.join(tmpdir(), 'wqs-mcp-agent-'));
  const mcp = await mcpFixture({ sse: true, delayMs: 40 });
  const bridge = await bridgeFixture(options);
  const store = new WorkspaceStore(directory);
  const owner = store.setup(randomBytes(18).toString('hex'));
  const bob = store.register({ account: 'agent_bob', email: 'agent-bob@example.test', password: randomBytes(18).toString('hex') });
  const tokenFile = path.join(directory, 'bridge-token');
  await writeFile(tokenFile, bridge.token);
  const client = new ModelClient(store, { baseUrl: bridge.origin + '/internal/model', tokenFile });
  const plugins = new PluginService(store, { allowedLocal: [mcp.origin] });
  const connection = await plugins.connect(owner.id, { kind: 'custom', name: 'GitHub 协作联调', endpoint: mcp.endpoint, authMode: 'bearer', token: mcp.token });
  const agent = new PluginAgent(store, plugins, client);
  t.after(async () => { await mcp.close(); await bridge.close(); store.close(); await rm(directory, { recursive: true, force: true }); });
  const input = { requestId: 'request_agent_fixture_001', assistant: 'general', messages: [{ role: 'user', content: '读取仓库信息' }], pluginIds: [connection.id] };
  return { directory, mcp, bridge, store, owner, bob, client, plugins, connection, agent, input };
}

test('model plans cannot execute MCP tools until confirmed, then continue from the actual tool result', async t => {
  const { agent, owner, input, mcp, bridge } = await setup(t);
  const planned = await agent.start(owner.id, input);
  assert.equal(planned.approval.calls[0].name, 'get_repository');
  assert.equal(mcp.state.calls.length, 0);
  assert.equal(bridge.state.calls.length, 1);
  assert.deepEqual(await agent.start(owner.id, input), planned);
  assert.equal(bridge.state.calls.length, 1);
  const decision = { approvalId: planned.approval.approvalId, approve: true, arguments: { owner: 'forged-owner' } };
  const [one, two] = await Promise.all([
    agent.decide(owner.id, planned.approval.runId, decision),
    agent.decide(owner.id, planned.approval.runId, decision),
  ]);
  assert.deepEqual(one, two);
  assert.equal(one.requestId, input.requestId);
  assert.equal(mcp.state.calls.length, 1);
  assert.equal(mcp.state.calls[0].arguments.owner, 'fixture-owner');
  assert.equal(bridge.state.calls.length, 2);
  assert.match(one.content, /fixture-owner/);
  assert.equal(one.usage.totalTokens, 6);
  assert.deepEqual(await agent.start(owner.id, input), one);
  await agent.decide(owner.id, planned.approval.runId, decision);
  assert.equal(mcp.state.calls.length, 1);
});

test('rejection is persisted without tool calls or an extra model request', async t => {
  const { agent, owner, input, mcp, bridge, store, plugins, client } = await setup(t);
  const planned = await agent.start(owner.id, input);
  const result = await agent.decide(owner.id, planned.approval.runId, { approvalId: planned.approval.approvalId, approve: false });
  assert.equal(result.cancelled, true);
  assert.equal(mcp.state.calls.length, 0);
  assert.equal(bridge.state.calls.length, 1);
  const restarted = new PluginAgent(store, plugins, client);
  assert.equal((await restarted.start(owner.id, input)).cancelled, true);
  assert.equal(bridge.state.calls.length, 1);
});

test('stale confirmations and another account cannot change the approved operation', async t => {
  const { agent, owner, bob, input, mcp, plugins, connection } = await setup(t);
  const planned = await agent.start(owner.id, input);
  await assert.rejects(agent.decide(bob.id, planned.approval.runId, { approvalId: planned.approval.approvalId, approve: true }), /不存在/);
  await assert.rejects(agent.decide(owner.id, planned.approval.runId, { approvalId: 'a'.repeat(64), approve: true }), /已变化/);
  plugins.configure(owner.id, connection.id, { revision: connection.revision, enabled: false });
  await assert.rejects(agent.decide(owner.id, planned.approval.runId, { approvalId: planned.approval.approvalId, approve: true }), /已停用/);
  assert.equal(mcp.state.calls.length, 0);
  assert.equal((await agent.decide(owner.id, planned.approval.runId, { approvalId: planned.approval.approvalId, approve: false })).cancelled, true);
});

test('a restarted executing run is reported as uncertain and is never replayed', async t => {
  const { agent, owner, input, mcp, bridge, store, plugins, client } = await setup(t);
  const planned = await agent.start(owner.id, input);
  store.db.prepare("UPDATE plugin_runs SET status='executing' WHERE id=?").run(planned.approval.runId);
  const restarted = new PluginAgent(store, plugins, client);
  assert.equal((await restarted.start(owner.id, input)).interrupted, true);
  assert.equal(mcp.state.calls.length, 0);
  assert.equal(bridge.state.calls.length, 1);
});

test('unadvertised model tools are rejected before any external operation', async t => {
  const { agent, owner, input, mcp } = await setup(t, { complete: async () => ({
    content: '', finishReason: 'tool_calls', toolCalls: [{ id: 'call_bad_fixture', name: 'unadvertised_tool', arguments: '{}' }],
  }) });
  await assert.rejects(agent.start(owner.id, input), /未选择的工具/);
  assert.equal(mcp.state.calls.length, 0);
  await assert.rejects(agent.start(owner.id, input), /未选择的工具/);
});

test('two connected services collaborate only after each concrete plan is confirmed', async t => {
  let firstAlias, secondAlias;
  const custom = async input => {
    const results = input.messages.filter(message => message.role === 'tool');
    if (results.length >= 2) return { content: '来自两项 MCP 结果：' + results.map(message => message.content).join('\n'), finishReason: 'stop' };
    return { content: '', finishReason: 'tool_calls', toolCalls: [{ id: 'call_stage_' + results.length,
      name: results.length ? secondAlias : firstAlias,
      arguments: JSON.stringify({ owner: 'collaboration', repo: results.length ? 'second' : 'first' }) }] };
  };
  const { owner, input, mcp, store, client, connection } = await setup(t, { complete: custom });
  const second = await mcpFixture();
  t.after(() => second.close());
  const plugins = new PluginService(store, { allowedLocal: [mcp.origin, second.origin] });
  const connected = await plugins.connect(owner.id, { kind: 'custom', name: '第二协作服务', endpoint: second.endpoint, authMode: 'bearer', token: second.token });
  const bindings = plugins.bindings(owner.id, [connection.id, connected.id]);
  firstAlias = bindings.find(binding => binding.connectionId === connection.id && binding.name === 'get_repository').alias;
  secondAlias = bindings.find(binding => binding.connectionId === connected.id && binding.name === 'get_repository').alias;
  const agent = new PluginAgent(store, plugins, client);
  const start = await agent.start(owner.id, { ...input, pluginIds: [connection.id, connected.id] });
  assert.equal(mcp.state.calls.length + second.state.calls.length, 0);
  const next = await agent.decide(owner.id, start.approval.runId, { approvalId: start.approval.approvalId, approve: true });
  assert.equal(mcp.state.calls.length, 1);
  assert.equal(second.state.calls.length, 0);
  assert.equal(next.approval.calls[0].pluginName, '第二协作服务');
  const done = await agent.decide(owner.id, next.approval.runId, { approvalId: next.approval.approvalId, approve: true });
  assert.match(done.content, /collaboration\/first/);
  assert.match(done.content, /collaboration\/second/);
  assert.equal(second.state.calls.length, 1);
});

test('plugin IDs remain bound to a request without invalidating old workspace backups', () => {
  const state = createInitialState(), id = 'plugin_' + 'a'.repeat(32);
  beginChat(state, '', '插件协作', 'AI 对话', '', [id]);
  assert.deepEqual(state.tasks[0].pluginIds, [id]);
  assert.equal(validateState(state), true);
  const restored = structuredClone(state);
  delete restored.tasks[0].pluginIds;
  assert.equal(validateState(restored), true);
  const before = structuredClone(state);
  assert.throws(() => beginChat(state, '', 'invalid', 'AI 对话', '', ['invalid']), /插件选择/);
  assert.deepEqual(state, before);
  state.tasks[0].pluginIds = [id, id];
  assert.equal(validateState(state), false);
});
