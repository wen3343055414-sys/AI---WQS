import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import https from 'node:https';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { HttpError } from './store.js';
import { credentialHeaders, modelsUrl, parseModels } from './model-protocols.js';

const DEFAULTS = { name: '自定义模型接口', baseUrl: '', model: '', authMode: 'bearer', timeoutSeconds: 30 };
export class ProbeError extends Error { constructor(message, status = null) { super(message); this.status = status; } }
function ipv4(address) {
  if (isIP(address) === 4) return address;
  if (!address.toLowerCase().startsWith('::ffff:')) return null;
  const tail = address.slice(7);
  if (isIP(tail) === 4) return tail;
  const words = tail.split(':');
  if (words.length !== 2 || !words.every(word => /^[a-f0-9]{1,4}$/i.test(word))) return null;
  const [a, b] = words.map(word => parseInt(word, 16));
  return `${a >> 8}.${a & 255}.${b >> 8}.${b & 255}`;
}
function loopback(address) { return address === '::1' || ipv4(address)?.startsWith('127.'); }
export function allowedAddress(address, protocol) {
  if (!isIP(address) || address.includes('%')) return false;
  const v4 = ipv4(address);
  if (v4) {
    const parts = v4.split('.').map(Number);
    if (parts[0] === 0 || parts[0] >= 224 || (parts[0] === 169 && parts[1] === 254)) return false;
  } else if (address === '::' || /^(fe[89ab]|ff)/i.test(address) || address.toLowerCase() === 'fd00:ec2::254') return false;
  return protocol !== 'http:' || Boolean(loopback(address));
}
export function normalizeBaseUrl(value) {
  if (typeof value !== 'string' || value.length > 1000 || /[\x00-\x20\x7f]/.test(value)) throw new HttpError(400, '请填写有效的接口 Base URL。');
  let url;
  try { url = new URL(value); } catch { throw new HttpError(400, '接口地址格式不正确。'); }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash)
    throw new HttpError(400, '接口地址只支持 HTTP/HTTPS，不能包含账号、密码、查询参数或锚点。');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (isIP(host) && !allowedAddress(host, url.protocol)) throw new HttpError(400, '不支持该接口地址，请使用 HTTPS 服务或本机模型地址。');
  if (url.protocol === 'http:' && host !== 'localhost' && !loopback(host)) throw new HttpError(400, '远程接口请使用 HTTPS；本机模型可以使用 HTTP。');
  url.pathname = url.pathname.replace(/\/+$/, '');
  if (/\/(models(?:\/.*)?|chat\/completions|responses|messages|[^/]*:generateContent)$/i.test(url.pathname)) throw new HttpError(400, '请填写 Base URL，不要包含 /models、/chat/completions 等具体接口路径。');
  return url.toString().replace(/\/$/, '');
}
export function validateSettings(input) {
  if (typeof input.name !== 'string' || !input.name.trim() || input.name.length > 50) throw new HttpError(400, '接口名称需要 1–50 个字符。');
  if (!['bearer', 'none'].includes(input.authMode)) throw new HttpError(400, '认证方式无效。');
  if (typeof input.model !== 'string' || input.model.length > 200 || /[\x00-\x1f\x7f]/.test(input.model)) throw new HttpError(400, '模型名称格式不正确。');
  if (!Number.isInteger(input.timeoutSeconds) || input.timeoutSeconds < 5 || input.timeoutSeconds > 120) throw new HttpError(400, '超时需要设置为 5–120 秒。');
  if (input.apiKey !== undefined && (typeof input.apiKey !== 'string' || input.apiKey.length > 4096 || /[\x00-\x20\x7f]/.test(input.apiKey)))
    throw new HttpError(400, 'API 密钥不能含空格或换行，且长度不能超过 4096 个字符。');
  if (input.clearKey !== undefined && typeof input.clearKey !== 'boolean') throw new HttpError(400, '密钥清除选项无效。');
  if (input.clearKey && input.apiKey) throw new HttpError(400, '不能同时输入新密钥并清除密钥。');
  if (!Number.isSafeInteger(input.revision) || input.revision < 0) throw new HttpError(400, '配置版本无效，请刷新后重试。');
  return { name: input.name.trim(), baseUrl: normalizeBaseUrl(input.baseUrl), model: input.model.trim(), authMode: input.authMode, timeoutSeconds: input.timeoutSeconds };
}

