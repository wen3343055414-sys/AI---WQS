import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import {
  BUILTIN_TOOLS, createInitialState, validateState, readState,
  saveTodo, setTodoDone, removeTodo, enabledToolIds, setToolEnabled,
  summarizeText, recordExchange, removeSession, searchWorkspace,
} from "../public/core.js";
import { WorkspaceStore } from "../src/store.js";

const now = "2026-11-15T02:00:00.000Z";

test("legacy workspaces remain readable and gain features without losing chat records", () => {
  const legacy = createInitialState();
  const sessionId = recordExchange(legacy, "", "保留原会话", "AI 对话", now);
  delete legacy.todos;
  delete legacy.settings.enabledTools;
  const original = JSON.stringify(legacy);
  const loaded = readState({ getItem: () => original });
  assert.equal(loaded.warning, "");
  assert.equal(JSON.stringify(loaded.state), original);
  assert.deepEqual(enabledToolIds(loaded.state), BUILTIN_TOOLS.map(tool => tool.id));
  const id = saveTodo(loaded.state, "", { title: "  检查发布  ", notes: "原任务备注", sourceSessionId: sessionId }, now);
  setToolEnabled(loaded.state, "text-stats", false);
  assert.ok(validateState(loaded.state));
  assert.equal(loaded.state.todos[0].title, "检查发布");
  assert.equal(loaded.state.sessions[0].id, sessionId);
  assert.equal(loaded.state.tasks.length, 1);
  assert.equal(searchWorkspace(loaded.state, "原任务备注")[0].kind, "todo");
  removeSession(loaded.state, sessionId);
  assert.equal(loaded.state.todos[0].id, id);
  assert.equal(loaded.state.todos[0].sourceSessionId, sessionId);
  assert.ok(validateState(loaded.state));
  const secondSession = recordExchange(loaded.state, "", "继续原功能");
  removeTodo(loaded.state, id);
  assert.equal(loaded.state.sessions[0].id, secondSession);
  assert.equal(loaded.state.tasks.length, 1);
});

test("task editing and completion keep identity and reject invalid writes atomically", () => {
  const state = createInitialState();
  const id = saveTodo(state, "", { title: "完成设计", notes: "", dueDate: "2028-02-29" }, now);
  setTodoDone(state, id, true, "2026-11-15T03:00:00.000Z");
  saveTodo(state, id, { title: "完成设计评审", notes: "补充备注" }, "2026-11-15T04:00:00.000Z");
  assert.equal(state.todos.length, 1);
  assert.equal(state.todos[0].createdAt, now);
  assert.equal(state.todos[0].done, true);
  assert.equal(state.todos[0].dueDate, "2028-02-29");
  assert.equal(state.todos[0].updatedAt, "2026-11-15T04:00:00.000Z");
  const before = JSON.stringify(state);
  for (const fields of [{ title: "  ", notes: "" }, { title: "x".repeat(101), notes: "" }, { title: "有效", notes: "x".repeat(2001) }]) {
    assert.throws(() => saveTodo(state, id, fields, now));
    assert.equal(JSON.stringify(state), before);
  }
  assert.throws(() => saveTodo(state, "missing", { title: "保留", notes: "" }, now));
  assert.throws(() => saveTodo(state, id, { title: "有效", dueDate: "2027-02-29" }, now), /截止日期/);
  assert.throws(() => saveTodo(state, "", { title: "有效", sourceSessionId: "missing" }, now), /原对话/);
  assert.throws(() => setTodoDone(state, id, "true", now));
  assert.throws(() => setTodoDone(state, id, false, "bad-date"));
  assert.throws(() => setToolEnabled(state, "unavailable", true));
  assert.equal(JSON.stringify(state), before);
  setTodoDone(state, id, false, now);
  assert.equal(state.todos[0].done, false);
  saveTodo(state, id, { title: "完成设计评审", notes: "", dueDate: "" }, now);
  assert.equal(Object.hasOwn(state.todos[0], "dueDate"), false);
});

