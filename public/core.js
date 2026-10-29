export const STORAGE_KEY = "zhizuotai.workspace.v1";
export const CATEGORIES = ["写作", "营销", "编程", "办公", "学习"];
export const MODELS = {
  general: "通用助手",
  writing: "写作助手",
  coding: "编程助手",
};
export const MAX_FILE_SIZE = 1024 * 1024;
export const MAX_DOCUMENT_CHARS = 1_500_000;
export const STARTERS = [
  {
    id: "writing",
    title: "写文案",
    icon: "pen",
    tone: "purple",
    subtitle: "让灵感，落笔成文",
    text: "请帮我写一份文案。\n主题：\n目标读者：\n发布平台：\n希望传达的重点：",
  },
  {
    id: "summary",
    title: "总结文档",
    icon: "file",
    tone: "blue",
    subtitle: "提炼重点，一目了然",
    text: "请总结以下内容，提炼核心观点、关键数据与待办事项。\n\n待总结内容：",
  },
  {
    id: "translate",
    title: "翻译润色",
    icon: "languages",
    tone: "orange",
    subtitle: "表达准确，更进一步",
    text: "请翻译并润色以下内容，保持原意，让表达自然流畅。\n目标语言：\n使用场景：\n\n原文：",
  },
  {
    id: "data",
    title: "分析数据",
    icon: "chart",
    tone: "green",
    subtitle: "从数字中，发现线索",
    text: "请分析以下数据，说明主要趋势、异常值和可行动的建议。不要编造缺失数据。\n\n数据与背景：",
  },
  {
    id: "ideas",
    title: "头脑风暴",
    icon: "bulb",
    tone: "pink",
    subtitle: "给好想法，多一种可能",
    text: "请围绕以下主题提出 5 个不同方向的创意，并说明各自的适用场景和下一步。\n\n主题与限制条件：",
  },
];
const prompts = [
  {
    id: "prompt-weekly",
    title: "一份清晰的工作周报",
    category: "办公",
    icon: "briefcase",
    description: "把零散的工作记录，整理成有重点、有进展的周报。",
    content:
      "你是一位善于梳理信息的工作助理。请根据我的工作记录，整理一份简洁的周报。\n\n请分为：本周完成、关键成果、遇到的问题、下周计划。保留具体数据，不要编造工作成果；信息不足时指出需要补充的内容。\n\n我的工作记录：",
    favorite: true,
  },
  {
    id: "prompt-copy",
    title: "让产品文案更有吸引力",
    category: "营销",
    icon: "megaphone",
    description: "找到用户关心的价值，写出自然、有说服力的产品介绍。",
    content:
      "你是一位产品文案编辑。请为以下产品写 3 个不同角度的介绍，分别突出使用场景、用户收益和独特价值。避免夸大承诺与空泛形容词。\n\n产品：\n目标用户：\n主要功能：\n语气与字数：",
    favorite: true,
  },
  {
    id: "prompt-learn",
    title: "把复杂概念讲明白",
    category: "学习",
    icon: "book",
    description: "从一个生活中的例子开始，循序渐进理解新知识。",
    content:
      "请像一位耐心的老师，解释下面的概念。先用一句话概括，再给出一个生活中的类比，最后说明原理、常见误区和一个练习题。根据我的基础调整深度。\n\n概念：\n我的基础：",
    favorite: true,
  },
  {
    id: "prompt-article",
    title: "从想法到文章大纲",
    category: "写作",
    icon: "pen",
    description: "理顺文章结构，找到一个值得展开的切入点。",
    content:
      "请帮我把以下想法整理成文章大纲。先明确目标读者和核心论点，再给出标题建议、开头、3–5 个主要段落和结尾。列出需要查证的事实，不要编造引用。\n\n想法：\n目标读者：\n预计字数：",
    favorite: false,
  },
  {
    id: "prompt-code",
    title: "代码审查好搭档",
    category: "编程",
    icon: "code",
    description: "关注正确性、可维护性与边界情况，给出具体修改建议。",
    content:
      "请审查下面的代码，按严重程度列出可能影响正确性、安全性和可维护性的问题。给出问题位置、触发条件和最小修改建议。若无法确认，请明确说明。\n\n运行环境：\n预期行为：\n代码：",
    favorite: false,
  },
  {
    id: "prompt-meeting",
    title: "会议纪要与行动清单",
    category: "办公",
    icon: "list",
    description: "记录关键决策，把讨论整理成可执行的下一步。",
    content:
      "请整理以下会议记录，输出会议主题、关键讨论、已确认决策和行动清单。行动清单包含任务、负责人和截止时间；未提及的信息标注为待确认，不要推测。\n\n会议记录：",
    favorite: false,
  },
];
export const uid = (prefix = "item") =>
  `${prefix}-${globalThis.crypto.randomUUID()}`;
