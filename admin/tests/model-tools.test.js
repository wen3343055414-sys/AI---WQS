import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { completeChat } from '../src/provider-chat.js';
import { validateChat, ModelGateway } from '../src/model-gateway.js';
import { AdminStore } from '../src/store.js';
import { ModelRegistry } from '../src/model-registry.js';
import { createAdminServer } from '../src/server.js';
import { WorkspaceStore } from '../../src/store.js';
import { ModelClient } from '../../src/model-client.js';

const tools = [{ type: 'function', function: { name: 'mcp_repository', description: 'Read a connected repository',
  parameters: { type: 'object', properties: { owner: { type: 'string' } }, required: ['owner'] } } }];
const args = { owner: 'fixture-owner' }, KEY = 'fixture-native-tools-key', TOKEN = 'a'.repeat(64);
const vault = { protect: async value => 'fixture:' + value, unprotect: async value => value.slice(8) };
function nativeReply(protocol, first) {
  const usage = { input_tokens: 2, output_tokens: 1 };
  if (protocol === 'anthropic') return { content: first ? [{ type: 'tool_use', id: 'call_native', name: tools[0].function.name, input: args }] :
    [{ type: 'text', text: '工具返回的仓库信息' }], stop_reason: first ? 'tool_use' : 'end_turn', usage };
  if (protocol === 'gemini') return { candidates: [{ content: { parts: first ?
    [{ functionCall: { name: tools[0].function.name, args }, thoughtSignature: 'opaque-provider-signature' }] :
    [{ text: '工具返回的仓库信息' }] }, finishReason: 'STOP' }],
    usageMetadata: { promptTokenCount: 2, candidatesTokenCount: 1, totalTokenCount: 3 } };
  return { choices: [{ message: first ? { content: null, tool_calls: [{ id: 'call_native', type: 'function',
    function: { name: tools[0].function.name, arguments: JSON.stringify(args) } }] } : { content: '工具返回的仓库信息' },
    finish_reason: first ? 'tool_calls' : 'stop' }], usage: { prompt_tokens: 2, completion_tokens: 1, total_tokens: 3 } };
}
for (const protocol of ['openai', 'anthropic', 'gemini']) test(protocol + ' native HTTP tools round trip through authenticated workbench bridge', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'wqs-tools-native-'));
  const admin = new AdminStore(path.join(directory, 'admin')), workspace = new WorkspaceStore(path.join(directory, 'workspace'));
  t.after(async () => { admin.close(); workspace.close(); await rm(directory, { recursive: true, force: true }); });
  const observed = [];
  const provider = createServer(async (req, res) => {
    if (req.method !== 'POST') {
      res.end(JSON.stringify(protocol === 'gemini' ? { models: [{ name: 'models/fixture-model' }] } : { data: [{ id: 'fixture-model' }] })); return;
    }
    let raw = ''; for await (const part of req) raw += part;
    observed.push({ input: JSON.parse(raw), headers: req.headers });
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(nativeReply(protocol, observed.length === 1)));
  });
  await new Promise(resolve => provider.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { provider.close(resolve); provider.closeAllConnections(); }));
  const registry = new ModelRegistry(admin, vault);
  const p = await registry.saveProvider(null, { name: protocol, preset: 'custom', protocol,
    baseUrl: 'http://127.0.0.1:' + provider.address().port + '/v1', authMode: 'bearer',
    apiKey: KEY, timeoutSeconds: 5, monthlyTokenLimit: 0, enabled: true, revision: 0 });
  const model = registry.addModel(p.id, { providerRevision: p.revision, modelId: 'fixture-model', name: protocol });
  const gateway = new ModelGateway(admin, registry, TOKEN);
  const { server } = createAdminServer({ root: path.resolve(import.meta.dirname, '..'), settings: { port: 0, bridgeToken: TOKEN },
    store: admin, modelSettings: registry, modelGateway: gateway, manager: {} });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const tokenFile = path.join(directory, 'bridge-token'); await writeFile(tokenFile, TOKEN);
  const client = new ModelClient(workspace, { baseUrl: 'http://127.0.0.1:' + server.address().port + '/internal/model', tokenFile });
  assert.equal((await client.config()).toolCalling, true);
  const first = { requestId: 'request_tool_native_first', assistant: 'general', modelKey: model.id,
    tools, messages: [{ role: 'user', content: '读取仓库' }] };
  const plan = await client.chat(first);
  assert.equal(plan.finishReason, 'tool_calls'); assert.equal(plan.toolCalls.length, 1);
  assert.deepEqual(JSON.parse(plan.toolCalls[0].arguments), args);
  assert.equal(plan.usage.totalTokens, 3); assert.ok(!JSON.stringify(plan).includes(KEY));
  const call = plan.toolCalls[0], transcript = [...first.messages, { role: 'assistant', content: '',
    tool_calls: [{ id: call.id, type: 'function', function: { name: call.name, arguments: call.arguments },
      ...(call.thoughtSignature ? { thoughtSignature: call.thoughtSignature } : {}) }] },
    { role: 'tool', name: call.name, tool_call_id: call.id, content: '{"full_name":"fixture-owner/actual-repo"}' }];
  const result = await client.chat({ ...first, requestId: 'request_tool_native_second', messages: transcript });
  assert.equal(result.content, '工具返回的仓库信息');
  await client.chat({ ...first, requestId: 'request_tool_native_second', messages: transcript });
  assert.equal(observed.length, 2, 'repeat bridge request must not call provider again');
  assert.equal(gateway.usage().total.totalTokens, 6);
  const [initial, next] = observed.map(r => r.input);
  if (protocol === 'openai') {
    assert.deepEqual(initial.tools, tools); assert.equal(initial.tool_choice, 'auto');
    assert.equal(next.messages.at(-1).tool_call_id, call.id);
    assert.equal(next.messages.at(-2).tool_calls[0].function.name, call.name);
    assert.ok(!JSON.stringify(next).includes('thoughtSignature'));
  } else if (protocol === 'anthropic') {
    assert.deepEqual(initial.tools[0].input_schema, tools[0].function.parameters);
    assert.equal(next.messages.at(-2).content[0].type, 'tool_use');
    assert.deepEqual(next.messages.at(-2).content[0].input, args);
    assert.equal(next.messages.at(-1).content[0].tool_use_id, call.id);
  } else {
    assert.deepEqual(initial.tools[0].functionDeclarations[0].parametersJsonSchema, tools[0].function.parameters);
    assert.equal(next.contents.at(-2).parts[0].thoughtSignature, 'opaque-provider-signature');
    assert.deepEqual(next.contents.at(-2).parts[0].functionCall.args, args);
    assert.equal(next.contents.at(-1).parts[0].functionResponse.name, call.name);
    assert.match(next.contents.at(-1).parts[0].functionResponse.response.content, /actual-repo/);
  }
});

