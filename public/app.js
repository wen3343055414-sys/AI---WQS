import {
  CATEGORIES,
  MODELS,
  MAX_FILE_SIZE,
  MAX_DOCUMENT_CHARS,
  createInitialState,
  uid,
  readState,
  saveState,
  validateState,
  escapeHtml as e,
  markdown,
  beginChat,
  chatMessages,
  finishChat,
  removeSession,
  searchWorkspace,
  STARTERS,
  saveTodo,
  setTodoDone,
  removeTodo,
} from "./core.js";
import { WorkspaceSync } from "./sync.js";

const paths = {
  spark:
    '<path d="m14 3 2.5 6.5L23 12l-6.5 2.5L14 21l-2.5-6.5L5 12l6.5-2.5L14 3Z"/><path d="m4 2 .8 2.2L7 5l-2.2.8L4 8l-.8-2.2L1 5l2.2-.8L4 2Z"/>',
  puzzle: '<path d="M8 3H3v5a3 3 0 1 1 0 6v7h7a3 3 0 1 1 6 0h5v-7a3 3 0 1 0 0-6V3h-7a3 3 0 1 1-6 0Z"/>',
  home: '<path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1Z"/>',
  chat: '<path d="M21 11.5a8.5 8.5 0 0 1-8.5 8.5H4l-2 2V11.5a9.5 9.5 0 0 1 19 0Z"/><path d="M7 9h9M7 13h6"/>',
  layers: '<path d="m12 3 10 5-10 5L2 8l10-5ZM2 12l10 5 10-5M2 16l10 5 10-5"/>',
  book: '<path d="M12 5C8 2 5 3 2 4v15c3-1 6-2 10 1 4-3 7-2 10-1V4c-3-1-6-2-10 1v15"/>',
  history: '<path d="M3 11a9 9 0 1 1 2.6 7.4M3 4v7h7M12 7v5l3 2"/>',
  settings:
    '<path d="m9 3-1 3-3 1-2 4 2 3v4l4 2 3-1 3 1 4-2v-4l2-3-2-4-3-1-1-3Z"/><circle cx="12" cy="12" r="3"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  arrow: '<path d="M4 12h16m-6-6 6 6-6 6"/>',
  chevron: '<path d="m9 5 7 7-7 7"/>',
  down: '<path d="m6 9 6 6 6-6"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 0 1 5 .5c0 2-2.5 2-2.5 4M12 17h.01"/>',
  shield:
    '<path d="m12 2 8 4v6c0 5-8 10-8 10S4 17 4 12V6l8-4Z"/><path d="m8 12 3 3 5-6"/>',
  pen: '<path d="m16 3 5 5-12 12-6 1 1-6L16 3Zm-3 3 5 5M3 21l3-3"/>',
  file: '<path d="M14 2H5v20h14V7l-5-5v5h5M8 12h8M8 16h6"/>',
  languages:
    '<path d="M3 5h12M9 2v3M5 5c1 6 5 9 9 11M13 5c-1 6-5 9-10 12M13 21l4-10 4 10M14.5 17h5"/>',
  chart: '<path d="M4 3v17h17M8 15v-4M13 15V7M18 15V4"/>',
  bulb: '<path d="M9 18h6M9 21h6M8 14a7 7 0 1 1 8 0c-1 1-1 2-1 4H9c0-2 0-3-1-4Z"/>',
  briefcase:
    '<rect x="3" y="7" width="18" height="14" rx="2"/><path d="M8 7V3h8v4M3 12c5 4 13 4 18 0M10 12h4v5h-4Z"/>',
  megaphone: '<path d="m3 9 17-6v18L3 15V9Zm4 7 2 6h4l-2-5M20 9l3 2v2l-3 2"/>',
  code: '<path d="m7 6-5 6 5 6M17 6l5 6-5 6M14 3l-4 18"/>',
  list: '<path d="M9 5h12M9 12h12M9 19h12M3 5h.01M3 12h.01M3 19h.01"/>',
  star: '<path d="m12 3 2.8 5.8 6.4.9-4.6 4.5 1.1 6.3L12 17.5l-5.7 3 1.1-6.3-4.6-4.5 6.4-.9L12 3Z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5 19 19M5 19l1.5-1.5M17.5 6.5 19 5"/>',
  clip: '<path d="m8 13 7-7a3 3 0 0 1 4 4l-9 9a5 5 0 0 1-7-7L13 2"/>',
  send: '<path d="m3 3 19 9-19 9 3-9-3-9Zm3 9h16"/>',
  upload: '<path d="M12 16V3m-5 5 5-5 5 5M3 16v5h18v-5"/>',
  download: '<path d="M12 3v13m-5-5 5 5 5-5M3 16v5h18v-5"/>',
  trash: '<path d="M3 6h18M8 6V3h8v3M5 6l1 15h12l1-15M10 10v7M14 10v7"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  copy: '<rect x="8" y="8" width="13" height="13" rx="2"/><path d="M15 8V3H3v12h5"/>',
  refresh: '<path d="M20 8A8.5 8.5 0 1 0 21 14M20 3v5h-5"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  "sidebar-close": '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M8 4v16m7-12-4 4 4 4"/>',
  "sidebar-open": '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M8 4v16m4-12 4 4-4 4"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7h.01"/>',
  folder: '<path d="M3 5h7l2 3h9v12H3V5Z"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
};
const icon = (name) =>
  `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${paths[name] || paths.file}</svg>`;
const button = (action, label, name, style = "btn", extra = "") =>
  `<button type="button" class="${style}" data-action="${action}" ${extra}>${name ? icon(name) : ""}${label}</button>`;
const iconButton = (action, label, name, extra = "") =>
  button(
    action,
    "",
    name,
    "icon-button",
    `aria-label="${e(label)}" title="${e(label)}" ${extra}`,
  );
const nav = [
  ["todo", "任务", "list"],
  ["home", "首页", "home"],
  ["chat", "AI 对话", "chat"],
  ["prompts", "提示词库", "layers"],
  ["knowledge", "知识库", "book"],
  ["plugins", "插件", "puzzle"],
  ["tasks", "历史对话", "history"],
  ["settings", "设置", "settings"],
];
const categoryStyle = {
  写作: ["purple", "pen"],
  营销: ["pink", "megaphone"],
  编程: ["blue", "code"],
  办公: ["orange", "briefcase"],
  学习: ["green", "book"],
};
const initial = readState({ getItem: (key) => localStorage.getItem(key) });
let state = initial.state;
let sync;
let modelConfig = { ready: false, model: '', provider: '', message: '正在读取服务端模型配置' };
let modelConfigPending = false, modelConfigChecked = 0, chatPending = null, chatAccountCycle = 0;
let newServerVersion = "";
let promptFilter = "全部",
  promptQuery = "",
  documentFilter = "全部",
  documentQuery = "",
  historyQuery = "",
  todoFilter = "全部",
  todoQuery = "";
let pluginConnections = [], pluginHistory = [], pluginError = "", pluginsLoaded = false, pluginLoading = false, pluginChecked = 0, pluginViewDirty = false;
const selectedPluginIds = new Set(), pluginDetailsCache = new Map(), pluginApprovals = new Map();
const drafts = new Map();
let pendingType = "AI 对话";
let focusNewConversation = false;
let toastTimer;
let dialogOrigin;
let uploadQueue = Promise.resolve();
const dialog = document.querySelector("#dialog");
const app = document.querySelector("#app");
const systemTheme = matchMedia("(prefers-color-scheme: dark)");
const mobile = matchMedia("(max-width: 760px)");
const SIDEBAR_VIEW_KEY = "zhizuotai.sidebar.collapsed.v1";
let sidebarCollapsed = false;
try { sidebarCollapsed = localStorage.getItem(SIDEBAR_VIEW_KEY) === "true"; } catch { /* Layout remains usable when storage is unavailable. */ }

