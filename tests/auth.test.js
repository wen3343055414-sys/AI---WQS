import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomBytes, scryptSync, createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { WorkspaceStore } from "../src/store.js";
import { createInitialState } from "../public/core.js";

test("旧密码、会话和工作空间迁移为 admin，保留回退兼容", async t => {
  const directory = await mkdtemp(path.join(tmpdir(), "wqs-legacy-auth-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const password = "legacy-password-testing";
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  const token = randomBytes(32).toString("hex");
  const state = createInitialState();
  state.prompts[0].title = "原工作空间记录";
  const old = new DatabaseSync(path.join(directory, "workspace.sqlite"));
  old.exec([
    "CREATE TABLE owner (id INTEGER PRIMARY KEY CHECK(id=1),salt TEXT NOT NULL,hash TEXT NOT NULL);",
    "CREATE TABLE sessions (token_hash TEXT PRIMARY KEY,expires_at INTEGER NOT NULL);",
    "CREATE TABLE workspace (id INTEGER PRIMARY KEY CHECK(id=1),body TEXT NOT NULL,revision INTEGER NOT NULL,updated_at TEXT NOT NULL);"
  ].join("\n"));
  old.prepare("INSERT INTO owner VALUES (1,?,?)").run(salt, hash);
  old.prepare("INSERT INTO workspace VALUES (1,?,4,?)").run(JSON.stringify(state), new Date().toISOString());
  old.prepare("INSERT INTO sessions VALUES (?,?)").run(createHash("sha256").update(token).digest("hex"), Date.now() + 60000);
  old.close();

  let store = new WorkspaceStore(directory);
  assert.equal(store.legacyLoginHint(), "admin");
  const admin = store.authenticateUser("ADMIN", password);
  assert.ok(admin.legacy);
  assert.equal(store.sessionUser(token).id, admin.id);
  assert.equal(store.read().revision, 4);
  assert.equal(store.read().state.prompts[0].title, "原工作空间记录");
  state.prompts[0].title = "新界面保存的记录";
  store.save(state, 4, admin.id);
  assert.equal(JSON.parse(store.db.prepare("SELECT body FROM workspace WHERE id=1").get().body).prompts[0].title, "新界面保存的记录");
  store.close();

  const rollback = new DatabaseSync(path.join(directory, "workspace.sqlite"));
  state.prompts[0].title = "旧版本运行时新增记录";
  rollback.prepare("UPDATE workspace SET body=?,revision=6 WHERE id=1").run(JSON.stringify(state));
  rollback.close();
  store = new WorkspaceStore(directory);
  assert.equal(store.read().revision, 6);
  assert.equal(store.read().state.prompts[0].title, "旧版本运行时新增记录");
  const bob = store.register({ account: "Bob", email: "bob@example.test", password: "bob-password-testing" });
  assert.equal(bob.legacy, false);
  assert.notEqual(store.read(bob.id).state.prompts[0].title, "旧版本运行时新增记录");
  const session = store.createSession(bob.id);
  store.close();
  store = new WorkspaceStore(directory);
  assert.equal(store.sessionUser(session).account, "Bob");
  assert.equal(store.authenticateUser("BOB@EXAMPLE.TEST", "bob-password-testing", "email").id, bob.id);
  assert.throws(() => store.register({ account: "bob", email: "other@example.test", password: "bob-password-testing" }), error => error.status === 409);
  assert.throws(() => store.register({ account: "Other", email: "BOB@example.test", password: "bob-password-testing" }), error => error.status === 409);
  store.close();
});

test("账号注册、邮箱登录与工作空间隔离，拒绝过期页面跨账号写入", { timeout: 20000 }, async t => {
  const directory = await mkdtemp(path.join(tmpdir(), "wqs-account-api-"));
  const child = spawn(process.execPath, ["src/server.js"], { env: { ...process.env, HOST: "127.0.0.1", PORT: "0", DATA_DIR: directory }, stdio: ["ignore", "pipe", "pipe"] });
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) { const stopped = once(child, "exit"); child.kill(); await stopped; }
    await rm(directory, { recursive: true, force: true });
  });
  const base = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Startup timed out")), 5000);
    child.stdout.on("data", data => { const match = String(data).match(/http:\/\/127\.0\.0\.1:\d+/); if (match) { clearTimeout(timer); resolve(match[0]); } });
    child.once("error", reject);
    child.once("exit", code => { clearTimeout(timer); if (code) reject(new Error("Startup failed")); });
  });
  const api = (url, body, cookie, headers = {}) => fetch(base + url, { method: body === undefined ? "GET" : "POST", headers: { ...(body === undefined ? {} : { "Content-Type": "application/json" }), ...(cookie ? { Cookie: cookie } : {}), ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(5000) });
  const cookieOf = response => response.headers.get("set-cookie").split(";")[0];
  const aliceDetails = { account: "Alice", email: "alice@example.test", password: "alice-password-testing" };
  const registered = await api("/api/register", aliceDetails);
  assert.equal(registered.status, 201);
  const alice = (await registered.json()).user;
  const aliceCookie = cookieOf(registered);
  assert.equal(alice.account, "Alice");
  assert.equal(alice.legacy, true);
  assert.equal((await api("/api/register", { ...aliceDetails, account: "Alice2" })).status, 409);
  assert.equal((await api("/api/register", { ...aliceDetails, account: "Invalid Account", email: "invalid@example.test" })).status, 400);
  assert.equal((await api("/api/register", { account: "Short", email: "short@example.test", password: "short" })).status, 400);
  assert.equal((await api("/api/register", { ...aliceDetails, account: "Cross", email: "cross@example.test" }, undefined, { Origin: "https://example.invalid" })).status, 403);

  const accountLogin = await api("/api/login", { method: "account", account: "ALICE", password: aliceDetails.password });
  assert.equal(accountLogin.status, 200);
  const emailLogin = await api("/api/login", { method: "email", email: "ALICE@EXAMPLE.TEST", password: aliceDetails.password });
  assert.equal(emailLogin.status, 200);
  assert.equal((await emailLogin.json()).user.id, alice.id);
  assert.equal((await api("/api/login", { method: "email", password: aliceDetails.password })).status, 400);
  assert.equal((await api("/api/login", { method: "account", account: "someone-else", password: aliceDetails.password })).status, 401);

  const state = createInitialState();
  state.prompts[0].title = "Alice 私有内容";
  const save = (body, cookie) => fetch(base + "/api/workspace", { method: "PUT", headers: { "Content-Type": "application/json", Cookie: cookie }, body: JSON.stringify(body) });
  assert.equal((await save({ state, baseRevision: 0, userId: alice.id }, aliceCookie)).status, 200);
  const bobRegistration = await api("/api/register", { account: "Bob", email: "bob@example.test", password: "bob-password-testing" });
  assert.equal(bobRegistration.status, 201);
  const bob = (await bobRegistration.json()).user;
  const bobCookie = cookieOf(bobRegistration);
  const bobWorkspace = await (await api("/api/workspace", undefined, bobCookie)).json();
  assert.equal(bobWorkspace.userId, bob.id);
  assert.equal(bobWorkspace.revision, 0);
  assert.notEqual(bobWorkspace.state.prompts[0].title, "Alice 私有内容");
  assert.equal((await save({ state, baseRevision: 0, userId: alice.id }, bobCookie)).status, 401);
  assert.equal((await save({ state, baseRevision: 0 }, bobCookie)).status, 401);
  bobWorkspace.state.prompts[0].title = "Bob 的独立内容";
  assert.equal((await save({ state: bobWorkspace.state, baseRevision: 0, userId: bob.id }, bobCookie)).status, 200);
  assert.equal((await (await api("/api/workspace", undefined, aliceCookie)).json()).state.prompts[0].title, "Alice 私有内容");

  const sms = await api("/api/sms/send", { phone: "+8613800000000" });
  assert.equal(sms.status, 503);
  assert.equal(sms.headers.get("set-cookie"), null);
  assert.equal((await sms.json()).error, "sms_unavailable");
  assert.equal((await api("/api/login/sms", { phone: "+8613800000000", code: "123456" })).status, 503);
  const status = await (await api("/api/status")).json();
  assert.equal(status.authMethods.sms, false);
  assert.equal(status.user, null);
  await api("/api/logout", {}, bobCookie);
  assert.equal((await api("/api/workspace", undefined, bobCookie)).status, 401);
  assert.equal((await api("/api/workspace", undefined, aliceCookie)).status, 200);
});
