import http from 'node:http';
import https from 'node:https';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { HttpError } from './store.js';

export const MCP_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26'];
const error = (code, message, status = 502) => new HttpError(status, code, message);
export function publicAddress(address) {
  if (isIP(address) === 4) {
    const [a, b, c] = address.split('.').map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 ||
      a === 100 && b >= 64 && b <= 127 || a === 169 && b === 254 ||
      a === 172 && b >= 16 && b <= 31 || a === 192 && (b === 168 || b === 0 || b === 2 || b === 88 && c === 99) ||
      a === 198 && (b === 18 || b === 19 || b === 51 && c === 100) || a === 203 && b === 0 && c === 113);
  }
  if (isIP(address) === 6) {
    const a = new URL('http://[' + address + ']').hostname.slice(1, -1).toLowerCase();
    const groups = a.split(':');
    return /^[23][0-9a-f]{0,3}:/.test(a) && groups[0] !== '2002' &&
      !(groups[0] === '2001' && (parseInt(groups[1] || '0', 16) < 0x200 || groups[1] === 'db8'));
  }
  return false;
}
export function localOrigins(value = process.env.MCP_ALLOWED_LOCAL_ORIGINS || '') {
  return String(value).split(',').map(v => v.trim()).filter(Boolean).map(v => {
    const url = new URL(v);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== '/')
      throw error('plugin_local_config', '本机 MCP 地址白名单配置无效。', 500);
    return url.origin;
  });
}
export function endpointUrl(value, allowedLocal = []) {
  let url;
  try { if (typeof value !== 'string' || value.length > 2000) throw Error(); url = new URL(value.trim()); }
  catch { throw error('plugin_url', '请输入有效的 MCP 服务地址。', 400); }
  if (url.username || url.password || url.hash || !['https:', 'http:'].includes(url.protocol) ||
    url.protocol !== 'https:' && !allowedLocal.includes(url.origin) ||
    [...url.searchParams.keys()].some(key => /token|secret|authorization|api.?key|^key$|^auth$|password/i.test(key)))
    throw error('plugin_url', '请使用 HTTPS MCP 地址，凭据填写在授权令牌栏。本机服务需先配置地址白名单。', 400);
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  if (isIP(hostname) && !publicAddress(hostname) && !allowedLocal.includes(url.origin))
    throw error('plugin_address', '此 MCP 地址未获准访问。', 400);
  return url;
}

