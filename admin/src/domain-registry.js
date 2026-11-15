import { randomBytes } from 'node:crypto';
import { Resolver } from 'node:dns/promises';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';
import { checkServerIdentity } from 'node:tls';
import { domainToASCII } from 'node:url';
import { HttpError } from './store.js';

const now = () => new Date().toISOString();
const clean = (value, length = 500) => typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, length) : '';
const pending = message => ({ state: 'pending', dns: { state: 'pending', records: [] },
  ssl: { state: 'pending', issuer: null, expiresAt: null }, checkedAt: null, message });

export function normalizeDomainHostname(value) {
  if (typeof value !== 'string' || !value.trim() || /[\u0000-\u001f\u007f]/.test(value) || /[:/\\@?#%*\[\]\s]/.test(value.trim())) throw new HttpError(400, '请输入不含协议、端口或路径的完整域名。');
  const hostname = domainToASCII(value.trim()).toLowerCase();
  const labels = hostname.split('.');
  if (!hostname || hostname.length > 253 || isIP(hostname) || labels.length < 2 ||
      !labels.every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)) ||
      !/^(?:[a-z]{2,63}|xn--[a-z0-9-]{1,59})$/.test(labels.at(-1)) ||
      /(?:^|\.)(?:localhost|local|internal|lan|home|test|invalid|example|onion|arpa)$/.test(hostname) ||
      /(?:^|\.)example\.(?:com|net|org)$/.test(hostname)) throw new HttpError(400, '请使用可在公网 DNS 配置的真实域名，不支持 IP、本地域名或保留域名。');
  return hostname;
}

export function isPublicDomainAddress(address) {
  if (typeof address !== 'string' || address.includes('%')) return false;
  const family = isIP(address);
  if (family === 4) {
    const [a, b, c] = address.split('.').map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 ||
      a === 100 && b >= 64 && b <= 127 || a === 169 && b === 254 ||
      a === 172 && b >= 16 && b <= 31 ||
      a === 192 && (b === 168 || b === 0 && (c === 0 || c === 2) || b === 88 && c === 99) ||
      a === 198 && (b === 18 || b === 19 || b === 51 && c === 100) || a === 203 && b === 0 && c === 113);
  }
  if (family === 6) {
    const parts = address.toLowerCase().split(':');
    const first = parseInt(parts[0] || '0', 16), second = parseInt(parts[1] || '0', 16);
    // Only global unicast; excludes mapped IPv4, ULA, link-local, multicast and translation ranges.
    return first >= 0x2000 && first <= 0x3fff && first !== 0x2002 && first !== 0x3fff &&
      !(first === 0x2001 && (second <= 0x1ff || second === 0xdb8));
  }
  return false;
}

function recordsFrom(input) {
  const records = [], seen = new Set();
  let unsafe = false;
  for (const record of Array.isArray(input) ? input.slice(0, 128) : []) {
    if (!record || !['A', 'AAAA', 'CNAME'].includes(record.type) || typeof record.value !== 'string') continue;
    let value = record.value;
    if (record.type === 'CNAME') {
      try { value = normalizeDomainHostname(value.replace(/\.$/, '')); } catch { unsafe = true; continue; }
    } else if (isIP(value) !== (record.type === 'A' ? 4 : 6) || !isPublicDomainAddress(value)) { unsafe = true; continue; }
    const key = `${record.type}:${value}`;
    if (!seen.has(key)) { seen.add(key); records.push({ type: record.type, value }); }
  }
  return { records: records.slice(0, 64), unsafe };
}

async function systemDns(hostname) {
  const resolver = new Resolver({ timeout: 2000, tries: 1 });
  const queries = [['A', () => resolver.resolve4(hostname)], ['AAAA', () => resolver.resolve6(hostname)], ['CNAME', () => resolver.resolveCname(hostname)]];
  const results = await Promise.allSettled(queries.map(([, query]) => query()));
  const records = [];
  let failed = false;
  results.forEach((result, index) => {
    if (result.status === 'fulfilled') records.push(...result.value.map(value => ({ type: queries[index][0], value })));
    else if (!['ENODATA', 'ENOTFOUND', 'ENONAME'].includes(result.reason?.code)) failed = true;
  });
  return { records, failed };
}

