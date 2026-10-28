import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';

const host = process.env.HOST ?? '127.0.0.1';
const portValue = process.env.PORT ?? '3000';
if (!host.trim() || !/^\d+$/.test(portValue) || Number(portValue) > 65535) {
  console.error('配置错误：HOST 不能为空；PORT 必须为 0–65535 的整数。');
  process.exit(1);
}

// 只暴露明确列出的资源，避免将源码或 .env 作为静态文件公开。
const assets = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/styles.css', ['styles.css', 'text/css; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
]);

const server = createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'no-store');
  const send = (status, contentType, body) => {
    res.writeHead(status, { 'Content-Type': contentType });
    res.end(req.method === 'HEAD' ? undefined : body);
  };
  const json = (status, body) => send(status, 'application/json; charset=utf-8', JSON.stringify(body));

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Allow', 'GET, HEAD');
    return json(405, { error: 'Method not allowed' });
  }
  let pathname;
  try {
    pathname = new URL(req.url, 'http://localhost').pathname;
  } catch {
    return json(400, { error: 'Bad request' });
  }
  if (pathname === '/api/health') return json(200, { status: 'ok', app: 'AI---WQS' });
  const asset = assets.get(pathname);
  if (!asset) return json(404, { error: 'Not found' });
  try {
    const body = await readFile(new URL(`../public/${asset[0]}`, import.meta.url));
    send(200, asset[1], body);
  } catch (error) {
    console.error('读取页面资源失败：', error.message);
    json(500, { error: 'Internal server error' });
  }
});

server.on('error', (error) => {
  console.error(`启动失败：${error.code ?? error.message}；请检查 HOST、PORT 或端口占用。`);
  process.exit(1);
});
server.listen(Number(portValue), host, () => {
  const address = server.address();
  const urlHost = address.address.includes(':') ? `[${address.address}]` : address.address;
  console.log(`AI---WQS running at http://${urlHost}:${address.port}`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 5000).unref();
  });
}
