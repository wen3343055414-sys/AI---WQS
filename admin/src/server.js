import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { timingSafeEqual } from 'node:crypto';
import { AdminStore, HttpError } from './store.js';
import { SystemManager, ACTIONS } from './system.js';
import { WindowsKeyVault } from './model-settings.js';
import { ModelRegistry } from './model-registry.js';
import { ModelGateway, bridgeToken } from './model-gateway.js';
import { WebsiteStore } from './websites.js';
import { WebsiteTunnel } from './website-tunnel.js';
import { generateWebsite } from './website-generator.js';
import { createWorkbenchGateway } from './workbench-gateway.js';
import { DomainRegistry } from './domain-registry.js';
import { LanAccess, probeWorkbench } from './lan-access.js';
import { LanNetwork } from './lan-network.js';

const CODE_ROOT = fileURLToPath(new URL('../', import.meta.url));
const ROOT = process.env.AI_WQS_ADMIN_HOME ? path.resolve(process.env.AI_WQS_ADMIN_HOME) : CODE_ROOT;
const COOKIE = 'ai_wqs_admin_session';
const assets = new Map([['/', ['index.html', 'text/html; charset=utf-8']], ['/app.js', ['app.js', 'text/javascript; charset=utf-8']], ['/api-settings.js', ['api-settings.js', 'text/javascript; charset=utf-8']], ['/websites.js', ['websites.js', 'text/javascript; charset=utf-8']], ['/websites.css', ['websites.css', 'text/css; charset=utf-8']], ['/models.css', ['models.css', 'text/css; charset=utf-8']], ['/styles.css', ['styles.css', 'text/css; charset=utf-8']], ['/favicon.svg', ['favicon.svg', 'image/svg+xml']]]);
function tokenFrom(request) {
  return request.headers.cookie?.split(';').map(value => value.trim()).find(value => value.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1) || '';
}
async function body(request, limit = 8192) {
  if (request.headers['content-type']?.split(';')[0].trim() !== 'application/json') throw new HttpError(415, '请使用 JSON 请求。');
  const chunks = []; let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > limit) throw new HttpError(413, '请求内容过大。');
    chunks.push(chunk);
  }
  try { const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))); if (!value || Array.isArray(value) || typeof value !== 'object') throw Error(); return value; }
  catch { throw new HttpError(400, '请求格式不正确。'); }
}
function sameToken(left, right) {
  return typeof right === 'string' && /^[a-f0-9]{48}$/.test(right) && left.length === right.length && timingSafeEqual(Buffer.from(left), Buffer.from(right));
}
export function createAdminServer({ root = ROOT, settings, store = new AdminStore(path.join(root, 'data')), manager = new SystemManager(root, settings), modelSettings = new ModelRegistry(store, new WindowsKeyVault(root, settings)), modelGateway = new ModelGateway(store, modelSettings, settings.bridgeToken || ''), websites = new WebsiteStore(store), websiteRuntime, domains = new DomainRegistry(store) }) {
  let addressPort = settings.port;
  let draining = false;
  const attempts = new Map();
  let hashing = 0;
  const server = createServer(async (request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('X-Frame-Options', 'DENY');
    const websiteOrigin = websiteRuntime?.localOrigin || 'http://127.0.0.1:3200';
    response.setHeader('Content-Security-Policy', `default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-src ${websiteOrigin}; frame-ancestors 'none'; base-uri 'none'; object-src 'none'; form-action 'self'`);
    const send = (status, value) => {
      response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify(value));
    };
    try {
      const allowedHosts = [`127.0.0.1:${addressPort}`, `localhost:${addressPort}`];
      if (!allowedHosts.includes(request.headers.host)) throw new HttpError(421, '请通过本机管理地址访问。');
      const url = new URL(request.url, `http://${request.headers.host}`);
      const pathname = url.pathname;
      if (!['GET', 'HEAD', 'POST'].includes(request.method)) throw new HttpError(405, '不支持此请求方法。');
      if (pathname.startsWith('/internal/model/')) {
        if (request.headers.origin || request.headers['sec-fetch-site'] || !modelGateway.authorized(request.headers['x-model-bridge'])) throw new HttpError(403, '模型桥接认证失败。');
        const runtime = () => ({ draining, activeCalls: modelGateway.active, activeJobs: store.db.prepare("SELECT COUNT(*) AS count FROM jobs WHERE status='running'").get().count, revision: settings.revision || 'local' });
        if (pathname === '/internal/model/runtime' && request.method === 'GET') return send(200, runtime());
        if (pathname === '/internal/model/drain' && request.method === 'POST') {
          const active = runtime();
          if (!active.activeCalls && !active.activeJobs) draining = true;
          return send(200, runtime());
        }
        if (pathname === '/internal/model/config' && request.method === 'GET') return send(200, modelGateway.config());
        if (draining) throw new HttpError(503, '管理服务正在切换已验收版本，请稍后重新发送。');
        if (pathname === '/internal/model/chat' && request.method === 'POST') {
          const input = await body(request, 600_000);
          if (draining) throw new HttpError(503, '管理服务正在切换已验收版本，请稍后重新发送。');
          return send(200, await modelGateway.chat(input));
        }
        throw new HttpError(404, '接口不存在。');
      }
      if (pathname === '/api/health' && request.method === 'GET') {
        const hosting = websiteRuntime?.status();
        return send(200, { status: 'ok', mode: 'admin', version: '1.5.0', revision: settings.revision || 'local', draining,
          ...(hosting ? { websites: { available: hosting.available, localOrigin: hosting.localOrigin,
            publicOrigin: hosting.publicOrigin || (hosting.tunnel?.state === 'ready' ? hosting.tunnel.url : null), state: hosting.state || hosting.tunnel?.state,
            ...(hosting.target ? { target: hosting.target, lanEnabled: hosting.lanEnabled, lanOrigins: hosting.lanOrigins } : {}) } } : {}) });
      }
      const token = tokenFrom(request);
      const session = store.session(token);
      if (pathname === '/api/session' && request.method === 'GET') return send(200, { setupRequired: !store.hasOwner(), authenticated: Boolean(session), csrf: session?.csrf, product: '智作台服务端', port: addressPort });
      if (request.method === 'POST') {
        const expected = `http://${request.headers.host}`;
        if (request.headers.origin !== expected || request.headers['sec-fetch-site'] === 'cross-site') throw new HttpError(403, '请求来源验证失败，请在管理页面操作。');
      }
      if (['/api/setup', '/api/login'].includes(pathname) && request.method === 'POST') {
        const input = await body(request);
        const key = request.socket.remoteAddress || 'local';
        const previous = attempts.get(key);
        const attempt = previous && Date.now() - previous.since < 15 * 60_000 ? previous : { count: 0, since: Date.now() };
        if (attempt.count >= 10) throw new HttpError(429, '尝试次数过多，请在 15 分钟后重试。');
        if (hashing >= 2) throw new HttpError(429, '正在验证其他登录，请稍后重试。');
        hashing++;
        try {
          if (pathname === '/api/setup') await store.setup(input.password);
          else if (!(await store.checkPassword(input.password))) {
            attempt.count++;
            attempts.set(key, attempt);
            store.audit('login', 'failed', '密码不正确');
            throw new HttpError(401, '管理密码不正确。');
          }
          attempts.delete(key);
          const created = store.createSession();
          response.setHeader('Set-Cookie', `${COOKIE}=${created.token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=28800`);
          store.audit('login', 'success');
          return send(200, { authenticated: true, csrf: created.csrf });
        } finally { hashing--; }
      }
      if (pathname.startsWith('/api/')) {
        if (!session) throw new HttpError(401, '请先登录管理后台。');
        if (request.method === 'POST' && !sameToken(session.csrf, request.headers['x-admin-csrf'])) throw new HttpError(403, '登录校验已失效，请刷新后重试。');
        if (draining && request.method === 'POST' && pathname !== '/api/logout') throw new HttpError(503, '管理服务正在更新，请稍后重试。');
        if (pathname === '/api/logout' && request.method === 'POST') {
          store.logout(token);
          response.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`);
          return send(200, { ok: true });
        }
        if (pathname === '/api/overview' && request.method === 'GET') return send(200, { ...(await manager.overview()), jobs: store.jobs(), audit: store.audits(), modelUsage: modelGateway.usage() });
        if (pathname === '/api/model-usage' && request.method === 'GET') return send(200, modelGateway.usage());
        if (pathname === '/api/domains' && request.method === 'GET') return send(200, { domains: domains.list(), access: websiteRuntime?.access ? await websiteRuntime.access() : { available: false, enabled: false, revision: 0, addresses: [], workbench: { ready: false }, firewall: { state: 'unknown', message: '尚未启动局域网网关。' } } });
        if (pathname === '/api/domains' && request.method === 'POST') return send(201, domains.add(await body(request)));
        if (pathname === '/api/domain-access/check' && request.method === 'POST') {
          await body(request);
          if (!websiteRuntime?.access) throw new HttpError(503, '工作台访问网关未启动。');
          return send(200, { domains: domains.list(), access: await websiteRuntime.access({ force: true }) });
        }
        if (pathname === '/api/domain-access' && request.method === 'POST') {
          const input = await body(request);
          if (!websiteRuntime?.lanAccess || !websiteRuntime?.access || !websiteRuntime.available) throw new HttpError(503, '工作台访问网关未启动。');
          if (input.enabled === true) {
            const live = await websiteRuntime.access();
            if (!live.workbench.ready || live.workbench.setupRequired !== false) throw new HttpError(409, '请先启动本机工作台并设置访问密码，再启用局域网访问。');
            if (!live.addresses.length) throw new HttpError(409, '未检测到可用的物理局域网连接，请先连接 Wi-Fi 或网线。');
          }
          websiteRuntime.lanAccess.save(input);
          return send(200, { domains: domains.list(), access: await websiteRuntime.access() });
        }
        const domainRoute = pathname.match(/^\/api\/domains\/(domain_[a-f0-9]{24})(?:\/(verify|default|delete))?$/);
        if (domainRoute && request.method === 'POST') {
          const [, id, action] = domainRoute, input = await body(request);
          if (action === 'verify') return send(200, await domains.verify(id, input));
          if (action === 'default') return send(200, domains.setDefault(id, input));
          if (action === 'delete') { domains.remove(id, input); return send(200, { ok: true }); }
          return send(200, domains.save(id, input));
        }
        if (websiteRuntime?.target === 'workbench' && (pathname === '/api/websites' || pathname.startsWith('/api/websites/'))) throw new HttpError(410, '此模块已调整为工作台域名与访问管理，原网站草稿仍保留。');
        if (pathname === '/api/websites' && request.method === 'GET') return send(200, { sites: websites.list(), hosting: websiteRuntime?.status() || { localOrigin: null, available: false, tunnel: { state: 'stopped', url: null, installed: false, message: '网站访客服务未启动。' } }, models: modelGateway.config() });
        if (pathname === '/api/websites' && request.method === 'POST') return send(201, websites.create(await body(request, 8_000_000)));
        if (pathname === '/api/website-hosting/start' && request.method === 'POST') {
          if (websiteRuntime?.target === 'workbench' && settings.enablePublicAccess !== true) throw new HttpError(409, '当前按本地局域网部署，未启用公网通道。');
          if (!websiteRuntime?.available) throw new HttpError(503, '网站访客服务不可用，请查看管理服务日志。');
          await body(request);
          const result = await websiteRuntime.tunnel.start();
          store.audit('website_tunnel_start', 'started', '开启网站公网访问通道');
          return send(202, result);
        }
        if (pathname === '/api/website-hosting/stop' && request.method === 'POST') {
          const input = await body(request);
          if (input.confirmation !== 'stop') throw new HttpError(400, '请确认关闭公网访问通道。');
          if (!websiteRuntime) throw new HttpError(503, '网站访客服务未启动。');
          const result = await websiteRuntime.tunnel.stop();
          store.audit('website_tunnel_stop', 'success', '关闭网站公网访问通道');
          return send(200, result);
        }
        const websiteRoute = pathname.match(/^\/api\/websites\/(site_[a-f0-9]+)(?:\/(publish|unpublish|delete|preview|generate|export))?$/);
        if (websiteRoute) {
          const [, id, action] = websiteRoute;
          if (!action && request.method === 'GET') return send(200, websites.get(id));
          if (action === 'export' && request.method === 'GET') {
            const site = websites.get(id);
            response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Disposition': `attachment; filename="${site.slug}.json"` });
            return response.end(JSON.stringify({ schemaVersion: 1, name: site.name, slug: site.slug, description: site.description, files: site.files }, null, 2));
          }
          if (request.method === 'POST') {
            const input = await body(request, action === 'generate' ? 120_000 : 8_000_000);
            if (!action) return send(200, websites.save(id, input));
            if (action === 'publish') {
              if (!websiteRuntime?.available) throw new HttpError(503, '网站访客服务不可用，未发布。');
              return send(200, websites.publish(id, input));
            }
            if (action === 'unpublish') return send(200, websites.unpublish(id, input));
            if (action === 'delete') { websites.remove(id, input); return send(200, { ok: true }); }
            if (action === 'preview') {
              if (!websiteRuntime?.available) throw new HttpError(503, '网站访客服务不可用，无法预览。');
              const preview = websites.preview(id, input);
              return send(200, { ...preview, url: websiteRuntime.localOrigin + preview.path });
            }
            if (action === 'generate') {
              const current = websites.get(id);
              const generated = await generateWebsite(modelGateway, current, input);
              if (draining) throw new HttpError(503, '管理服务正在更新，生成结果尚未保存。');
              return send(200, { site: websites.save(id, { ...current, files: generated.files, revision: input.revision }), model: generated.model });
            }
          }
          throw new HttpError(405, '不支持此网站操作。');
        }
        if (pathname === '/api/model-settings' && request.method === 'GET') return send(200, modelSettings.read());
        if (pathname === '/api/model-settings' && request.method === 'POST') return send(200, await modelSettings.save(await body(request)));
        if (pathname === '/api/model-settings/test' && request.method === 'POST') return send(200, await modelSettings.test((await body(request)).revision));
        if (pathname === '/api/model-providers' && request.method === 'GET') return send(200, modelSettings.list());
        if (pathname === '/api/model-providers' && request.method === 'POST') return send(200, await modelSettings.saveProvider(null, await body(request)));
        if (pathname === '/api/model-routing' && request.method === 'POST') { const input = await body(request); return send(200, modelSettings.setDefault(input.modelKey, input.revision)); }
        const providerRoute = pathname.match(/^\/api\/model-providers\/(provider_[A-Za-z0-9_-]+)(?:\/(test|models|delete))?$/);
        if (providerRoute && request.method === 'POST') {
          const [, id, action] = providerRoute, input = await body(request);
          if (action === 'test') return send(200, await modelSettings.testProvider(id, input.revision));
          if (action === 'models') return send(200, modelSettings.addModel(id, input));
          if (action === 'delete') { modelSettings.removeProvider(id, input.revision, input.confirmation); return send(200, { ok: true }); }
          return send(200, await modelSettings.saveProvider(id, input));
        }
        const modelRoute = pathname.match(/^\/api\/model-catalog\/(model_[A-Za-z0-9_-]+)(?:\/(delete))?$/);
        if (modelRoute && request.method === 'POST') {
          const [, id, action] = modelRoute, input = await body(request);
          if (action === 'delete') { modelSettings.removeModel(id, input.revision, input.confirmation); return send(200, { ok: true }); }
          return send(200, modelSettings.updateModel(id, input));
        }
        if (pathname === '/api/logs' && request.method === 'GET') {
          const lines = Number(url.searchParams.get('lines') || 140);
          if (!Number.isInteger(lines) || lines < 1 || lines > 500) throw new HttpError(400, '日志行数需为 1–500。');
          return send(200, { text: await manager.logs(url.searchParams.get('source') || 'backend', lines), updatedAt: new Date().toISOString() });
        }
        if (pathname === '/api/actions' && request.method === 'POST') {
          const input = await body(request);
          if (!ACTIONS.has(input.action)) throw new HttpError(400, '不支持此管理操作。');
          if (input.confirmation !== input.action) throw new HttpError(400, '请在确认窗口确认此操作。');
          const id = store.createJob(input.action);
          send(202, { id, message: `${ACTIONS.get(input.action)}已开始。` });
          Promise.resolve().then(() => manager.action(input.action)).then(result => store.finishJob(id, 'success', result.message, result.output)).catch(error => store.finishJob(id, 'failed', error.message, error.output));
          return;
        }
        if (pathname.startsWith('/api/backups/') && request.method === 'GET') {
          const name = decodeURIComponent(pathname.slice('/api/backups/'.length));
          const download = await manager.downloadBackup(name);
          store.audit('download', 'success', name);
          response.writeHead(200, { 'Content-Type': 'application/vnd.sqlite3', 'Content-Length': download.size, 'Content-Disposition': `attachment; filename="${name}"` });
          try { await pipeline(createReadStream(download.file), response); } finally { await download.cleanup(); }
          return;
        }
        throw new HttpError(404, '接口不存在。');
      }
      const asset = assets.get(pathname);
      if (!asset || !['GET', 'HEAD'].includes(request.method)) throw new HttpError(404, '页面不存在。');
      const content = await readFile(path.join(settings.codeRoot || root, 'public', asset[0]));
      response.writeHead(200, { 'Content-Type': asset[1] });
      response.end(request.method === 'HEAD' ? undefined : content);
    } catch (error) {
      if (response.headersSent) { response.destroy(); return; }
      if (!error.status) console.error(new Date().toISOString(), 'Request error:', error.message);
      send(error.status || 503, { message: error.status ? error.message : '暂时无法读取服务状态，请查看管理服务日志。', ...(error.code && error.status ? { code: error.code } : {}) });
    }
  });
  server.on('listening', () => { addressPort = server.address().port; });
  server.requestTimeout = 30000;
  server.headersTimeout = 10000;
  return { server, store, websites };
}

async function main() {
  process.umask(0o077);
  const settings = JSON.parse((await readFile(path.join(ROOT, 'config.json'), 'utf8')).replace(/^\uFEFF/, ''));
  if (!Number.isInteger(settings.port) || settings.port < 1024 || settings.port > 65535) throw new Error('管理端口配置无效。');
  await mkdir(path.join(ROOT, 'data'), { recursive: true, mode: 0o700 });
  const websitePort = settings.websitePort ?? 3200;
  if (!Number.isInteger(websitePort) || websitePort < 1024 || websitePort > 65535 || websitePort === settings.port) throw new Error('网站访客端口配置无效。');
  const store = new AdminStore(path.join(ROOT, 'data'));
  const deploymentRoot = path.resolve(ROOT, settings.deploymentRoot || '../AI-WQS-local');
  let deploymentConfig;
  try { deploymentConfig = JSON.parse((await readFile(path.join(deploymentRoot, 'config.json'), 'utf8')).replace(/^\uFEFF/, '')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; deploymentConfig = { port: 3000 }; }
  const workbenchPort = settings.workbenchPort ?? deploymentConfig.port;
  if (!Number.isInteger(workbenchPort) || workbenchPort < 1024 || workbenchPort > 65535 || workbenchPort === websitePort || workbenchPort === settings.port) throw new Error('工作台端口配置无效。');
  const workbenchOrigin = `http://127.0.0.1:${workbenchPort}`;
  const publicEnabled = settings.enablePublicAccess === true;
  const websites = new WebsiteStore(store), domains = new DomainRegistry(store, { workbenchOrigin });
  const lanAccess = new LanAccess(store), network = new LanNetwork({ port: websitePort, nodePath: settings.node });
  let networkSnapshot = await network.read();
  const tunnel = new WebsiteTunnel({ root: ROOT, port: websitePort, executable: settings.websiteTunnelExecutable });
  let workbenchCheck = null, checkingWorkbench = null;
  const workbench = async (force = false) => {
    if (!force && workbenchCheck && Date.now() - workbenchCheck.time < 5000) return workbenchCheck.value;
    if (checkingWorkbench) return checkingWorkbench;
    checkingWorkbench = probeWorkbench(workbenchOrigin).then(value => { workbenchCheck = { time: Date.now(), value }; return value; }).finally(() => { checkingWorkbench = null; });
    return checkingWorkbench;
  };
  const websiteRuntime = { target: 'workbench', available: false, localOrigin: `http://127.0.0.1:${websitePort}`, tunnel, lanAccess,
    status() { const enabled = lanAccess.read().enabled; return { target: this.target, available: this.available, localOrigin: this.localOrigin,
      publicOrigin: publicEnabled ? domains.defaultOrigin() : null, tunnel: tunnel.status(), state: this.available && enabled ? 'ready' : 'stopped',
      lanEnabled: enabled, lanOrigins: enabled ? networkSnapshot.addresses.map(item => item.url) : [] }; },
    async access({ force = false } = {}) {
      const [lan, upstream] = await Promise.all([network.read({ force }), workbench(force)]);
      networkSnapshot = lan;
      return { ...lanAccess.read(), available: this.available, gatewayPort: websitePort, localUrl: workbenchOrigin,
        addresses: lan.addresses, hostname: lan.hostname, primaryUrl: lan.addresses[0]?.url || null,
        workbench: upstream, firewall: lan.firewall, checkedAt: lan.checkedAt };
    } };
  const publicHost = hostname => publicEnabled && (domains.allowedHost(hostname) || tunnel.status().url && new URL(tunnel.status().url).hostname === hostname);
  const visitor = createWorkbenchGateway({ upstreamOrigin: workbenchOrigin,
    allowedHost: hostname => network.allowedHost(hostname) || Boolean(publicHost(hostname)),
    allowedClient: address => network.allowedClient(address),
    secureHost: hostname => Boolean(publicHost(hostname)),
    isEnabled: () => lanAccess.read().enabled || publicEnabled });
  visitor.on('error', error => { websiteRuntime.available = false; console.error('工作台访问网关启动失败：', error.message); });
  visitor.listen(websitePort, '0.0.0.0', () => {
    websiteRuntime.available = true;
    console.log(`${new Date().toISOString()} 工作台访问网关已启动：${websiteRuntime.localOrigin}`);
    if (publicEnabled) tunnel.restore().catch(error => console.error('公网通道未恢复：', error.message));
  });
  const networkRefresh = setInterval(() => { network.read({ force: true }).then(value => { networkSnapshot = value; }).catch(() => {}); }, 30_000); networkRefresh.unref();
  const { server } = createAdminServer({ store, websites, domains, websiteRuntime, settings: { ...settings, codeRoot: CODE_ROOT, revision: process.env.APP_VERSION || 'local', bridgeToken: await bridgeToken(ROOT) } });
  server.listen(settings.port, '127.0.0.1', () => console.log(`${new Date().toISOString()} 管理服务已启动：http://127.0.0.1:${settings.port}`));
  let stopping = false;
  async function shutdown(code = 0) {
    if (stopping) return; stopping = true;
    clearInterval(networkRefresh);
    const timeout = setTimeout(() => process.exit(1), 7000); timeout.unref();
    await tunnel.shutdown();
    await Promise.all([server, visitor].map(listener => new Promise(resolve => { listener.close(resolve); listener.closeIdleConnections(); })));
    store.close(); process.exit(code);
  }
  server.on('error', error => { console.error(error.message); shutdown(1).catch(() => process.exit(1)); });
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { shutdown().catch(() => process.exit(1)); });
}
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) main().catch(error => { console.error(error.message); process.exitCode = 1; });