function route() {
  const [page, id] = location.hash.slice(1).split("/");
  return {
    page: nav.some((n) => n[0] === page) ? page : "home",
    id: /^[\w-]{1,100}$/.test(id || "") ? id : "",
  };
}
function go(page, id = "") {
  const hash = `#${page}${id ? `/${id}` : ""}`;
  if (location.hash === hash) render();
  else location.hash = hash;
}
function mutate(fn) {
  const next = structuredClone(state);
  const result = fn(next);
  persist(next);
  return result;
}
function persist(next) {
  if (!validateState(next)) throw new Error("工作空间数据格式无效，未修改已有记录。");
  if (sync?.mode === "server") {
    if (!sync.authenticated) throw new Error("请先登录账号。");
    sync.enqueue(next);
  } else {
    if (sync?.mode === "connecting") throw new Error("正在连接服务器，请稍候。");
    saveState(localStorage, next);
  }
  state = next;
}
function activeModel() {
  const key = state.settings.modelKey;
  if (!key) return modelConfig;
  const model = (modelConfig.models || []).find(item => item.key === key);
  return model ? { ...model, model: model.id, ready: true, message: '已选择服务端提供的模型。' }
    : { ready: false, provider: '', model: '', message: '所选模型已停用或不再可用，请重新选择模型。' };
}
function aiModelOptions() {
  const key = state.settings.modelKey || '', models = modelConfig.models || [];
  const groups = new Map();
  for (const model of models) { if (!groups.has(model.providerId)) groups.set(model.providerId, { provider: model.provider, models: [] }); groups.get(model.providerId).models.push(model); }
  return `<option value="" ${!key ? 'selected' : ''}>跟随服务端默认${modelConfig.model ? ` · ${e(modelConfig.model)}` : ''}</option>` +
    (key && !models.some(model => model.key === key) ? `<option value="${e(key)}" selected disabled>所选模型已停用</option>` : '') +
    [...groups.values()].map(group => `<optgroup label="${e(group.provider)}">${group.models.map(model => `<option value="${e(model.key)}" ${key === model.key ? 'selected' : ''}>${e(model.name)}${model.name !== model.id ? ` · ${e(model.id)}` : ''}</option>`).join('')}</optgroup>`).join('');
}
function modelPrivacy() {
  return activeModel().ready ? `已连接 ${activeModel().provider} · 对话和所选文本将发送给模型服务，密钥由服务端保管` : activeModel().message;
}
async function refreshModelConfig(force = false) {
  if (!sync?.authenticated || modelConfigPending || (!force && Date.now() - modelConfigChecked < 5000)) return;
  modelConfigPending = true;
  const accountCycle = chatAccountCycle;
  try {
    const value = await sync.request('/api/model-config');
    if (accountCycle !== chatAccountCycle || !sync.authenticated) return;
    const changed = JSON.stringify(value) !== JSON.stringify(modelConfig);
    modelConfig = value;
    if (changed && !chatPending && !dialog.open && !document.activeElement?.matches('input,textarea,select')) render();
    const current = activeModel();
    document.querySelectorAll('[data-model-label]').forEach(element => { element.textContent = current.ready ? current.model : '模型未就绪'; });
    document.querySelectorAll('[data-model-summary]').forEach(element => { element.textContent = current.ready ? `已连接 ${current.provider} · ${current.model}` : current.message; });
    if (changed && !chatPending) document.querySelectorAll('[data-setting="modelKey"]').forEach(select => { if (document.activeElement !== select) select.innerHTML = aiModelOptions(); });
    const send = document.querySelector('#message-form button[type=submit]');
    if (send) send.disabled = Boolean(chatPending || !current.ready || hasPluginApproval());
  } catch { if (accountCycle === chatAccountCycle) modelConfig = { ready: false, model: '', provider: '', message: '无法读取服务端模型配置，请稍后重试。' }; }
  finally { if (accountCycle === chatAccountCycle) { modelConfigChecked = Date.now(); modelConfigPending = false; } }
}
function hasPluginApproval(sessionId = route().id) {
  return Boolean(sessionId && state.tasks.some(task => task.sessionId === sessionId && pluginApprovals.has(task.id)));
}
function chatRequestNotice(session) {
  if (!session) return "";
  if (chatPending?.sessionId === session.id) return `<div class="model-request-status" role="status"><span class="model-spinner"></span>${chatPending.pluginPhase === "executing" ? "正在执行已确认的插件操作并整理结果…" : chatPending.pluginPhase ? "正在处理插件协作，请稍候…" : "模型正在回复，请稍候…"}</div>`;
  const task = state.tasks.find(item => item.sessionId === session.id);
  if (!task || !["pending", "failed"].includes(task.status) || !task.requestId) return "";
  if (pluginApprovals.has(task.id)) return pluginApprovalView(task.id, pluginApprovals.get(task.id));
  return `<div class="model-request-status failed" role="status"><span>${e(task.error || "上次请求结果尚未确认，可尝试恢复回复。")}</span>${task.pluginUncertain ?
    '<a class="btn" href="#plugins">查看插件调用</a>' :
    button(task.status === "pending" ? "resume-chat" : "retry-chat", task.status === "pending" ? "恢复回复" : "重新请求", "", "btn", `data-id="${task.id}"`)}</div>`;
}
async function sendChat(content, draftKey) {
  if (chatPending) throw new Error('请等待当前回复完成。');
  if (hasPluginApproval()) throw new Error('请先确认或取消当前插件操作。');
  const pluginIds = [...selectedPluginIds];
  const accountCycle = chatAccountCycle;
  await refreshModelConfig(true);
  if (accountCycle !== chatAccountCycle) return;
  if (chatPending) throw new Error('请等待当前回复完成。');
  if (!activeModel().ready || !sync?.authenticated) throw new Error(activeModel().message || '请先登录并在服务端配置模型接口。');
  if (pluginIds.length) {
    await refreshPlugins(true);
    if (accountCycle !== chatAccountCycle) return;
    if (!modelConfig.toolCalling) throw new Error("当前模型服务端尚不支持插件对话，请先更新服务端。");
    if (pluginIds.some(id => !pluginConnections.some(connection => connection.id === id && pluginReady(connection))))
      throw new Error("所选插件已不可用，请重新选择。");
  }
  const result = mutate(next => beginChat(next, route().page === 'chat' ? route().id : '', content, pendingType, next.settings.modelKey || '', pluginIds));
  drafts.delete(draftKey);
  const input = document.querySelector('#message-input'); if (input) input.value = '';
  pendingType = 'AI 对话'; go('chat', result.sessionId);
  await performChat(result.taskId);
}
async function performChat(taskId) {
  if (chatPending) throw new Error('已有对话正在回复。');
  const task = state.tasks.find(item => item.id === taskId);
  if (!task) throw new Error('对话任务不存在。');
  const accountCycle = chatAccountCycle;
  chatPending = { taskId, sessionId: task.sessionId, pluginPhase: task.pluginIds?.length ? 'planning' : '' };
  render();
  try {
    const session = state.sessions.find(item => item.id === task.sessionId);
    const input = { requestId: task.requestId, userId: sync.user?.id, assistant: task.assistant || state.settings.model, messages: chatMessages(session, task.userMessageId), ...(task.modelKey ? { modelKey: task.modelKey } : {}), ...(task.pluginIds?.length ? { pluginIds: task.pluginIds } : {}) };
    const until = Date.now() + 15000;
    while (sync.pending || sync.busy) {
      if (sync.conflict) throw new Error('请先处理工作空间同步冲突，再重新请求。');
      if (accountCycle !== chatAccountCycle) return;
      if (!sync.authenticated || Date.now() > until) throw new Error('对话尚未保存到本机，请恢复连接后重新请求。');
      if (!sync.busy) await sync.flush();
      if (sync.pending || sync.busy) await new Promise(resolve => setTimeout(resolve, 150));
    }
    if (accountCycle !== chatAccountCycle || !sync.authenticated) return;
    let result = await sync.request('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input), signal: AbortSignal.timeout(140000) });
    if (accountCycle !== chatAccountCycle || !sync.authenticated) return;
    if (task.pluginIds?.length) {
      result = await waitPluginRun(result, accountCycle);
      if (!result || accountCycle !== chatAccountCycle) return;
      acceptPluginReply(taskId, result);
    } else {
      mutate(next => finishChat(next, taskId, result));
      if (result.finishReason === 'length') toast('回复达到长度上限，可以发送“请继续”。');
    }
  } catch (error) {
    if (accountCycle !== chatAccountCycle || !sync.authenticated) return;
    const message = error.name === 'TimeoutError' ? '等待回复超时，请检查服务端后重新请求。' : error.message;
    mutate(next => { const item = next.tasks.find(item => item.id === taskId); if (item) { item.status = item.pluginIds?.length && ![400, 403, 404, 409, 413, 422].includes(error.status) ? 'pending' : 'failed'; item.error = message.slice(0, 500); } });
    toast(message, true);
  } finally { if (accountCycle === chatAccountCycle) { chatPending = null; render(); } }
}
window.addEventListener('beforeunload', event => { if (chatPending) { event.preventDefault(); event.returnValue = ''; } });
setInterval(() => { if (!document.hidden) refreshModelConfig(); }, 8000);
function toast(message, error = false) {
  clearTimeout(toastTimer);
  const target = document.querySelector("#toast");
  target.textContent = message;
  target.classList.toggle("error", error);
  target.hidden = false;
  toastTimer = setTimeout(
    () => {
      target.hidden = true;
    },
    error ? 9000 : 3500,
  );
}
function applyTheme() {
  document.body.dataset.theme =
    state.settings.theme === "system"
      ? systemTheme.matches
        ? "dark"
        : "light"
      : state.settings.theme;
}
function dateText(value, full = false) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    ...(full ? { hour: "2-digit", minute: "2-digit" } : {}),
    timeZone: "Asia/Shanghai",
  }).format(new Date(value));
}
const today = () =>
  new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "long",
    timeZone: "Asia/Shanghai",
  }).format(new Date());
const category = (value) => {
  const [tone, name] = categoryStyle[value] || ["purple", "file"];
  return `<span class="category tone-${tone}">${icon(name)}${e(value)}</span>`;
};
const empty = (name, title, description, action = "") =>
  `<div class="empty">${icon(name)}<h3>${title}</h3><p>${description}</p>${action}</div>`;
const notice = (text) =>
  `<div class="notice">${icon("info")}<span>${text}</span></div>`;