export function createInitialState() {
  return {
    version: 1,
    prompts: structuredClone(prompts),
    sessions: [],
    documents: [],
    tasks: [],
    settings: { theme: "light", model: "general" },
  };
}
const isText = (v, max = 50_000) => typeof v === "string" && v.length <= max;
const isTime = (v) =>
  isText(v, 24) &&
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(v) &&
  Number.isFinite(Date.parse(v)) &&
  new Date(v).toISOString() === v;
const isId = (v) => typeof v === "string" && /^[a-zA-Z0-9_-]{1,100}$/.test(v);
const uniqueIds = (items) =>
  items.every((item) => item && typeof item === "object") &&
  new Set(items.map((item) => item.id)).size === items.length;
export function validateState(value) {
  if (!value || value.version !== 1 || !value.settings) return false;
  if (
    !["light", "dark", "system"].includes(value.settings.theme) ||
    !Object.hasOwn(MODELS, value.settings.model)
  )
    return false;
  if (
    !["prompts", "sessions", "documents", "tasks"].every(
      (k) =>
        Array.isArray(value[k]) &&
        value[k].length <= 1000 &&
        uniqueIds(value[k]),
    )
  )
    return false;
  if (
    !value.prompts.every(
      (p) =>
        isId(p.id) &&
        isText(p.title, 80) &&
        isText(p.description, 200) &&
        isText(p.content, 20_000) &&
        CATEGORIES.includes(p.category) &&
        typeof p.favorite === "boolean",
    )
  )
    return false;
  if (
    !value.sessions.every(
      (s) =>
        isId(s.id) &&
        isText(s.title, 80) &&
        isTime(s.createdAt) &&
        isTime(s.updatedAt) &&
        Array.isArray(s.messages) &&
        s.messages.length <= 2000 &&
        uniqueIds(s.messages) &&
        s.messages.every(
          (m) =>
            isId(m.id) &&
            ["user", "assistant"].includes(m.role) &&
            isText(m.content) &&
            isTime(m.createdAt) &&
            (m.role !== "assistant" || m.demo === true),
        ),
    )
  )
    return false;
  if (
    !value.documents.every(
      (d) =>
        isId(d.id) &&
        isText(d.name, 300) &&
        isText(d.tag, 30) &&
        isTime(d.createdAt) &&
        Number.isFinite(d.size) &&
        d.size >= 0 &&
        d.size <= MAX_FILE_SIZE &&
        ["text", "metadata"].includes(d.kind) &&
        isText(d.content, MAX_FILE_SIZE),
    )
  )
    return false;
  if (
    value.documents.reduce((n, d) => n + d.content.length, 0) >
    MAX_DOCUMENT_CHARS
  )
    return false;
  if (
    !value.tasks.every(
      (t) =>
        isId(t.id) &&
        isText(t.title, 100) &&
        isText(t.type, 30) &&
        t.status === "demo" &&
        isTime(t.createdAt) &&
        isId(t.sessionId),
    )
  )
    return false;
  return true;
}
export function readState(storage) {
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return { state: createInitialState(), warning: "" };
    const parsed = JSON.parse(raw);
    if (validateState(parsed)) return { state: parsed, warning: "" };
    return {
      state: createInitialState(),
      warning: "本地数据格式异常，已加载初始界面。旧数据未被自动覆盖。",
    };
  } catch {
    return {
      state: createInitialState(),
      warning: "无法读取本地数据，本次可继续使用；请检查浏览器的存储权限。",
    };
  }
}
export function saveState(storage, state) {
  if (!validateState(state))
    throw new Error("数据不符合保存格式，请减少内容后重试。");
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    throw new Error(
      "本地存储已满或不可用，修改尚未保存。请导出数据或减少资料后重试。",
    );
  }
}
export function escapeHtml(value) {
  return String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
}
// HTML, images and links stay plain text. Only a safe Markdown subset is rendered.
export function markdown(text) {
  let fenced = false,
    output = "";
  for (const line of String(text).split("\n")) {
    if (/^```/.test(line)) {
      output += fenced ? "</code></pre>" : "<pre><code>";
      fenced = !fenced;
      continue;
    }
    const safe = escapeHtml(line);
    if (fenced) {
      output += `${safe}\n`;
      continue;
    }
    const inline = safe
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/`([^`]+)`/g, "<code>$1</code>");
    if (/^###? /.test(line))
      output += `<h3>${inline.replace(/^###? /, "")}</h3>`;
    else if (/^[-*] /.test(line))
      output += `<p class="md-list">${inline.slice(2)}</p>`;
    else output += line ? `<p>${inline}</p>` : '<div class="md-space"></div>';
  }
  return output + (fenced ? "</code></pre>" : "");
}
export function demoReply() {
  return "### 这是一条演示消息\n尚未连接模型服务，**没有调用 AI，也没有生成真实答案**。你的输入已保留在此会话中。\n\n你可以先检查提示词是否包含：\n- 明确的目标：希望解决什么问题？\n- 必要的背景：读者、场景和已知信息。\n- 输出要求：结构、语气、字数和限制。\n\n需要保留这次思路时，可以复制消息或导出会话。";
}
export function recordExchange(
  state,
  sessionId,
  content,
  type = "AI 对话",
  now = new Date().toISOString(),
) {
  const text = content.trim();
  if (!text || text.length > 20_000)
    throw new Error("请输入 1–20,000 个字符。");
  let session = state.sessions.find((s) => s.id === sessionId);
  if (
    state.tasks.length >= 1000 ||
    (!session && state.sessions.length >= 1000) ||
    (session && session.messages.length > 1998)
  )
    throw new Error("记录数量已达上限，请先导出并删除部分历史。");
  if (!session) {
    session = {
      id: uid("session"),
      title: text.replace(/\s+/g, " ").slice(0, 32),
      createdAt: now,
      updatedAt: now,
      messages: [],
    };
    state.sessions.unshift(session);
  }
  session.updatedAt = now;
  session.messages.push(
    { id: uid("message"), role: "user", content: text, createdAt: now },
    {
      id: uid("message"),
      role: "assistant",
      content: demoReply(),
      demo: true,
      createdAt: now,
    },
  );
  state.tasks.unshift({
    id: uid("task"),
    title: text.replace(/\s+/g, " ").slice(0, 60),
    type,
    status: "demo",
    createdAt: now,
    sessionId: session.id,
  });
  return session.id;
}
export function removeSession(state, id) {
  state.sessions = state.sessions.filter((s) => s.id !== id);
  state.tasks = state.tasks.filter((t) => t.sessionId !== id);
}
export function searchWorkspace(state, query) {
  const q = query.trim().toLocaleLowerCase();
  if (!q) return [];
  const contains = (...parts) =>
    parts.some((s) => s.toLocaleLowerCase().includes(q));
  return [
    ...state.prompts
      .filter((p) => contains(p.title, p.content, p.category))
      .map((p) => ({
        kind: "prompt",
        id: p.id,
        title: p.title,
        label: `提示词 · ${p.category}`,
      })),
    ...state.sessions
      .filter((s) => contains(s.title, ...s.messages.map((m) => m.content)))
      .map((s) => ({
        kind: "session",
        id: s.id,
        title: s.title,
        label: "历史会话",
      })),
    ...state.documents
      .filter((d) => contains(d.name, d.tag, d.content))
      .map((d) => ({
        kind: "document",
        id: d.id,
        title: d.name,
        label: `知识资料 · ${d.tag}`,
      })),
    ...state.tasks
      .filter((t) => contains(t.title, t.type))
      .map((t) => ({
        kind: "task",
        id: t.id,
        title: t.title,
        label: "任务记录 · 演示",
      })),
  ].slice(0, 30);
}
