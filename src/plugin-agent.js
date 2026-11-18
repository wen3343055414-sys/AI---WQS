import { randomBytes, createHash } from 'node:crypto';
import { HttpError } from './store.js';
import { checkedArguments } from './plugins.js';

const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const stamp = () => new Date().toISOString();
const fault = (code, message, status = 400) => new HttpError(status, code, message);
const validRequest = value => typeof value === 'string' && /^[A-Za-z0-9_-]{12,100}$/.test(value);
export class PluginAgent {
  constructor(store, plugins, modelClient) {
    this.db = store.db; this.plugins = plugins; this.model = modelClient; this.active = new Map();
    this.db.exec(`CREATE TABLE IF NOT EXISTS plugin_runs (
      id TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), request_id TEXT NOT NULL,
      fingerprint TEXT NOT NULL, status TEXT NOT NULL, body TEXT NOT NULL, updated_at TEXT NOT NULL,
      error_message TEXT, UNIQUE(user_id,request_id));
      UPDATE plugin_runs SET status='interrupted',error_message='服务重启，插件执行结果未确认；请先核对远端状态。'
        WHERE status='executing';`);
  }
  owned(userId, id) {
    if (typeof id !== 'string' || !/^agent_[a-f0-9]{32}$/.test(id)) throw fault('plugin_run_missing', '插件任务不存在。', 404);
    const row = this.db.prepare('SELECT * FROM plugin_runs WHERE id=? AND user_id=?').get(id, userId);
    if (!row) throw fault('plugin_run_missing', '插件任务不存在。', 404);
    return row;
  }
  save(row, body, status, error = null) {
    this.db.prepare('UPDATE plugin_runs SET body=?,status=?,updated_at=?,error_message=? WHERE id=? AND user_id=?')
      .run(JSON.stringify(body), status, stamp(), error, row.id, row.user_id);
    return this.owned(row.user_id, row.id);
  }
  state(row) {
    const body = JSON.parse(row.body);
    if (row.status === 'complete') return body.reply;
    if (row.status === 'cancelled') return { cancelled: true, requestId: row.request_id, message: '已取消插件操作，未提交本次工具请求。' };
    if (row.status === 'interrupted') return { interrupted: true, requestId: row.request_id, message: row.error_message || '插件执行结果未确认，请先核对远端状态。' };
    if (row.status === 'error') throw fault('plugin_run_failed', row.error_message || '插件任务未完成，请重新检查后再发起。', 409);
    if (row.status === 'approval') return { requestId: row.request_id, approval: {
      runId: row.id, approvalId: body.approvalId,
      calls: body.pending.map(call => ({ id: call.id, pluginName: call.binding.pluginName, name: call.binding.name,
        endpoint: new URL(call.binding.endpoint).origin, description: call.binding.description.slice(0, 1000), arguments: call.args })),
    } };
    return { requestId: row.request_id, processing: true, runId: row.id };
  }
  async start(userId, input) {
    if (!input || !validRequest(input.requestId) || !['general', 'writing', 'coding'].includes(input.assistant) ||
      !Array.isArray(input.messages) || !input.messages.length || input.messages.length > 80 ||
      !input.messages.every(message => message && ['user', 'assistant'].includes(message.role) && typeof message.content === 'string' && message.content.trim() && message.content.length <= 50_000) ||
      input.messages.at(-1).role !== 'user' || input.messages.reduce((n, message) => n + message.content.length, 0) > 120_000)
      throw fault('plugin_chat', '插件对话内容或请求编号无效。');
    if (input.modelKey !== undefined && !/^model_[A-Za-z0-9_-]{1,64}$/.test(input.modelKey)) throw fault('plugin_chat', '模型标识无效。');
    const fingerprint = hash(input);
    const prior = this.db.prepare('SELECT * FROM plugin_runs WHERE user_id=? AND request_id=?').get(userId, input.requestId);
    if (prior) {
      if (prior.fingerprint !== fingerprint) throw fault('request_conflict', '同一请求编号不能用于不同的插件对话。', 409);
      return prior.status === 'model' && !this.active.has(prior.id) ? this.advance(prior) : this.state(prior);
    }
    const bindings = this.plugins.bindings(userId, input.pluginIds);
    const config = await this.model.config();
    if (!config.ready || config.toolCalling !== true) throw fault('plugin_model_unavailable', '请先更新服务端并配置支持工具调用的模型。', 503);
    const body = { input: { requestId: input.requestId, assistant: input.assistant,
      ...(input.modelKey || config.defaultModelKey ? { modelKey: input.modelKey || config.defaultModelKey } : {}) },
      messages: input.messages.map(message => ({ role: message.role, content: message.content })),
      bindings, step: 0, toolCount: 0, pending: [], usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 }, usageKnown: true };
    const id = 'agent_' + randomBytes(16).toString('hex');
    try { this.db.prepare('INSERT INTO plugin_runs VALUES (?,?,?,?,?,?,?,?)').run(id, userId, input.requestId, fingerprint, 'model', JSON.stringify(body), stamp(), null); }
    catch (error) {
      const raced = this.db.prepare('SELECT * FROM plugin_runs WHERE user_id=? AND request_id=?').get(userId, input.requestId);
      if (raced?.fingerprint === fingerprint) return raced.status === 'model' ? this.advance(raced) : this.active.get(raced.id)?.promise || this.state(raced);
      throw error;
    }
    return this.advance(this.owned(userId, id));
  }
  async modelStep(row) {
    const body = JSON.parse(row.body);
    if (body.step >= 8) throw fault('plugin_step_limit', '本次插件协作已达到步骤上限，请核对已完成操作后继续新对话。', 409);
    const requestId = 'request_mcp_' + hash([row.id, body.step]);
    const input = { ...body.input, requestId, messages: body.messages, tools: body.bindings.map(binding => binding.definition) };
    if (Buffer.byteLength(JSON.stringify(input)) > 550_000) throw fault('plugin_context_large', '插件对话内容过长，请缩小查询范围后继续。', 413);
    const result = await this.model.chat(input, row.user_id);
    if (!result || typeof result.model !== 'string' || !result.model || result.model.length > 200)
      throw fault('plugin_model_result', '模型未返回有效的插件协作响应。', 502);
    if (result.usage && ['promptTokens', 'completionTokens', 'totalTokens'].every(key => Number.isSafeInteger(result.usage[key]) && result.usage[key] >= 0)) {
      for (const key of ['promptTokens', 'completionTokens', 'totalTokens']) body.usage[key] += result.usage[key];
    } else body.usageKnown = false;
    body.lastModel = result.model;
    if (result.toolCalls?.length) {
      if (!Array.isArray(result.toolCalls) || result.toolCalls.length > 4 || body.toolCount + result.toolCalls.length > 12)
        throw fault('plugin_call_limit', '一次工具请求过多，请缩小任务范围。', 409);
      const ids = new Set();
      const pending = result.toolCalls.map(call => {
        const binding = body.bindings.find(binding => binding.alias === call.name);
        if (!binding || typeof call.id !== 'string' || !/^[A-Za-z0-9_.:-]{1,128}$/.test(call.id) || ids.has(call.id) ||
          typeof call.arguments !== 'string' || call.arguments.length > 40_000)
          throw fault('plugin_model_result', '模型请求了未选择的工具或返回了无效参数。', 502);
        ids.add(call.id);
        let args; try { args = JSON.parse(call.arguments); } catch { throw fault('plugin_model_result', '模型工具参数不是有效 JSON，未执行插件操作。', 502); }
        checkedArguments(args);
        return { id: call.id, alias: call.name, args, binding,
          ...(typeof call.thoughtSignature === 'string' ? { thoughtSignature: call.thoughtSignature } : {}) };
      });
      body.messages.push({ role: 'assistant', content: result.content || '', tool_calls: pending.map(call => ({
        id: call.id, type: 'function', function: { name: call.alias, arguments: JSON.stringify(call.args) },
        ...(call.thoughtSignature ? { thoughtSignature: call.thoughtSignature } : {}),
      })) });
      body.pending = pending;
      body.approvalId = hash([row.id, body.step, pending]);
      return this.state(this.save(row, body, 'approval'));
    }
    if (typeof result.content !== 'string' || !result.content.trim() || result.content.length > 50_000 ||
      !['stop', 'length'].includes(result.finishReason)) throw fault('plugin_model_result', '模型未返回可显示的最终回复。', 502);
    body.reply = { requestId: row.request_id, content: result.content, model: result.model,
      provider: result.provider, modelKey: result.modelKey, finishReason: result.finishReason,
      usage: body.usageKnown ? body.usage : null };
    return this.state(this.save(row, body, 'complete'));
  }
  advance(row) {
    if (this.active.has(row.id)) return this.active.get(row.id).promise;
    const promise = this.modelStep(row).catch(error => {
      const fresh = this.owned(row.user_id, row.id);
      if (!['complete', 'cancelled', 'interrupted'].includes(fresh.status))
        this.save(fresh, JSON.parse(fresh.body), 'error', error instanceof HttpError ? error.message : '插件协作暂时无法完成，请核对服务状态。');
      throw error;
    }).finally(() => this.active.delete(row.id));
    this.active.set(row.id, { key: 'model', promise });
    return promise;
  }
  async decide(userId, id, input) {
    const row = this.owned(userId, id), body = JSON.parse(row.body);
    if (typeof input.approvalId !== 'string' || !/^[a-f0-9]{64}$/.test(input.approvalId) || typeof input.approve !== 'boolean')
      return Promise.reject(fault('plugin_approval', '插件操作确认无效。'));
    if (['complete', 'cancelled', 'interrupted', 'error'].includes(row.status)) return Promise.resolve(this.state(row));
    const active = this.active.get(row.id), key = 'approve:' + input.approvalId;
    if (active) return active.key === key && input.approve ? active.promise :
      Promise.reject(fault('plugin_busy', '此任务正在处理，请先等待当前结果。', 409));
    if (row.status !== 'approval' || body.approvalId !== input.approvalId)
      return Promise.reject(fault('plugin_approval_changed', '待确认操作已变化，请恢复最新回复后再确认。', 409));
    if (Date.now() - Date.parse(row.updated_at) > 24 * 3600_000)
      return Promise.reject(fault('plugin_approval_expired', '此操作确认已过期，请核对状态后重新发起。', 409));
    if (!input.approve) return Promise.resolve(this.state(this.save(row, body, 'cancelled')));
    // All targets are checked before the first tool is called; browser-supplied
    // arguments can never replace this immutable approved plan.
    for (const call of body.pending) {
      const connection = this.plugins.row(userId, call.binding.connectionId, true);
      if (connection.status !== 'connected') return Promise.reject(fault('plugin_connection', '插件连接异常，请先重新验证后发起新的确认。', 409));
      if (connection.revision !== call.binding.revision) return Promise.reject(fault('plugin_changed', '插件配置已变化，请重新发起对话并确认。', 409));
    }
    this.save(row, body, 'executing');
    const promise = (async () => {
      for (const call of body.pending) {
        const requestId = 'invoke_' + hash([row.id, body.step, call.id]);
        const result = await this.plugins.invoke(userId, call.binding.connectionId, call.binding.name,
          call.args, requestId, call.binding.revision);
        body.toolCount++;
        if (result.status === 'unknown' || result.status === 'running')
          return this.state(this.save(row, body, 'interrupted', '插件操作结果未确认，请先在远端核对，系统不会自动重复执行。'));
        const report = JSON.stringify({ status: result.status, result: result.result, error: result.error });
        body.messages.push({ role: 'tool', tool_call_id: call.id, name: call.alias,
          content: report.length > 30_000 ? report.slice(0, 30_000) + '\n[工具结果过长，已截取；请缩小查询范围核对完整信息。]' : report });
        this.save(row, body, 'executing');
      }
      body.step++;
      body.pending = [];
      body.approvalId = '';
      const fresh = this.save(row, body, 'model');
      return await this.modelStep(fresh);
    })().catch(error => {
      const fresh = this.owned(userId, id);
      if (!['complete', 'cancelled', 'interrupted'].includes(fresh.status))
        this.save(fresh, JSON.parse(fresh.body), 'error', error instanceof HttpError ? error.message : '插件协作未完成，请核对远端状态。');
      throw error;
    }).finally(() => this.active.delete(id));
    this.active.set(id, { key, promise });
    return promise;
  }
}
