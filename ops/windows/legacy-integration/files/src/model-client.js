import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { HttpError } from './store.js';

export class ModelClient {
  constructor(store, { baseUrl = process.env.MODEL_GATEWAY_URL, tokenFile = process.env.MODEL_BRIDGE_TOKEN_FILE } = {}) {
    this.store = store; this.baseUrl = baseUrl; this.tokenFile = tokenFile; this.active = new Map();
    store.db.exec(`CREATE TABLE IF NOT EXISTS model_replies (request_id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, created_at INTEGER NOT NULL, response TEXT NOT NULL)`);
  }
  async request(endpoint, input) {
    if (!this.baseUrl || !this.tokenFile) throw new HttpError(503, 'model_unconfigured', '请在智作台服务端配置模型接口。');
    let token;
    try { token = (await readFile(this.tokenFile, 'utf8')).trim(); }
    catch { throw new HttpError(503, 'bridge_unavailable', '模型服务连接未就绪，请检查智作台服务端。'); }
    const url = new URL(this.baseUrl + endpoint);
    if (url.protocol !== 'http:' || !['host.docker.internal', '127.0.0.1', 'localhost'].includes(url.hostname) || !/^[a-f0-9]{64}$/.test(token)) throw new HttpError(503, 'bridge_invalid', '模型桥接配置无效。');
    return new Promise((resolve, reject) => {
      const payload = input === undefined ? null : JSON.stringify(input);
      const timer = setTimeout(() => { request.destroy(); reject(new HttpError(504, 'model_timeout', '模型请求超时，请稍后重试。')); }, 135000);
      const request = http.request(url, { method: payload ? 'POST' : 'GET', headers: {
        Host: `127.0.0.1:${url.port}`, 'X-Model-Bridge': token, Accept: 'application/json',
        ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}),
      } }, response => {
        const chunks = []; let size = 0;
        response.on('data', chunk => { size += chunk.length; if (size > 600_000) { response.destroy(); reject(new HttpError(502, 'bridge_response', '模型回复过大。')); } else chunks.push(chunk); });
        response.on('error', () => { clearTimeout(timer); reject(new HttpError(503, 'bridge_unavailable', '模型服务连接中断，请稍后重试。')); });
        response.on('end', () => {
          clearTimeout(timer);
          try {
            const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
            if (response.statusCode !== 200) { reject(new HttpError(response.statusCode, value.code || 'model_error', value.message || '模型请求未完成。')); return; }
            resolve(value);
          } catch { reject(new HttpError(502, 'bridge_response', '模型服务响应格式无效。')); }
        });
      });
      request.on('error', () => { clearTimeout(timer); reject(new HttpError(503, 'bridge_unavailable', '智作台服务端暂时不可用，请启动服务端后重试。')); });
      request.end(payload);
    });
  }
  async config() {
    try { return await this.request('/config'); }
    catch (error) { return { ready: false, model: '', provider: '', revision: 0, timeoutSeconds: 30, message: error.message }; }
  }
  async chat(input) {
    if (!input || typeof input.requestId !== 'string' || !/^[a-zA-Z0-9_-]{12,100}$/.test(input.requestId)) throw new HttpError(400, 'invalid_chat', '对话请求编号无效。');
    const fingerprint = createHash('sha256').update(JSON.stringify(input)).digest('hex');
    const saved = this.store.db.prepare('SELECT fingerprint,response FROM model_replies WHERE request_id=?').get(input.requestId);
    if (saved) {
      if (saved.fingerprint !== fingerprint) throw new HttpError(409, 'request_conflict', '同一请求编号不能用于不同的对话。');
      return JSON.parse(saved.response);
    }
    const active = this.active.get(input.requestId);
    if (active) {
      if (active.fingerprint !== fingerprint) throw new HttpError(409, 'request_conflict', '对话请求编号冲突。');
      return active.promise;
    }
    if (this.active.size >= 2) throw new HttpError(429, 'chat_busy', '模型正在回复，请等待完成。');
    const promise = this.request('/chat', input).then(result => {
      this.store.db.prepare('INSERT OR IGNORE INTO model_replies VALUES (?,?,?,?)').run(input.requestId, fingerprint, Date.now(), JSON.stringify(result));
      this.store.db.prepare('DELETE FROM model_replies WHERE created_at<?').run(Date.now() - 7 * 86400_000);
      return result;
    }).finally(() => this.active.delete(input.requestId));
    this.active.set(input.requestId, { fingerprint, promise });
    return promise;
  }
}