export async function mcpHttp(endpoint, payload, { token = '', sessionId = '', protocolVersion = MCP_VERSIONS[0],
  github = false, allowedLocal = [], resolver = lookup, timeoutMs = 25000, maxBytes = 2_000_000 } = {}) {
  const url = endpointUrl(endpoint, allowedLocal);
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  const body = JSON.stringify(payload);
  if (Buffer.byteLength(body) > 550_000) throw error('plugin_request_large', '插件请求过大，请减少参数。', 400);
  let request, expired = false, timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => { expired = true; request?.destroy(); reject(error('plugin_timeout', '插件响应超时，执行结果可能尚未确认，请先核对远端状态。')); }, timeoutMs);
  });
  const operation = (async () => {
    const addresses = isIP(hostname) ? [{ address: hostname, family: isIP(hostname) }] : await resolver(hostname, { all: true });
    if (expired) throw error('plugin_timeout', '插件连接超时。');
    const permitted = addresses.filter(v => isIP(v.address) === Number(v.family) && (allowedLocal.includes(url.origin) || publicAddress(v.address)));
    const destination = permitted.find(v => v.family === 4) || permitted[0];
    if (!destination) throw error('plugin_address', '插件域名解析到未获准访问的网络地址。', 400);
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (failure, result) => {
        if (settled) return;
        settled = true;
        if (failure) reject(failure); else resolve(result);
      };
      const headers = { Accept: 'application/json, text/event-stream', 'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body), 'User-Agent': 'ZhiZuoTai-MCP/1.0', 'MCP-Protocol-Version': protocolVersion };
      if (token) headers.Authorization = 'Bearer ' + token;
      if (sessionId) headers['Mcp-Session-Id'] = sessionId;
      if (github) headers['X-MCP-Toolsets'] = 'context,repos,issues,pull_requests';
      request = (url.protocol === 'https:' ? https : http).request(url, {
        method: 'POST', headers, agent: false, family: destination.family,
        lookup: (_host, options, callback) => options.all ? callback(null, [destination]) : callback(null, destination.address, destination.family),
      }, response => {
        const status = response.statusCode;
        if (payload.id === undefined && [200, 202, 204].includes(status)) {
          response.destroy(); finish(null, { result: null }); return;
        }
        if (status !== 200) {
          response.destroy();
          finish(error(status === 401 || status === 403 ? 'plugin_auth' : 'plugin_http',
            status === 401 || status === 403 ? '插件认证失败，请检查令牌、权限及服务访问策略。' :
            status >= 300 && status < 400 ? '插件返回重定向，授权信息未转发；请填写最终 MCP 地址。' :
            status === 404 ? 'MCP 地址或会话已失效，请重新连接后核对结果。' : '插件服务返回 HTTP ' + status + '。'));
          return;
        }
        const returnedSession = response.headers['mcp-session-id'];
        if (returnedSession && (typeof returnedSession !== 'string' || !/^[\x21-\x7e]{1,256}$/.test(returnedSession))) {
          response.destroy(); finish(error('plugin_protocol', '插件返回了无效的会话标识。')); return;
        }
        const consume = value => {
          if (!value || value.jsonrpc !== '2.0' || value.id !== payload.id) return false;
          if (value.error) { finish(error('plugin_rpc', '插件拒绝了请求，请检查工具参数与账号权限。')); return true; }
          if (!Object.hasOwn(value, 'result')) { finish(error('plugin_protocol', '插件响应缺少结果。')); return true; }
          if (token && JSON.stringify(value.result).includes(token)) { finish(error('plugin_secret_echo', '插件响应包含授权信息，已停止展示和传递。')); return true; }
          finish(null, { result: value.result, sessionId: returnedSession || sessionId });
          return true;
        };
        const type = String(response.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
        if (!['application/json', 'text/event-stream'].includes(type)) {
          response.destroy(); finish(error('plugin_protocol', '此地址未返回 MCP JSON 或事件流。')); return;
        }
        const decoder = new TextDecoder();
        let buffer = '', size = 0;
        response.on('data', chunk => {
          if (settled) return;
          size += chunk.length;
          if (size > maxBytes) { finish(error('plugin_response_large', '插件结果过大，请缩小查询范围后再操作。')); response.destroy(); return; }
          buffer += decoder.decode(chunk, { stream: true });
          if (type === 'text/event-stream') {
            let match;
            while ((match = /\r?\n\r?\n/.exec(buffer))) {
              const event = buffer.slice(0, match.index);
              buffer = buffer.slice(match.index + match[0].length);
              const data = event.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).replace(/^ /, '')).join('\n');
              if (!data || data === '[DONE]') continue;
              let value; try { value = JSON.parse(data); } catch { continue; }
              if (consume(value)) { response.destroy(); break; }
            }
          }
        });
        response.on('end', () => {
          if (settled) return;
          buffer += decoder.decode();
          if (type === 'application/json') {
            let value; try { value = JSON.parse(buffer); } catch { finish(error('plugin_protocol', '插件返回了无效的 JSON。')); return; }
            if (consume(value)) return;
          }
          finish(error('plugin_protocol', '插件连接结束，但未返回本次请求的结果。'));
        });
        response.on('error', () => { if (!settled) finish(error('plugin_interrupted', '插件连接中断，执行结果未确认。')); });
        response.on('aborted', () => { if (!settled) finish(error('plugin_interrupted', '插件连接中断，执行结果未确认。')); });
      });
      request.on('error', () => finish(error('plugin_unavailable', '无法连接插件服务，请检查地址、网络及 HTTPS 证书。')));
      request.end(body);
    });
  })();
  try { return await Promise.race([operation, deadline]); }
  catch (failure) { if (failure instanceof HttpError) throw failure; throw error('plugin_unavailable', '无法连接插件服务，请检查地址与网络。'); }
  finally { clearTimeout(timer); }
}

export class McpClient {
  constructor(endpoint, options = {}) { this.endpoint = endpoint; this.options = options; this.sessionId = ''; this.version = MCP_VERSIONS[0]; this.sequence = 0; }
  async rpc(method, params = {}, notification = false) {
    const value = await mcpHttp(this.endpoint, { jsonrpc: '2.0', ...(notification ? {} : { id: ++this.sequence }), method, params },
      { ...this.options, sessionId: this.sessionId, protocolVersion: this.version });
    if (value.sessionId) this.sessionId = value.sessionId;
    return value.result;
  }
  async connect() {
    const hello = await this.rpc('initialize', { protocolVersion: this.version, capabilities: {}, clientInfo: { name: 'ZhiZuoTai', version: '1.0.0' } });
    if (!hello || !MCP_VERSIONS.includes(hello.protocolVersion) || !hello.capabilities?.tools)
      throw error('plugin_protocol', '此服务未提供兼容的 MCP 工具能力。');
    this.version = hello.protocolVersion;
    await this.rpc('notifications/initialized', {}, true);
    const tools = [], cursors = new Set();
    let cursor;
    do {
      const page = await this.rpc('tools/list', cursor ? { cursor } : {});
      if (!page || !Array.isArray(page.tools)) throw error('plugin_protocol', '插件工具列表格式无效。');
      tools.push(...page.tools);
      cursor = page.nextCursor;
      if (tools.length > 128 || cursor && (typeof cursor !== 'string' || cursor.length > 2000 || cursors.has(cursor) || cursors.size >= 8))
        throw error('plugin_tools_large', '插件工具集过大，请在 MCP 服务端限制工具集。');
      if (cursor) cursors.add(cursor);
    } while (cursor);
    return { tools, serverInfo: hello.serverInfo || {} };
  }
  async call(name, args) { return this.rpc('tools/call', { name, arguments: args }); }
}
