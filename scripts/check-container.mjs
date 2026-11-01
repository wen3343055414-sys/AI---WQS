import assert from "node:assert/strict";

const base = process.argv[2] || "http://127.0.0.1:3000";
const get = (path, options = {}) =>
  fetch(`${base}${path}`, {
    signal: AbortSignal.timeout(5000),
    ...options,
  });

try {
  const health = await get("/api/health");
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), { status: "ok", app: "AI---WQS" });

  const home = await get("/");
  assert.equal(home.status, 200);
  assert.match(home.headers.get("content-type"), /text\/html/);
  assert.match(await home.text(), /AI 大模型工作台/);

  for (const [path, mime] of [
    ["/app.js", "text/javascript"],
    ["/core.js", "text/javascript"],
    ["/styles.css", "text/css"],
    ["/favicon.svg", "image/svg+xml"],
  ]) {
    const asset = await get(path);
    assert.equal(asset.status, 200, path);
    assert.ok(asset.headers.get("content-type").startsWith(mime), path);
    assert.ok((await asset.text()).length > 0, path);
  }

  for (const path of ["/.env", "/.git/config", "/src/server.js", "/package.json"]) {
    assert.equal((await get(path)).status, 404, path);
  }
  const head = await get("/", { method: "HEAD" });
  assert.equal(head.status, 200);
  assert.equal(await head.text(), "");
  assert.equal((await get("/api/health", { method: "POST" })).status, 405);
  console.log(`容器 HTTP 验收通过：${base}`);
} catch (error) {
  console.error(`容器 HTTP 验收失败：${error.message}`);
  process.exitCode = 1;
}