class ProbeError extends Error {
  constructor(code) { super(code); this.code = code; }
}
function certificateInfo(socket, hostname) {
  const certificate = socket?.getPeerCertificate?.();
  if (!socket?.authorized || !certificate || checkServerIdentity(hostname, certificate)) throw new ProbeError('certificate');
  const expiry = Date.parse(certificate.valid_to);
  if (!Number.isFinite(expiry) || expiry <= Date.now()) throw new ProbeError('certificate');
  const issuer = clean(certificate.issuer?.CN || certificate.issuer?.O, 240) || null;
  return { state: 'valid', issuer, expiresAt: new Date(expiry).toISOString() };
}
function requestJson(url, { destination, timeout = 4500, inspectTls = false, headers = {}, requester } = {}) {
  return new Promise((resolve, reject) => {
    let request, settled = false;
    const finish = (error, result) => { if (settled) return; settled = true; clearTimeout(timer); error ? reject(error) : resolve(result); };
    const timer = setTimeout(() => { finish(new ProbeError('timeout')); request?.destroy(); }, timeout);
    try {
      const send = requester || (url.protocol === 'https:' ? httpsRequest : httpRequest);
      request = send(url, { method: 'GET', agent: false, maxHeaderSize: 16384,
        headers: { Accept: 'application/json', 'Accept-Encoding': 'identity', 'User-Agent': 'AI-WQS-Domain-Verification/1.0', ...headers },
        ...(url.protocol === 'https:' ? { rejectUnauthorized: true, servername: url.hostname, checkServerIdentity } : {}),
        ...(destination ? { family: destination.family, autoSelectFamily: false,
          lookup: (_hostname, options, callback) => options.all ? callback(null, [destination]) : callback(null, destination.address, destination.family) } : {}),
      }, response => {
        let ssl = null;
        try { if (inspectTls) ssl = certificateInfo(response.socket, url.hostname); }
        catch (error) { response.destroy(); finish(error); return; }
        const chunks = []; let size = 0;
        response.on('data', chunk => {
          size += chunk.length;
          if (size > 65536) { finish(new ProbeError('response_size')); response.destroy(); }
          else chunks.push(chunk);
        });
        response.on('error', () => finish(new ProbeError('response')));
        response.on('end', () => {
          let data = null;
          try { data = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { /* Report a non-JSON endpoint as a different service. */ }
          finish(null, { status: response.statusCode, data, ssl });
        });
      });
      request.once('error', error => finish(error));
      request.end();
    } catch (error) { finish(error); }
  });
}

async function publicDns(hostname) {
  const types = ['A', 'AAAA', 'CNAME'];
  const results = await Promise.allSettled(types.map(type => requestJson(new URL(`https://dns.google/resolve?name=${encodeURIComponent(hostname)}&type=${type}`), { timeout: 5000 })));
  const records = [];
  let failed = false;
  for (const result of results) {
    if (result.status === 'rejected' || result.value.status !== 200 || ![0, 3].includes(result.value.data?.Status)) { failed = true; continue; }
    for (const answer of Array.isArray(result.value.data.Answer) ? result.value.data.Answer.slice(0, 64) : []) {
      const type = ({ 1: 'A', 28: 'AAAA', 5: 'CNAME' })[answer?.type];
      if (type && typeof answer.data === 'string') records.push({ type, value: answer.data });
    }
  }
  return { records, failed };
}

export async function resolveDomainDns(hostname, { system = systemDns, fallback = publicDns } = {}) {
  let result;
  try { result = await system(hostname); } catch { result = { records: [], failed: true }; }
  let parsed = recordsFrom(result.records);
  // VPN fake-IP DNS (including 198.18/15), split DNS and failures must never become verified public IPs.
  if (parsed.unsafe || result.failed || !parsed.records.some(record => record.type !== 'CNAME')) {
    try { result = await fallback(hostname); parsed = recordsFrom(result.records); }
    catch { return { state: 'error', records: [] }; }
  }
  if (parsed.unsafe) return { state: 'error', records: parsed.records.filter(record => record.type === 'CNAME') };
  if (parsed.records.some(record => record.type !== 'CNAME')) return { state: 'resolved', records: parsed.records };
  return { state: result.failed ? 'error' : 'pending', records: parsed.records };
}

function localOrigin(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error('本机工作台地址配置无效。'); }
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ||
      url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('本机工作台验证只允许固定的本机 HTTP 地址。');
  if (url.hostname === 'localhost') url.hostname = '127.0.0.1';
  return url.origin;
}

