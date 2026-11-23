export const STORAGE_KEY = "zhizuotai.workspace.v1";
export const CATEGORIES = ["写作", "营销", "编程", "办公", "学习"];
export const INTEL_TOPICS = {
  technology: "AI 与技术",
  policy: "政策与采购",
  markets: "经济与市场",
  research: "研究与产品",
  world: "全球要闻",
};
export const MODELS = {
  general: "通用助手",
  writing: "写作助手",
  coding: "编程助手",
};
export const CHAT_MODES = { single: "单聊", group: "群聊", collaborate: "协作" };
export const CHAT_ROLES = {
  analysis: "分析",
  planning: "策划",
  review: "审校",
  writing: "写作",
  research: "研究",
  implementation: "实现",
};
export const MAX_CHAT_MEMBERS = 6;
export const BUILTIN_TOOLS = [
  { id: "workspace-search", title: "工作空间搜索", description: "快速查找任务、提示词、历史对话和知识资料。", icon: "search", tone: "purple" },
  { id: "text-stats", title: "文本统计", description: "实时查看字符、非空字符、行数与段落数。", icon: "chart", tone: "blue" },
  { id: "data-export", title: "数据导出", description: "将当前账号的工作空间保存为 JSON 备份。", icon: "download", tone: "green" },
];
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
  `${prefix}-${globalThis.crypto.randomUUID?.() ?? Array.from(globalThis.crypto.getRandomValues(new Uint8Array(16)), x => x.toString(16).padStart(2, "0")).join("")}`;
export function createInitialState() {
  return {
    version: 1,
    prompts: structuredClone(prompts),
    sessions: [],
    documents: [],
    tasks: [],
    todos: [],
    settings: { theme: "light", model: "general", enabledTools: BUILTIN_TOOLS.map(tool => tool.id) },
  };
}
const isText = (v, max = 50_000) => typeof v === "string" && v.length <= max;
const isTime = (v) =>
  isText(v, 24) &&
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(v) &&
  Number.isFinite(Date.parse(v)) &&
  new Date(v).toISOString() === v;
const isId = (v) => typeof v === "string" && /^[a-zA-Z0-9_-]{1,100}$/.test(v);
const isModelKey = (v) => typeof v === "string" && /^model_[A-Za-z0-9_-]{1,64}$/.test(v);
const isChatRole = role => typeof role === "string" && Object.hasOwn(CHAT_ROLES, role);
const uniqueIds = (items) =>
  items.every((item) => item && typeof item === "object") &&
  new Set(items.map((item) => item.id)).size === items.length;
export function validateChatSetup(setup) {
  return Boolean(setup && typeof setup.mode === "string" && Object.hasOwn(CHAT_MODES, setup.mode) && Array.isArray(setup.members) &&
    setup.members.length <= MAX_CHAT_MEMBERS &&
    setup.members.every(member => member && isModelKey(member.modelKey) && isChatRole(member.role)) &&
    new Set(setup.members.map(member => member.modelKey)).size === setup.members.length &&
    (setup.members.length ? setup.members.some(member => member.modelKey === setup.leadKey) : setup.leadKey === ""));
}
const isChatAuthor = author => author && isModelKey(author.modelKey) && isText(author.name, 200) && Boolean(author.name) &&
  isText(author.provider, 200) && (author.role === "" || author.role === "summary" || isChatRole(author.role));
