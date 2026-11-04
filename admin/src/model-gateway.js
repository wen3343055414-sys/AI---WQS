import { randomBytes, timingSafeEqual, createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { HttpError } from './store.js';
import { completeChat, ProviderError } from './provider-chat.js';

export async function bridgeToken(root) {
  const directory = path.join(root, 'data');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const file = path.join(directory, 'model-bridge-token');
  try { await writeFile(file, randomBytes(32).toString('hex'), { flag: 'wx', mode: 0o600 }); }
  catch (error) { if (error.code !== 'EEXIST') throw error; }
  const token = (await readFile(file, 'utf8')).trim();
  if (!/^[a-f0-9]{64}$/.test(token)) throw new Error('模型桥接认证文件无效。');
  return token;
}
const assistants = {
  general: '你是智作台的 AI 助手。请准确、清晰地回答用户；不确定时如实说明，不编造事实。',
  writing: '你是智作台的写作助手。按用户要求撰写、编辑和润色，保持事实准确，避免编造引用。',
  coding: '你是智作台的编程助手。优先提供正确、可运行且易维护的方案，说明必要的运行条件。',
};
export function validateChat(input) {
  if (!input || typeof input.requestId !== 'string' || !/^[a-zA-Z0-9_-]{12,100}$/.test(input.requestId)) throw new HttpError(400, '对话请求编号无效。');
  if (!Object.hasOwn(assistants, input.assistant) || !Array.isArray(input.messages) || !input.messages.length || input.messages.length > 80) throw new HttpError(400, '对话格式或消息数量无效（最多 80 条）。');
  let length = 0;
  const messages = input.messages.map(message => {
    if (!message || !['user', 'assistant'].includes(message.role) || typeof message.content !== 'string' || !message.content.trim() || message.content.length > 50_000) throw new HttpError(400, '对话内容无效。');
    length += message.content.length;
    return { role: message.role, content: message.content };
  });
  if (length > 120_000 || messages.at(-1).role !== 'user') throw new HttpError(400, '对话过长或末条消息无效，请新建对话。');
  return { requestId: input.requestId, assistant: input.assistant, messages };
}
export class ModelGateway {
  constructor(store, settings, token = '', complete = completeChat) {
    this.store = store; this.settings = settings; this.token = token; this.complete = complete; this.active = 0; this.cache = new Map();
    store.db.exec(`CREATE TABLE IF NOT EXISTS model_usage (
      request_id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, started_at TEXT NOT NULL, finished_at TEXT,
      provider TEXT NOT NULL, model TEXT NOT NULL, config_revision INTEGER NOT NULL, source TEXT NOT NULL,
      status TEXT NOT NULL, error_message TEXT, prompt_tokens INTEGER, completion_tokens INTEGER,
      total_tokens INTEGER, cached_tokens INTEGER, reasoning_tokens INTEGER, latency_ms INTEGER);
      CREATE INDEX IF NOT EXISTS model_usage_time ON model_usage(started_at);
      UPDATE model_usage SET status='unknown', error_message='管理服务重启，接口结果未确认。' WHERE status='pending';`);
  }
  authorized(value) { return Boolean(this.token && typeof value === 'string' && /^[a-f0-9]{64}$/.test(value) && timingSafeEqual(Buffer.from(this.token), Buffer.from(value))); }
  config() {
    const config = this.settings.read();
    const ready = config.configured && Boolean(config.model) && (config.authMode === 'none' || config.hasApiKey);
    return { ready, provider: config.name, model: config.model, revision: config.revision, timeoutSeconds: config.timeoutSeconds,
      message: ready ? '真实模型已配置，工作台自动使用服务端设置。' : '请在服务端保存接口地址、密钥和默认模型。' };
  }
  async chat(raw, source = 'workbench') {
    const input = validateChat(raw);
    const fingerprint = createHash('sha256').update(JSON.stringify({ assistant: input.assistant, messages: input.messages })).digest('hex');
    const prior = this.store.db.prepare('SELECT fingerprint, status, error_message FROM model_usage WHERE request_id=?').get(input.requestId);
    if (prior) {
      if (prior.fingerprint !== fingerprint) throw new HttpError(409, '同一请求编号不能用于不同的对话。');
      const cached = this.cache.get(input.requestId);
      if (cached) return cached.promise;
      throw new HttpError(409, prior.status === 'failed' ? prior.error_message : '此请求已提交，结果暂不可恢复。请检查会话后手动发起新的请求，避免重复计费。');
    }
    if (this.active >= 2) throw new HttpError(429, '已有两个模型请求正在处理，请等待回复。');
    const recent = this.store.db.prepare("SELECT COUNT(*) AS n FROM model_usage WHERE started_at>? AND source='workbench'").get(new Date(Date.now() - 60_000).toISOString()).n;
    if (recent >= 20) throw new HttpError(429, '对话请求过于频繁，请稍后再试。');
    const row = this.settings.row();
    if (!row || !this.config().ready) throw new HttpError(503, '模型接口尚未配置完整，请在服务端设置。');
    const config = JSON.parse(row.config);
    const started = Date.now();
    this.store.db.prepare('INSERT INTO model_usage(request_id,fingerprint,started_at,provider,model,config_revision,source,status) VALUES (?,?,?,?,?,?,?,?)').run(input.requestId, fingerprint, new Date(started).toISOString(), config.name, config.model, row.revision, source, 'pending');
    this.active++;
    const promise = (async () => {
      let result, failure;
      try {
        const key = row.key_cipher ? await this.settings.vault.unprotect(row.key_cipher) : '';
        result = await this.complete(config, key, [{ role: 'system', content: assistants[input.assistant] }, ...input.messages]);
        return { ...result, provider: config.name, configRevision: row.revision, requestId: input.requestId };
      } catch (error) {
        failure = error instanceof ProviderError ? error : new HttpError(503, '模型请求暂时无法完成，请检查服务端配置。');
        throw failure;
      } finally {
        const usage = result?.usage || failure?.usage;
        this.store.db.prepare('UPDATE model_usage SET finished_at=?,status=?,error_message=?,prompt_tokens=?,completion_tokens=?,total_tokens=?,cached_tokens=?,reasoning_tokens=?,latency_ms=? WHERE request_id=?').run(new Date().toISOString(), failure ? 'failed' : 'success', failure?.message || null, usage?.promptTokens ?? null, usage?.completionTokens ?? null, usage?.totalTokens ?? null, usage?.cachedTokens ?? null, usage?.reasoningTokens ?? null, Date.now() - started, input.requestId);
        this.active--;
      }
    })();
    this.cache.set(input.requestId, { promise });
    // Response cache is memory only; persisted records contain usage metadata.
    while (this.cache.size > 100) this.cache.delete(this.cache.keys().next().value);
    return promise;
  }
  usage() {
    const day = new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10);
    const dayStart = `${day}T00:00:00+08:00`;
    const totals = where => this.store.db.prepare(`SELECT COUNT(*) AS requests, COALESCE(SUM(status='success'),0) AS succeeded, COALESCE(SUM(status='failed'),0) AS failed,
      COALESCE(SUM(status='pending'),0) AS pending, COALESCE(SUM(status='unknown'),0) AS unknown, COUNT(total_tokens) AS meteredRequests,
      COALESCE(SUM(prompt_tokens),0) AS promptTokens, COALESCE(SUM(completion_tokens),0) AS completionTokens, COALESCE(SUM(total_tokens),0) AS totalTokens,
      COALESCE(SUM(cached_tokens),0) AS cachedTokens FROM model_usage ${where}`).get();
    const since = this.store.db.prepare('SELECT MIN(started_at) AS time FROM model_usage').get().time;
    return { model: this.config(), today: totals(`WHERE started_at>='${new Date(dayStart).toISOString()}'`), total: totals(''), since,
      recent: this.store.db.prepare('SELECT started_at AS time,provider,model,source,status,prompt_tokens AS promptTokens,completion_tokens AS completionTokens,total_tokens AS totalTokens,cached_tokens AS cachedTokens,latency_ms AS latencyMs,error_message AS error FROM model_usage ORDER BY started_at DESC LIMIT 12').all() };
  }
}