test("workspace validation rejects malformed or oversized optional features", () => {
  const base = createInitialState();
  saveTodo(base, "", { title: "检查格式", notes: "保留正文" }, now);
  for (const change of [
    value => { value.todos = null; },
    value => { value.todos[0].title = " "; },
    value => { value.todos[0].title = "x".repeat(101); },
    value => { value.todos[0].notes = "x".repeat(2001); },
    value => { value.todos[0].done = "yes"; },
    value => { value.todos[0].dueDate = "2026-11-31"; },
    value => { value.todos[0].dueDate = "2026-11-15T00:00:00.000Z"; },
    value => { value.todos[0].sourceSessionId = "#other"; },
    value => { value.todos[0].updatedAt = '2026-11-15" onfocus="x'; },
    value => { value.todos.push({ ...value.todos[0] }); },
    value => { value.todos = Array.from({ length: 1001 }, (_, i) => ({ ...value.todos[0], id: "todo-" + i })); },
    value => { value.settings.enabledTools = ["text-stats", "text-stats"]; },
    value => { value.settings.enabledTools = ["execute-script"]; },
    value => { value.settings.enabledTools = {}; },
  ]) {
    const value = structuredClone(base);
    change(value);
    assert.equal(validateState(value), false);
  }
  const full = structuredClone(base);
  full.todos = Array.from({ length: 1000 }, (_, i) => ({ ...full.todos[0], id: "todo-" + i }));
  assert.ok(validateState(full));
  assert.throws(() => saveTodo(full, "", { title: "超过容量", notes: "" }, now), /上限/);
  assert.equal(full.todos.length, 1000);
});

test("task lists and tool preferences survive SQLite reopen with account and revision isolation", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "wqs-features-"));
  let store;
  try {
    store = new WorkspaceStore(directory);
    const owner = store.setup(randomBytes(18).toString("hex"));
    const bob = store.register({ account: "feature_bob", email: "feature_bob@example.test", password: randomBytes(18).toString("hex") });
    const old = store.read(owner.id);
    delete old.state.todos;
    delete old.state.settings.enabledTools;
    store.save(old.state, old.revision, owner.id);
    store.close();
    store = new WorkspaceStore(directory);
    const next = store.read(owner.id);
    assert.equal(next.state.todos, undefined);
    assert.ok(validateState(next.state));
    const source = recordExchange(next.state, "", "检查发布准备", "AI 对话", now);
    const id = saveTodo(next.state, "", {
      title: "当前账号的任务", notes: "独立保存", dueDate: "2026-11-16", sourceSessionId: source,
    }, now);
    setTodoDone(next.state, id, true, now);
    setToolEnabled(next.state, "text-stats", false);
    store.save(next.state, next.revision, owner.id);
    assert.throws(() => store.save(old.state, old.revision, owner.id), error => error.status === 409);
    const other = store.read(bob.id);
    assert.equal(other.state.todos.length, 0);
    assert.ok(enabledToolIds(other.state).includes("text-stats"));
    saveTodo(other.state, "", { title: "另一个账号的任务", notes: "" }, now);
    store.save(other.state, other.revision, bob.id);
    store.close();
    store = new WorkspaceStore(directory);
    const restored = store.read(owner.id).state;
    assert.equal(restored.todos.length, 1);
    assert.equal(restored.todos[0].id, id);
    assert.equal(restored.todos[0].done, true);
    assert.equal(restored.todos[0].dueDate, "2026-11-16");
    assert.equal(restored.todos[0].sourceSessionId, source);
    assert.ok(!enabledToolIds(restored).includes("text-stats"));
    assert.equal(store.read(bob.id).state.todos[0].title, "另一个账号的任务");
    assert.ok(validateState(JSON.parse(JSON.stringify(restored))));
    assert.equal(readState({ getItem: () => JSON.stringify(restored) }).warning, "");
  } finally {
    store?.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("text statistics handle Unicode and Windows newlines without treating each line as a paragraph", () => {
  assert.deepEqual(summarizeText(""), { characters: 0, nonWhitespace: 0, lines: 0, paragraphs: 0 });
  assert.deepEqual(summarizeText("A🙂 中\n\n第二行"), { characters: 9, nonWhitespace: 6, lines: 3, paragraphs: 2 });
  assert.deepEqual(summarizeText("甲\r\n乙"), { characters: 4, nonWhitespace: 2, lines: 2, paragraphs: 1 });
  assert.equal(summarizeText("甲\r\n \r\n乙").paragraphs, 2);
  assert.equal(summarizeText(" \n \n ").paragraphs, 0);
});