test('tool transcript validator rejects forged, incomplete and unadvertised operations', () => {
  const base = { requestId: 'request_tool_validation', assistant: 'general', tools, messages: [{ role: 'user', content: 'read' }] };
  const call = { role: 'assistant', content: '', tool_calls: [{ id: 'call_valid', type: 'function',
    function: { name: tools[0].function.name, arguments: '{"owner":"fixture"}' } }] };
  const result = { role: 'tool', tool_call_id: 'call_valid', name: tools[0].function.name, content: '{}' };
  assert.doesNotThrow(() => validateChat({ ...base, messages: [...base.messages, call, result] }));
  for (const messages of [[result], [...base.messages, call], [...base.messages, call, { ...result, tool_call_id: 'forged' }],
    [...base.messages, call, { ...result, name: 'forged' }], [...base.messages, call, { role: 'user', content: 'skip' }]]) {
    assert.throws(() => validateChat({ ...base, messages }));
  }
  assert.throws(() => validateChat({ ...base, tools: undefined, messages: [...base.messages, call, result] }));
  const invalid = structuredClone(call); invalid.tool_calls[0].function.name = 'unknown';
  assert.throws(() => validateChat({ ...base, messages: [...base.messages, invalid, result] }));
});
test('provider cannot request an unadvertised tool or leak a model credential in tool arguments', async t => {
  let data;
  const server = createServer((req, res) => res.end(JSON.stringify(data)));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const config = { protocol: 'openai', model: 'fixture-model', baseUrl: 'http://127.0.0.1:' + server.address().port + '/v1', timeoutSeconds: 5, authMode: 'bearer' };
  data = nativeReply('openai', true); data.choices[0].message.tool_calls[0].function.name = 'unknown';
  await assert.rejects(completeChat(config, KEY, [{ role: 'user', content: 'read' }], { tools }));
  data = nativeReply('openai', true); data.choices[0].message.tool_calls[0].function.arguments = JSON.stringify({ owner: KEY });
  await assert.rejects(completeChat(config, KEY, [{ role: 'user', content: 'read' }], { tools }), error => !error.message.includes(KEY));
});