function heading(title, description, action = "") {
  return `<div class="page-intro"><div><h1 tabindex="-1" id="page-title">${title}</h1><p>${description}</p></div>${action}</div>`;
}
function section(title, caption = "", action = "") {
  return `<div class="section-heading"><h2>${title}${caption ? `<span class="caption">${caption}</span>` : ""}</h2>${action}</div>`;
}
function modelOptions() {
  return Object.entries(MODELS)
    .map(
      ([key, label]) =>
        `<option value="${key}" ${state.settings.model === key ? "selected" : ""}>${label}</option>`,
    )
    .join("");
}
function composer(home = false) {
  const key = home ? "home" : route().id || "new";
  return `<form class="composer" id="message-form" data-draft="${e(key)}">
    ${home ? `<label class="composer-label" for="message-input">${icon("spark")}今天，想一起完成什么？</label>` : '<label class="visually-hidden" for="message-input">输入消息</label>'}
    <textarea id="message-input" name="message" maxlength="20000" required placeholder="${home ? "写下你的想法，或者从下方选择一个灵感起点…" : "输入你的问题，继续这段思考…"}">${e(drafts.get(key) || "")}</textarea>
    <div class="composer-bottom"><div class="composer-controls">${iconButton("attach", "从知识库添加文本", "clip")}${button("plugin-picker", '<span data-plugin-choice-label>' + (selectedPluginIds.size ? "插件 " + selectedPluginIds.size : "插件") + "</span>", "puzzle", "composer-plugin" + (selectedPluginIds.size ? " active" : ""), sync?.authenticated ? "" : "disabled")}<select class="model-select" aria-label="选择助手" data-setting="model">${modelOptions()}</select><select class="model-select ai-model-select" aria-label="选择 AI 模型" data-setting="modelKey">${aiModelOptions()}</select></div><button type="submit" class="btn btn-primary" ${chatPending || !activeModel().ready || (!home && hasPluginApproval()) ? 'disabled' : ''}>${chatPending ? '正在回复…' : home ? '开始对话' : '发送'}${icon("arrow")}</button></div>
  </form>`;
}
function promptCard(p) {
  return `<article class="prompt-card"><div class="prompt-card-top">${category(p.category)}${button("favorite", "", "star", `icon-button favorite ${p.favorite ? "active" : ""}`, `data-id="${p.id}" aria-label="${p.favorite ? "取消收藏" : "收藏"}：${e(p.title)}" aria-pressed="${p.favorite}"`)}</div><h3>${e(p.title)}</h3><p>${e(p.description || "一个值得保留的好提示词。")}</p><div class="prompt-card-bottom">${button("use-prompt", `使用提示词 ${icon("arrow")}`, "", "btn btn-quiet", `data-id="${p.id}"`)}${button("view-prompt", "查看与编辑", "", "btn btn-quiet", `data-id="${p.id}"`)}</div></article>`;
}
function sortedConversations(query = "") {
  const text = query.trim().toLocaleLowerCase();
  return state.sessions
    .filter(session => !text || session.title.toLocaleLowerCase().includes(text) ||
      session.messages.some(message => message.content.toLocaleLowerCase().includes(text)))
    .sort((one, two) => two.updatedAt.localeCompare(one.updatedAt));
}
function conversationList(sessions, filtered = false) {
  if (!sessions.length) return empty(
    "history", filtered ? "没有找到相关对话" : "还没有历史对话",
    filtered ? "试试对话标题或消息中的其他关键词。" : "开启新对话，你的思考会保存在这里。",
    filtered ? "" : button("new-chat", "新对话", "plus", "btn"),
  );
  return `<ul class="conversation-list" aria-label="历史对话列表">${sessions.map(session => {
    const content = session.messages.at(-1)?.content || "还没有消息，点击继续对话。";
    const preview = Array.from(content.replace(/\s+/g, " ")).slice(0, 120).join("");
    return `<li><a class="conversation-link" href="#chat/${e(session.id)}" aria-label="继续对话：${e(session.title)}">
      <span class="conversation-symbol">${icon("chat")}</span>
      <span class="conversation-copy"><strong>${e(session.title)}</strong><span>${e(preview)}</span></span>
      <span class="conversation-meta"><time datetime="${e(session.updatedAt)}">${dateText(session.updatedAt, true)}</time><small>${session.messages.length} 条消息</small></span>
      <span class="conversation-chevron">${icon("chevron")}</span>
    </a></li>`;
  }).join("")}</ul>`;
}
function homePage() {
  const hour = Number(
    new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      hourCycle: "h23",
      timeZone: "Asia/Shanghai",
    }).format(new Date()),
  );
  const hello =
    hour < 6
      ? "夜深了，记得休息"
      : hour < 12
        ? "上午好，开启高效的一天"
        : hour < 18
          ? "下午好，让好想法继续生长"
          : "晚上好，留一点时间给灵感";
  const favorites = state.prompts.filter((p) => p.favorite).slice(0, 3);
  return `<div class="greeting">${icon("sun")}${hello}</div><div class="page-intro"><div><h1 tabindex="-1" id="page-title">把想法，变成<span>下一步。</span></h1><p>你的 AI 工作空间，让创作、思考与日常工作从容发生。</p></div><span class="date">${today()}</span></div>
  ${composer(true)}<div class="privacy-line">${icon("shield")}${e(modelPrivacy())}</div>
  ${section("从一个灵感开始", "为日常工作，找到更好的起点")}
  <div class="quick-grid">${STARTERS.map((s) => `<button class="quick-card" data-action="starter" data-id="${s.id}"><span class="tile-icon tone-${s.tone}">${icon(s.icon)}</span><strong>${s.title}</strong><small>${s.subtitle}</small></button>`).join("")}</div>
  <div class="dashboard-lower"><div>${section("常用提示词", "收藏好方法，下次直接用", '<a class="btn btn-quiet" href="#prompts">查看全部 ' + icon("arrow") + "</a>")}<div class="prompt-grid">${favorites.length ? favorites.map(promptCard).join("") : empty("star", "把好用的提示词收藏在这里", "去提示词库点亮星标，建立你的常用清单。", '<a class="btn" href="#prompts">浏览提示词库</a>')}</div>
  ${section("最近对话", "每一份思考，都有迹可循", '<a class="btn btn-quiet" href="#tasks">全部对话 ' + icon("arrow") + "</a>")}${conversationList(sortedConversations().slice(0, 3))}</div>
  <aside class="side-panel"><div class="note-card"><span class="eyebrow">${icon("bulb")}灵感便签 / 01</span><h3>好的回答，<br>从好的提问开始。</h3><p>给 AI 一个角色、一点背景，<br>再告诉它你期待的结果。</p><div class="mini-example">“你是一位内容编辑，请面向初学者，用一个例子解释这个概念。”</div>${button("prompt-guide", `看看怎么提问 ${icon("arrow")}`, "", "btn btn-quiet")}</div></aside></div>`;
}
function promptResults() {
  const list = state.prompts.filter(
    (p) =>
      (promptFilter === "全部" ||
        (promptFilter === "已收藏"
          ? p.favorite
          : p.category === promptFilter)) &&
      `${p.title} ${p.description} ${p.content}`
        .toLocaleLowerCase()
        .includes(promptQuery.toLocaleLowerCase()),
  );
  return list.length
    ? `<div class="prompt-grid library">${list.map(promptCard).join("")}</div>`
    : empty(
        "search",
        "还没有找到合适的提示词",
        "试试其他分类、关键词，或创建你自己的提示词。",
        button("new-prompt", "新建提示词", "plus", "btn"),
      );
}
function searchField(id, placeholder, value) {
  return `<label class="search-field">${icon("search")}<span class="visually-hidden">${placeholder}</span><input id="${id}" type="search" placeholder="${placeholder}" value="${e(value)}" maxlength="100" autocomplete="off" /></label>`;
}
function tabs(items, current, action) {
  return `<div class="tabs" role="group" aria-label="筛选分类">${items.map((t) => button(action, e(t), "", `tab ${t === current ? "active" : ""}`, `data-id="${e(t)}" aria-pressed="${t === current}"`)).join("")}</div>`;
}
function promptsPage() {
  return (
    heading(
      "提示词库",
      "把好用的方法留下来，让每次创作都有一个好起点。",
      button("new-prompt", "新建提示词", "plus", "btn btn-primary"),
    ) +
    `<div class="toolbar"><div id="prompt-tabs">${tabs(["全部", "已收藏", ...CATEGORIES], promptFilter, "prompt-filter")}</div>${searchField("prompt-search", "搜索提示词…", promptQuery)}</div><div id="prompt-results" aria-live="polite">${promptResults()}</div>`
  );
}
function documentResults() {
  const list = state.documents.filter(
    (d) =>
      (documentFilter === "全部" || d.tag === documentFilter) &&
      `${d.name} ${d.tag} ${d.content}`
        .toLocaleLowerCase()
        .includes(documentQuery.toLocaleLowerCase()),
  );
  if (!list.length)
    return empty(
      "folder",
      state.documents.length ? "没有找到匹配的资料" : "给想法，一点背景资料",
      "添加一份资料，随时查找、预览，或将文本带入对话。",
    );
  return `<div class="document-grid">${list.map((d) => `<article class="document-card"><div class="document-top"><span class="tile-icon tone-blue">${icon("file")}</span>${iconButton("delete-document", `删除：${d.name}`, "trash", `data-id="${d.id}"`)}</div><h3>${e(d.name)}</h3><p class="metadata">${d.size < 1024 ? `${d.size} B` : `${(d.size / 1024).toFixed(1)} KB`} · ${dateText(d.createdAt)}</p><span class="status-pill">${d.kind === "text" ? "文本已读取 · 本地" : "仅保存文件信息"}</span><div class="document-bottom">${button("document-tag", e(d.tag), "", "btn btn-quiet", `data-id="${d.id}" aria-label="编辑标签：${e(d.name)}"`)}${button("view-document", `查看 ${icon("arrow")}`, "", "btn btn-quiet", `data-id="${d.id}"`)}</div></article>`).join("")}</div>`;
}
function documentTabs() {
  return tabs(
    ["全部", ...new Set(state.documents.map((d) => d.tag))],
    documentFilter,
    "document-filter",
  );
}
function knowledgePage() {
  return (
    heading(
      "知识库",
      "整理你的背景资料，让零散的信息随时可用。",
      button("upload", "添加资料", "plus", "btn btn-primary"),
    ) +
    notice(
      "资料仅保存于当前浏览器。TXT、Markdown、CSV、JSON 可读取文本；PDF、Word 等仅记录文件信息，尚未进行解析、向量检索或云端上传。",
    ) +
    `<div class="upload-zone" id="upload-zone">${icon("upload")}<strong>把资料放在这里，给思考一个起点</strong><p>拖拽文件至此，或点击选择文件 · 每个文件不超过 1 MB</p>${button("upload", "选择文件", "plus", "btn")}<input type="file" id="file-input" multiple hidden /></div><div class="toolbar"><div id="document-tabs">${documentTabs()}</div>${searchField("document-search", "搜索文件名、标签或文本…", documentQuery)}</div><div id="document-results" aria-live="polite">${documentResults()}</div>`
  );
}
function todoResults() {
  const query = todoQuery.trim().toLocaleLowerCase();
  const items = (state.todos || []).filter(todo =>
    (todoFilter === "全部" || todo.done === (todoFilter === "已完成")) &&
    (!query || (todo.title + " " + todo.notes).toLocaleLowerCase().includes(query)))
    .sort((one, two) => Number(one.done) - Number(two.done) || two.updatedAt.localeCompare(one.updatedAt));
  if (!items.length) return empty("list", query || todoFilter !== "全部" ? "没有符合条件的任务" : "从一个小任务开始",
    query || todoFilter !== "全部" ? "试试其他关键词或筛选条件。" : "把想做的事记下来，完成一项，前进一步。",
    query || todoFilter !== "全部" ? "" : button("new-todo", "新建任务", "plus", "btn"));
  return '<div class="todo-list">' + items.map(todo => `<article class="todo-item ${todo.done ? "is-done" : ""}" data-todo-id="${e(todo.id)}">
    ${button("toggle-todo", icon("check"), "", "todo-toggle", `data-id="${e(todo.id)}" role="checkbox" aria-checked="${todo.done}" aria-label="${todo.done ? "恢复待办" : "标记完成"}：${e(todo.title)}"`)}
    <div class="todo-copy"><h2>${e(todo.title)}</h2>${todo.notes ? `<p>${e(todo.notes)}</p>` : ""}<small>${todo.done ? "已完成" : "待完成"} · 更新于 ${dateText(todo.updatedAt, true)}</small></div>
    <div class="todo-actions">${iconButton("edit-todo", `编辑任务：${todo.title}`, "pen", `data-id="${e(todo.id)}"`)}${iconButton("delete-todo", `删除任务：${todo.title}`, "trash", `data-id="${e(todo.id)}"`)}</div>
  </article>`).join("") + "</div>";
}
function todoPage() {
  const items = state.todos || [], completed = items.filter(todo => todo.done).length;
  return heading("任务", "把计划拆成清晰的下一步。", button("new-todo", "新建任务", "plus", "btn btn-primary")) +
    `<div class="todo-overview" aria-label="任务概览"><div><span>全部任务</span><strong>${items.length}</strong></div><div><span>待完成</span><strong>${items.length - completed}</strong></div><div><span>已完成</span><strong>${completed}</strong></div></div>
    <div class="toolbar todo-toolbar"><div id="todo-tabs">${tabs(["全部", "待完成", "已完成"], todoFilter, "todo-filter")}</div>${searchField("todo-search", "搜索任务名称或备注…", todoQuery)}</div>
    <div id="todo-results" aria-live="polite">${todoResults()}</div>`;
}
function pluginReady(connection) {
  return Boolean(connection.enabled && connection.status === "connected" && connection.selectedCount > 0);
}
async function refreshPlugins(force = false) {
  if (!sync?.authenticated || pluginLoading || !force && Date.now() - pluginChecked < 15000) return;
  const cycle = chatAccountCycle;
  pluginLoading = true;
  pluginChecked = Date.now();
  try {
    const data = await sync.request("/api/plugins");
    if (cycle !== chatAccountCycle || !sync.authenticated) return;
    if (!Array.isArray(data.connections) || data.connections.length > 8 || !Array.isArray(data.history)) throw new Error("插件列表响应无效。");
    const changed = JSON.stringify([pluginConnections, pluginHistory, pluginError]) !== JSON.stringify([data.connections, data.history, ""]);
    pluginConnections = data.connections;
    pluginHistory = data.history;
    pluginError = "";
    pluginsLoaded = true;
    for (const id of selectedPluginIds) if (!pluginConnections.some(connection => connection.id === id && pluginReady(connection))) selectedPluginIds.delete(id);
    document.querySelectorAll("[data-plugin-choice-label]").forEach(element => { element.textContent = selectedPluginIds.size ? "插件 " + selectedPluginIds.size : "插件"; });
    if (changed && route().page === "plugins") { if (dialog.open || chatPending) pluginViewDirty = true; else render(); }
  } catch (error) {
    if (cycle !== chatAccountCycle) return;
    pluginError = error.status === 404 ? "当前服务端还没有插件接口，请先更新工作台前后端。" : error.message;
    pluginsLoaded = true;
    if (route().page === "plugins" && !dialog.open && !chatPending) render();
  } finally { if (cycle === chatAccountCycle) { pluginLoading = false; pluginChecked = Date.now(); } }
}
async function pluginRequest(endpoint, data = {}) {
  if (!sync?.authenticated || sync.mode !== "server") throw new Error("请先连接并登录工作台服务。");
  const cycle = chatAccountCycle, userId = sync.user?.id;
  const result = await sync.request(endpoint, { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...data, userId }), signal: AbortSignal.timeout(120000) });
  return cycle === chatAccountCycle && sync.authenticated ? result : null;
}
function pluginsPage() {
  const usable = sync?.mode === "server" && sync.authenticated;
  const disabled = usable && pluginsLoaded && !pluginError ? "" : "disabled";
  const connected = pluginConnections.filter(connection => connection.status === "connected" && connection.enabled).length;
  const content = pluginConnections.length ? '<div class="plugin-connections">' + pluginConnections.map(connection => {
    const ready = pluginReady(connection);
    return `<article class="plugin-connection" data-plugin-id="${e(connection.id)}"><div class="plugin-connection-head"><span class="tile-icon tone-purple">${icon(connection.kind === "github" ? "code" : "puzzle")}</span>
      <div><h3>${e(connection.name)}</h3><p>${e(connection.endpoint)}</p></div><span class="plugin-state ${connection.status === "connected" && connection.enabled ? "is-connected" : ""}">${!connection.enabled ? "已停用" : connection.status === "connected" ? "已连接" : "连接异常"}</span></div>
      <p class="plugin-connection-summary">${connection.toolCount} 项可用工具 · ${connection.selectedCount} 项用于对话</p>
      ${connection.error ? `<p class="plugin-error">${e(connection.error)}</p>` : ""}
      <div class="plugin-connection-actions">${button("plugin-use-chat", "在对话中使用", "chat", "btn btn-primary", `data-id="${e(connection.id)}" ${ready ? "" : "disabled"}`)}
        ${button("plugin-details", "查看工具", "list", "btn", `data-id="${e(connection.id)}"`)}
        ${button("plugin-enable", connection.enabled ? "停用" : "启用", "", "btn btn-quiet", `data-id="${e(connection.id)}"`)}
        ${iconButton("plugin-reconnect", "重新验证：" + connection.name, "refresh", `data-id="${e(connection.id)}"`)}
        ${iconButton("plugin-disconnect", "断开连接：" + connection.name, "close", `data-id="${e(connection.id)}"`)}</div></article>`;
  }).join("") + "</div>" : empty("puzzle", !pluginsLoaded && usable ? "正在读取插件连接" : "还没有连接插件",
    usable ? "连接 GitHub 或其他 MCP 服务，将真实工具带入工作。" : "插件连接需要工作台服务，请先连接并登录。");
  const history = pluginHistory.length ? `<section class="plugin-recent"><div class="section-heading"><h2>最近调用</h2><span class="caption">当前账号的实际执行记录</span></div>
    <div class="plugin-history-list">${pluginHistory.map(call => `<div><span><strong>${e(call.pluginName)}</strong><small>${e(call.toolName)}</small></span><span>${({success:"已完成",error:"请求失败",unknown:"结果未确认",running:"执行中"})[call.status] || "已记录"}</span><time>${dateText(call.createdAt, true)}</time></div>`).join("")}</div></section>` : "";
  return heading("插件", "连接你的工具，让对话真正完成工作。", button("plugin-connect", "连接插件", "plus", "btn btn-primary", disabled)) +
    `<div class="plugins-summary"><span>我的连接</span><div><small>已连接 ${connected} / ${pluginConnections.length}</small>${button("plugins-refresh", "刷新", "refresh", "btn btn-quiet", usable ? "" : "disabled")}</div></div>
    ${pluginError ? notice(e(pluginError)) : ""}${content}
    <section class="plugin-discover"><div class="section-heading"><h2>连接更多工具</h2><span class="caption">通过 MCP 接入外部服务</span></div><div class="plugin-catalog">
      <article class="plugin-catalog-card"><span class="tile-icon tone-purple">${icon("code")}</span><h3>GitHub</h3><p>读取仓库、查阅代码、协作处理 Issue 与 Pull Request，具体能力取决于账号权限。</p><div><span>GitHub 官方 MCP</span>${button("plugin-connect-github", "连接 GitHub", "arrow", "btn", disabled)}</div></article>
      <article class="plugin-catalog-card"><span class="tile-icon tone-blue">${icon("puzzle")}</span><h3>自定义 MCP</h3><p>连接其他提供远程 MCP 接口的工具，发现它们实际开放的操作。</p><div><span>HTTPS · Streamable HTTP</span>${button("plugin-connect", "添加服务", "plus", "btn", disabled)}</div></article>
    </div></section>${history}`;
}
function pluginConnector(kind = "custom") {
  if (!sync?.authenticated || sync.mode !== "server") throw new Error("请先连接并登录工作台服务。");
  const github = kind === "github";
  openDialog(github ? "连接 GitHub" : "连接 MCP 插件",
    `<form id="plugin-connect-form" class="dialog-body" data-kind="${github ? "github" : "custom"}"><label>连接名称<input class="input" name="name" maxlength="80" required value="${github ? "GitHub" : ""}" placeholder="给这个连接取个名字" /></label>
    <label>MCP 服务地址<input class="input" name="endpoint" type="url" maxlength="2000" required value="${github ? "https://api.githubcopilot.com/mcp/" : ""}" ${github ? "readonly" : ""} placeholder="https://你的服务地址/mcp" /></label>
    ${github ? '<input type="hidden" name="authMode" value="bearer" />' : '<label>授权方式<select class="input" name="authMode" id="plugin-auth-mode"><option value="none">无需令牌</option><option value="bearer">Bearer 令牌</option></select></label>'}
    <label id="plugin-token-label" ${github ? "" : "hidden"}>${github ? "GitHub 个人访问令牌" : "授权令牌"}<input class="input" name="token" type="password" maxlength="4096" autocomplete="off" spellcheck="false" data-plugin-secret ${github ? "required" : ""} placeholder="仅在连接时填写，不在页面回显" /></label>
    <p class="field-help">凭据加密保存在本机服务端，按工作台账号隔离，不包含在工作空间 JSON 备份中。</p>
    ${github ? '<p class="plugin-auth-help"><a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener noreferrer">打开 GitHub 令牌设置</a>，选择需要协作的仓库和权限。每次工具执行前会展示具体操作供你确认。</p>' : '<p class="plugin-auth-help">填写远程 MCP 的最终 HTTPS 地址，支持无需授权或 Bearer 令牌的 Streamable HTTP 服务。</p>'}
    <p class="dialog-error" id="form-error" role="alert"></p><div class="dialog-actions">${button("close-dialog", "取消", "", "btn")}<button class="btn btn-primary" type="submit">连接并验证</button></div></form>`);
}
async function pluginDetails(id) {
  const cycle = chatAccountCycle;
  const connection = await sync.request("/api/plugins/" + encodeURIComponent(id));
  if (cycle !== chatAccountCycle) return;
  pluginDetailsCache.set(id, connection);
  const selected = new Set(connection.selectedTools);
  openDialog(connection.name + " · 可用工具",
    `<form id="plugin-tools-form" class="dialog-body" data-id="${e(id)}" data-revision="${connection.revision}"><p>选择允许模型在对话中请求的工具，最多 40 项。实际执行仍需确认。</p>
    <div class="plugin-tool-list">${connection.tools.map(tool => `<article class="plugin-tool-row" data-tool-name="${e(tool.name)}"><label><input type="checkbox" name="tools" value="${e(tool.name)}" ${selected.has(tool.name) ? "checked" : ""} /><span><strong>${e(tool.title || tool.name)}</strong><code>${e(tool.name)}</code><small>${e(tool.description)}</small></span></label>
      ${button("plugin-tool-open", "执行工具", "arrow", "btn", `data-id="${e(id)}" data-tool="${e(tool.name)}" ${connection.enabled ? "" : "disabled"}`)}</article>`).join("") || empty("puzzle", "暂无可用工具", "此服务暂未开放工具，请检查权限后重新验证连接。")}</div>
    <p class="dialog-error" id="form-error" role="alert"></p><div class="dialog-actions">${button("close-dialog", "关闭", "", "btn")}<button class="btn btn-primary" type="submit">保存对话工具</button></div></form>`, "plugin-tools-dialog");
}
function toolExample(schema) {
  const result = Object.create(null);
  for (const name of (schema.required || []).slice(0, 15)) {
    const property = schema.properties?.[name] || {};
    result[name] = property.default ?? property.enum?.[0] ?? ({ string: "", integer: 0, number: 0, boolean: false, array: [], object: {} }[property.type] ?? "");
  }
  return JSON.stringify(result, null, 2);
}
function pluginToolEditor(id, name) {
  const connection = pluginDetailsCache.get(id), tool = connection?.tools.find(tool => tool.name === name);
  if (!connection || !tool) throw new Error("请先打开插件工具列表。");
  openDialog(connection.name + " · " + (tool.title || tool.name),
    `<form id="plugin-call-form" class="dialog-body" data-id="${e(id)}" data-tool="${e(name)}" data-revision="${connection.revision}" data-request-id="${uid("invoke")}"><p>${e(tool.description)}</p>
    <details class="plugin-schema"><summary>查看参数说明</summary><pre>${e(JSON.stringify(tool.inputSchema, null, 2))}</pre></details>
    <label>工具参数（JSON）<textarea class="input plugin-arguments" id="plugin-call-args" name="arguments" maxlength="40000" required spellcheck="false">${e(toolExample(tool.inputSchema))}</textarea></label>
    <p class="field-help">点击“执行工具”后，这些参数会发送至 ${e(new URL(connection.endpoint).origin)}。</p>
    <p class="dialog-error" id="form-error" role="alert"></p><div id="plugin-call-result" aria-live="polite"></div>
    <div class="dialog-actions">${button("close-dialog", "关闭", "", "btn")}${button("plugin-new-call", "准备新调用", "plus", "btn", "hidden data-new-call")}<button class="btn btn-primary" type="submit">执行工具</button></div></form>`);
}
async function pluginPicker() {
  await refreshPlugins(true);
  const connections = pluginConnections.filter(pluginReady);
  openDialog("选择对话插件",
    `<form id="plugin-picker-form" class="dialog-body"><p>本次发送的请求可使用所选服务。模型提出工具操作后，会先展示名称和参数供你确认。</p>
    ${connections.length ? `<div class="plugin-picker-list">${connections.map(connection => `<label><input type="checkbox" name="plugins" value="${e(connection.id)}" ${selectedPluginIds.has(connection.id) ? "checked" : ""} /><span><strong>${e(connection.name)}</strong><small>${connection.selectedCount} 项工具可用于对话</small></span></label>`).join("")}</div>` : empty("puzzle", "还没有可用于对话的插件", "先连接插件并选择对话工具。", '<a class="btn" href="#plugins">前往连接插件</a>')}
    ${modelConfig.toolCalling !== true ? notice("当前模型服务端尚未提供对话工具调用能力，请先更新服务端；插件页仍可独立执行工具。") : ""}
    <p class="dialog-error" id="form-error" role="alert"></p><div class="dialog-actions">${button("close-dialog", "取消", "", "btn")}<button class="btn btn-primary" type="submit">确认选择</button></div></form>`);
}

