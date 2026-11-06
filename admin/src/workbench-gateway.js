import { createServer, request as httpRequest } from 'node:http';
import { Transform } from 'node:stream';

const LOOPBACKS = new Set(['127.0.0.1', 'localhost', '[::1]']);
const ASSETS = ['/', '/index.html', '/styles.css', '/app.js', '/core.js', '/sync.js', '/favicon.svg'];
const ROUTES = new Map([
  ...ASSETS.map(name => [name, ['GET', 'HEAD']]),
  ['/api/health', ['GET', 'HEAD']], ['/api/status', ['GET', 'HEAD']],
  ['/api/login', ['POST']], ['/api/logout', ['POST']],
  ['/api/workspace', ['GET', 'HEAD', 'PUT']], ['/api/model-config', ['GET']], ['/api/chat', ['POST']],
]);
const RESPONSE_HEADERS = new Set(['content-type', 'content-length', 'content-encoding', 'cache-control',
  'content-security-policy', 'referrer-policy', 'x-content-type-options', 'x-frame-options',
  'permissions-policy', 'etag', 'last-modified', 'vary', 'allow', 'retry-after', 'content-language']);
const REQUEST_HEADERS = ['content-type', 'content-length', 'accept', 'accept-language',
  'origin', 'sec-fetch-site', 'sec-fetch-mode', 'sec-fetch-dest', 'if-none-match', 'if-modified-since'];

function upstreamAddress(value) {
  let address;
  try { address = new URL(value); } catch { throw new Error('工作台上游地址无效。'); }
  const port = Number(address.port || 80);
  if (address.protocol !== 'http:' || !LOOPBACKS.has(address.hostname) || address.username || address.password ||
    address.pathname !== '/' || address.search || address.hash || port < 1024 || port > 65535 || [3100, 3200].includes(port))
    throw new Error('工作台上游必须是固定的本机 HTTP 服务地址，且不能指向管理或公网入口端口。');
  if (address.hostname === 'localhost') address.hostname = '127.0.0.1';
  return address;
}

function responseCookies(value, secure) {
  return (Array.isArray(value) ? value : value ? [value] : []).flatMap(cookie => {
    const match = cookie.match(/^wqs_session=([a-f0-9]{64}|)(?:;|$)/);
    if (!match) return [];
    // Workbench sessions remain host-only and cannot replace an admin cookie.
    const age = cookie.match(/(?:^|;)\s*Max-Age=(\d+)(?:;|$)/i)?.[1];
    return [`wqs_session=${match[1]}; HttpOnly; SameSite=Strict; Path=/${age && Number(age) <= 604800 ? `; Max-Age=${age}` : ''}${secure || /(?:^|;)\s*Secure(?:;|$)/i.test(cookie) ? '; Secure' : ''}`];
  });
}

