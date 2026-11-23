import https from 'node:https';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { createGunzip, createBrotliDecompress } from 'node:zlib';
import { HttpError } from './store.js';
import { publicAddress } from './plugin-network.js';

export const INTEL_FEEDS = [
  { id: 'codex', name: 'OpenAI Codex', topic: 'technology', tier: 'official', region: '全球', url: 'https://github.com/openai/codex/releases.atom' },
  { id: 'ollama', name: 'Ollama', topic: 'technology', tier: 'official', region: '全球', url: 'https://github.com/ollama/ollama/releases.atom' },
  { id: 'hacker-news', name: 'Hacker News', topic: 'technology', tier: 'community', region: '全球', url: 'https://news.ycombinator.com/rss' },
  { id: 'arxiv', name: 'arXiv · AI', topic: 'research', tier: 'research', region: '全球', url: 'https://rss.arxiv.org/rss/cs.AI' },
  { id: 'product-hunt', name: 'Product Hunt', topic: 'research', tier: 'community', region: '全球', url: 'https://www.producthunt.com/feed' },
  { id: 'gov-cn', name: '中国政府网', topic: 'policy', tier: 'official', region: '中国', url: 'https://www.gov.cn/rss/zhengce.xml' },
  { id: 'un-news', name: '联合国新闻', topic: 'world', tier: 'official', region: '全球', url: 'https://news.un.org/feed/subscribe/zh/news/all/rss.xml' },
  { id: 'bbc', name: 'BBC World', topic: 'world', tier: 'media', region: '全球', url: 'https://feeds.bbci.co.uk/news/world/rss.xml' },
  { id: 'federal-reserve', name: '美国联邦储备委员会', topic: 'markets', tier: 'official', region: '美国', url: 'https://www.federalreserve.gov/feeds/press_all.xml' },
  { id: 'ecb', name: '欧洲中央银行', topic: 'markets', tier: 'official', region: '欧洲', url: 'https://www.ecb.europa.eu/rss/press.html' },
];