export async function verifyDomainBinding({ hostname, workbenchOrigin }, { resolveDns = resolveDomainDns, requester } = {}) {
  hostname = normalizeDomainHostname(hostname);
  workbenchOrigin = localOrigin(workbenchOrigin);
  const [dnsResult, local] = await Promise.allSettled([
    resolveDns(hostname), requestJson(new URL('/api/status', workbenchOrigin), { timeout: 2500, requester }),
  ]);
  const dns = dnsResult.status === 'fulfilled' ? dnsResult.value : { state: 'error', records: [] };
  const result = { ...pending('等待域名解析和 HTTPS 配置。'), dns, checkedAt: now() };
  const parsed = recordsFrom(dns.records);
  if (dns.state !== 'resolved' || parsed.unsafe || !parsed.records.some(record => record.type !== 'CNAME')) {
    result.state = dns.state === 'error' || parsed.unsafe ? 'error' : 'pending';
    result.dns = { state: result.state === 'error' ? 'error' : 'pending', records: parsed.records.filter(record => record.type === 'CNAME') };
    result.message = result.state === 'error' ? '未获得可核验的公网 DNS 结果，请检查解析配置和网络。' : '尚未解析到公网地址，请先在域名服务商配置 DNS。';
    return result;
  }
  result.dns = { state: 'resolved', records: parsed.records };
  const destinations = parsed.records.filter(record => record.type !== 'CNAME').sort((a, b) => a.type.localeCompare(b.type)).slice(0, 2);
  let remote, failure;
  for (const record of destinations) {
    try {
      const headers = /\.(?:ngrok-free\.(?:app|dev)|ngrok\.(?:app|dev))$/.test(hostname) ? { 'ngrok-skip-browser-warning': '1' } : {};
      remote = await requestJson(new URL(`https://${hostname}/api/status`), {
        destination: { address: record.value, family: record.type === 'A' ? 4 : 6 }, inspectTls: true, headers, requester,
      });
      break;
    } catch (error) { if (!failure || /CERT|TLS|SSL|certificate/.test(error.code || '')) failure = error; }
  }
  if (!remote) {
    const invalidCertificate = /CERT|TLS|SSL|certificate/.test(failure?.code || '');
    result.state = invalidCertificate ? 'error' : 'pending';
    result.ssl.state = invalidCertificate ? 'error' : 'pending';
    result.message = invalidCertificate ? '域名的 HTTPS 证书验证失败，请检查证书有效期和域名匹配。' : 'DNS 已解析，但 HTTPS 暂不可达，请检查公网入口、端口和网络。';
    return result;
  }
  result.ssl = remote.ssl;
  if (remote.status >= 300 && remote.status < 400) {
    result.state = 'error'; result.message = 'HTTPS 返回重定向，未跟随跳转；请让此域名直接访问工作台。'; return result;
  }
  if (remote.status !== 200 || remote.data?.mode !== 'server' || !/^[a-f0-9]{32}$/.test(remote.data?.serverId || '')) {
    result.state = 'error'; result.message = 'HTTPS 已连通，但此域名未返回真实工作台状态，请检查转发目标。'; return result;
  }
  if (local.status !== 'fulfilled' || local.value.status !== 200 || local.value.data?.mode !== 'server' || !/^[a-f0-9]{32}$/.test(local.value.data?.serverId || '')) {
    result.state = 'error'; result.message = '无法读取本机工作台实例，请先启动本机工作台后重新检测。'; return result;
  }
  if (local.value.data.serverId !== remote.data.serverId) {
    result.state = 'error'; result.message = '此域名指向另一工作台实例，与当前本机工作台不一致。'; return result;
  }
  result.state = 'active'; result.message = 'DNS、HTTPS 证书与本机工作台实例验证通过。';
  return result;
}