function todoEditor(id = "") {
  const todo = (state.todos || []).find(item => item.id === id);
  if (id && !todo) throw new Error("任务已不存在，请刷新后重试。");
  openDialog(todo ? "编辑任务" : "新建任务",
    `<form id="todo-form" class="dialog-body" data-id="${e(id)}"><label>任务名称<input class="input" name="title" maxlength="100" required value="${e(todo?.title || "")}" placeholder="下一步，想完成什么？" autofocus /></label>
    <label>备注<textarea class="input" name="notes" maxlength="2000" placeholder="补充任务背景或具体步骤（选填）">${e(todo?.notes || "")}</textarea></label>
    <p class="dialog-error" id="form-error" role="alert"></p><div class="dialog-actions">${button("close-dialog", "取消", "", "btn")}<button class="btn btn-primary" type="submit">保存任务</button></div></form>`);
}
async function handlePluginForm(form, data) {
  const cycle = chatAccountCycle, submit = form.querySelector('button[type="submit"]');
  const label = submit?.textContent;
  if (submit) { submit.disabled = true; submit.textContent = "正在处理…"; }
  try {
    if (form.id === "plugin-connect-form") {
      const value = await pluginRequest("/api/plugins/connect", { kind: form.dataset.kind,
        name: String(data.get("name")), endpoint: String(data.get("endpoint")),
        authMode: String(data.get("authMode")), token: String(data.get("token") || "") });
      form.querySelector("[data-plugin-secret]").value = "";
      if (!value || cycle !== chatAccountCycle) return;
      await refreshPlugins(true);
      closeDialog();
      toast("已连接 " + value.name + "，发现 " + value.toolCount + " 项工具");
    } else if (form.id === "plugin-tools-form") {
      const value = await pluginRequest("/api/plugins/" + form.dataset.id + "/configure", {
        revision: Number(form.dataset.revision), selectedTools: data.getAll("tools").map(String) });
      if (!value || cycle !== chatAccountCycle) return;
      pluginDetailsCache.delete(form.dataset.id);
      await refreshPlugins(true);
      closeDialog();
      toast("对话工具选择已保存");
    } else if (form.id === "plugin-picker-form") {
      const ids = data.getAll("plugins").map(String);
      if (ids.length > 4 || ids.some(id => !pluginConnections.some(connection => connection.id === id && pluginReady(connection))))
        throw new Error("请选择最多 4 个可用插件。");
      selectedPluginIds.clear();
      ids.forEach(id => selectedPluginIds.add(id));
      closeDialog();
      render();
      document.querySelector("#message-input")?.focus();
    } else if (form.id === "plugin-call-form") {
      let args;
      try { args = JSON.parse(String(data.get("arguments"))); } catch { throw new Error("请输入有效的 JSON 参数。"); }
      if (!args || typeof args !== "object" || Array.isArray(args)) throw new Error("工具参数必须是 JSON 对象。");
      form.dataset.sent = "true";
      form.querySelector("#plugin-call-args").readOnly = true;
      const value = await pluginRequest("/api/plugins/" + form.dataset.id + "/call", {
        toolName: form.dataset.tool, arguments: args, revision: Number(form.dataset.revision), requestId: form.dataset.requestId });
      if (!value || cycle !== chatAccountCycle) return;
      const status = ({ success: "工具执行完成", error: "工具请求失败", unknown: "操作结果未确认", running: "操作仍在执行" })[value.status] || "已记录调用";
      form.querySelector("#plugin-call-result").innerHTML = `<section class="plugin-result" data-call-status="${e(value.status)}"><h3>${status}</h3>
        ${value.error ? `<p>${e(value.error)}</p>` : ""}${value.result ? `<pre>${e(JSON.stringify(value.result, null, 2))}</pre>` : ""}
        ${value.status === "unknown" ? "<p>请先核对远端状态，再决定是否发起新的调用。</p>" : ""}</section>`;
      form.dataset.finished = "true";
      form.querySelector("[data-new-call]").hidden = false;
      await refreshPlugins(true);
    }
  } finally {
    if (submit?.isConnected) {
      submit.disabled = form.dataset.finished === "true";
      submit.textContent = form.dataset.sent === "true" && form.dataset.finished !== "true" ? "恢复结果" : label;
    }
  }
}
function pluginApprovalView(taskId, approval) {
  return `<section class="plugin-approval" aria-label="确认插件操作"><div class="plugin-approval-title">${icon("puzzle")}<strong>确认使用插件</strong></div>
    <p>确认后，将以下参数发送给对应服务并执行工具。</p>
    ${approval.calls.map(call => `<details class="plugin-plan" open><summary>${e(call.pluginName)} · ${e(call.name)}</summary><small>${e(call.endpoint)}</small><pre>${e(JSON.stringify(call.arguments, null, 2))}</pre></details>`).join("")}
    <div class="plugin-approval-actions">${button("plugin-approve", "确认并执行", "check", "btn btn-primary", `data-id="${e(taskId)}"`)}
      ${button("plugin-reject", "取消操作", "", "btn", `data-id="${e(taskId)}"`)}</div></section>`;
}
function acceptPluginReply(taskId, result) {
  if (result.approval) {
    if (!Array.isArray(result.approval.calls) || !result.approval.calls.length || result.approval.calls.length > 4)
      throw new Error("插件确认信息无效，未执行操作。");
    pluginApprovals.set(taskId, result.approval);
    return;
  }
  pluginApprovals.delete(taskId);
  if (result.cancelled || result.interrupted) {
    mutate(next => {
      const task = next.tasks.find(task => task.id === taskId);
      if (task) { task.status = "failed"; task.error = String(result.message).slice(0, 500); task.pluginUncertain = Boolean(result.interrupted); }
    });
    return;
  }
  mutate(next => finishChat(next, taskId, result));
  if (result.finishReason === "length") toast("回复达到长度上限，可以发送“请继续”。");
}
async function waitPluginRun(value, cycle) {
  const until = Date.now() + 300000;
  while (value.processing) {
    if (cycle !== chatAccountCycle || !sync.authenticated) return null;
    if (typeof value.runId !== "string" || !/^agent_[a-f0-9]{32}$/.test(value.runId)) throw new Error("插件任务状态无效。");
    if (Date.now() > until) throw new Error("插件任务仍在处理，请恢复回复核对结果。");
    await new Promise(resolve => setTimeout(resolve, 1000));
    value = await sync.request("/api/plugin-runs/" + encodeURIComponent(value.runId));
  }
  return value;
}
async function answerPluginApproval(taskId, approve) {
  const approval = pluginApprovals.get(taskId), task = state.tasks.find(task => task.id === taskId);
  if (!approval || !task || chatPending) throw new Error("请先恢复当前插件任务状态。");
  const cycle = chatAccountCycle;
  chatPending = { taskId, sessionId: task.sessionId, pluginPhase: "executing" };
  render();
  try {
    const started = await pluginRequest("/api/plugin-runs/" + approval.runId + "/decide", { approvalId: approval.approvalId, approve });
    if (!started || cycle !== chatAccountCycle) return;
    const result = await waitPluginRun(started, cycle);
    if (!result || cycle !== chatAccountCycle) return;
    acceptPluginReply(taskId, result);
    await refreshPlugins(true);
  } catch (error) {
    if (cycle !== chatAccountCycle) return;
    pluginApprovals.delete(taskId);
    mutate(next => {
      const record = next.tasks.find(task => task.id === taskId);
      if (record) { record.status = "pending"; record.error = "请恢复回复核对插件结果：" + error.message.slice(0, 350); }
    });
    toast(error.message, true);
  } finally { if (cycle === chatAccountCycle) { chatPending = null; render(); } }
}