function validChatPlan(plan) {
  if (!plan || !["group", "collaborate"].includes(plan.mode) || !Array.isArray(plan.steps) ||
    !plan.steps.length || plan.steps.length > MAX_CHAT_MEMBERS + 1 || !plan.steps.every(step =>
      isChatAuthor(step) && isId(step.requestId) && ["pending", "failed", "success"].includes(step.status) &&
      (step.status === "success" ? isId(step.messageId) : step.messageId === undefined) &&
      (step.error === undefined || isText(step.error, 500)))) return false;
  const work = plan.mode === "collaborate" ? plan.steps.slice(0, -1) : plan.steps;
  return work.length <= MAX_CHAT_MEMBERS && new Set(work.map(step => step.modelKey)).size === work.length &&
    (plan.mode === "group" ? work.every(step => step.role === "") :
      work.length >= 2 && work.every(step => isChatRole(step.role)) &&
      plan.steps.at(-1).role === "summary" && work.some(step => step.modelKey === plan.steps.at(-1).modelKey));
}
export function validateState(value) {
  if (!value || value.version !== 1 || !value.settings) return false;
  if (
    !["light", "dark", "system"].includes(value.settings.theme) ||
    !Object.hasOwn(MODELS, value.settings.model) ||
    (value.settings.modelKey !== undefined && value.settings.modelKey !== '' && !isModelKey(value.settings.modelKey))
  )
    return false;
  if (value.settings.enabledTools !== undefined && (
    !Array.isArray(value.settings.enabledTools) ||
    value.settings.enabledTools.length > BUILTIN_TOOLS.length ||
    new Set(value.settings.enabledTools).size !== value.settings.enabledTools.length ||
    !value.settings.enabledTools.every(id => BUILTIN_TOOLS.some(tool => tool.id === id))
  )) return false;
  // Optional additive fields keep pre-feature workspaces and backups readable.
  if (value.todos !== undefined && (
    !Array.isArray(value.todos) || value.todos.length > 1000 || !uniqueIds(value.todos) ||
    !value.todos.every(todo => isId(todo.id) && isText(todo.title, 100) && Boolean(todo.title.trim()) &&
      isText(todo.notes, 2000) && typeof todo.done === "boolean" &&
      isTime(todo.createdAt) && isTime(todo.updatedAt))
  )) return false;
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
        (s.pinned === undefined || typeof s.pinned === "boolean") &&
        (s.chatSetup === undefined || validateChatSetup(s.chatSetup)) &&
        Array.isArray(s.messages) &&
        s.messages.length <= 2000 &&
        uniqueIds(s.messages) &&
        s.messages.every(
          (m) =>
            isId(m.id) &&
            ["user", "assistant"].includes(m.role) &&
            isText(m.content) &&
            isTime(m.createdAt) &&
            (m.author === undefined || (m.role === "assistant" && m.demo === false && isChatAuthor(m.author))) &&
            (m.mention === undefined || (m.role === "user" && isText(m.mention, 200))) &&
            (m.role !== "assistant" || m.demo === true || (m.demo === false && isText(m.model, 200) && Boolean(m.model) && isId(m.requestId))),
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
        ["demo", "pending", "success", "failed"].includes(t.status) &&
        isTime(t.createdAt) &&
        isId(t.sessionId) &&
        (t.modelKey === undefined || isModelKey(t.modelKey)) &&
        (t.chatPlan === undefined || (isId(t.userMessageId) && validChatPlan(t.chatPlan))) &&
        (t.pluginIds === undefined || Array.isArray(t.pluginIds) && t.pluginIds.length <= 4 &&
          new Set(t.pluginIds).size === t.pluginIds.length && t.pluginIds.every(id => typeof id === "string" && /^plugin_[a-f0-9]{32}$/.test(id))) &&
        (t.pluginUncertain === undefined || typeof t.pluginUncertain === "boolean"),
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
export function beginChat(state, sessionId, content, type = 'AI 对话', modelKey = '', pluginIds = []) {
  const text = content.trim(), now = new Date().toISOString();
  let session = state.sessions.find(item => item.id === sessionId);
  if (!text || text.length > 20_000) throw new Error('请输入 1–20,000 个字符。');
  if (modelKey && !isModelKey(modelKey)) throw new Error('所选模型标识无效。');
  if (!Array.isArray(pluginIds) || pluginIds.length > 4 || new Set(pluginIds).size !== pluginIds.length || pluginIds.some(id => typeof id !== 'string' || !/^plugin_[a-f0-9]{32}$/.test(id))) throw new Error('插件选择无效。');
  if (state.tasks.length >= 1000 || (!session && state.sessions.length >= 1000) || (session && session.messages.length > 1998)) throw new Error('记录数量已达上限，请先导出并删除部分历史。');
  if (!session) {
    session = { id: uid('session'), title: text.replace(/\s+/g, ' ').slice(0, 32), createdAt: now, updatedAt: now, messages: [] };
    state.sessions.unshift(session);
  }
  const message = { id: uid('message'), role: 'user', content: text, createdAt: now };
  session.messages.push(message); session.updatedAt = now;
  const task = { id: uid('task'), requestId: uid('request'), assistant: state.settings.model, ...(modelKey ? { modelKey } : {}), ...(pluginIds.length ? { pluginIds: [...pluginIds] } : {}), userMessageId: message.id, title: text.replace(/\s+/g, ' ').slice(0, 60), type, status: 'pending', createdAt: now, sessionId: session.id };
  state.tasks.unshift(task);
  return { sessionId: session.id, taskId: task.id };
}
export function beginChatPlan(state, sessionId, content, type, setup, models, mentionKey = "") {
  if (!validateChatSetup(setup) || setup.mode === "single") throw new Error("请选择有效的群聊成员。");
  const selected = mentionKey ? setup.members.filter(member => member.modelKey === mentionKey) : setup.members;
  if (selected.length < (mentionKey ? 1 : 2)) throw new Error("请选择至少两个模型，或 @ 指定一位成员。");
  const mode = mentionKey ? "group" : setup.mode;
  const steps = selected.map(member => {
    const model = models.find(item => item.key === member.modelKey);
    if (!model) throw new Error("部分模型已停用，请更新成员。");
    return { modelKey: model.key, name: (model.name || model.id || model.key).slice(0, 200),
      provider: (model.provider || "").slice(0, 200), role: mode === "collaborate" ? member.role : "",
      requestId: uid("request"), status: "pending" };
  });
  if (mode === "collaborate") {
    const lead = steps.find(step => step.modelKey === setup.leadKey);
    steps.push({ ...lead, role: "summary", requestId: uid("request") });
  }
  const previous = state.sessions.find(item => item.id === sessionId);
  if ((previous?.messages.length || 0) + 1 + steps.length > 2000)
    throw new Error("会话消息已达上限，请新建对话。");
  const result = beginChat(state, sessionId, content, type);
  const session = state.sessions.find(item => item.id === result.sessionId);
  session.chatSetup = structuredClone(setup);
  if (mentionKey) session.messages.at(-1).mention = steps[0].name;
  const task = state.tasks[0];
  // Requests for a group turn are tracked per step. Older clients can still
  // read the conversation without treating the entire turn as one request.
  delete task.requestId;
  task.chatPlan = { mode, steps };
  return result;
}
function historyThrough(session, userMessageId) {
  const index = session?.messages.findIndex(message => message.id === userMessageId && message.role === 'user') ?? -1;
  if (index < 0) throw new Error('未找到需要回复的消息。');
  return session.messages.slice(0, index + 1).filter(message => message.demo !== true);
}
function boundedChatHistory(prior, latest) {
  const history = [];
  for (const message of prior) {
    if (!message.content.trim()) continue;
    const { role, author, mention } = message;
    const label = author ? `【${author.name}${author.role ? ` · ${CHAT_ROLES[author.role] || "汇总"}` : ""}】\n` : mention ? `@${mention}\n` : "";
    const content = label + message.content.slice(0, author ? 6800 : 50_000 - label.length);
    const previous = history.at(-1);
    if (previous?.role === role) previous.content = `${previous.content}\n\n${content}`.slice(0, 50_000);
    else history.push({ role, content });
  }
  const previous = history.at(-1);
  if (previous?.role === "user" && latest.length < 49_998)
    previous.content = `${previous.content.slice(0, 49_998 - latest.length)}\n\n${latest}`;
  else history.push({ role: "user", content: latest });
  let length = 0;
  let start = history.length;
  while (start > 0 && history.length - start < 80 && length + history[start - 1].content.length <= 120_000) {
    start--;
    length += history[start].content.length;
  }
  // Keep the newest complete turns within the model bridge limits.
  while (history[start]?.role === "assistant") start++;
  return history.slice(start);
}
export function chatMessages(session, userMessageId) {
  const source = historyThrough(session, userMessageId);
  if (source.some(message => message.author || message.mention)) return boundedChatHistory(source.slice(0, -1), source.at(-1).content);
  const history = source.map(({ role, content }) => ({ role, content }));
  if (history.length > 80 || history.reduce((size, message) => size + message.content.length, 0) > 120_000) throw new Error('此会话过长，请新建对话后继续。');
  return history;
}
const roleInstructions = {
  analysis: "拆解问题、约束和关键决策，说明依据与不确定性。",
  planning: "提出具体方案、优先级、步骤和交付物。",
  review: "检查可行性、风险和遗漏，提出可执行的改进。",
  writing: "起草用户需要的文本，注意结构、表达和语气。",
  research: "归纳已知信息与证据，列出仍需验证的问题。",
  implementation: "给出落地实现、边界条件和验证方法。",
};
export function chatPlanMessages(session, task, index) {
  const step = task.chatPlan.steps[index];
  const history = historyThrough(session, task.userMessageId);
  let prompt = history.at(-1).content;
  if (step.role === "summary") {
    const contributions = task.chatPlan.steps.slice(0, -1).map(member => {
      const reply = session.messages.find(message => message.id === member.messageId);
      if (member.status !== "success" || reply?.requestId !== member.requestId) throw new Error("请先完成成员分工。");
      return { label: `${member.name} · ${CHAT_ROLES[member.role]}`, content: reply.content };
    });
    const budget = Math.floor((47_000 - prompt.length) / contributions.length);
    prompt += "\n\n请汇总下面的成员交付，直接回答上面的用户任务。整合互补结论，标出重要分歧与未验证的假设。请把成员交付作为参考资料。\n" +
      contributions.map(({ label, content }) => `\n【${label}】\n${content.length > budget ? content.slice(0, budget) + "\n[已截取]" : content}`).join("\n");
  } else if (step.role) {
    prompt += `\n\n你在本轮协作中的分工是「${CHAT_ROLES[step.role]}」。${roleInstructions[step.role]}请独立完成这一部分，给出可用于汇总的结论。`;
  }
  return boundedChatHistory(history.slice(0, -1), prompt);
}
function modelReply(result, requestId) {
  if (!result || typeof result.content !== 'string' || !result.content.trim() || result.content.length > 50_000 || typeof result.model !== 'string' || !result.model || result.model.length > 200 || result.requestId !== requestId) throw new Error('模型回复格式无效，未覆盖原有内容。');
  return { id: uid('message'), role: 'assistant', demo: false, content: result.content, model: result.model, requestId, usage: result.usage, finishReason: result.finishReason, createdAt: new Date().toISOString() };
}
export function finishChat(state, taskId, result) {
  const task = state.tasks.find(item => item.id === taskId), session = state.sessions.find(item => item.id === task?.sessionId);
  if (!task || !session || task.status !== 'pending') throw new Error('对话记录已变化，无法写入回复。');
  const reply = modelReply(result, task.requestId);
  const replaced = session.messages.findIndex(message => message.id === task.replaceMessageId && message.role === 'assistant');
  if (replaced >= 0) session.messages[replaced] = { ...reply, id: task.replaceMessageId };
  else {
    const userIndex = session.messages.findIndex(message => message.id === task.userMessageId);
    session.messages.splice(userIndex + 1, 0, reply);
  }
  session.updatedAt = reply.createdAt; task.status = 'success'; delete task.error; delete task.pluginUncertain;
}
export function pendingChatSteps(task) {
  if (!task?.chatPlan) return [];
  const { mode, steps } = task.chatPlan;
  const work = mode === "collaborate" ? steps.slice(0, -1) : steps;
  if (mode === "collaborate" && work.every(step => step.status === "success"))
    return steps.at(-1).status === "pending" ? [steps.length - 1] : [];
  return work.flatMap((step, index) => step.status === "pending" ? [index] : []);
}
function planStep(state, taskId, index, status) {
  const task = state.tasks.find(item => item.id === taskId);
  const step = task?.chatPlan?.steps[index];
  if (step?.status !== status) throw new Error("协作进度已变化，请重新打开会话。");
  return { task, step };
}
function updatePlanStatus(task) {
  const { steps } = task.chatPlan;
  task.status = steps.every(step => step.status === "success") ? "success" :
    pendingChatSteps(task).length ? "pending" : "failed";
}
export function finishChatPlanStep(state, taskId, index, result) {
  const { task, step } = planStep(state, taskId, index, "pending");
  const session = state.sessions.find(item => item.id === task.sessionId);
  const userIndex = session?.messages.findIndex(message => message.id === task.userMessageId && message.role === "user") ?? -1;
  if (userIndex < 0 || session.messages.length >= 2000 || !pendingChatSteps(task).includes(index))
    throw new Error("对话记录已变化，无法写入回复。");
  const reply = modelReply(result, step.requestId);
  if (result.modelKey && result.modelKey !== step.modelKey) throw new Error("模型回复与指定成员不匹配。");
  const before = task.chatPlan.steps.slice(0, index).filter(member => member.messageId).length;
  const { modelKey, name, provider, role } = step;
  session.messages.splice(userIndex + before + 1, 0, { ...reply, author: { modelKey, name, provider, role } });
  session.updatedAt = reply.createdAt;
  Object.assign(step, { status: "success", messageId: reply.id });
  delete step.error;
  updatePlanStatus(task);
}
export function failChatPlanStep(state, taskId, index, error, recoverable) {
  const { task, step } = planStep(state, taskId, index, "pending");
  if (!recoverable) step.status = "failed";
  step.error = error.slice(0, 500);
  updatePlanStatus(task);
}
export function retryChatPlanStep(state, taskId, index) {
  const { task, step } = planStep(state, taskId, index, "failed");
  Object.assign(step, { status: "pending", requestId: uid("request") });
  delete step.error;
  updatePlanStatus(task);
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
        label: "历史对话",
      })),
    ...state.documents
      .filter((d) => contains(d.name, d.tag, d.content))
      .map((d) => ({
        kind: "document",
        id: d.id,
        title: d.name,
        label: `知识资料 · ${d.tag}`,
      })),
    ...(state.todos || [])
      .filter(todo => contains(todo.title, todo.notes))
      .map(todo => ({ kind: "todo", id: todo.id, title: todo.title, label: todo.done ? "任务 · 已完成" : "任务 · 待完成" })),
    ...state.tasks
      .filter((t) => contains(t.title, t.type))
      .map((t) => ({
        kind: "task",
        id: t.id,
        title: t.title,
        label: t.status === 'demo' ? "对话请求 · 历史演示" : "对话请求 · 模型对话",
      })),
  ].slice(0, 30);
}


