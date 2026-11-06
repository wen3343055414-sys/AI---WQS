import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { HttpError } from './store.js';

const MAX_BYTES = 5 * 1024 * 1024;
const MAX_FILES = 100;
const PREVIEW_TTL = 15 * 60_000;
const TYPES = new Map([
  ['.html', 'text/html; charset=utf-8'], ['.htm', 'text/html; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'], ['.js', 'text/javascript; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'], ['.json', 'application/json; charset=utf-8'],
  ['.webmanifest', 'application/manifest+json; charset=utf-8'], ['.svg', 'image/svg+xml'],
  ['.txt', 'text/plain; charset=utf-8'], ['.md', 'text/plain; charset=utf-8'],
  ['.png', 'image/png'], ['.jpg', 'image/jpeg'], ['.jpeg', 'image/jpeg'],
  ['.gif', 'image/gif'], ['.webp', 'image/webp'], ['.avif', 'image/avif'],
  ['.ico', 'image/x-icon'], ['.woff', 'font/woff'], ['.woff2', 'font/woff2'],
  ['.ttf', 'font/ttf'], ['.otf', 'font/otf'],
]);
const BINARY = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif', '.ico', '.woff', '.woff2', '.ttf', '.otf']);
const timestamp = () => new Date().toISOString();
const safePath = value => typeof value === 'string' && value.length > 0 && value.length <= 240 &&
  !/[\\%?#:\u0000-\u001f\u007f]/.test(value) && !value.startsWith('/') &&
  value.split('/').every(part => part && !part.startsWith('.') && part.trim() === part);

function validateFiles(input) {
  if (!Array.isArray(input) || input.length > MAX_FILES) throw new HttpError(400, '网站最多包含 100 个文件。');
  const seen = new Set();
  let total = 0;
  return input.map(file => {
    if (!file || !safePath(file.path)) throw new HttpError(400, '文件路径无效，请使用网站内的相对路径。');
    const extension = path.posix.extname(file.path).toLowerCase();
    if (!TYPES.has(extension)) throw new HttpError(400, '文件类型不受支持，请使用 HTML、CSS、JavaScript、文本、图片或字体文件。');
    const key = file.path.toLowerCase();
    if (seen.has(key)) throw new HttpError(400, '网站中存在重复文件路径。');
    seen.add(key);
    const encoding = file.encoding ?? 'utf8';
    if (typeof file.content !== 'string' || !['utf8', 'base64'].includes(encoding) ||
      (BINARY.has(extension) ? encoding !== 'base64' : encoding !== 'utf8')) throw new HttpError(400, '文件内容或编码无效，图片和字体需要 Base64 编码。');
    if (encoding === 'base64' && (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(file.content) || Buffer.from(file.content, 'base64').toString('base64') !== file.content)) throw new HttpError(400, '图片或字体的 Base64 内容无效。');
    total += Buffer.byteLength(file.content, encoding);
    if (total > MAX_BYTES) throw new HttpError(413, '网站文件总大小不能超过 5 MB。');
    return { path: file.path, content: file.content, encoding };
  });
}

function validateDraft(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new HttpError(400, '网站内容无效。');
  if (typeof input.name !== 'string' || !input.name.trim() || input.name.trim().length > 100) throw new HttpError(400, '网站名称需为 1–100 个字符。');
  if (typeof input.slug !== 'string' || !/^[a-z0-9](?:[a-z0-9-]{0,58}[a-z0-9])?$/.test(input.slug) || input.slug === 'api') throw new HttpError(400, '网址标识需为 1–60 个小写字母、数字或短横线，首尾使用字母或数字。');
  const description = input.description ?? '';
  if (typeof description !== 'string' || description.length > 500) throw new HttpError(400, '网站说明不能超过 500 个字符。');
  return { name: input.name.trim(), slug: input.slug, description, files: validateFiles(input.files ?? []) };
}

export class WebsiteStore {
  constructor(store) {
    this.store = store;
    this.db = store.db;
    this.previews = new Map();
    this.db.exec(`CREATE TABLE IF NOT EXISTS ai_websites (
      id TEXT PRIMARY KEY, slug TEXT NOT NULL UNIQUE, name TEXT NOT NULL, description TEXT NOT NULL,
      files TEXT NOT NULL, revision INTEGER NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      published_slug TEXT UNIQUE, published_files TEXT, published_at TEXT, published_revision INTEGER
    );`);
  }
  record(row, includeFiles = true) {
    return { id: row.id, name: row.name, slug: row.slug, description: row.description,
      revision: row.revision, createdAt: row.created_at, updatedAt: row.updated_at,
      published: row.published_files !== null, publishedAt: row.published_at,
      publishedRevision: row.published_revision, publishedSlug: row.published_slug,
      ...(includeFiles ? { files: JSON.parse(row.files) } : {}) };
  }
  row(id) {
    if (typeof id !== 'string' || !/^site_[a-f0-9]{24}$/.test(id)) throw new HttpError(404, '网站不存在。');
    const row = this.db.prepare('SELECT * FROM ai_websites WHERE id=?').get(id);
    if (!row) throw new HttpError(404, '网站不存在。');
    return row;
  }
  current(id, input) {
    const row = this.row(id);
    if (!input || !Number.isSafeInteger(input.revision) || input.revision !== row.revision) throw new HttpError(409, '网站已被其他页面更新，请重新读取后再操作。');
    return row;
  }
  reserveSlug(slug, id = '') {
    if (this.db.prepare('SELECT 1 FROM ai_websites WHERE (slug=? OR published_slug=?) AND id<>?').get(slug, slug, id)) throw new HttpError(409, '此网址标识已被其他网站使用。');
  }
  audit(action, id) { this.store.audit(`website-${action}`, 'success', id); }
  list() {
    return this.db.prepare(`SELECT id,slug,name,description,revision,created_at,updated_at,
      published_slug,published_at,published_revision,CASE WHEN published_files IS NULL THEN NULL ELSE '' END AS published_files
      FROM ai_websites ORDER BY updated_at DESC, id`).all().map(row => this.record(row, false));
  }
  get(id) { return this.record(this.row(id)); }
  create(input) {
    const draft = validateDraft(input);
    this.reserveSlug(draft.slug);
    const id = `site_${randomBytes(12).toString('hex')}`, now = timestamp();
    this.db.prepare('INSERT INTO ai_websites (id,slug,name,description,files,revision,created_at,updated_at) VALUES (?,?,?,?,?,1,?,?)')
      .run(id, draft.slug, draft.name, draft.description, JSON.stringify(draft.files), now, now);
    this.audit('create', id);
    return this.get(id);
  }
  save(id, input) {
    const row = this.current(id, input), draft = validateDraft(input);
    this.reserveSlug(draft.slug, id);
    const changed = this.db.prepare('UPDATE ai_websites SET slug=?,name=?,description=?,files=?,revision=revision+1,updated_at=? WHERE id=? AND revision=?')
      .run(draft.slug, draft.name, draft.description, JSON.stringify(draft.files), timestamp(), id, row.revision);
    if (!changed.changes) throw new HttpError(409, '网站已被其他页面更新，请重新读取后再操作。');
    this.audit('save', id);
    return this.get(id);
  }
  publish(id, input) {
    const row = this.current(id, input), files = JSON.parse(row.files);
    if (!files.some(file => file.path === 'index.html' && file.content.trim())) throw new HttpError(400, '发布前请添加非空的 index.html 首页。');
    this.reserveSlug(row.slug, id);
    const now = timestamp();
    const changed = this.db.prepare('UPDATE ai_websites SET published_slug=slug,published_files=files,published_at=?,published_revision=revision+1,revision=revision+1,updated_at=? WHERE id=? AND revision=?')
      .run(now, now, id, row.revision);
    if (!changed.changes) throw new HttpError(409, '网站已被其他页面更新，请重新读取后再操作。');
    this.audit('publish', id);
    return this.get(id);
  }
  unpublish(id, input) {
    const row = this.current(id, input);
    if (input.confirmation !== id) throw new HttpError(400, '请确认下线此网站。');
    const changed = this.db.prepare('UPDATE ai_websites SET published_slug=NULL,published_files=NULL,published_at=NULL,published_revision=NULL,revision=revision+1,updated_at=? WHERE id=? AND revision=?')
      .run(timestamp(), id, row.revision);
    if (!changed.changes) throw new HttpError(409, '网站已被其他页面更新，请重新读取后再操作。');
    this.audit('unpublish', id);
    return this.get(id);
  }
  remove(id, input) {
    const row = this.current(id, input);
    if (input.confirmation !== id) throw new HttpError(400, '请确认删除此网站。');
    const changed = this.db.prepare('DELETE FROM ai_websites WHERE id=? AND revision=?').run(id, row.revision);
    if (!changed.changes) throw new HttpError(409, '网站已被其他页面更新，请重新读取后再操作。');
    for (const [token, preview] of this.previews) if (preview.id === id) this.previews.delete(token);
    this.audit('delete', id);
    return { ok: true };
  }
  preview(id, input) {
    const row = this.current(id, input), now = Date.now();
    for (const [token, preview] of this.previews) if (preview.expires <= now) this.previews.delete(token);
    // Limit memory even if a logged-in owner repeatedly requests previews.
    while (this.previews.size >= 20) this.previews.delete(this.previews.keys().next().value);
    const token = randomBytes(32).toString('hex'), expires = now + PREVIEW_TTL;
    this.previews.set(token, { id, expires, files: JSON.parse(row.files) });
    return { path: `/__preview/${token}/`, expiresAt: new Date(expires).toISOString() };
  }
  revokePreview(token) { this.previews.delete(token); }
  visitor(slug) {
    const row = this.db.prepare('SELECT published_files FROM ai_websites WHERE published_slug=? AND published_files IS NOT NULL').get(slug);
    return row ? JSON.parse(row.published_files) : null;
  }
  previewFiles(token) {
    const value = this.previews.get(token);
    if (!value || value.expires <= Date.now()) { this.previews.delete(token); return null; }
    return value.files;
  }
}

const CONTENT_POLICY = "default-src 'self' https: data: blob:; script-src 'self' 'unsafe-inline' 'unsafe-eval' https: blob:; style-src 'self' 'unsafe-inline' https:; connect-src 'self' https:; object-src 'none'; base-uri 'none'; frame-ancestors *; sandbox allow-scripts allow-forms allow-popups allow-downloads";
// Published sites use the visitor origin, which has no administration APIs.
// Normal origin behavior enables localStorage and browser modules. Draft previews
// remain opaque even when opened directly, so unreviewed code stays isolated.
const PUBLISHED_CONTENT_POLICY = `${CONTENT_POLICY} allow-same-origin`;
const LOOPBACKS = new Set(['127.0.0.1', 'localhost', '[::1]']);

export function createWebsiteServer({ websites, hostname = '127.0.0.1', allowedHost = () => false }) {
  const server = createServer((request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('Content-Security-Policy', CONTENT_POLICY);
    response.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    const fail = status => { response.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' }); response.end(request.method === 'HEAD' ? undefined : (status === 404 ? '网站或文件不存在。' : '请求无效。')); };
    try {
      const host = request.headers.host || '';
      if (!/^[A-Za-z0-9.:[\]-]+$/.test(host)) return fail(421);
      const receivedHost = new URL(`http://${host}`).hostname;
      if (!LOOPBACKS.has(receivedHost) && receivedHost !== hostname && !allowedHost(receivedHost)) return fail(421);
      if (!['GET', 'HEAD'].includes(request.method)) { response.setHeader('Allow', 'GET, HEAD'); return fail(405); }
      const rawPath = request.url?.split('?')[0];
      if (!rawPath?.startsWith('/') || rawPath.startsWith('//')) return fail(400);
      let decoded;
      try { decoded = decodeURIComponent(rawPath); } catch { return fail(400); }
      if (/[\\%#\u0000-\u001f\u007f]/.test(decoded) || /%2f/i.test(rawPath) || decoded.split('/').some(part => part.startsWith('.')) || decoded.includes('//')) return fail(400);
      if (decoded === '/_health') {
        response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        return response.end(request.method === 'HEAD' ? undefined : JSON.stringify({ status: 'ok', mode: 'websites' }));
      }
      const pieces = decoded.slice(1).split('/');
      let files, base, isPreview = false;
      if (pieces[0] === '__preview') {
        isPreview = true;
        if (!/^[a-f0-9]{64}$/.test(pieces[1] || '')) return fail(404);
        files = websites.previewFiles(pieces[1]);
        base = pieces.splice(0, 2).join('/');
      } else {
        if (!/^[a-z0-9](?:[a-z0-9-]{0,58}[a-z0-9])?$/.test(pieces[0])) return fail(404);
        base = pieces.shift();
        files = websites.visitor(base);
      }
      if (!files) return fail(404);
      if (decoded === `/${base}`) {
        response.writeHead(308, { Location: `/${base}/${request.url.includes('?') ? '?' + request.url.split('?').slice(1).join('?') : ''}` });
        return response.end();
      }
      let filename = pieces.join('/');
      if (!filename || filename.endsWith('/')) filename += 'index.html';
      const file = files.find(item => item.path === filename);
      if (!file) return fail(404);
      const content = Buffer.from(file.content, file.encoding);
      if (!isPreview) response.setHeader('Content-Security-Policy', PUBLISHED_CONTENT_POLICY);
      // The HTML sandbox gives documents an opaque origin. Public, anonymous
      // assets still need CORS for module scripts, font loads and fetch().
      response.writeHead(200, { 'Content-Type': TYPES.get(path.posix.extname(file.path).toLowerCase()), 'Content-Length': content.length,
        'Access-Control-Allow-Origin': '*', 'Cross-Origin-Resource-Policy': 'cross-origin' });
      response.end(request.method === 'HEAD' ? undefined : content);
    } catch {
      if (!response.headersSent) fail(503); else response.destroy();
    }
  });
  server.requestTimeout = 15_000;
  server.headersTimeout = 10_000;
  return server;
}
