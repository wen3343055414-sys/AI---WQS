import test from "node:test";
import assert from "node:assert/strict";
import {
  STORAGE_KEY,
  createInitialState,
  readState,
  saveState,
  validateState,
  recordExchange,
  removeSession,
  searchWorkspace,
  markdown,
} from "../public/core.js";

const memory = () => {
  const entries = new Map();
  return {
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => entries.set(key, value),
  };
};

test("初始状态不冒充真实任务，各工作空间互不共享引用", () => {
  const one = createInitialState(),
    two = createInitialState();
  assert.ok(validateState(one));
  assert.equal(one.tasks.length, 0);
  assert.equal(one.sessions.length, 0);
  one.prompts[0].favorite = false;
  assert.equal(two.prompts[0].favorite, true);
});

test("多轮会话关联演示任务，删除会话时同步清理记录", () => {
  const state = createInitialState();
  const id = recordExchange(state, "", "写一份工作周报", "办公");
  assert.equal(recordExchange(state, id, "增加下周计划"), id);
  assert.equal(state.sessions.length, 1);
  assert.equal(state.sessions[0].messages.length, 4);
  assert.equal(state.tasks.length, 2);
  assert.ok(
    state.tasks.every((t) => t.sessionId === id && t.status === "demo"),
  );
  for (const m of state.sessions[0].messages.filter(
    (m) => m.role === "assistant",
  )) {
    assert.equal(m.demo, true);
    assert.match(m.content, /没有调用 AI/);
  }
  assert.ok(validateState(state));
  removeSession(state, id);
  assert.equal(state.sessions.length, 0);
  assert.equal(state.tasks.length, 0);
});

test("拒绝空白、超长输入和记录上限，保留已有状态", () => {
  const state = createInitialState();
  assert.throws(() => recordExchange(state, "", "   "));
  assert.throws(() => recordExchange(state, "", "x".repeat(20001)));
  assert.equal(state.sessions.length, 0);
  const id = recordExchange(state, "", "原始记录");
  const task = state.tasks[0];
  state.tasks = Array.from({ length: 1000 }, (_, i) => ({
    ...task,
    id: `task-${i}`,
  }));
  assert.throws(() => recordExchange(state, "", "新会话"));
  assert.throws(() => recordExchange(state, id, "继续"));
  assert.equal(state.sessions.length, 1);
  assert.equal(state.sessions[0].messages.length, 2);
});

test("持久化恢复和坏数据处理不静默覆盖原始记录", () => {
  const storage = memory(),
    state = createInitialState();
  recordExchange(state, "", "保存这次思考");
  saveState(storage, state);
  assert.deepEqual(readState(storage).state, state);
  storage.setItem(STORAGE_KEY, "{broken");
  assert.ok(readState(storage).warning);
  assert.equal(storage.getItem(STORAGE_KEY), "{broken");
  storage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      version: 1,
      settings: { theme: "light", model: "general" },
      prompts: [null],
      sessions: [],
      tasks: [],
      documents: [],
    }),
  );
  assert.ok(readState(storage).warning);
  assert.equal(
    validateState({
      ...state,
      settings: { theme: "light", model: "toString" },
    }),
    false,
  );
  const quota = {
    setItem() {
      throw new Error("quota");
    },
  };
  assert.throws(() => saveState(quota, state), /尚未保存/);
});

test("全局搜索覆盖模板、会话正文、知识正文与任务", () => {
  const state = createInitialState();
  recordExchange(state, "", "讨论火星基地", "资料讨论");
  state.documents.push({
    id: "doc-1",
    name: "研究笔记.md",
    kind: "text",
    content: "火星基地资料",
    tag: "研究",
    size: 20,
    createdAt: new Date().toISOString(),
  });
  assert.deepEqual(
    new Set(searchWorkspace(state, "火星").map((r) => r.kind)),
    new Set(["session", "document", "task"]),
  );
  assert.equal(searchWorkspace(state, "工作周报")[0].kind, "prompt");
  assert.equal(searchWorkspace(state, "   ").length, 0);
});

test("导入数据仅接受标准时间戳，拒绝可注入属性的日期字符串", () => {
  const state = createInitialState();
  recordExchange(state, "", "检查备份");
  assert.ok(validateState(state));
  state.sessions[0].messages[0].createdAt = '2026-10-28 (" onfocus="alert(1))';
  assert.equal(validateState(state), false);
  state.sessions[0].messages[0].createdAt = "2026-02-30T12:00:00.000Z";
  assert.equal(validateState(state), false);
});

test("Markdown 展示转义 HTML、属性与脚本协议", () => {
  const output = markdown(
    '### 标题\n**重点**\n<img src=x onerror="alert(1)">\n[jump](javascript:alert(1))\n```html\n<script>alert(1)</script>\n```',
  );
  assert.match(output, /<h3>标题<\/h3>/);
  assert.match(output, /<strong>重点<\/strong>/);
  assert.ok(!output.includes("<img"));
  assert.ok(!output.includes("<script>"));
  assert.ok(!output.includes("<a "));
  assert.match(output, /&lt;img/);
});
