import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";

test(
  "真实进程启动、页面资源、健康接口与路由边界",
  { timeout: 15000 },
  async (t) => {
    const child = spawn(
      process.execPath,
      ["--env-file=.env.example", "src/server.js"],
      {
        cwd: fileURLToPath(new URL("..", import.meta.url)),
        env: { ...process.env, HOST: "127.0.0.1", PORT: "0" },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    t.after(async () => {
      if (child.exitCode !== null || child.signalCode !== null) return;
      const closed = once(child, "close");
      child.kill();
      await closed;
    });
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    const base = await new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`启动超时：${stderr}`)),
        5000,
      );
      let stdout = "";
      child.stdout.on("data", (chunk) => {
        stdout += chunk;
        const match = stdout.match(/http:\/\/127\.0\.0\.1:\d+/);
        if (match) {
          clearTimeout(timer);
          resolve(match[0]);
        }
      });
      child.once("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.once("exit", (code) => {
        clearTimeout(timer);
        reject(new Error(`进程退出 ${code}：${stderr}`));
      });
    });
    const get = (path, options = {}) =>
      fetch(`${base}${path}`, {
        signal: AbortSignal.timeout(3000),
        ...options,
      });
    const home = await get("/");
    assert.equal(home.status, 200);
    assert.match(home.headers.get("content-type"), /text\/html/);
    assert.match(await home.text(), /AI 大模型工作台/);
    for (const [path, type] of [
      ["/styles.css", "text/css"],
      ["/app.js", "text/javascript"],
      ["/core.js", "text/javascript"],
      ["/favicon.svg", "image/svg+xml"],
    ]) {
      const response = await get(path);
      assert.equal(response.status, 200);
      assert.ok(response.headers.get("content-type").startsWith(type));
      assert.ok((await response.text()).length > 0);
    }
    const health = await get("/api/health");
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), { status: "ok", app: "AI---WQS" });
    for (const path of [
      "/missing",
      "/.env",
      "/src/server.js",
      "/%2e%2e/.env",
      "/AGENTS.md",
      "/package.json",
      "/.git/config",
      "/tests/smoke.test.js",
    ]) {
      assert.equal((await get(path)).status, 404);
    }
    const post = await get("/api/health", { method: "POST" });
    assert.equal(post.status, 405);
    assert.equal(post.headers.get("allow"), "GET, HEAD");
    assert.equal(await (await get("/", { method: "HEAD" })).text(), "");
  },
);
