import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';

export const MCP_TOOLS = [
  { name: 'get_repository', title: '读取仓库', description: 'Read repository information from the connected service.',
    inputSchema: { type: 'object', properties: { owner: { type: 'string' }, repo: { type: 'string' } }, required: ['owner', 'repo'] } },
  { name: 'create_issue', title: '创建 Issue', description: 'Create an issue in the selected repository.',
    inputSchema: { type: 'object', properties: { owner: { type: 'string' }, repo: { type: 'string' }, title: { type: 'string' } }, required: ['owner', 'repo', 'title'] } },
];
export async function mcpFixture(options = {}) {
  const token = options.token ?? randomBytes(20).toString('hex');
  const state = { calls: [], initializations: 0, notifications: 0, lists: 0, tools: structuredClone(MCP_TOOLS), delayMs: options.delayMs || 0 };
  const session = 'fixture_' + randomBytes(8).toString('hex');
  const server = createServer(async (request, response) => {
    response.on('error', () => {});
    if (request.url !== '/mcp') { response.writeHead(404); response.end(); return; }
    if (options.auth !== false && request.headers.authorization !== 'Bearer ' + token) {
      response.writeHead(401, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ error: 'fixture unauthorized', credential: token })); return;
    }
    let raw = '';
    for await (const chunk of request) raw += chunk;
    let input; try { input = JSON.parse(raw); } catch { response.writeHead(400); response.end(); return; }
    const reply = result => {
      const value = { jsonrpc: '2.0', id: input.id, result };
      if (options.sse) {
        response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Mcp-Session-Id': session });
        response.write('event: message\ndata: ' + JSON.stringify({ jsonrpc: '2.0', method: 'notifications/progress', params: {} }) + '\n\n');
        const text = 'event: message\ndata: ' + JSON.stringify(value) + '\n\n';
        const bytes = Buffer.from(text);
        response.write(bytes.subarray(0, Math.floor(bytes.length / 2)));
        response.end(bytes.subarray(Math.floor(bytes.length / 2)));
      } else {
        response.writeHead(200, { 'Content-Type': 'application/json', 'Mcp-Session-Id': session });
        response.end(JSON.stringify(value));
      }
    };
    if (input.method === 'initialize') {
      state.initializations++;
      reply({ protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'MCP integration fixture', version: '1' } }); return;
    }
    if (request.headers['mcp-session-id'] !== session) { response.writeHead(404); response.end(); return; }
    if (input.method === 'notifications/initialized') { state.notifications++; response.writeHead(202); response.end(); return; }
    if (input.method === 'tools/list') {
      state.lists++;
      reply(options.pagination && !input.params.cursor ? { tools: state.tools.slice(0, 1), nextCursor: 'next-fixture' } :
        { tools: options.pagination ? state.tools.slice(1) : state.tools }); return;
    }
    if (input.method === 'tools/call') {
      const call = { name: input.params.name, arguments: input.params.arguments };
      state.calls.push(call);
      if (state.delayMs) await new Promise(resolve => setTimeout(resolve, state.delayMs));
      const result = options.result ? options.result(call) : {
        content: [{ type: 'text', text: JSON.stringify({ full_name: call.arguments.owner + '/' + call.arguments.repo,
          ...(call.name === 'create_issue' ? { number: 42, title: call.arguments.title } : {}), source: 'MCP 工具返回的实际联调结果' }) }],
        structuredContent: { full_name: call.arguments.owner + '/' + call.arguments.repo, number: call.name === 'create_issue' ? 42 : undefined },
      };
      reply(result); return;
    }
    response.writeHead(400, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ jsonrpc: '2.0', id: input.id, error: { code: -32601, message: 'Unknown method' } }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = 'http://127.0.0.1:' + server.address().port;
  return { token, origin, endpoint: origin + '/mcp', state, server,
    close: () => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }) };
}
export async function bridgeFixture(options = {}) {
  const token = options.token || randomBytes(32).toString('hex');
  const state = { calls: [] };
  const server = createServer(async (request, response) => {
    if (request.headers['x-model-bridge'] !== token) { response.writeHead(403); response.end(); return; }
    if (request.url === '/internal/model/config') {
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify({ ready: true, toolCalling: true, model: 'fixture-model', provider: '联调模型服务', defaultModelKey: 'model_fixture',
        models: [{ key: 'model_fixture', id: 'fixture-model', name: 'fixture-model', providerId: 'fixture', provider: '联调模型服务' }] })); return;
    }
    if (request.url !== '/internal/model/chat') { response.writeHead(404); response.end(); return; }
    let raw = ''; for await (const chunk of request) raw += chunk;
    const input = JSON.parse(raw);
    state.calls.push(input);
    let result;
    if (options.complete) result = await options.complete(input, state);
    else if (input.tools?.length && input.messages.at(-1).role === 'user') {
      const write = /创建|issue/i.test(input.messages.at(-1).content);
      const tool = input.tools.find(tool => Boolean(tool.function.parameters.properties?.title) === write) || input.tools[0];
      result = { content: '', finishReason: 'tool_calls', toolCalls: [{ id: 'call_fixture_' + state.calls.length, name: tool.function.name,
        arguments: JSON.stringify({ owner: 'fixture-owner', repo: 'fixture-repo', ...(write ? { title: '协作任务' } : {}) }) }] };
    } else result = { content: input.tools?.length ? '已读取插件返回结果：' + input.messages.at(-1).content : '普通对话联调回复', finishReason: 'stop' };
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify({ ...result, requestId: input.requestId, model: 'fixture-model', usage: { promptTokens: 2, completionTokens: 1, totalTokens: 3 } }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return { token, state, origin: 'http://127.0.0.1:' + server.address().port,
    close: () => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }) };
}
