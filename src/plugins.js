import { randomBytes, createCipheriv, createDecipheriv, createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { HttpError } from './store.js';
import { McpClient, endpointUrl, localOrigins } from './plugin-network.js';

const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const stamp = () => new Date().toISOString();
const fault = (code, message, status = 400) => new HttpError(status, code, message);
const validId = value => typeof value === 'string' && /^plugin_[a-f0-9]{32}$/.test(value);
const jsonObject = value => value && typeof value === 'object' && !Array.isArray(value);
const preferredGithub = ['get_me', 'search_repositories', 'get_file_contents', 'search_code', 'list_branches', 'list_commits',
  'get_commit', 'issue_read', 'list_issues', 'search_issues', 'pull_request_read', 'list_pull_requests', 'search_pull_requests',
  'issue_write', 'create_pull_request', 'create_branch', 'create_or_update_file', 'push_files', 'add_issue_comment', 'update_pull_request'];
export function toolCatalog(items) {
  if (!Array.isArray(items) || items.length > 128) throw fault('plugin_catalog', '插件工具列表无效。');
  const names = new Set();
  const tools = items.map(tool => {
    if (!tool || typeof tool.name !== 'string' || !tool.name || tool.name.length > 128 || /[\x00-\x1f\x7f]/.test(tool.name) ||
      names.has(tool.name) || !jsonObject(tool.inputSchema) || tool.inputSchema.type && tool.inputSchema.type !== 'object' ||
      Buffer.byteLength(JSON.stringify(tool.inputSchema)) > 50_000) throw fault('plugin_catalog', '插件提供了不支持的工具定义。');
    names.add(tool.name);
    return { name: tool.name, title: typeof tool.title === 'string' ? tool.title.slice(0, 200) : tool.name,
      description: typeof tool.description === 'string' ? tool.description.slice(0, 4000) : '',
      inputSchema: { ...tool.inputSchema, type: 'object' } };
  });
  if (Buffer.byteLength(JSON.stringify(tools)) > 500_000) throw fault('plugin_catalog', '插件工具定义过大，请缩小服务端工具集。');
  return tools;
}
export function checkedArguments(value) {
  if (!jsonObject(value)) throw fault('plugin_arguments', '工具参数必须是 JSON 对象。');
  let count = 0;
  const visit = (item, depth) => {
    if (depth > 16 || ++count > 5000) throw fault('plugin_arguments', '工具参数结构过大。');
    if (item && typeof item === 'object') for (const child of Object.values(item)) visit(child, depth + 1);
    else if (!['string', 'number', 'boolean', 'undefined'].includes(typeof item) && item !== null ||
      typeof item === 'number' && !Number.isFinite(item)) throw fault('plugin_arguments', '工具参数包含不支持的值。');
  };
  visit(value, 0);
  if (Buffer.byteLength(JSON.stringify(value)) > 40_000) throw fault('plugin_arguments', '工具参数过长。');
  return value;
}

export class PluginService {
  constructor(store, { allowedLocal = localOrigins(), clientFactory } = {}) {
    this.store = store; this.db = store.db; this.allowedLocal = allowedLocal; this.clients = new Map(); this.active = new Map();
    this.clientFactory = clientFactory || ((row, token) => new McpClient(row.endpoint, { token, github: row.kind === 'github', allowedLocal }));
    const keyFile = path.join(store.directory, 'plugins.key');
    try { writeFileSync(keyFile, randomBytes(32), { flag: 'wx', mode: 0o600 }); }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
    this.key = readFileSync(keyFile);
    if (this.key.length !== 32) throw fault('plugin_key', '插件凭据文件无效，请恢复原凭据文件或重新配置连接。', 500);
    this.db.exec(`CREATE TABLE IF NOT EXISTS plugin_connections (
      id TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), name TEXT NOT NULL, kind TEXT NOT NULL,
      endpoint TEXT NOT NULL, auth_mode TEXT NOT NULL, credential TEXT NOT NULL, enabled INTEGER NOT NULL,
      status TEXT NOT NULL, tools TEXT NOT NULL, selected_tools TEXT NOT NULL, revision INTEGER NOT NULL,
      created_at TEXT NOT NULL, checked_at TEXT NOT NULL, last_error TEXT, UNIQUE(user_id,endpoint));
      CREATE TABLE IF NOT EXISTS plugin_invocations (
        user_id INTEGER NOT NULL REFERENCES users(id), request_id TEXT NOT NULL, connection_id TEXT NOT NULL,
        plugin_name TEXT NOT NULL, tool_name TEXT NOT NULL, fingerprint TEXT NOT NULL, status TEXT NOT NULL,
        created_at TEXT NOT NULL, finished_at TEXT, result TEXT, error_message TEXT,
        PRIMARY KEY(user_id,request_id));
      CREATE INDEX IF NOT EXISTS plugin_calls_user ON plugin_invocations(user_id,created_at);
      UPDATE plugin_invocations SET status='unknown', error_message='服务重启，上次插件操作结果未确认；请核对远端状态。'
        WHERE status='running';`);
  }
  protect(value, row) {
    if (!value) return '';
    const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', this.key, iv);
    cipher.setAAD(Buffer.from(JSON.stringify([row.user_id, row.id, row.endpoint])));
    const body = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    return JSON.stringify({ v: 1, iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), body: body.toString('base64') });
  }
  secret(row) {
    if (!row.credential) return '';
    try {
      const data = JSON.parse(row.credential);
      if (data.v !== 1) throw Error();
      const cipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(data.iv, 'base64'));
      cipher.setAAD(Buffer.from(JSON.stringify([row.user_id, row.id, row.endpoint])));
      cipher.setAuthTag(Buffer.from(data.tag, 'base64'));
      return Buffer.concat([cipher.update(Buffer.from(data.body, 'base64')), cipher.final()]).toString('utf8');
    } catch { throw fault('plugin_credentials', '无法读取此插件凭据，请断开后重新授权。', 503); }
  }
  row(userId, id, enabled = false) {
    if (!validId(id)) throw fault('plugin_missing', '插件连接不存在。', 404);
    const row = this.db.prepare('SELECT * FROM plugin_connections WHERE user_id=? AND id=?').get(userId, id);
    if (!row) throw fault('plugin_missing', '插件连接不存在。', 404);
    if (enabled && !row.enabled) throw fault('plugin_disabled', '此插件已停用，请先启用。', 409);
    return row;
  }
  view(row, details = false) {
    const tools = JSON.parse(row.tools), selected = JSON.parse(row.selected_tools);
    return { id: row.id, name: row.name, kind: row.kind, endpoint: row.endpoint, authMode: row.auth_mode,
      hasCredential: Boolean(row.credential), enabled: Boolean(row.enabled), status: row.status,
      toolCount: tools.length, selectedCount: selected.length, selectedTools: selected, revision: row.revision,
      createdAt: row.created_at, checkedAt: row.checked_at, error: row.last_error || '',
      ...(details ? { tools } : {}) };
  }
  list(userId) { return this.db.prepare('SELECT * FROM plugin_connections WHERE user_id=? ORDER BY created_at DESC').all(userId).map(row => this.view(row)); }
  detail(userId, id) { return this.view(this.row(userId, id), true); }
  async connect(userId, input) {
    if (this.list(userId).length >= 8) throw fault('plugin_limit', '每个账号最多连接 8 个插件。');
    const kind = input.kind === 'github' ? 'github' : 'custom';
    const name = typeof input.name === 'string' ? input.name.trim() : '';
    if (!name || name.length > 80) throw fault('plugin_name', '请输入 1–80 字的插件名称。');
    const endpoint = endpointUrl(kind === 'github' ? 'https://api.githubcopilot.com/mcp/' : input.endpoint, this.allowedLocal).href;
    const authMode = kind === 'github' ? 'bearer' : input.authMode;
    const token = typeof input.token === 'string' ? input.token.trim() : '';
    if (!['none', 'bearer'].includes(authMode) || authMode === 'bearer' && (!/^[\x21-\x7e]{8,4096}$/.test(token)) ||
      authMode === 'none' && token) throw fault('plugin_auth', '请选择授权方式并填写有效令牌；无授权方式请留空令牌。');
    if (this.db.prepare('SELECT 1 FROM plugin_connections WHERE user_id=? AND endpoint=?').get(userId, endpoint))
      throw fault('plugin_exists', '此服务已连接，请刷新列表或先断开旧连接。', 409);
    const row = { id: 'plugin_' + randomBytes(16).toString('hex'), user_id: userId, name, kind, endpoint, auth_mode: authMode };
    const client = this.clientFactory(row, token);
    const discovered = await client.connect(), tools = toolCatalog(discovered.tools);
    if (token && JSON.stringify(tools).includes(token)) throw fault('plugin_secret_echo', '插件工具定义包含授权信息，已停止保存。', 502);
    const preferred = kind === 'github' ? preferredGithub.filter(name => tools.some(tool => tool.name === name)) : [];
    const selected = preferred.length ? preferred : tools.slice(0, 16).map(tool => tool.name);
    const at = stamp();
    try {
      this.db.prepare('INSERT INTO plugin_connections VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(
        row.id, userId, name, kind, endpoint, authMode, this.protect(token, row), 1, 'connected',
        JSON.stringify(tools), JSON.stringify(selected), 1, at, at, null);
    } catch (error) {
      if (this.db.prepare('SELECT 1 FROM plugin_connections WHERE user_id=? AND endpoint=?').get(userId, endpoint))
        throw fault('plugin_exists', '此服务已连接，请刷新列表。', 409);
      throw error;
    }
    this.clients.set(row.id, { client, revision: 1 });
    return this.detail(userId, row.id);
  }
  async refresh(userId, id) {
    const row = this.row(userId, id), token = this.secret(row), client = this.clientFactory(row, token);
    try {
      const found = await client.connect(), tools = toolCatalog(found.tools);
      if (token && JSON.stringify(tools).includes(token)) throw fault('plugin_secret_echo', '插件工具定义包含授权信息，已停止读取。', 502);
      const selected = JSON.parse(row.selected_tools).filter(name => tools.some(tool => tool.name === name));
      this.db.prepare("UPDATE plugin_connections SET tools=?,selected_tools=?,revision=revision+1,status='connected',checked_at=?,last_error=NULL WHERE id=? AND user_id=?")
        .run(JSON.stringify(tools), JSON.stringify(selected), stamp(), id, userId);
      this.clients.set(id, { client, revision: row.revision + 1 });
      return this.detail(userId, id);
    } catch (error) {
      this.clients.delete(id);
      this.db.prepare("UPDATE plugin_connections SET status='error',last_error=?,checked_at=? WHERE id=? AND user_id=?")
        .run(error instanceof HttpError ? error.message : '插件连接未完成，请稍后重试。', stamp(), id, userId);
      throw error;
    }
  }
  configure(userId, id, input) {
    const row = this.row(userId, id);
    if (!Number.isInteger(input.revision) || input.revision !== row.revision) throw fault('plugin_changed', '插件配置已变化，请刷新后重试。', 409);
    const selected = input.selectedTools === undefined ? JSON.parse(row.selected_tools) : input.selectedTools;
    const known = new Set(JSON.parse(row.tools).map(tool => tool.name));
    if (!Array.isArray(selected) || selected.length > 40 || new Set(selected).size !== selected.length || selected.some(name => !known.has(name)))
      throw fault('plugin_tools', '请选择最多 40 项真实可用的工具。');
    if (input.enabled !== undefined && typeof input.enabled !== 'boolean') throw fault('plugin_enabled', '插件开关无效。');
    this.db.prepare('UPDATE plugin_connections SET selected_tools=?,enabled=?,revision=revision+1 WHERE id=? AND user_id=?')
      .run(JSON.stringify(selected), input.enabled === undefined ? row.enabled : Number(input.enabled), id, userId);
    this.clients.delete(id);
    return this.detail(userId, id);
  }
  disconnect(userId, id) {
    this.row(userId, id);
    this.db.prepare('DELETE FROM plugin_connections WHERE user_id=? AND id=?').run(userId, id);
    this.clients.delete(id);
    return { disconnected: true };
  }
  async client(row) {
    const cached = this.clients.get(row.id);
    if (cached?.revision === row.revision) return cached.client;
    const client = this.clientFactory(row, this.secret(row));
    const found = toolCatalog((await client.connect()).tools);
    if (digest(found) !== digest(JSON.parse(row.tools))) throw fault('plugin_changed', '插件工具已变化，请先刷新连接并重新确认操作。', 409);
    this.clients.set(row.id, { client, revision: row.revision });
    return client;
  }
  bindings(userId, ids) {
    if (!Array.isArray(ids) || !ids.length || ids.length > 4 || new Set(ids).size !== ids.length)
      throw fault('plugin_selection', '请选择 1–4 个已连接插件。');
    const bindings = [];
    for (const id of ids) {
      const row = this.row(userId, id, true);
      if (row.status !== 'connected') throw fault('plugin_connection', '请先重新连接插件：' + row.name, 409);
      const selected = new Set(JSON.parse(row.selected_tools));
      for (const [index, tool] of JSON.parse(row.tools).entries()) if (selected.has(tool.name)) bindings.push({
        alias: 'mcp_' + row.id.slice(7) + '_' + index, connectionId: row.id, revision: row.revision,
        pluginName: row.name, endpoint: row.endpoint, name: tool.name, description: tool.description,
        definition: { type: 'function', function: { name: 'mcp_' + row.id.slice(7) + '_' + index,
          description: row.name + ' — ' + tool.description.slice(0, 2000), parameters: tool.inputSchema } },
      });
    }
    if (!bindings.length || bindings.length > 64 || Buffer.byteLength(JSON.stringify(bindings.map(v => v.definition))) > 150_000)
      throw fault('plugin_selection', '当前可用于对话的工具为空或过多，请在插件详情中调整工具选择。');
    return bindings;
  }
  priorCall(userId, requestId) { return this.db.prepare('SELECT * FROM plugin_invocations WHERE user_id=? AND request_id=?').get(userId, requestId); }
  callView(row) {
    return { requestId: row.request_id, pluginName: row.plugin_name, toolName: row.tool_name,
      status: row.status, createdAt: row.created_at, finishedAt: row.finished_at,
      result: row.result ? JSON.parse(row.result) : null, error: row.error_message || '' };
  }
  history(userId) {
    return this.db.prepare('SELECT * FROM plugin_invocations WHERE user_id=? ORDER BY created_at DESC LIMIT 12').all(userId)
      .map(row => ({ requestId: row.request_id, pluginName: row.plugin_name, toolName: row.tool_name,
        status: row.status, createdAt: row.created_at, finishedAt: row.finished_at, error: row.error_message || '' }));
  }
  async invoke(userId, id, toolName, args, requestId, revision) {
    if (typeof requestId !== 'string' || !/^[A-Za-z0-9_-]{12,100}$/.test(requestId)) throw fault('plugin_request', '插件调用编号无效。');
    checkedArguments(args);
    const row = this.row(userId, id, true);
    if (revision !== row.revision) throw fault('plugin_changed', '插件配置已变化，请重新确认工具和参数。', 409);
    if (!JSON.parse(row.tools).some(tool => tool.name === toolName)) throw fault('plugin_tool', '此插件未提供所选工具。');
    const fingerprint = digest([id, revision, toolName, args]), key = userId + ':' + requestId;
    const prior = this.priorCall(userId, requestId);
    if (prior) {
      if (prior.fingerprint !== fingerprint) throw fault('plugin_request_conflict', '调用编号已用于另一项操作。', 409);
      if (this.active.has(key)) return this.active.get(key);
      return this.callView(prior);
    }
    if (this.active.size >= 8 || [...this.active.keys()].filter(key => key.startsWith(userId + ':')).length >= 2)
      throw fault('plugin_busy', '插件调用正在处理，请等待当前操作完成。', 429);
    this.db.prepare('INSERT INTO plugin_invocations(user_id,request_id,connection_id,plugin_name,tool_name,fingerprint,status,created_at) VALUES (?,?,?,?,?,?,?,?)')
      .run(userId, requestId, id, row.name, toolName, fingerprint, 'running', stamp());
    const promise = (async () => {
      let sent = false;
      try {
        const client = await this.client(row);
        // Recheck ownership/configuration after discovery, before any operation.
        const fresh = this.row(userId, id, true);
        if (fresh.revision !== revision) throw fault('plugin_changed', '插件配置已变化，请重新确认。', 409);
        sent = true;
        const result = await client.call(toolName, args);
        if (!jsonObject(result) || !Array.isArray(result.content) && !jsonObject(result.structuredContent))
          throw fault('plugin_result', '插件操作响应无法识别，结果未确认。', 502);
        if (Buffer.byteLength(JSON.stringify(result)) > 200_000) throw fault('plugin_result', '插件结果过大，操作结果需在远端核对。', 502);
        const secret = this.secret(row);
        if (secret && JSON.stringify(result).includes(secret)) throw fault('plugin_secret_echo', '插件结果包含授权信息，已阻止展示。', 502);
        this.db.prepare('UPDATE plugin_invocations SET status=?,finished_at=?,result=? WHERE user_id=? AND request_id=?')
          .run(result.isError ? 'error' : 'success', stamp(), JSON.stringify(result), userId, requestId);
      } catch (error) {
        this.db.prepare('UPDATE plugin_invocations SET status=?,finished_at=?,error_message=? WHERE user_id=? AND request_id=?')
          .run(sent ? 'unknown' : 'error', stamp(), error instanceof HttpError ? error.message : '插件操作未完成，请核对远端状态。', userId, requestId);
      }
      return this.callView(this.priorCall(userId, requestId));
    })().finally(() => this.active.delete(key));
    this.active.set(key, promise);
    return promise;
  }
}
