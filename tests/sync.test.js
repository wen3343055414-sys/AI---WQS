import test from "node:test";
import assert from "node:assert/strict";
import { WorkspaceSync } from "../public/sync.js";
import { createInitialState } from "../public/core.js";

function client() {
  const sync = Object.create(WorkspaceSync.prototype);
  Object.assign(sync, { authenticated: true, busy: false, revision: 3, sequence: 1, conflict: null, pending: createInitialState(), callbacks: {}, serverId: "test" });
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