function safeVerification(value) {
  if (!value || !['active', 'pending', 'error'].includes(value.state)) return { ...pending('域名检测暂时无法完成，请稍后重试。'), state: 'error', checkedAt: now() };
  const parsed = recordsFrom(value.dns?.records);
  const dns = { state: ['resolved', 'pending', 'error'].includes(value.dns?.state) ? value.dns.state : 'error', records: parsed.records };
  const expiry = Date.parse(value.ssl?.expiresAt);
  const ssl = { state: ['valid', 'pending', 'error'].includes(value.ssl?.state) ? value.ssl.state : 'error',
    issuer: clean(value.ssl?.issuer, 240) || null, expiresAt: Number.isFinite(expiry) ? new Date(expiry).toISOString() : null };
  let state = value.state;
  if (parsed.unsafe) { dns.state = 'error'; dns.records = parsed.records.filter(record => record.type === 'CNAME'); state = 'error'; }
  if (state === 'active' && (dns.state !== 'resolved' || !dns.records.some(record => record.type !== 'CNAME') || ssl.state !== 'valid' || expiry <= Date.now() || !Number.isFinite(expiry))) state = 'error';
  return { state, dns, ssl, checkedAt: now(), message: state !== value.state ? '域名验证信息不完整，请重新检测。' : clean(value.message) || '域名检测已完成。' };
}