function historyResults() {
  const sessions = sortedConversations(historyQuery);
  return (historyQuery.trim() ? `<p class="history-result-count">找到 ${sessions.length} 段对话</p>` : "") +
    conversationList(sessions, Boolean(historyQuery.trim()));
}
function historyPage() {
  return heading("历史对话", "回到上一次思考，继续下一步。",
    button("export-history", "导出对话", "download", "btn")) +
    `<div class="toolbar"><span class="history-total">共 ${state.sessions.length} 段对话</span>${searchField("history-search", "搜索对话标题或内容…", historyQuery)}</div><div id="history-results" aria-live="polite">${historyResults()}</div>`;
}
function chatPage() {
  const session = state.sessions.find((s) => s.id === route().id);
  return `<div class="chat-layout"><aside class="chat-sidebar" aria-label="历史会话">${button("new-chat", "新对话", "plus", "btn")}<p>历史会话 · ${state.sessions.length}</p>${[
    ...state.sessions,
  ]
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .map(
      (s) =>
        `<a href="#chat/${s.id}" class="session-link ${session?.id === s.id ? "active" : ""}" ${session?.id === s.id ? 'aria-current="page"' : ""} title="${e(s.title)}">${e(s.title)}<small>${dateText(s.updatedAt)} · 本地保存</small></a>`,
    )
    .join(
      "",
    )}${!state.sessions.length ? '<p class="empty-history">还没有会话，<br>从一个小问题开始吧。</p>' : ""}</aside><section class="chat-main" aria-label="AI 对话"><div class="chat-header"><h1 tabindex="-1" id="page-title">${session ? e(session.title) : "新的一段思考"}</h1><div><span class="server-sync-label" data-server-label>${e(sync?.label || "正在连接服务器")}</span><span class="demo-badge" data-model-label>${e(activeModel().ready ? activeModel().model : "模型未就绪")}</span>${session ? iconButton("export-session", "导出会话", "download", `data-id="${session.id}"`) + iconButton("delete-session", "删除会话", "trash", `data-id="${session.id}"`) : ""}</div></div><div class="messages" id="messages">${
    session
      ? session.messages
          .map(
            (m) =>
              `<article class="message ${m.role}"><div class="avatar">${m.role === "user" ? "我" : icon("spark")}</div><div class="message-body"><div class="message-label">${m.role === "user" ? "你" : `智作台 <span class="demo-badge">${m.demo ? "历史演示消息" : e(m.model)}</span>`}<time datetime="${e(m.createdAt)}">${dateText(m.createdAt, true)}</time></div><div class="message-content">${m.role === "user" ? e(m.content) : markdown(m.content)}</div><div class="message-actions">${button("copy-message", `${icon("copy")} 复制`, "", "btn btn-quiet", `data-id="${m.id}"`)}${m.role === "assistant" ? button("regenerate", `${icon("refresh")} 重新生成`, "", "btn btn-quiet", `data-id="${m.id}"`) : ""}</div></div></article>`,
          )
          .join("")
      : `<div class="chat-welcome"><div class="brand-mark">${icon("spark")}</div><h2>让每个想法，都有回响。</h2><p>写下一个问题，或选一个方向开始。<br><span data-model-summary>${e(activeModel().ready ? "已连接 " + activeModel().provider + " · " + activeModel().model : activeModel().message)}</span></p><div class="suggestions">${STARTERS.filter(
          (s) => s.id !== "translate",
        )
          .map((s) =>
            button(
              "starter",
              e(s.title),
              s.icon,
              "suggestion",
              `data-id="${s.id}"`,
            ),
          )
          .join("")}</div></div>`
  }${chatRequestNotice(session)}</div><div class="chat-composer">${composer()}<div class="privacy-line">${icon("shield")}${e(modelPrivacy())}</div></div></section></div>`;
}
function settingsPage() {
  return (
    heading("设置", "管理你的账号、工作空间与使用偏好。") +
    `<div class="settings-grid">${accountSettings()}${workspaceSettings()}<div>${serverSettings()}<section class="settings-card"><h2>${icon("sun")}外观与偏好</h2><p>让工作台呈现你喜欢的样子。</p><div class="setting-row"><div><strong>界面主题</strong><small>跟随系统或选择固定主题</small></div><div class="segmented" role="group" aria-label="界面主题">${[
      ["light", "浅色"],
      ["dark", "深色"],
      ["system", "系统"],
    ]
      .map(([id, label]) =>
        button(
          "theme",
          label,
          "",
          state.settings.theme === id ? "active" : "",
          `data-id="${id}" aria-pressed="${state.settings.theme === id}"`,
        ),
      )
      .join(
        "",
      )}</div></div><div class="setting-row"><div><strong>默认助手</strong><small>选择通用、写作或编程风格；实际模型跟随服务端设置</small></div><select class="input" data-setting="model" aria-label="默认助手">${modelOptions()}</select></div></section><section class="settings-card"><h2>${icon("spark")}模型连接</h2><p>模型配置由智作台服务端统一管理，保存后自动同步。</p><div class="connection-state"><strong>AI 模型服务</strong><span class="status-pill" data-model-label>${e(activeModel().ready ? activeModel().model : "等待配置")}</span></div>${notice("发送消息时，对话上下文和你选入的文本会发送给服务端配置的模型服务。API 密钥仅由服务端使用，不下发到浏览器。")}<div class="setting-row">${button("connection-help", "查看接入说明", "arrow", "btn")}</div></section><section class="settings-card"><h2>${icon("shield")}本地数据</h2><p>${sync?.mode === "server" ? "内容保存在本机数据库，容器重建后继续保留。也可以导出 JSON 备份并在需要时恢复。" : "内容保存在当前浏览器，清理浏览器前请导出 JSON 备份。"}</p><div class="settings-actions">${button("export-all", "导出全部数据", "download", "btn")}${button("import-backup", "恢复备份", "upload", "btn")}${button("reset", "重置工作台", "trash", "btn btn-danger")}</div><input type="file" id="backup-input" accept="application/json,.json" hidden /></section></div><aside><section class="settings-card"><h2>${icon("help")}使用帮助</h2><ol class="help-list"><li>在提示词库点亮星标，常用方法就会出现在首页。</li><li>用全局搜索查找提示词、历史对话与资料正文。</li><li>在知识库添加文本，可将内容带入对话输入框。</li><li>按 Ctrl / ⌘ + K 打开搜索，按 Esc 关闭弹窗。</li></ol><div class="settings-actions">${button("help", "打开使用帮助", "help", "btn")}</div></section><section class="settings-card"><h2>${icon("layers")}关于智作台</h2><p>一个让创作、思考与日常工作从容发生的 AI 工作空间。</p><div class="connection-state"><span>版本</span><strong>0.3.0 · 本地服务版</strong></div></section></aside></div>`
  );
}
function accountSettings() {
  const user = sync?.authenticated ? sync.user : null;
  const enabled = sync?.mode === "server" && Boolean(user);
  const account = user?.account || (sync?.mode === "local" ? "浏览器模式" : "未登录");
  return `<section class="settings-card account-settings" data-account-management aria-labelledby="account-settings-title">
    <h2 id="account-settings-title">${icon("shield")}账号管理</h2>
    <p>${enabled ? "管理当前登录账号，或登录其他账号进入独立工作空间。" : "连接并登录工作台后，可在这里管理账号。"}</p>
    <div class="account-summary"><span class="account-avatar" aria-hidden="true">${e(user?.account?.slice(0, 1).toUpperCase() || "我")}</span>
      <div class="account-identity"><strong data-current-account>${e(account)}</strong><small data-current-email>${e(user?.email || (enabled ? "未设置邮箱" : "尚未连接账号"))}</small></div>
      ${enabled ? '<span class="account-current-badge">当前账号</span>' : ""}
    </div>
    <div class="settings-actions"><button type="button" class="btn btn-primary" data-sync="add-account" ${enabled ? "" : "disabled"}>${icon("plus")}添加其他账号登录</button><button type="button" class="btn" data-sync="logout" ${enabled ? "" : "disabled"}>退出当前账号</button></div>
    <p class="account-help">各账号的内容独立保存，切换账号后可继续访问原有数据。</p>
  </section>`;
}
function workspaceSettings() {
  return `<section class="settings-card settings-workspace" data-settings-workspace aria-labelledby="workspace-settings-title">
    <h2 id="workspace-settings-title">${icon("layers")}我的工作空间</h2>
    <p>${sync?.mode === "server" ? "当前账号的创作与资料概览。" : "当前浏览器中保存的创作与资料概览。"}</p>
    <div class="settings-workspace-stats">
      <div><strong>${state.prompts.filter(p => p.favorite).length}</strong><span>收藏提示词</span></div>
      <div><strong>${state.documents.length}</strong><span>知识资料</span></div>
      <div><strong>${state.sessions.length}</strong><span>累计对话</span></div>
    </div>
    <p class="workspace-settings-note">数据导出、备份与恢复可在下方“本地数据”中管理。</p>
  </section>`;
}
function serverSettings() {
  return `<section class="settings-card"><h2>${icon("shield")}本机服务器</h2><p>${sync?.mode === "server" ? "会话、提示词、资料与设置由本机数据库统一保存，其他已登录页面会自动同步。" : "静态部署使用浏览器保存。运行本机 Docker 服务后可启用数据库与自动同步。"}</p><div class="connection-state"><span>保存状态</span><strong data-server-label>${e(sync?.label || "正在连接")}</strong></div><div class="connection-state"><span>运行版本</span><strong data-server-version>${e(sync?.version?.slice(0, 12) || "静态演示版")}</strong></div><div class="settings-actions"><button type="button" class="btn" data-sync="retry">重新连接</button></div></section>`;
}
function render() {
  const textarea = document.querySelector("#message-input");
  if (textarea) drafts.set(textarea.form.dataset.draft, textarea.value);
  const { page } = route();
  applyTheme();
  const title = nav.find((n) => n[0] === page)[1];
  document.title = `${title} · 智作台`;
  document.body.classList.remove("sidebar-open");
  app.innerHTML = `<div class="app-shell"><aside class="sidebar" id="sidebar" aria-label="主导航"><a class="brand" href="#home" aria-label="智作台首页"><span class="brand-mark">${icon("spark")}</span><span><span class="brand-name">智作台</span><span class="brand-caption">YOUR AI WORKSPACE</span></span></a><p class="workspace-label">工作空间</p><nav aria-label="工作空间导航">${button("new-chat", "新对话", "plus", "btn btn-primary sidebar-new-chat")}${nav
    .filter(([id]) => id !== "settings")
    .map(
      ([id, label, name]) =>
        `<a class="nav-link ${page === id ? "active" : ""}" href="#${id}" ${page === id ? 'aria-current="page"' : ""}>${icon(name)}${label}${id === "prompts" && page !== id ? `<span class="count">${state.prompts.length}</span>` : ""}</a>`,
    )
    .join(
      "",
    )}</nav><div class="sidebar-bottom"><div class="sidebar-settings-wrap"><a href="#settings" class="nav-link sidebar-settings ${page === "settings" ? "active" : ""}" ${page === "settings" ? 'aria-current="page"' : ""}>${icon("settings")}<span>设置<small>账号、工作空间与偏好</small></span>${icon("chevron")}</a></div></div></aside><button class="sidebar-backdrop" data-action="close-menu" aria-label="关闭导航" tabindex="-1"></button><div class="workspace"><header class="topbar">${button("toggle-sidebar", '<span data-sidebar-toggle-label>收起侧边栏</span>', "sidebar-close", "sidebar-toggle", 'aria-label="收起侧边栏" title="收起侧边栏" aria-expanded="true" aria-controls="sidebar" data-menu-button')}<div class="breadcrumb"><span>工作空间</span><span>/</span><span>${title}</span></div><div class="topbar-tools">${button("search", "<span>搜索工作空间…</span><kbd>⌘ K</kbd>", "search", "search-trigger", 'aria-label="搜索工作空间"')}<span class="server-sync-label" data-server-label>${e(sync?.label || "正在连接服务器")}</span><span class="demo-badge" data-model-label>${e(activeModel().ready ? activeModel().model : "模型未就绪")}</span></div></header><main class="main" id="main" tabindex="-1"><div id="sync-conflict" class="sync-banner" ${sync?.conflict ? "" : "hidden"}><span>其他页面有新修改。本页内容已保留，请选择同步版本。</span><button type="button" class="btn" data-sync="use-server">采用服务器版本</button><button type="button" class="btn" data-sync="use-local">保留本页内容</button></div><div id="sync-version" class="sync-banner" ${newServerVersion ? "" : "hidden"}><span>新版本已部署。你的输入仍保留，刷新即可使用。</span><button type="button" class="btn" data-sync="reload">刷新到新版本</button></div>${{ home: homePage, todo: todoPage, plugins: pluginsPage, prompts: promptsPage, knowledge: knowledgePage, tasks: historyPage, chat: chatPage, settings: settingsPage }[page]()}${page === "chat" ? "" : '<footer class="footer"><span>智作台 · 让想法有处落地</span><span>为每一份专注而设计 &nbsp; / &nbsp; 本地服务版 0.3</span></footer>'}</main></div></div>`;
  syncSidebar();
  const messages = document.querySelector("#messages");
  if (messages) messages.scrollTop = messages.scrollHeight;
  if (focusNewConversation && page === "chat" && !route().id) {
    focusNewConversation = false;
    requestAnimationFrame(() => {
      if (route().page === "chat" && !route().id) document.querySelector("#message-input")?.focus();
    });
  }
  sync?.refreshStatus();
}