const maxBytes = 2_000_000;
const timeout = 9000;
const curatedAgent = new https.Agent({ proxyEnv: process.env });
const fault = (code, message, status = 502, extra) => new HttpError(status, code, message, extra);
export function feedUrl(value) {
  let url;
  try { if (typeof value === 'string' && value.length <= 1800) url = new URL(value.trim()); } catch { /* Handled below. */ }
  if (!url || url.protocol !== 'https:' || url.port || url.username || url.password || url.hash ||
    !url.hostname.includes('.') || isIP(url.hostname) && !publicAddress(url.hostname) ||
    [...url.searchParams.keys()].some(key => /token|secret|signature|authorization|api.?key|^key$|^auth$|password/i.test(key)))
    throw fault('intel_feed_url', '请输入公开的 HTTPS RSS 或 Atom 地址。', 400);
  return url;
}
export function articleUrl(value, base) {
  try {
    const url = new URL(value.trim(), base);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || !url.hostname.includes('.')) return '';
    url.hash = '';
    for (const key of [...url.searchParams.keys()]) if (/^(utm_|fbclid$|gclid$|mc_cid$|mc_eid$)/i.test(key)) url.searchParams.delete(key);
    url.searchParams.sort();
    return url.href.length <= 2000 ? url.href : '';
  } catch { return ''; }
}
const entities = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
function decodeEntities(value) {
  return value.replace(/&(#x[\da-f]{1,8}|#\d{1,8}|[a-z]{2,8});/gi, (raw, entity) => {
    if (entity[0] !== '#') return entities[entity.toLowerCase()] || raw;
    const point = /^#x/i.test(entity) ? parseInt(entity.slice(2), 16) : Number(entity.slice(1));
    return point > 0 && point <= 0x10ffff && !(point >= 0xd800 && point <= 0xdfff) ? String.fromCodePoint(point) : '';
  });
}
function field(block, tags) {
  for (const tag of tags) {
    const start = new RegExp(`<${tag}(?:\\s[^<>]{0,1800})?>`, 'i').exec(block);
    if (!start) continue;
    const end = new RegExp(`</${tag}\\s*>`, 'gi');
    const offset = start.index + start[0].length;
    end.lastIndex = offset;
    const stop = end.exec(block);
    if (stop) {
      const value = block.slice(offset, stop.index);
      if (value.trim()) return value;
    }
  }
  return '';
}
function plainText(value, max) {
  return decodeEntities(decodeEntities(value).replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<!--[\s\S]*?-->|<[^>]{1,2500}>/g, ' '))
    .replace(/[\u0000-\u001f\u007f-\u009f\s]+/g, ' ').trim().slice(0, max);
}
function entryLink(block, base) {
  const rss = field(block, ['link']);
  if (rss) return articleUrl(decodeEntities(rss), base);
  for (const link of block.matchAll(/<link\s+([^<>]{1,2400})>/gi)) {
    const attrs = Object.fromEntries([...link[1].matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)].map(match => [match[1].toLowerCase(), match[2] ?? match[3]]));
    if (attrs.href && (!attrs.rel || attrs.rel === 'alternate')) return articleUrl(decodeEntities(attrs.href), base);
  }
  const guid = decodeEntities(field(block, ['guid', 'id'])).trim();
  return /^https?:\/\//i.test(guid) ? articleUrl(guid, base) : '';
}
export function parseFeed(xml, base, now = Date.now()) {
  // Isolate CDATA from XML delimiters and never resolve entities or fetch external DTDs.
  const text = xml.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, (_, inner) => inner.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'))
    .replace(/<!--[\s\S]*?-->/g, '');
  const root = text.match(/<(?!\?)([\w:.-]+)(?=[\s>])/)?.[1].split(':').at(-1).toLowerCase();
  if (!['rss', 'feed', 'rdf'].includes(root) || /<!\s*(?:DOCTYPE|ENTITY)\b/i.test(text))
    throw fault('intel_feed_format', '此地址未返回有效的 RSS 或 Atom。');
  const stories = new Map();
  let start = null;
  for (const match of text.matchAll(/<(\/?)(item|entry)(?:\s[^<>]{0,2000})?>/gi)) {
    const type = match[2].toLowerCase();
    if (!match[1]) { start = { type, offset: match.index + match[0].length }; continue; }
    if (type !== start?.type) continue;
    const block = text.slice(start.offset, match.index);
    start = null;
    const url = entryLink(block, base);
    const title = plainText(field(block, ['title']), 280);
    if (!url || !title || stories.has(url)) continue;
    const summary = plainText(field(block, ['summary', 'description', 'content:encoded', 'content']), 700);
    const date = Date.parse(plainText(field(block, ['pubDate', 'published', 'dc:date', 'updated']), 100));
    const published = Number.isFinite(date) && date > 0 && date <= now + 86_400_000 ? date : null;
    stories.set(url, { url, title, summary, published });
    if (stories.size === 45) break;
  }
  return [...stories.values()];
}
function readResponse(url, { signal, headers, agent, destination }) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, {
      signal, headers, agent,
      ...(destination ? { family: destination.family, lookup: (_host, options, callback) =>
        options.all ? callback(null, [destination]) : callback(null, destination.address, destination.family) } : {}),
    }, response => {
      const { statusCode: status, headers } = response;
      if (status !== 200) { response.destroy(); resolve({ status, headers }); return; }
      if (Number(headers['content-length']) > maxBytes) {
        response.destroy(); reject(fault('intel_feed_large', '信源响应过大。')); return;
      }
      const encoding = headers['content-encoding'];
      const decoder = encoding === 'gzip' ? createGunzip() : encoding === 'br' ? createBrotliDecompress() : null;
      let wireBytes = 0;
      let bytes = 0;
      const chunks = [];
      const fail = failure => { response.destroy(); decoder?.destroy(); reject(failure); };
      response.on('error', fail);
      response.on('aborted', () => fail(fault('intel_feed_network', '信源连接已中断。')));
      if (decoder) response.on('data', chunk => {
        wireBytes += chunk.length;
        if (wireBytes > maxBytes) fail(fault('intel_feed_large', '信源响应过大。'));
      });
      const stream = decoder ? response.pipe(decoder) : response;
      if (decoder) decoder.on('error', fail);
      stream.on('data', chunk => {
        bytes += chunk.length;
        if (bytes > maxBytes) fail(fault('intel_feed_large', '信源响应过大。'));
        else chunks.push(chunk);
      });
      stream.on('end', () => resolve({ status, headers, body: Buffer.concat(chunks) }));
    });
    request.on('error', reject);
  });
}
function decodeFeed(bytes, type) {
  const label = (String(type || '').match(/charset\s*=\s*["']?([\w-]+)/i) || bytes.subarray(0, 160).toString('ascii').match(/encoding\s*=\s*['"]([\w-]+)['"]/i))?.[1];
  try { return new TextDecoder(label || 'utf-8').decode(bytes); }
  catch { throw fault('intel_feed_format', '信源使用了无法读取的文本编码。'); }
}
export async function requestFeed(value, { etag, modified, curated = false, resolver = lookup, now = Date.now() } = {}) {
  const original = feedUrl(value);
  const signal = AbortSignal.timeout(timeout);
  let url = original;
  const headers = { 'User-Agent': 'ZhiZuoTai-Feed/1.0', Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*;q=0.1' };
  if (etag) headers['If-None-Match'] = etag;
  if (modified) headers['If-Modified-Since'] = modified;
  try {
    for (let hop = 0; hop < 4; hop++) {
      let destination;
      if (!curated) {
        const ordered = await Promise.race([
          resolver(url.hostname, { all: true }),
          new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true })),
        ]);
        signal.throwIfAborted();
        const permitted = ordered.filter(entry => isIP(entry.address) === entry.family && publicAddress(entry.address));
        destination = permitted.find(entry => entry.family === 4) || permitted[0];
        if (!destination) throw fault('intel_feed_address', '信源地址必须指向公网。', 400);
      }
      const response = await readResponse(url, { signal, headers, destination, agent: curated ? curatedAgent : false });
      if (response.status === 304) return { unchanged: true };
      if ([301, 302, 303, 307, 308].includes(response.status) && response.headers.location) {
        const redirected = feedUrl(new URL(response.headers.location, url).href);
        if (curated && redirected.hostname !== original.hostname)
          throw fault('intel_feed_redirect', '信源已跳转到其他站点，请使用新的订阅地址。');
        url = redirected;
        delete headers['If-None-Match'];
        delete headers['If-Modified-Since'];
        continue;
      }
      if (response.status !== 200) {
        const retry = response.headers['retry-after'];
        const retryMs = /^\d+$/.test(retry || '') ? Number(retry) * 1000 : Date.parse(retry) - now;
        throw fault('intel_feed_http', `信源返回 HTTP ${response.status}。`, 502,
          { retryMs: Number.isFinite(retryMs) ? Math.max(0, Math.min(86_400_000, retryMs)) : 0 });
      }
      return { stories: parseFeed(decodeFeed(response.body, response.headers['content-type']), url, now),
        etag: String(response.headers.etag || '').slice(0, 512), modified: String(response.headers['last-modified'] || '').slice(0, 100) };
    }
    throw fault('intel_feed_redirect', '信源重定向次数过多。');
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw fault('intel_feed_network', signal.aborted ? '信源连接超时。' : '暂时无法连接信源。');
  }
}