/** A fixed-target reverse proxy; it never serves a static or demo fallback. */
export function createWorkbenchGateway({ upstreamOrigin = 'http://127.0.0.1:3000', allowedHost = () => false,
  isEnabled = () => true, secureHost = hostname => !LOOPBACKS.has(hostname), allowedClient = () => true } = {}) {
  const upstream = upstreamAddress(upstreamOrigin);
  const server = createServer((request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    let completed = false, outbound, deadline;
    const fail = (status, error, message) => {
      if (completed || response.destroyed) return;
      completed = true;
      clearTimeout(deadline);
      if (response.headersSent) { response.destroy(); return; }
      response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
      response.end(request.method === 'HEAD' ? undefined : JSON.stringify({ error, message }));
    };
    try {
      if (!allowedClient(request.socket.remoteAddress || '')) return fail(403, 'client_rejected', '不允许从此网络访问工作台。');
      if (!isEnabled()) return fail(503, 'public_access_disabled', '工作台访问入口已关闭。');
      const host = request.headers.host || '';
      if (host.length > 255 || !/^[A-Za-z0-9.:[\]-]+$/.test(host)) return fail(421, 'host_rejected', '请使用已启用的工作台网址。');
      const hostname = new URL(`http://${host}`).hostname;
      if (!LOOPBACKS.has(hostname) && !allowedHost(hostname)) return fail(421, 'host_rejected', '请使用已启用的工作台网址。');
      const rawPath = request.url?.split('?')[0];
      const methods = ROUTES.get(rawPath);
      if (!methods) return fail(404, 'not_found', '页面或接口不存在。');
      if (!methods.includes(request.method)) {
        response.setHeader('Allow', methods.join(', '));
        return fail(405, 'method_not_allowed', '不支持此请求方法。');
      }
      const headers = { host };
      for (const name of REQUEST_HEADERS) if (typeof request.headers[name] === 'string') headers[name] = request.headers[name];
      const session = request.headers.cookie?.match(/(?:^|;\s*)wqs_session=([a-f0-9]{64})(?:;|$)/)?.[1];
      if (session) headers.cookie = `wqs_session=${session}`;
      const limit = rawPath === '/api/chat' ? 600_000 : 16 * 1024 * 1024;
      const length = Number(headers['content-length'] || 0);
      if (!Number.isSafeInteger(length) || length < 0) return fail(400, 'invalid_length', '请求长度无效。');
      if (length > limit) {
        response.setHeader('Connection', 'close'); request.resume();
        return fail(413, 'body_too_large', '请求内容超过允许大小。');
      }
      // Only this constructor-provided loopback address can be contacted.
      // index.html is an alias for the existing backend's real root page.
      const targetPath = rawPath === '/index.html' ? '/' + request.url.slice(rawPath.length) : request.url;
      outbound = httpRequest({ protocol: 'http:', hostname: upstream.hostname.replace(/^\[|\]$/g, ''),
        port: Number(upstream.port), method: request.method, path: targetPath, headers, agent: false }, incoming => {
        const status = incoming.statusCode || 502;
        if (status >= 300 && status < 400 && status !== 304) {
          incoming.resume();
          return fail(502, 'upstream_redirect_rejected', '工作台返回了不支持的跳转，请检查本地服务。');
        }
        const forwardHeaders = () => {
          const clean = {};
          const hopHeaders = new Set(String(incoming.headers.connection || '').toLowerCase().split(',').map(name => name.trim()));
          for (const [name, value] of Object.entries(incoming.headers)) if (RESPONSE_HEADERS.has(name) && !hopHeaders.has(name)) clean[name] = value;
          const cookies = responseCookies(incoming.headers['set-cookie'], Boolean(secureHost(hostname)));
          if (cookies.length) clean['set-cookie'] = cookies;
          return clean;
        };
        // The frontend treats a missing /api/status as a browser-only static
        // build. Verify that endpoint so a broken upstream cannot enable it.
        if (rawPath === '/api/status' && request.method !== 'HEAD') {
          if (status !== 200) { incoming.resume(); return fail(502, 'workbench_unavailable', '工作台服务器未就绪，请稍后重试。'); }
          const chunks = [];
          let size = 0;
          incoming.on('data', chunk => {
            size += chunk.length;
            if (size > 1_000_000) { incoming.destroy(); return fail(502, 'invalid_workbench_status', '工作台服务器状态无法识别。'); }
            chunks.push(chunk);
          });
          incoming.on('end', () => {
            if (completed) return;
            const content = Buffer.concat(chunks);
            let state;
            try { state = JSON.parse(content.toString('utf8')); } catch { /* Do not accept an HTML/static response. */ }
            if (!state || state.mode !== 'server' || typeof state.serverId !== 'string' || !state.serverId)
              return fail(502, 'invalid_workbench_status', '工作台服务器状态无法识别。');
            completed = true; clearTimeout(deadline);
            response.writeHead(status, forwardHeaders()); response.end(content);
          });
        } else {
          if (completed) { incoming.resume(); return; }
          response.writeHead(status, forwardHeaders());
          incoming.pipe(response);
          incoming.on('end', () => { completed = true; clearTimeout(deadline); });
        }
        incoming.on('error', () => fail(502, 'workbench_unavailable', '工作台连接中断，请稍后重试。'));
        incoming.on('aborted', () => fail(502, 'workbench_unavailable', '工作台连接中断，请稍后重试。'));
      });
      outbound.on('error', () => fail(502, 'workbench_unavailable', '本地工作台服务不可用，请启动工作台后重试。'));
      outbound.on('upgrade', (_, socket) => { socket.destroy(); fail(502, 'unsupported_upgrade', '不支持升级此连接。'); });
      deadline = setTimeout(() => {
        fail(504, 'workbench_timeout', '等待工作台响应超时，请稍后重试。');
        outbound.destroy();
      }, rawPath === '/api/chat' ? 160_000 : 30_000);
      deadline.unref();
      let received = 0;
      const bounded = new Transform({ transform(chunk, encoding, callback) {
        received += chunk.length;
        if (received > limit) { const error = new Error('Request too large'); error.code = 'BODY_TOO_LARGE'; callback(error); }
        else callback(null, chunk);
      } });
      bounded.on('error', () => {
        request.unpipe(bounded); request.resume(); if (!response.headersSent) response.setHeader('Connection', 'close');
        fail(413, 'body_too_large', '请求内容超过允许大小。'); outbound.destroy();
      });
      request.on('aborted', () => { completed = true; clearTimeout(deadline); outbound.destroy(); });
      request.on('error', () => { completed = true; clearTimeout(deadline); outbound.destroy(); });
      response.on('close', () => { clearTimeout(deadline); if (!completed) outbound.destroy(); });
      request.pipe(bounded).pipe(outbound);
    } catch {
      outbound?.destroy(); fail(502, 'gateway_unavailable', '工作台公网入口暂时不可用，请稍后重试。');
    }
  });
  const rejectSocket = socket => socket.end('HTTP/1.1 405 Method Not Allowed\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
  server.on('upgrade', (_, socket) => rejectSocket(socket));
  server.on('connect', (_, socket) => rejectSocket(socket));
  server.on('checkContinue', (_, response) => { response.writeHead(417, { Connection: 'close' }); response.end(); });
  server.on('checkExpectation', (_, response) => { response.writeHead(417, { Connection: 'close' }); response.end(); });
  server.requestTimeout = 30_000;
  server.headersTimeout = 10_000;
  return server;
}