let confirmAction = null;
function openDialog(title, content, className = "") {
  if (!dialog.open) dialogOrigin = document.activeElement;
  dialog.className = className;
  dialog.innerHTML = `<div class="dialog-header"><h2 id="dialog-title">${e(title)}</h2>${iconButton("close-dialog", "关闭弹窗", "close")}</div>${content}`;
  if (!dialog.open) dialog.showModal();
}
function closeDialog() {
  dialog.querySelectorAll("[data-plugin-secret]").forEach(input => { input.value = ""; });
  dialog.close();
  confirmAction = null;
  if (pluginViewDirty && route().page === "plugins") {
    pluginViewDirty = false;
    render();
    document.querySelector("#page-title")?.focus();
  } else if (dialogOrigin?.isConnected) dialogOrigin.focus();
}
function confirmDialog(title, description, label, fn) {
  confirmAction = fn;
  openDialog(
    title,
    `<div class="dialog-body"><p>${e(description)}</p><div class="dialog-actions">${button("close-dialog", "取消", "", "btn")}${button("confirm", e(label), "", "btn btn-danger")}</div></div>`,
  );
}
function promptEditor(id = "") {
  const p = state.prompts.find((p) => p.id === id);
  openDialog(
    p ? "查看与编辑提示词" : "创建你的提示词",
    `<form id="prompt-form" class="dialog-body" data-id="${p?.id || ""}"><label>名称<input class="input" name="title" maxlength="80" required value="${e(p?.title || "")}" placeholder="给这个好方法取个名字" /></label><label>分类<select class="input" name="category">${CATEGORIES.map((c) => `<option ${p?.category === c ? "selected" : ""}>${c}</option>`).join("")}</select></label><label>一句话描述<input class="input" name="description" maxlength="200" value="${e(p?.description || "")}" placeholder="它能帮你完成什么？" /></label><label>提示词内容<textarea class="input" name="content" maxlength="20000" required placeholder="写下角色、背景和你期待的结果…">${e(p?.content || "")}</textarea></label><p class="field-help">使用时会带入对话输入框，你可以补充背景再发送。</p><p class="dialog-error" id="form-error" role="alert"></p><div class="dialog-actions">${p ? button("delete-prompt", "删除", "trash", "btn btn-danger", `data-id="${p.id}"`) : ""}${button("close-dialog", "取消", "", "btn")}<button class="btn btn-primary" type="submit">保存提示词</button></div></form>`,
  );
}
function showDocument(id) {
  const d = state.documents.find((d) => d.id === id);
  if (!d) return;
  openDialog(
    d.name,
    `<div class="dialog-body"><p>${e(d.tag)} · ${d.size} 字节 · ${d.kind === "text" ? "文本已读取，仅在本地保存" : "仅保存文件信息，未上传或解析"}</p>${d.kind === "text" ? `<pre class="preview-text">${e(d.content)}</pre><div class="dialog-actions">${button("copy-document", "复制文本", "copy", "btn", `data-id="${d.id}"`)}${button("attach-document", "带入对话", "chat", "btn btn-primary", `data-id="${d.id}"`)}</div>` : notice("本版本暂不解析此格式，也未保存文件二进制内容。请将需要讨论的段落另存为 TXT 或 Markdown 后添加。")}</div>`,
  );
}
function showSearch() {
  openDialog(
    "搜索工作空间",
    `<div class="global-search-input">${icon("search")}<input type="search" id="global-search" aria-label="搜索任务、提示词、历史对话与资料" maxlength="100" placeholder="搜索任务、提示词、历史对话与资料…" autocomplete="off" autofocus /></div><div id="global-results" class="search-results" aria-live="polite">${empty("search", "把需要的内容，找回来", "输入关键词，搜索你的整个工作空间。")}</div><div class="search-help">输入关键词搜索 · Tab 选择结果 · Esc 关闭</div>`,
    "search-dialog",
  );
  document.querySelector("#global-search").focus();
}
function updateSearch(query) {
  const results = searchWorkspace(state, query);
  document.querySelector("#global-results").innerHTML = results.length
    ? results
        .map(
          (r) =>
            `<button class="search-result" data-action="search-result" data-kind="${r.kind}" data-id="${r.id}">${icon({ prompt: "layers", session: "chat", document: "file", task: "history", todo: "list" }[r.kind])}<span><strong>${e(r.title)}</strong><small>${e(r.label)}</small></span></button>`,
        )
        .join("")
    : empty(
        "search",
        query.trim() ? "没有找到相关内容" : "把需要的内容，找回来",
        query.trim()
          ? "试试更短的关键词，或检查是否已保存。"
          : "输入关键词，搜索你的整个工作空间。",
      );
}
function draftChat(text, type = "AI 对话") {
  pendingType = type;
  const input = document.querySelector("#message-input");
  if (input?.form.dataset.draft === "new") input.value = text;
  drafts.set("new", text);
  go("chat");
  requestAnimationFrame(() =>
    document.querySelector("#message-input")?.focus(),
  );
}
async function copy(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast("已复制到剪贴板");
  } catch {
    openDialog(
      "复制内容",
      `<div class="dialog-body"><p>浏览器未允许直接复制，请选中下方文本后复制。</p><textarea class="input" readonly aria-label="待复制的内容">${e(text)}</textarea></div>`,
    );
    dialog.querySelector("textarea").select();
  }
}
function download(filename, text, type = "application/json") {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function exportJSON(filename, value) {
  download(filename, JSON.stringify(value, null, 2));
  toast("已导出，请查看浏览器下载记录");
}
function syncPromptResults() {
  const target = document.querySelector("#prompt-results");
  if (target) {
    target.innerHTML = promptResults();
    document.querySelector("#prompt-tabs").innerHTML = tabs(
      ["全部", "已收藏", ...CATEGORIES],
      promptFilter,
      "prompt-filter",
    );
  }
}
function syncDocumentResults() {
  const target = document.querySelector("#document-results");
  if (target) {
    target.innerHTML = documentResults();
    document.querySelector("#document-tabs").innerHTML = documentTabs();
  }
}
async function addFiles(files) {
  let count = 0;
  const errors = [];
  for (const file of files) {
    try {
      if (file.size > MAX_FILE_SIZE) throw new Error("超过 1 MB");
      if (file.name.length > 300) throw new Error("文件名过长");
      if (state.documents.length >= 1000) throw new Error("资料数量已达上限");
      const text = /\.(txt|md|markdown|csv|json)$/i.test(file.name);
      const content = text ? await file.text() : "";
      if (
        content.length > MAX_FILE_SIZE ||
        state.documents.reduce((n, d) => n + d.content.length, 0) +
          content.length >
          MAX_DOCUMENT_CHARS
      )
        throw new Error("超出本地文本容量，请先导出并删除部分资料");
      if (text && content.includes("\u0000"))
        throw new Error("文件包含二进制内容，请使用 UTF-8 文本");
      mutate((next) =>
        next.documents.unshift({
          id: uid("document"),
          name: file.name,
          size: file.size,
          kind: text ? "text" : "metadata",
          content,
          tag: "未分类",
          createdAt: new Date().toISOString(),
        }),
      );
      count++;
    } catch (error) {
      errors.push(`${file.name}：${error.message}`);
    }
  }
  syncDocumentResults();
  const fileInput = document.querySelector("#file-input");
  if (fileInput) fileInput.value = "";
  if (errors.length)
    openDialog(
      "资料添加结果",
      `<div class="dialog-body"><p>已添加 ${count} 份资料。以下文件未保存：</p><div class="preview-text">${e(errors.join("\n"))}</div></div>`,
    );
  else if (count) toast(`已在本地添加 ${count} 份资料`);
}
function syncSidebar() {
  const expanded = mobile.matches ? document.body.classList.contains("sidebar-open") : !sidebarCollapsed;
  document.body.classList.toggle("sidebar-collapsed", !mobile.matches && sidebarCollapsed);
  const sidebar = document.querySelector("#sidebar");
  const toggle = document.querySelector("[data-menu-button]");
  if (!expanded && sidebar.contains(document.activeElement)) toggle.focus();
  sidebar.inert = !expanded;
  sidebar.setAttribute("aria-hidden", String(!expanded));
  document.querySelector(".workspace").inert = false;
  document.querySelector(".main").inert = mobile.matches && expanded;
  document.querySelector(".topbar-tools").inert = mobile.matches && expanded;
  const label = expanded ? "收起侧边栏" : "展开侧边栏";
  toggle.setAttribute("aria-expanded", String(expanded));
  toggle.setAttribute("aria-label", label);
  toggle.title = label;
  toggle.innerHTML = icon(expanded ? "sidebar-close" : "sidebar-open") + `<span data-sidebar-toggle-label>${label}</span>`;
}
function setMenu(open, restoreFocus = true) {
  document.body.classList.toggle("sidebar-open", mobile.matches && open);
  syncSidebar();
  if (mobile.matches && open) document.querySelector(".sidebar-new-chat").focus();
  else if (restoreFocus) document.querySelector("[data-menu-button]").focus();
}
function toggleSidebar() {
  if (mobile.matches) setMenu(!document.body.classList.contains("sidebar-open"));
  else {
    sidebarCollapsed = !sidebarCollapsed;
    try { localStorage.setItem(SIDEBAR_VIEW_KEY, String(sidebarCollapsed)); } catch { /* Only the saved layout preference is optional. */ }
    syncSidebar();
  }
}

async function handleAction(target) {
  const { action, id } = target.dataset;
  if (chatPending && ['delete-session', 'reset', 'import-backup'].includes(action)) throw new Error('模型正在回复，请等待完成后再修改会话记录。');
  const session = state.sessions.find((s) => s.id === route().id);
  switch (action) {
    case "toggle-sidebar":
      toggleSidebar();
      break;
    case "close-menu":
      setMenu(false);
      break;
    case "close-dialog":
      closeDialog();
      break;
    case "confirm": {
      const fn = confirmAction;
      if (fn) {
        await fn();
        closeDialog();
      }
      break;
    }
    case "search":
      showSearch();
      break;
    case "new-chat":
      pendingType = "AI 对话";
      drafts.set("new", "");
      if (
        document.querySelector("#message-input")?.form.dataset.draft === "new"
      )
        document.querySelector("#message-input").value = "";
      focusNewConversation = true;
      go("chat");
      break;
    case "new-todo":
      todoEditor();
      break;
    case "edit-todo":
      todoEditor(id);
      break;
    case "toggle-todo": {
      const todo = (state.todos || []).find(item => item.id === id);
      if (!todo) throw new Error("任务已不存在。");
      mutate(next => setTodoDone(next, id, !todo.done));
      render();
      document.querySelector('#todo-results [data-action="toggle-todo"][data-id="' + id + '"]')?.focus();
      toast(todo.done ? "已恢复为待办任务" : "任务已完成");
      break;
    }
    case "delete-todo": {
      const todo = (state.todos || []).find(item => item.id === id);
      if (!todo) break;
      confirmDialog("删除这项任务？", todo.title, "删除任务", () => {
        mutate(next => removeTodo(next, id));
        render();
        toast("任务已删除");
      });
      break;
    }
    case "todo-filter":
      if (!["全部", "待完成", "已完成"].includes(id)) break;
      todoFilter = id;
      render();
      document.querySelector('#todo-tabs [data-id="' + id + '"]')?.focus();
      break;
    case "plugins-refresh":
      await refreshPlugins(true);
      render();
      break;
    case "plugin-connect":
      pluginConnector("custom");
      break;
    case "plugin-connect-github":
      pluginConnector("github");
      break;
    case "plugin-details":
      await pluginDetails(id);
      break;
    case "plugin-tool-open":
      pluginToolEditor(id, target.dataset.tool);
      break;
    case "plugin-picker":
      await pluginPicker();
      break;
    case "plugin-use-chat": {
      const connection = pluginConnections.find(connection => connection.id === id);
      if (!connection || !pluginReady(connection)) throw new Error("请先连接并启用此插件。");
      if (selectedPluginIds.size >= 4 && !selectedPluginIds.has(id)) throw new Error("最多同时选择 4 个对话插件。");
      selectedPluginIds.add(id);
      focusNewConversation = true;
      go("chat");
      break;
    }
    case "plugin-enable": {
      const connection = pluginConnections.find(connection => connection.id === id);
      if (!connection) break;
      const value = await pluginRequest("/api/plugins/" + id + "/configure", { revision: connection.revision, enabled: !connection.enabled });
      if (!value) break;
      await refreshPlugins(true);
      render();
      break;
    }
    case "plugin-reconnect": {
      const value = await pluginRequest("/api/plugins/" + id + "/refresh");
      if (!value) break;
      pluginDetailsCache.delete(id);
      await refreshPlugins(true);
      render();
      toast("已重新验证插件连接");
      break;
    }
    case "plugin-disconnect": {
      const connection = pluginConnections.find(connection => connection.id === id);
      if (!connection) break;
      confirmDialog("断开插件连接？", "将移除“" + connection.name + "”的本机连接与保存的凭据，保留历史调用记录。", "断开连接", async () => {
        const value = await pluginRequest("/api/plugins/" + id + "/disconnect");
        if (!value) return;
        selectedPluginIds.delete(id);
        pluginDetailsCache.delete(id);
        await refreshPlugins(true);
        toast("插件连接已断开");
      });
      break;
    }
    case "plugin-new-call": {
      const form = document.querySelector("#plugin-call-form");
      if (!form) break;
      form.dataset.requestId = uid("invoke");
      delete form.dataset.sent;
      delete form.dataset.finished;
      form.querySelector("#plugin-call-args").readOnly = false;
      form.querySelector("#plugin-call-result").innerHTML = "";
      form.querySelector("#form-error").textContent = "";
      form.querySelector('button[type="submit"]').disabled = false;
      form.querySelector('button[type="submit"]').textContent = "执行工具";
      form.querySelector("[data-new-call]").hidden = true;
      form.querySelector("#plugin-call-args").focus();
      break;
    }
    case "plugin-approve":
      await answerPluginApproval(id, true);
      break;
    case "plugin-reject":
      await answerPluginApproval(id, false);
      break;
    case "new-document":
      closeDialog();
      go("knowledge");
      break;
    case "starter": {
      const s = STARTERS.find((s) => s.id === id);
      if (s) draftChat(s.text, s.title);
      break;
    }
    case "favorite": {
      const p = state.prompts.find((p) => p.id === id);
      if (!p) break;
      mutate((next) => {
        next.prompts.find((p) => p.id === id).favorite = !p.favorite;
      });
      if (route().page === "prompts") syncPromptResults();
      else render();
      toast(p.favorite ? "已取消收藏" : "已加入常用提示词");
      break;
    }
    case "prompt-filter":
      promptFilter = id;
      syncPromptResults();
      break;
    case "document-filter":
      documentFilter = id;
      syncDocumentResults();
      break;
    case "new-prompt":
      promptEditor();
      break;
    case "view-prompt":
      promptEditor(id);
      break;
    case "use-prompt": {
      const p = state.prompts.find((p) => p.id === id);
      if (p) {
        if (dialog.open) closeDialog();
        draftChat(p.content, p.category);
        toast("提示词已带入，可补充背景后发送");
      }
      break;
    }
    case "delete-prompt": {
      const p = state.prompts.find((p) => p.id === id);
      if (!p) break;
      confirmDialog(
        "删除提示词？",
        `“${p.title}”将从当前浏览器删除。`,
        "删除提示词",
        () => {
          mutate((next) => {
            next.prompts = next.prompts.filter((p) => p.id !== id);
          });
          render();
          toast("提示词已删除");
        },
      );
      break;
    }
    case "open-session":
      go("chat", id);
      break;
    case "delete-session":
      confirmDialog(
        "删除这段对话？",
        "这段对话及其消息将一起删除。",
        "删除会话",
        () => {
          mutate((next) => removeSession(next, id));
          drafts.delete(id);
          go("chat");
          toast("会话已删除");
        },
      );
      break;
    case "export-session": {
      const s = state.sessions.find((s) => s.id === id);
      if (s) exportJSON("智作台-会话.json", s);
      break;
    }
    case "copy-message": {
      const m = session?.messages.find((m) => m.id === id);
      if (m) await copy(m.content);
      break;
    }
    case "regenerate": {
      if (chatPending || !session) throw new Error('请等待当前回复完成。');
      const index = session.messages.findIndex(message => message.id === id && message.role === 'assistant');
      const user = session.messages.slice(0, index).findLast(message => message.role === 'user');
      if (!user) break;
      const taskId = mutate(next => {
        if (next.tasks.length >= 1000) throw new Error('对话请求记录已达上限，请先清理历史。');
        const task = { id: uid('task'), requestId: uid('request'), assistant: next.settings.model, ...(next.settings.modelKey ? { modelKey: next.settings.modelKey } : {}), ...(selectedPluginIds.size ? { pluginIds: [...selectedPluginIds] } : {}), userMessageId: user.id, replaceMessageId: id, sessionId: session.id,
          title: user.content.slice(0, 60), type: '重新生成', status: 'pending', createdAt: new Date().toISOString() };
        next.tasks.unshift(task); return task.id;
      });
      await performChat(taskId); break;
    }
    case "retry-chat":
    case "resume-chat": {
      if (chatPending) throw new Error('请等待当前回复完成。');
      mutate(next => {
        const task = next.tasks.find(item => item.id === id);
        if (!task) throw new Error('请求记录不存在。');
        if (action === 'retry-chat') { task.requestId = uid('request'); if (next.settings.modelKey) task.modelKey = next.settings.modelKey; else delete task.modelKey; }
        task.status = 'pending'; delete task.error; delete task.pluginUncertain;
      });
      await performChat(id); break;
    }
    case "upload":
      document.querySelector("#file-input")?.click();
      break;
    case "view-document":
      showDocument(id);
      break;
    case "delete-document": {
      const d = state.documents.find((d) => d.id === id);
      if (!d) break;
      confirmDialog(
        "删除这份资料？",
        `“${d.name}”的本地记录将被删除。原始文件不受影响。`,
        "删除资料",
        () => {
          mutate((next) => {
            next.documents = next.documents.filter((d) => d.id !== id);
          });
          documentFilter = "全部";
          syncDocumentResults();
          toast("本地资料已删除");
        },
      );
      break;
    }
    case "document-tag": {
      const d = state.documents.find((d) => d.id === id);
      if (d)
        openDialog(
          "给资料添加标签",
          `<form class="dialog-body" id="tag-form" data-id="${d.id}"><label>标签名称<input class="input" name="tag" required maxlength="30" value="${e(d.tag)}" /></label><p class="dialog-error" id="form-error" role="alert"></p><div class="dialog-actions">${button("close-dialog", "取消", "", "btn")}<button class="btn btn-primary" type="submit">保存标签</button></div></form>`,
        );
      break;
    }
    case "copy-document": {
      const d = state.documents.find((d) => d.id === id);
      if (d) await copy(d.content);
      break;
    }
    case "attach": {
      const docs = state.documents.filter((d) => d.kind === "text");
      openDialog(
        "添加背景资料",
        `<div class="dialog-body"><p>选择一份文本资料，内容将加入新对话输入框。较长资料请先复制需要的段落。</p>${docs.length ? docs.map((d) => button("attach-document", e(d.name), "file", "search-result", `data-id="${d.id}"`)).join("") : empty("folder", "还没有可用的文本资料", "先在知识库添加 TXT、Markdown、CSV 或 JSON。", button("new-document", "前往知识库", "arrow", "btn"))}</div>`,
      );
      break;
    }
    case "attach-document": {
      const d = state.documents.find((d) => d.id === id && d.kind === "text");
      if (!d) break;
      const text = `请根据以下资料回答我的问题。\n问题：\n\n资料：${d.name}\n${d.content}`;
      if (text.length > 20000)
        throw new Error("资料文本超过对话长度限制，请在预览中复制需要的段落。");
      closeDialog();
      draftChat(text, "资料讨论");
      toast("资料文本已带入新对话，未发送给模型");
      break;
    }
    case "search-result": {
      const kind = target.dataset.kind;
      closeDialog();
      if (kind === "prompt") promptEditor(id);
      else if (kind === "document") showDocument(id);
      else if (kind === "session") go("chat", id);
      else if (kind === "todo") todoEditor(id);
      else {
        const task = state.tasks.find((t) => t.id === id);
        if (task) go("chat", task.sessionId);
      }
      break;
    }
    case "theme":
      if (["light", "dark", "system"].includes(id)) {
        mutate((next) => {
          next.settings.theme = id;
        });
        render();
      }
      break;
    case "export-all":
      exportJSON("智作台-工作空间备份.json", state);
      break;
    case "export-history":
      exportJSON("智作台-历史对话.json", sortedConversations());
      break;
    case "import-backup":
      document.querySelector("#backup-input").click();
      break;
    case "reset":
      confirmDialog(
        "重置整个工作台？",
        "所有任务、对话和资料将被清除，提示词和设置恢复初始值。建议先导出备份。此操作无法撤销。",
        "确认重置",
        () => {
          const next = createInitialState();
          persist(next);
          drafts.clear();
          promptFilter = documentFilter = "全部";
          promptQuery = documentQuery = historyQuery = todoQuery = "";
          todoFilter = "全部";
          render();
          toast("工作台已重置");
        },
      );
      break;
    case "prompt-guide":
      openDialog(
        "让提问更清楚的三个步骤",
        `<div class="dialog-body"><p>不必写很长，先把这三件事讲清楚。</p><ol class="help-list"><li><strong>给一个角色</strong>：例如“你是一位面向初学者的编程老师”。</li><li><strong>补一点背景</strong>：我在做什么、遇到什么问题、已经尝试了什么。</li><li><strong>说清结果</strong>：希望得到例子、步骤、表格，还是一份可执行清单。</li></ol><div class="mini-example">请作为一名内容编辑，面向第一次接触 AI 的读者，用一个生活中的例子解释“大模型”，控制在 200 字内。</div><div class="dialog-actions">${button("guide-use", "用这个模板开始", "arrow", "btn btn-primary")}</div></div>`,
      );
      break;
    case "guide-use":
      closeDialog();
      draftChat(
        "请作为一名内容编辑，面向第一次接触 AI 的读者，用一个生活中的例子解释“大模型”，控制在 200 字内。",
      );
      break;
    case "connection-help":
      openDialog(
        "关于模型接入",
        `<div class="dialog-body"><p>工作台通过本机服务端调用真实模型，模型和密钥在服务端统一设置。</p><ol class="help-list"><li>在智作台服务端的“API 接口设置”中保存接口地址、密钥和模型 ID。</li><li>密钥由 Windows 加密保护，工作台只读取模型名称和就绪状态。</li><li>修改配置后，工作台自动同步；下次发送立即使用服务端当前配置。</li></ol><p>通用、写作和编程助手分别使用不同的提示风格。历史演示消息继续保留标记。</p></div>`,
      );
      break;
    case "help":
      openDialog(
        "欢迎使用智作台",
        `<div class="dialog-body"><p>把常用提示词、资料和每次思考放在同一个地方。</p><ol class="help-list"><li>从首页快捷操作开始，或在提示词库选择一个模板。</li><li>发送后调用服务端配置的模型，保存真实回答和任务结果。</li><li>支持多轮会话、重新生成、复制和导出。Token 用量可在服务端总览查看。</li><li>在任务中记录待办；在插件中连接外部服务，选择对话工具并确认具体操作。</li><li>使用 Ctrl / ⌘ + K 搜索，按 Esc 关闭弹窗。</li></ol>${notice("会话由本机数据库保存。发送的消息和所选文本会交给配置的模型服务处理。")}</div>`,
      );
      break;
  }
}

document.addEventListener("click", (event) => {
  const target = event.target.closest("[data-action]");
  if (target) handleAction(target).catch((error) => toast(error.message, true));
  if (event.target.closest(".sidebar a") && mobile.matches) setMenu(false, false);
});
document.addEventListener("submit", async (event) => {
  const form = event.target;
  if (!["message-form", "prompt-form", "tag-form", "todo-form", "plugin-connect-form", "plugin-tools-form", "plugin-picker-form", "plugin-call-form"].includes(form.id)) return;
  event.preventDefault();
  const data = new FormData(form);
  try {
    if (form.id.startsWith("plugin-")) {
      await handlePluginForm(form, data);
    } else if (form.id === "message-form") {
      sendChat(String(data.get('message')), form.dataset.draft).catch(error => toast(error.message, true));
    } else if (form.id === "todo-form") {
      mutate(next => saveTodo(next, form.dataset.id, { title: String(data.get("title")), notes: String(data.get("notes")) }));
      todoFilter = "全部";
      todoQuery = "";
      closeDialog();
      render();
      toast("任务已保存");
    } else if (form.id === "prompt-form") {
      const title = String(data.get("title")).trim(),
        content = String(data.get("content")).trim();
      if (!title || !content) throw new Error("名称和提示词内容不能为空。");
      mutate((next) => {
        const p = next.prompts.find((p) => p.id === form.dataset.id);
        const fields = {
          title,
          category: String(data.get("category")),
          description: String(data.get("description")).trim(),
          content,
        };
        if (p) Object.assign(p, fields);
        else {
          if (next.prompts.length >= 1000) throw new Error("提示词已达上限");
          next.prompts.unshift({
            ...fields,
            id: uid("prompt"),
            favorite: false,
          });
        }
      });
      closeDialog();
      render();
      toast("提示词已保存");
    } else {
      const tag = String(data.get("tag")).trim();
      if (!tag) throw new Error("标签不能为空。");
      mutate((next) => {
        const d = next.documents.find((d) => d.id === form.dataset.id);
        if (d) d.tag = tag;
      });
      documentFilter = "全部";
      closeDialog();
      syncDocumentResults();
      toast("标签已更新");
    }
  } catch (error) {
    const output = form.querySelector("#form-error");
    if (output) output.textContent = error.message;
    else toast(error.message, true);
  }
});
document.addEventListener("input", (event) => {
  const { id, value } = event.target;
  if (id === "prompt-search") {
    promptQuery = value;
    syncPromptResults();
  }
  if (id === "document-search") {
    documentQuery = value;
    syncDocumentResults();
  }
  if (id === "history-search") {
    historyQuery = value;
    document.querySelector("#history-results").innerHTML = historyResults();
  }
  if (id === "todo-search") {
    todoQuery = value;
    document.querySelector("#todo-results").innerHTML = todoResults();
  }
  if (id === "global-search") updateSearch(value);
  if (id === "message-input")
    drafts.set(event.target.form.dataset.draft, value);
});
document.addEventListener("change", async (event) => {
  const target = event.target;
  try {
    if (target.id === "plugin-auth-mode") {
      const token = document.querySelector('#plugin-connect-form [name="token"]');
      token.required = target.value === "bearer";
      document.querySelector("#plugin-token-label").hidden = !token.required;
      if (!token.required) token.value = "";
    }
    if (target.dataset.setting === 'modelKey') {
      if (target.value && !(modelConfig.models || []).some(model => model.key === target.value)) throw new Error('此模型不可用，请刷新后重新选择。');
      mutate(next => { next.settings.modelKey = target.value; });
      render(); toast(target.value ? '已切换模型，下一条消息将使用所选模型。' : '已恢复跟随服务端默认模型。');
    }
    if (
      target.dataset.setting === "model" &&
      Object.hasOwn(MODELS, target.value)
    ) {
      mutate((next) => {
        next.settings.model = target.value;
      });
      toast("已切换助手风格，模型继续跟随服务端设置");
    }
    if (target.id === "file-input" && target.files.length) {
      const files = [...target.files];
      uploadQueue = uploadQueue.then(() => addFiles(files));
      await uploadQueue;
    }
    if (target.id === "backup-input" && target.files.length) {
      const file = target.files[0];
      if (file.size > 8 * 1024 * 1024)
        throw new Error("备份文件不能超过 8 MB。");
      let next;
      try {
        next = JSON.parse(await file.text());
      } catch {
        throw new Error("不是有效的 JSON 备份文件。");
      }
      const { validateState } = await import("./core.js");
      if (!validateState(next))
        throw new Error("备份格式不符合智作台的数据规范，未修改当前数据。");
      confirmDialog(
        "恢复这份备份？",
        `将替换当前本地数据：${next.prompts.length} 个提示词、${next.sessions.length} 段会话、${next.documents.length} 份资料、${(next.todos || []).length} 项任务。建议先导出现有数据。`,
        "替换并恢复",
        () => {
          persist(next);
          drafts.clear();
          promptFilter = documentFilter = "全部";
          promptQuery = documentQuery = historyQuery = todoQuery = "";
          todoFilter = "全部";
          render();
          toast("备份已恢复");
        },
      );
      target.value = "";
    }
  } catch (error) {
    toast(error.message, true);
  }
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && dialog.open) {
    event.preventDefault();
    closeDialog();
    return;
  }
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
    event.preventDefault();
    if (!dialog.open) showSearch();
  }
  if (
    event.key === "Enter" &&
    !event.shiftKey &&
    !event.isComposing &&
    event.target.id === "message-input"
  ) {
    event.preventDefault();
    event.target.form.requestSubmit();
  }
  if (
    event.key === "Escape" &&
    document.body.classList.contains("sidebar-open")
  )
    setMenu(false);
  if (event.key === "Tab" && !dialog.open && document.body.classList.contains("sidebar-open")) {
    const focusable = [...document.querySelectorAll(".sidebar a, .sidebar button:not(:disabled)"), document.querySelector("[data-menu-button]")];
    const first = focusable[0],
      last = focusable.at(-1);
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    }
    if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }
});
for (const name of ["dragenter", "dragover", "dragleave", "drop"]) {
  document.addEventListener(name, (event) => {
    const zone = event.target.closest("#upload-zone");
    if (!zone) return;
    event.preventDefault();
    zone.classList.toggle(
      "dragging",
      name === "dragenter" || name === "dragover",
    );
    if (name === "drop" && event.dataTransfer.files.length) {
      const files = [...event.dataTransfer.files];
      uploadQueue = uploadQueue
        .then(() => addFiles(files))
        .catch((error) => toast(error.message, true));
    }
  });
}
dialog.addEventListener("cancel", (event) => {
  event.preventDefault();
  closeDialog();
});
dialog.addEventListener("click", (event) => {
  if (event.target !== dialog) return;
  const rect = dialog.getBoundingClientRect();
  if (
    event.clientX < rect.left ||
    event.clientX > rect.right ||
    event.clientY < rect.top ||
    event.clientY > rect.bottom
  )
    closeDialog();
});
window.addEventListener("hashchange", () => {
  if (dialog.open) closeDialog();
  render();
  document.querySelector("#page-title")?.focus({ preventScroll: true });
});
systemTheme.addEventListener("change", applyTheme);
mobile.addEventListener("change", () => setMenu(false, false));
render();
if (initial.warning) toast(initial.warning, true);
function clearAccountView() {
  chatAccountCycle++;
  chatPending = null;
  pluginConnections = []; pluginHistory = []; pluginError = ""; pluginsLoaded = false; pluginLoading = false; pluginChecked = 0; pluginViewDirty = false;
  selectedPluginIds.clear(); pluginDetailsCache.clear(); pluginApprovals.clear();
  focusNewConversation = false;
  modelConfigPending = false;
  modelConfigChecked = 0;
  modelConfig = { ready: false, model: '', provider: '', message: '请登录后查看模型配置。' };
  if (dialog.open) closeDialog();
  dialog.innerHTML = "";
  state = createInitialState();
  drafts.clear();
  promptFilter = documentFilter = "全部";
  promptQuery = documentQuery = historyQuery = todoQuery = "";
  todoFilter = "全部";
  app.innerHTML = "";
  render();
}
sync = new WorkspaceSync({
  onAccountChange: clearAccountView,
  onSignedOut: clearAccountView,
  onState(next) {
    if (!validateState(next)) throw new Error("服务器数据格式异常，当前内容仍保留。");
    state = next;
    render();
  },
  onNotice: toast,
  canChangeAccount: action => !dialog.open && ![...drafts.values()].some(value => value.trim()) && (action !== "add-account" || !chatPending),
  onStatus() { refreshModelConfig(); refreshPlugins(); },
  canApply: () => !chatPending && !dialog.open && !document.activeElement?.matches("input, textarea, select"),
  canReload: () => !chatPending && !dialog.open && ![...drafts.values()].some(value => value.trim()) && !document.activeElement?.matches("input, textarea, select"),
  onVersion(version) {
    newServerVersion = version;
    const banner = document.querySelector("#sync-version");
    if (banner) banner.hidden = false;
  },
});
sync.connect();