export class DomainRegistry {
  constructor(store, { workbenchOrigin = 'http://127.0.0.1:3000', verifier = verifyDomainBinding } = {}) {
    this.store = store; this.db = store.db;
    this.workbenchOrigin = localOrigin(workbenchOrigin);
    this.verifier = verifier; this.checking = new Set();
    this.db.exec(`CREATE TABLE IF NOT EXISTS ai_domain_bindings (
      id TEXT PRIMARY KEY, hostname TEXT NOT NULL UNIQUE, revision INTEGER NOT NULL,
      enabled INTEGER NOT NULL, is_default INTEGER NOT NULL, created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL, verification TEXT
    ); CREATE UNIQUE INDEX IF NOT EXISTS ai_domain_default ON ai_domain_bindings(is_default) WHERE is_default=1;`);
  }
  record(row) { return { id: row.id, hostname: row.hostname, revision: row.revision, enabled: Boolean(row.enabled), isDefault: Boolean(row.is_default), createdAt: row.created_at, updatedAt: row.updated_at, verification: row.verification ? JSON.parse(row.verification) : null }; }
  row(id) {
    if (typeof id !== 'string' || !/^domain_[a-f0-9]{24}$/.test(id)) throw new HttpError(404, '域名配置不存在。');
    const row = this.db.prepare('SELECT * FROM ai_domain_bindings WHERE id=?').get(id);
    if (!row) throw new HttpError(404, '域名配置不存在。');
    return row;
  }
  current(id, input) {
    const row = this.row(id);
    if (!input || !Number.isSafeInteger(input.revision) || row.revision !== input.revision) throw new HttpError(409, '域名配置已被其他页面更新，请重新读取后操作。');
    return row;
  }
  available(hostname, id = '') {
    if (this.db.prepare('SELECT 1 FROM ai_domain_bindings WHERE hostname=? AND id<>?').get(hostname, id)) throw new HttpError(409, '此域名已添加，请使用已有配置。');
  }
  audit(action, id) { this.store.audit(`domain-${action}`, 'success', id); }
  list() { return this.db.prepare('SELECT * FROM ai_domain_bindings ORDER BY is_default DESC,created_at DESC,id').all().map(row => this.record(row)); }
  get(id) { return this.record(this.row(id)); }
  add(input) {
    const hostname = normalizeDomainHostname(input?.hostname);
    this.available(hostname);
    const id = `domain_${randomBytes(12).toString('hex')}`, created = now();
    const isDefault = this.db.prepare('SELECT 1 FROM ai_domain_bindings WHERE is_default=1').get() ? 0 : 1;
    this.db.prepare('INSERT INTO ai_domain_bindings VALUES (?,?,1,1,?,?,?,?)').run(id, hostname, isDefault, created, created, JSON.stringify(pending('域名已保存，尚未验证 DNS、HTTPS 和工作台路由。')));
    this.audit('add', id); return this.get(id);
  }
  save(id, input) {
    const row = this.current(id, input);
    const hostname = input.hostname === undefined ? row.hostname : normalizeDomainHostname(input.hostname);
    if (input.enabled !== undefined && typeof input.enabled !== 'boolean') throw new HttpError(400, '域名启用状态无效。');
    this.available(hostname, id);
    const enabled = input.enabled === undefined ? row.enabled : Number(input.enabled);
    const changed = this.db.prepare('UPDATE ai_domain_bindings SET hostname=?,enabled=?,revision=revision+1,updated_at=?,verification=? WHERE id=? AND revision=?')
      .run(hostname, enabled, now(), JSON.stringify(pending(enabled ? '域名配置已更新，请重新检测 DNS、HTTPS 和工作台路由。' : '此域名已停用。')), id, row.revision);
    if (!changed.changes) throw new HttpError(409, '域名配置已被其他页面更新，请重新读取后操作。');
    this.audit('save', id); return this.get(id);
  }
  setDefault(id, input) {
    const row = this.current(id, input);
    if (!row.enabled) throw new HttpError(400, '请先启用此域名，再设置为默认。');
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const updated = now();
      this.db.prepare('UPDATE ai_domain_bindings SET is_default=0,revision=revision+1,updated_at=? WHERE is_default=1 AND id<>?').run(updated, id);
      if (!this.db.prepare('UPDATE ai_domain_bindings SET is_default=1,revision=revision+1,updated_at=? WHERE id=? AND revision=?').run(updated, id, row.revision).changes) throw new HttpError(409, '域名配置已被其他页面更新，请重新读取后操作。');
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
    this.audit('default', id); return this.get(id);
  }
  remove(id, input) {
    const row = this.current(id, input);
    if (input.confirmation !== id) throw new HttpError(400, '请确认要移除此域名配置。');
    if (!this.db.prepare('DELETE FROM ai_domain_bindings WHERE id=? AND revision=?').run(id, row.revision).changes) throw new HttpError(409, '域名配置已被其他页面更新，请重新读取后操作。');
    this.audit('remove', id); return { ok: true };
  }
  async verify(id, input) {
    const row = this.current(id, input);
    if (!row.enabled) throw new HttpError(400, '域名已停用，请先启用后检测。');
    if (this.checking.has(id)) throw new HttpError(409, '此域名正在检测，请等待当前检测完成。');
    this.checking.add(id);
    try {
      let verification;
      try { verification = safeVerification(await this.verifier({ hostname: row.hostname, workbenchOrigin: this.workbenchOrigin })); }
      catch { verification = { ...pending('域名检测暂时无法完成，请检查网络后重试。'), state: 'error', checkedAt: now() }; }
      const updated = this.db.prepare('UPDATE ai_domain_bindings SET verification=?,revision=revision+1,updated_at=? WHERE id=? AND revision=?')
        .run(JSON.stringify(verification), now(), id, row.revision);
      if (!updated.changes) throw new HttpError(409, '检测期间域名配置发生变化，旧检测结果未保存，请重新检测。');
      this.audit('verify', id); return this.get(id);
    } finally { this.checking.delete(id); }
  }
  allowedHost(hostname) {
    try { return Boolean(this.db.prepare('SELECT 1 FROM ai_domain_bindings WHERE hostname=? AND enabled=1').get(normalizeDomainHostname(hostname))); }
    catch { return false; }
  }
  defaultOrigin() {
    const row = this.db.prepare('SELECT * FROM ai_domain_bindings WHERE is_default=1 AND enabled=1').get();
    if (!row) return null;
    const verification = row.verification ? JSON.parse(row.verification) : null;
    return verification?.state === 'active' && verification.ssl?.state === 'valid' && Date.parse(verification.ssl.expiresAt) > Date.now() ? `https://${row.hostname}` : null;
  }
}