export class WindowsKeyVault {
  constructor(root, settings) {
    this.root = root;
    this.codeRoot = settings.codeRoot || root;
    this.deploymentRoot = path.resolve(root, settings.deploymentRoot || '../AI-WQS-local');
  }
  async transform(operation, value) {
    const config = JSON.parse((await readFile(path.join(this.deploymentRoot, 'config.json'), 'utf8')).replace(/^\uFEFF/, ''));
    return new Promise((resolve, reject) => {
      const child = spawn(config.python, [path.join(this.codeRoot, 'scripts/secret_store.py')], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
      let output = '', done = false;
      const finish = (error, result) => { if (done) return; done = true; clearTimeout(timer); error ? reject(error) : resolve(result); };
      const failure = () => new HttpError(503, '本机密钥保护服务暂时不可用，配置未修改。');
      const timer = setTimeout(() => { child.kill(); finish(failure()); }, 10000);
      child.on('error', () => finish(failure()));
      child.stdin.on('error', () => finish(failure()));
      child.stdout.on('data', chunk => { output += chunk.toString('utf8'); if (output.length > 64000) { child.kill(); finish(failure()); } });
      child.stderr.resume();
      child.on('close', code => {
        try { const result = JSON.parse(output); if (code !== 0 || typeof result.value !== 'string') throw Error(); finish(null, result.value); }
        catch { finish(failure()); }
      });
      child.stdin.end(JSON.stringify({ operation, value }));
    });
  }
  protect(value) { return this.transform('protect', value); }
  unprotect(value) { return this.transform('unprotect', value); }
}

export async function probeModels(config, apiKey, { resolver = lookup } = {}) {
  const url = modelsUrl(config);
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  let request, expired = false, timer;
  const timeout = new Promise((_, reject) => { timer = setTimeout(() => { expired = true; request?.destroy(); reject(new ProbeError('连接超时，请检查接口地址或增加超时时间。')); }, config.timeoutSeconds * 1000); });
  const operation = (async () => {
    const addresses = isIP(hostname) ? [{ address: hostname, family: isIP(hostname) }] : await resolver(hostname, { all: true });
    if (expired) throw new ProbeError('连接超时。');
    const destination = addresses.find(item => item.family === 4 && allowedAddress(item.address, url.protocol)) || addresses.find(item => allowedAddress(item.address, url.protocol));
    if (!destination) throw new ProbeError('接口解析到了不支持的网络地址，已停止连接。');
    const found = new Set(); let cursor = null;
    for (let page = 0; page < 5; page++) {
      if (expired) throw new ProbeError('连接超时。');
      const result = await new Promise((resolve, reject) => {
      const headers = { Accept: 'application/json', 'User-Agent': 'ZhiZuoTai-Server/2.0', ...credentialHeaders(config, apiKey) };
      request = (url.protocol === 'https:' ? https : http).request(modelsUrl(config, cursor), {
        method: 'GET', headers, agent: false, family: destination.family,
        lookup: (_host, options, callback) => options.all ? callback(null, [destination]) : callback(null, destination.address, destination.family),
      }, response => {
        if (response.statusCode !== 200) {
          response.destroy();
          const messages = { 401: '认证失败，请检查 API 密钥是否有效。', 403: '接口拒绝访问，请检查密钥权限。', 404: '未找到 /models，请检查 Base URL 和接口协议。', 429: '接口请求受限，请稍后重试。' };
          reject(new ProbeError(messages[response.statusCode] || (response.statusCode >= 300 && response.statusCode < 400 ? '接口返回了重定向，密钥未转发；请填写最终接口地址。' : `接口返回 HTTP ${response.statusCode}。`), response.statusCode));
          return;
        }
        const chunks = []; let size = 0;
        response.on('data', chunk => { size += chunk.length; if (size > 1_000_000) { response.destroy(); reject(new ProbeError('模型列表响应过大，已停止读取。')); } else chunks.push(chunk); });
        response.on('error', () => reject(new ProbeError('读取接口响应失败，请重试。')));
        response.on('end', () => {
          try {
            const data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
            resolve(parseModels(config, data, apiKey));
          } catch { reject(new ProbeError('接口响应不是兼容的模型列表，请检查协议与 Base URL。')); }
        });
      });
      request.on('error', error => reject(error));
      request.end();
      });
      result.models.forEach(model => found.add(model));
      if (!result.cursor || result.cursor === cursor || found.size >= 500) break;
      cursor = result.cursor;
    }
    return [...found].slice(0, 500);
  })();
  try { return await Promise.race([operation, timeout]); }
  catch (error) {
    if (error instanceof ProbeError) throw error;
    if (['ENOTFOUND', 'EAI_AGAIN'].includes(error.code)) throw new ProbeError('无法解析接口域名，请检查地址和网络。');
    if (/CERT|TLS|SSL/.test(error.code || '')) throw new ProbeError('HTTPS 证书验证失败，请检查接口证书。');
    throw new ProbeError('无法连接接口，请检查地址、端口和网络。');
  } finally { clearTimeout(timer); }
}

export class ModelSettings {
  constructor(store, vault, probe = probeModels) {
    this.store = store; this.vault = vault; this.probe = probe; this.testing = false; this.saving = false;
    store.db.exec('CREATE TABLE IF NOT EXISTS model_settings (id INTEGER PRIMARY KEY CHECK(id=1), config TEXT NOT NULL, key_cipher TEXT, last_test TEXT, revision INTEGER NOT NULL, updated_at TEXT NOT NULL)');
  }
  row() { return this.store.db.prepare('SELECT * FROM model_settings WHERE id=1').get(); }
  read() {
    const row = this.row();
    return { ...DEFAULTS, ...(row ? JSON.parse(row.config) : {}), revision: row?.revision || 0, hasApiKey: Boolean(row?.key_cipher), configured: Boolean(row), updatedAt: row?.updated_at || null, lastTest: row?.last_test ? JSON.parse(row.last_test) : null };
  }
  async save(input) {
    if (this.saving) throw new HttpError(409, '正在保存配置，请稍后重试。');
    this.saving = true;
    try {
      const config = validateSettings(input), old = this.row();
      if (input.revision !== (old?.revision || 0)) throw new HttpError(409, '配置已在其他页面更新，请重新加载后再保存。');
      let cipher = old?.key_cipher || null;
      if (old && cipher && config.authMode === 'bearer' && !input.apiKey && !input.clearKey && new URL(JSON.parse(old.config).baseUrl).origin !== new URL(config.baseUrl).origin)
        throw new HttpError(400, '接口服务商已更换，请重新输入密钥，避免把原密钥发送到新的地址。');
      if (config.authMode === 'none' || input.clearKey) cipher = null;
      else if (input.apiKey) cipher = await this.vault.protect(input.apiKey);
      const updatedAt = new Date().toISOString();
      const saved = this.store.db.prepare('INSERT INTO model_settings VALUES (1, ?, ?, NULL, 1, ?) ON CONFLICT(id) DO UPDATE SET config=excluded.config, key_cipher=excluded.key_cipher, last_test=NULL, revision=model_settings.revision+1, updated_at=excluded.updated_at WHERE model_settings.revision=?').run(JSON.stringify(config), cipher, updatedAt, input.revision);
      if (!saved.changes) throw new HttpError(409, '配置已在其他页面更新，请重新加载后再保存。');
      this.store.audit('api_settings_save', 'success', `保存模型接口：${config.name}`);
      return this.read();
    } finally { this.saving = false; }
  }
  async test(revision) {
    if (this.testing) throw new HttpError(409, '正在检测接口，请稍后再试。');
    const row = this.row();
    if (!row) throw new HttpError(400, '请先保存接口配置。');
    if (!Number.isSafeInteger(revision) || revision !== row.revision) throw new HttpError(409, '配置已变化，请重新加载并保存后再检测。');
    const config = JSON.parse(row.config);
    if (config.authMode === 'bearer' && !row.key_cipher) throw new HttpError(400, '请先保存 API 密钥，或选择无需密钥。');
    this.testing = true;
    const started = Date.now();
    try {
      const apiKey = row.key_cipher ? await this.vault.unprotect(row.key_cipher) : '';
      let result;
      try {
        const models = await this.probe(config, apiKey);
        const modelAvailable = !config.model || models.includes(config.model);
        result = { ok: true, state: models.length && modelAvailable ? 'success' : 'warning', message: !models.length ? '连接成功，但接口未返回可用模型。' : !modelAvailable ? '连接成功，当前填写的模型未在返回列表中。' : `连接成功，返回 ${models.length} 个模型。`, models, modelAvailable };
      } catch (error) { result = { ok: false, state: 'failed', message: error instanceof ProbeError ? error.message : '连接检测未完成，请检查接口配置后重试。', models: [] }; }
      result = { ...result, latencyMs: Date.now() - started, testedAt: new Date().toISOString() };
      if (this.row()?.revision !== row.revision) throw new HttpError(409, '检测期间配置已更新，请使用新配置重新检测。');
      if (!this.store.db.prepare('UPDATE model_settings SET last_test=? WHERE id=1 AND revision=?').run(JSON.stringify(result), row.revision).changes) throw new HttpError(409, '检测期间配置已更新，请重新检测。');
      this.store.audit('api_connection_test', result.ok ? 'success' : 'failed', result.message);
      return result;
    } finally { this.testing = false; }
  }
}
