import test from "node:test";
import assert from "node:assert/strict";
import { WorkspaceSync } from "../public/sync.js";
import { createInitialState } from "../public/core.js";

function client() {
  const sync = Object.create(WorkspaceSync.prototype);
  Object.assign(sync, { authenticated: true, mode: "server", authCycle: 0, busy: false, revision: 3, sequence: 1, conflict: null, pending: createInitialState(), callbacks: {}, serverId: "test" });
  sync.status = () => {};
  sync.cachePending = () => {};
  return sync;
}

test("保存期间继续编辑时，下一次保存使用新的服务器修订号", async t => {
  const sync = client();
  t.after(() => clearTimeout(sync.flushTimer));
  let finish;
  let sent;
  sync.request = async (_, options) => { sent = JSON.parse(options.body); return new Promise(resolve => { finish = resolve; }); };
  const first = sync.flush();
  assert.equal(sent.baseRevision, 3);
  const latest = createInitialState(); latest.prompts[0].title = "继续编辑后的版本";
  sync.pending = latest; sync.sequence++;
  finish({ revision: 4 }); await first;
  assert.equal(sync.revision, 4);
  assert.equal(sync.pending.prompts[0].title, "继续编辑后的版本");
  sync.request = async (_, options) => { sent = JSON.parse(options.body); return { revision: 5 }; };
  const original = globalThis.localStorage;
  globalThis.localStorage = { removeItem() {} };
  try { await sync.flush(); } finally { globalThis.localStorage = original; }
  assert.equal(sent.baseRevision, 4);
  assert.equal(sync.pending, null);
  assert.equal(sync.revision, 5);
});

test("冲突时保留当前内容并停止自动覆盖", async () => {
  const sync = client();
  const before = structuredClone(sync.pending);
  sync.request = async () => { const error = new Error("conflict"); error.status = 409; error.body = { revision: 4, state: createInitialState() }; throw error; };
  await sync.flush();
  assert.deepEqual(sync.pending, before);
  assert.equal(sync.conflict.revision, 4);
  assert.equal(sync.flushTimer, undefined);
});


test("待发送缓存按账号隔离，保存请求携带账号绑定", async t => {
  const alice = client(), bob = client();
  alice.user = { id: 1 }; bob.user = { id: 2 };
  assert.notEqual(alice.pendingKey, bob.pendingKey);
  let body;
  alice.request = async (_, options) => { body = JSON.parse(options.body); return { revision: 4 }; };
  t.after(() => clearTimeout(alice.flushTimer));
  const original = globalThis.localStorage;
  globalThis.localStorage = { removeItem() {} };
  try { await alice.flush(); } finally { globalThis.localStorage = original; }
  assert.equal(body.userId, 1);
});

test("账号管理不会丢弃未同步修改或提前退出当前会话", async () => {
  const sync = client();
  const pending = sync.pending;
  const notices = [];
  let calls = 0;
  sync.callbacks.onNotice = message => notices.push(message);
  sync.request = async () => { calls++; return {}; };
  sync.auth = { open() { calls++; } };
  await sync.addAccount();
  await sync.logout();
  assert.equal(calls, 0);
  assert.equal(sync.authenticated, true);
  assert.equal(sync.pending, pending);
  assert.equal(notices.length, 2);
  assert.ok(notices.every(message => message.includes("未同步")));
});

test("退出请求失败时保留当前账号并恢复同步", async t => {
  const sync = client();
  sync.pending = null;
  sync.user = { id: 1, account: "fixture-owner" };
  sync.request = async () => { throw new Error("offline"); };
  t.after(() => clearInterval(sync.timer));
  await assert.rejects(sync.logout(), /offline/);
  assert.equal(sync.authenticated, true);
  assert.equal(sync.user.account, "fixture-owner");
  assert.equal(sync.accountActionBusy, false);
  assert.ok(sync.timer);
});