export function saveTodo(state, id, fields, now = new Date().toISOString()) {
  const title = typeof fields.title === "string" ? fields.title.trim() : "";
  const notes = typeof fields.notes === "string" ? fields.notes.trim() : "";
  if (!title || title.length > 100 || notes.length > 2000 || !isTime(now))
    throw new Error("请输入 1–100 字的任务名称，备注不超过 2,000 字。");
  const items = state.todos || [];
  const todo = items.find(item => item.id === id);
  if (id && !todo) throw new Error("任务已不存在，请刷新后重试。");
  if (!id && items.length >= 1000) throw new Error("任务已达上限，请先导出并清理已完成任务。");
  if (todo) Object.assign(todo, { title, notes, updatedAt: now });
  else {
    const created = { id: uid("todo"), title, notes, done: false, createdAt: now, updatedAt: now };
    state.todos = [created, ...items];
    return created.id;
  }
  return todo.id;
}
export function setTodoDone(state, id, done, now = new Date().toISOString()) {
  const todo = state.todos?.find(item => item.id === id);
  if (!todo || typeof done !== "boolean" || !isTime(now)) throw new Error("任务状态无效，请刷新后重试。");
  todo.done = done;
  todo.updatedAt = now;
}
export function removeTodo(state, id) {
  state.todos = (state.todos || []).filter(item => item.id !== id);
}
export function enabledToolIds(state) {
  return state.settings.enabledTools ?? BUILTIN_TOOLS.map(tool => tool.id);
}
export function setToolEnabled(state, id, enabled) {
  if (!BUILTIN_TOOLS.some(tool => tool.id === id) || typeof enabled !== "boolean")
    throw new Error("此工具不可用。");
  const selected = new Set(enabledToolIds(state));
  if (enabled) selected.add(id);
  else selected.delete(id);
  state.settings.enabledTools = BUILTIN_TOOLS.filter(tool => selected.has(tool.id)).map(tool => tool.id);
}
export function summarizeText(text) {
  return {
    characters: Array.from(text).length,
    nonWhitespace: Array.from(text.replace(/\s/gu, "")).length,
    lines: text ? text.split(/\r\n|\r|\n/).length : 0,
    paragraphs: text.trim() ? text.replace(/\r\n?/g, "\n").trim().split(/\n[ \t]*\n(?:[ \t]*\n)*/).filter(part => part.trim()).length : 0,
  };
}
