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
  more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
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
function rowActions(label, ...actions) {
  return `<details class="row-actions"><summary class="icon-button" aria-label="${e(label)}" title="${e(label)}">${icon("more")}</summary><div class="row-action-list">${actions.join("")}</div></details>`;
}
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
  return `<option value="" ${!key ? 'selected' : ''}>默认${modelConfig.model ? ` · ${e(modelConfig.model)}` : ''}</option>` +
    (key && !models.some(model => model.key === key) ? `<option value="${e(key)}" selected disabled>所选模型已停用</option>` : '') +
    [...groups.values()].map(group => `<optgroup label="${e(group.provider)}">${group.models.map(model => `<option value="${e(model.key)}" ${key === model.key ? 'selected' : ''}>${e(model.name)}${model.name !== model.id ? ` · ${e(model.id)}` : ''}</option>`).join('')}</optgroup>`).join('');
}
function modelPrivacy() {
  return activeModel().ready ? `消息和选入的资料会发送给 ${activeModel().provider}。` : '消息和选入的资料会发送给所选模型服务。';
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
    const current = activeModel();
    document.querySelectorAll('[data-model-label]').forEach(element => { element.textContent = current.ready ? current.model : '模型未就绪'; });
    document.querySelectorAll('[data-model-summary]').forEach(element => { element.textContent = current.message || ''; });
    document.querySelectorAll('[data-model-problem]').forEach(element => { element.hidden = current.ready; });
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
const category = (value) => {
  const [tone, name] = categoryStyle[value] || ["purple", "file"];
  return `<span class="category tone-${tone}">${icon(name)}${e(value)}</span>`;
};
const empty = (name, title, description, action = "") =>
  `<div class="empty">${icon(name)}<h3>${title}</h3>${description ? `<p>${description}</p>` : ""}${action}</div>`;
const notice = (text) =>
  `<div class="notice">${icon("info")}<span>${text}</span></div>`;
function heading(title, action = "") {
  return `<div class="page-intro"><h1 tabindex="-1" id="page-title">${title}</h1>${action}</div>`;
}
function section(title, action = "") {
  return `<div class="section-heading"><h2>${title}</h2>${action}</div>`;
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
  const model = activeModel();
  return `<form class="composer" id="message-form" data-draft="${e(key)}">
    <label class="visually-hidden" for="message-input">输入消息</label>
    <textarea id="message-input" name="message" maxlength="20000" required placeholder="输入消息…">${e(drafts.get(key) || "")}</textarea>
    <div class="composer-bottom">
      <div class="composer-controls">
        ${iconButton("attach", "从知识库添加文本", "clip")}
        ${button("plugin-picker", '<span data-plugin-choice-label>' + (selectedPluginIds.size ? "插件 " + selectedPluginIds.size : "插件") + "</span>", "puzzle", "composer-plugin" + (selectedPluginIds.size ? " active" : ""), sync?.authenticated ? "" : "disabled")}
        <select class="model-select" aria-label="选择助手" data-setting="model">${modelOptions()}</select>
        <select class="model-select ai-model-select" aria-label="选择 AI 模型" data-setting="modelKey">${aiModelOptions()}</select>
      </div>
      <div class="composer-submit">
        ${iconButton("data-use", "查看消息如何处理", "shield")}
        <button type="submit" class="btn btn-primary" ${chatPending || !model.ready || (!home && hasPluginApproval()) ? "disabled" : ""}>${chatPending ? "等待回复…" : "发送"}${icon("arrow")}</button>
      </div>
    </div>
    <div class="composer-problem" data-model-problem ${model.ready ? "hidden" : ""} role="status"><span data-model-summary>${e(model.message)}</span> <a href="#settings">查看连接</a></div>
  </form>`;
}
function promptCard(p) {
  const actions = `data-id="${e(p.id)}"`;
  return `<article class="prompt-card">
    <div class="prompt-card-top">${category(p.category)}${button("favorite", "", "star", `icon-button favorite ${p.favorite ? "active" : ""}`, `${actions} aria-label="${p.favorite ? "取消收藏" : "收藏"}：${e(p.title)}" aria-pressed="${p.favorite}"`)}</div>
    <h3>${e(p.title)}</h3>${p.description ? `<p>${e(p.description)}</p>` : ""}
    <div class="prompt-card-bottom">${button("use-prompt", "使用提示词", "arrow", "btn btn-tinted", actions)}${iconButton("view-prompt", "编辑：" + p.title, "pen", actions)}</div>
  </article>`;
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
    filtered ? "试试对话标题或消息中的其他关键词。" : "",
    filtered ? "" : button("new-chat", "新对话", "plus", "btn"),
  );
  return `<ul class="conversation-list" aria-label="历史对话列表">${sessions.map(session => {
    const last = session.messages.at(-1);
    const content = (last?.demo ? session.messages.findLast(message => message.role === "user") : last)?.content || "";
    const preview = Array.from(content.replace(/\s+/g, " ")).slice(0, 120).join("");
    return `<li><a class="conversation-link" href="#chat/${e(session.id)}" aria-label="继续对话：${e(session.title)}">
      <span class="conversation-symbol">${icon("chat")}</span>
      <span class="conversation-copy"><strong>${e(session.title)}</strong>${preview && preview !== session.title ? `<span>${e(preview)}</span>` : ""}</span>
      <span class="conversation-meta"><time datetime="${e(session.updatedAt)}">${dateText(session.updatedAt, true)}</time></span>
      <span class="conversation-chevron">${icon("chevron")}</span>
    </a></li>`;
  }).join("")}</ul>`;
}
function starterButtons() {
  return `<div class="starter-buttons" role="group" aria-label="对话快捷方式">${STARTERS.map(starter =>
    button("starter", e(starter.title), starter.icon, "btn starter-button", `data-id="${starter.id}"`),
  ).join("")}</div>`;
}
function favoriteRow(prompt) {
  const [tone, symbol] = categoryStyle[prompt.category] || ["purple", "file"];
  const target = `data-id="${e(prompt.id)}"`;
  return `<article class="favorite-row">
    <span class="tile-icon tone-${tone}">${icon(symbol)}</span>
    <span class="favorite-row-copy"><strong>${e(prompt.title)}</strong>${prompt.description ? `<small>${e(prompt.description)}</small>` : ""}</span>
    ${button("use-prompt", "使用", "arrow", "btn btn-tinted", `${target} aria-label="使用提示词：${e(prompt.title)}"`)}
    ${rowActions("提示词操作：" + prompt.title,
      button("view-prompt", "编辑", "pen", "btn btn-quiet", target),
      button("favorite", "取消收藏", "star", "btn btn-quiet", target))}
  </article>`;
}
function homePage() {
  const favorites = state.prompts.filter(prompt => prompt.favorite).slice(0, 3);
  return `<div class="home-hub">
    ${heading("开始对话")}
    ${composer(true)}
    ${starterButtons()}
  </div>
  <div class="home-collections">
    <section>
      ${section("收藏提示词", '<a class="btn btn-quiet" href="#prompts">提示词库 ' + icon("arrow") + "</a>")}
      ${favorites.length ? `<div class="home-favorites">${favorites.map(favoriteRow).join("")}</div>` : empty("star", "暂无收藏", "")}
    </section>
    <section>
      ${section("最近对话", '<a class="btn btn-quiet" href="#tasks">全部对话 ' + icon("arrow") + "</a>")}
      ${conversationList(sortedConversations().slice(0, 4))}
    </section>
  </div>`;
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
        "没有匹配的提示词",
        "",
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
      button("new-prompt", "新建提示词", "plus", "btn btn-primary"),
    ) +
    `<div class="toolbar"><div id="prompt-tabs">${tabs(["全部", "已收藏", ...CATEGORIES], promptFilter, "prompt-filter")}</div>${searchField("prompt-search", "搜索提示词…", promptQuery)}</div><div id="prompt-results" aria-live="polite">${promptResults()}</div>`
  );
}
function documentResults() {
  const list = state.documents.filter(
    document => (documentFilter === "全部" || document.tag === documentFilter) &&
      (document.name + " " + document.tag + " " + document.content).toLocaleLowerCase().includes(documentQuery.toLocaleLowerCase()),
  );
  if (!list.length) return empty("folder", state.documents.length ? "没有匹配的资料" : "暂无资料", "");
  return `<div class="document-grid">${list.map(document => {
    const target = `data-id="${e(document.id)}"`;
    const size = document.size < 1024 ? `${document.size} B` : `${(document.size / 1024).toFixed(1)} KB`;
    return `<article class="document-card">
      <div class="document-top"><span class="tile-icon tone-blue">${icon("file")}</span>
        ${rowActions("资料操作：" + document.name,
          button("document-tag", "编辑标签", "pen", "btn btn-quiet", target),
          button("delete-document", "删除资料", "trash", "btn btn-quiet menu-danger", target))}
      </div>
      <h3>${e(document.name)}</h3>
      <p class="metadata">${size} · ${dateText(document.createdAt)}${document.kind === "text" ? "" : " · 仅文件信息"}</p>
      <div class="document-bottom"><span class="category">${e(document.tag)}</span>${button("view-document", "查看", "arrow", "btn btn-quiet", target)}</div>
    </article>`;
  }).join("")}</div>`;
}
function documentTabs() {
  return tabs(
    ["全部", ...new Set(state.documents.map((d) => d.tag))],
    documentFilter,
    "document-filter",
  );
}
function knowledgePage() {
  const source = sync?.mode === "server" ? "资料保存到工作空间。" : "资料保存在此浏览器。";
  return heading("知识库", button("upload", "添加资料", "plus", "btn btn-primary")) +
    `<div class="knowledge-tools">
      <div class="upload-zone" id="upload-zone" aria-label="拖放文件">
        ${icon("upload")}<span>拖放文件 · 每份 1 MB 以内</span>
        <input type="file" id="file-input" multiple hidden />
      </div>
      <details class="inline-details">
        <summary>支持的格式</summary>
        <p>${source}支持读取 TXT、Markdown、CSV、JSON。其他格式仅保存文件信息。</p>
      </details>
    </div>
    <div class="toolbar"><div id="document-tabs">${documentTabs()}</div>${searchField("document-search", "搜索资料…", documentQuery)}</div>
    <div id="document-results" aria-live="polite">${documentResults()}</div>`;
}
function todoResults() {
  const query = todoQuery.trim().toLocaleLowerCase();
  const items = (state.todos || []).filter(todo =>
    (todoFilter === "全部" || todo.done === (todoFilter === "已完成")) &&
    (!query || (todo.title + " " + todo.notes).toLocaleLowerCase().includes(query)))
    .sort((one, two) => Number(one.done) - Number(two.done) || two.updatedAt.localeCompare(one.updatedAt));
  if (!items.length) return empty("list", query || todoFilter !== "全部" ? "没有符合条件的任务" : "暂无任务", "");
  return '<div class="todo-list">' + items.map(todo => `<article class="todo-item ${todo.done ? "is-done" : ""}" data-todo-id="${e(todo.id)}">
    ${button("toggle-todo", icon("check"), "", "todo-toggle", `data-id="${e(todo.id)}" role="checkbox" aria-checked="${todo.done}" aria-label="${todo.done ? "恢复待办" : "标记完成"}：${e(todo.title)}"`)}
    <div class="todo-copy"><h2>${e(todo.title)}</h2>${todo.notes ? `<p>${e(todo.notes)}</p>` : ""}</div>
    <div class="todo-actions">${iconButton("edit-todo", `编辑任务：${todo.title}`, "pen", `data-id="${e(todo.id)}"`)}${iconButton("delete-todo", `删除任务：${todo.title}`, "trash", `data-id="${e(todo.id)}"`)}</div>
  </article>`).join("") + "</div>";
}
function todoPage() {
  const items = state.todos || [];
  const completed = items.filter(todo => todo.done).length;
  return heading("任务", button("new-todo", "新建任务", "plus", "btn btn-primary")) +
    `<div class="toolbar todo-toolbar">
      <div id="todo-tabs">${tabs(["全部", "待完成", "已完成"], todoFilter, "todo-filter")}</div>
      ${items.length ? `<div class="todo-progress"><progress max="${items.length}" value="${completed}" aria-label="完成进度"></progress><span>${completed}/${items.length} 完成</span></div>` : ""}
      ${searchField("todo-search", "搜索任务…", todoQuery)}
    </div>
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
    const changed = !pluginsLoaded || JSON.stringify([pluginConnections, pluginHistory, pluginError]) !== JSON.stringify([data.connections, data.history, ""]);
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
  const connections = pluginConnections.length ? `<section>
    ${section("我的连接", iconButton("plugins-refresh", "刷新连接", "refresh"))}
    <div class="plugin-connections">${pluginConnections.map(connection => {
      const target = `data-id="${e(connection.id)}"`;
      const connected = connection.enabled && connection.status === "connected";
      const label = !connection.enabled ? "已停用" : connected ? "已连接" : "连接异常";
      return `<article class="plugin-connection" data-plugin-id="${e(connection.id)}">
        <div class="plugin-connection-head">
          <span class="tile-icon tone-purple">${icon(connection.kind === "github" ? "code" : "puzzle")}</span>
          <div><h3>${e(connection.name)}</h3><p title="${e(connection.endpoint)}">${e(new URL(connection.endpoint).host)} · ${connection.toolCount} 项工具</p></div>
          <span class="plugin-state ${connected ? "is-connected" : ""}">${label}</span>
          ${rowActions("管理连接：" + connection.name,
            button("plugin-enable", connection.enabled ? "停用" : "启用", "", "btn btn-quiet", target),
            button("plugin-reconnect", "重新验证", "refresh", "btn btn-quiet", target),
            button("plugin-disconnect", "断开连接", "close", "btn btn-quiet menu-danger", target))}
        </div>
        ${connection.error ? `<p class="plugin-error">${e(connection.error)}</p>` : ""}
        <div class="plugin-connection-actions">
          ${button("plugin-use-chat", "在对话中使用", "chat", "btn btn-tinted", target + (pluginReady(connection) ? "" : " disabled"))}
          ${button("plugin-details", "查看工具", "", "btn btn-quiet", target)}
        </div>
      </article>`;
    }).join("")}</div>
  </section>` : "";
  const history = pluginHistory.length ? `<details class="plugin-recent summary-panel">
    <summary>最近调用 <span>${pluginHistory.length}</span></summary>
    <div class="plugin-history-list">${pluginHistory.map(call => `<div>
      <span><strong>${e(call.pluginName)}</strong><small>${e(call.toolName)}</small></span>
      <span>${({success:"已完成",error:"请求失败",unknown:"结果未确认",running:"执行中"})[call.status] || "已记录"}</span>
      <time datetime="${e(call.createdAt)}">${dateText(call.createdAt, true)}</time>
    </div>`).join("")}</div>
  </details>` : "";
  return heading("插件") +
    (pluginError ? `<div class="inline-alert">${notice(e(pluginError))}${button("plugins-refresh", "重试", "refresh", "btn")}</div>` : "") +
    (!usable ? notice("登录工作台后可以连接插件。") : !pluginsLoaded ? '<p class="loading-line" role="status">正在读取连接…</p>' : "") +
    connections +
    `<section class="plugin-discover">
      ${section("连接插件")}
      <div class="plugin-catalog">
        <article class="plugin-catalog-card">
          <span class="tile-icon tone-purple">${icon("code")}</span>
          <div><h3>GitHub</h3><p>仓库、Issue 与 Pull Request</p></div>
          ${button("plugin-connect-github", "连接 GitHub", "arrow", "btn btn-tinted", disabled)}
        </article>
        <article class="plugin-catalog-card">
          <span class="tile-icon tone-blue">${icon("puzzle")}</span>
          <div><h3>自定义 MCP</h3><p>通过地址添加远程工具</p></div>
          ${button("plugin-connect", "添加服务", "plus", "btn", disabled)}
        </article>
      </div>
    </section>` + history;
}
function pluginConnector(kind = "custom") {
  if (!sync?.authenticated || sync.mode !== "server") throw new Error("请先登录工作台。");
  const github = kind === "github";
  const name = `<label>连接名称<input class="input" name="name" maxlength="80" ${github ? "" : "required"} value="${github ? "GitHub" : ""}" /></label>`;
  const endpoint = `<label>MCP 地址<input class="input" name="endpoint" type="url" maxlength="2000" required value="${github ? "https://api.githubcopilot.com/mcp/" : ""}" ${github ? "readonly" : 'placeholder="https://example.com/mcp"'} /></label>`;
  const token = `<label id="plugin-token-label" ${github ? "" : "hidden"}>${github ? "GitHub 个人访问令牌" : "授权令牌"}<input class="input" name="token" type="password" maxlength="4096" autocomplete="off" spellcheck="false" data-plugin-secret ${github ? "required autofocus" : ""} /></label>`;
  openDialog(github ? "连接 GitHub" : "添加 MCP 服务",
    `<form id="plugin-connect-form" class="dialog-body" data-kind="${github ? "github" : "custom"}">
      ${github ? `<input type="hidden" name="authMode" value="bearer" />
        ${token}
        <a class="form-link" href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener noreferrer">创建 GitHub 令牌 ↗</a>
        <details class="inline-details"><summary>连接信息</summary>${name}${endpoint}<p>令牌按账号加密保存。</p></details>` :
        `${name}${endpoint}
        <label>授权方式<select class="input" name="authMode" id="plugin-auth-mode"><option value="none">无需令牌</option><option value="bearer">Bearer 令牌</option></select></label>
        ${token}
        <details class="inline-details"><summary>连接要求</summary><p>使用支持 Streamable HTTP 的 HTTPS 地址。令牌按账号加密保存。</p></details>`}
      <p class="dialog-error" id="form-error" role="alert"></p>
      <div class="dialog-actions">${button("close-dialog", "取消", "", "btn")}<button class="btn btn-primary" type="submit">连接并验证</button></div>
    </form>`);
}
async function pluginDetails(id) {
  const cycle = chatAccountCycle;
  const connection = await sync.request("/api/plugins/" + encodeURIComponent(id));
  if (cycle !== chatAccountCycle) return;
  pluginDetailsCache.set(id, connection);
  const selected = new Set(connection.selectedTools);
  openDialog(connection.name + " · 可用工具",
    `<form id="plugin-tools-form" class="dialog-body" data-id="${e(id)}" data-revision="${connection.revision}">
    <fieldset class="plugin-tool-list"><legend>允许在对话中使用</legend>${connection.tools.map(tool => `<article class="plugin-tool-row" data-tool-name="${e(tool.name)}"><label><input type="checkbox" name="tools" value="${e(tool.name)}" ${selected.has(tool.name) ? "checked" : ""} /><span><strong>${e(tool.title || tool.name)}</strong>${tool.title && tool.title !== tool.name ? `<code>${e(tool.name)}</code>` : ""}${tool.description ? `<small>${e(tool.description)}</small>` : ""}</span></label>
      ${button("plugin-tool-open", "执行工具", "arrow", "btn", `data-id="${e(id)}" data-tool="${e(tool.name)}" ${connection.enabled && connection.status === "connected" ? "" : "disabled"}`)}</article>`).join("") || empty("puzzle", "暂无可用工具", "检查服务权限后重新验证连接。")}</fieldset>
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
    `<form id="plugin-call-form" class="dialog-body" data-id="${e(id)}" data-tool="${e(name)}" data-revision="${connection.revision}" data-request-id="${uid("invoke")}"><details class="plugin-schema inline-details"><summary>参数说明</summary>${tool.description ? `<p>${e(tool.description)}</p>` : ""}<pre>${e(JSON.stringify(tool.inputSchema, null, 2))}</pre></details>
    <label>工具参数（JSON）<textarea class="input plugin-arguments" id="plugin-call-args" name="arguments" maxlength="40000" required spellcheck="false">${e(toolExample(tool.inputSchema))}</textarea></label>
    <p class="field-help">发送至 ${e(new URL(connection.endpoint).origin)}</p>
    <p class="dialog-error" id="form-error" role="alert"></p><div id="plugin-call-result" aria-live="polite"></div>
    <div class="dialog-actions">${button("close-dialog", "关闭", "", "btn")}${button("plugin-new-call", "准备新调用", "plus", "btn", "hidden data-new-call")}<button class="btn btn-primary" type="submit">执行工具</button></div></form>`);
}
async function pluginPicker() {
  await refreshPlugins(true);
  const connections = pluginConnections.filter(pluginReady);
  openDialog("选择对话插件",
    `<form id="plugin-picker-form" class="dialog-body">
    ${connections.length ? `<div class="plugin-picker-list">${connections.map(connection => `<label><input type="checkbox" name="plugins" value="${e(connection.id)}" ${selectedPluginIds.has(connection.id) ? "checked" : ""} /><span><strong>${e(connection.name)}</strong><small>${connection.selectedCount} 项工具可用于对话</small></span></label>`).join("")}</div>` : empty("puzzle", "暂无可用插件", "", '<a class="btn" href="#plugins">前往连接插件</a>')}
    ${modelConfig.toolCalling !== true ? notice("当前模型服务端尚未提供对话工具调用能力，请先更新服务端；插件页仍可独立执行工具。") : ""}
    <p class="dialog-error" id="form-error" role="alert"></p><div class="dialog-actions">${button("close-dialog", "取消", "", "btn")}<button class="btn btn-primary" type="submit" ${connections.length ? "" : "disabled"}>应用</button></div></form>`);
}

function todoEditor(id = "") {
  const todo = (state.todos || []).find(item => item.id === id);
  if (id && !todo) throw new Error("任务已不存在，请刷新后重试。");
  openDialog(todo ? "编辑任务" : "新建任务",
    `<form id="todo-form" class="dialog-body" data-id="${e(id)}"><label>任务名称<input class="input" name="title" maxlength="100" required value="${e(todo?.title || "")}" autofocus /></label>
    <label>备注<textarea class="input" name="notes" maxlength="2000" placeholder="选填">${e(todo?.notes || "")}</textarea></label>
    <p class="dialog-error" id="form-error" role="alert"></p><div class="dialog-actions">${button("close-dialog", "取消", "", "btn")}<button class="btn btn-primary" type="submit">保存任务</button></div></form>`);
}
async function handlePluginForm(form, data) {
  const cycle = chatAccountCycle, submit = form.querySelector('button[type="submit"]');
  const label = submit?.textContent;
  if (submit) { submit.disabled = true; submit.textContent = "正在处理…"; }
  try {
    if (form.id === "plugin-connect-form") {
      const value = await pluginRequest("/api/plugins/connect", { kind: form.dataset.kind,
        name: String(data.get("name")).trim() || (form.dataset.kind === "github" ? "GitHub" : ""), endpoint: String(data.get("endpoint")),
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
  return `<section class="plugin-approval" aria-label="确认插件操作"><div class="plugin-approval-title">${icon("puzzle")}<strong>执行插件操作？</strong></div>
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
  return heading("历史对话",
    button("export-history", "导出对话", "download", "btn")) +
    `<div class="toolbar">${searchField("history-search", "搜索对话…", historyQuery)}</div><div id="history-results" aria-live="polite">${historyResults()}</div>`;
}
function chatPage() {
  const session = state.sessions.find((s) => s.id === route().id);
  return `<div class="chat-layout"><aside class="chat-sidebar" aria-label="历史会话">${button("new-chat", "新对话", "plus", "btn")}${[
    ...state.sessions,
  ]
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .map(
      (s) =>
        `<a href="#chat/${s.id}" class="session-link ${session?.id === s.id ? "active" : ""}" ${session?.id === s.id ? 'aria-current="page"' : ""} title="${e(s.title)}">${e(s.title)}<small>${dateText(s.updatedAt)}</small></a>`,
    )
    .join(
      "",
    )}${!state.sessions.length ? '<p class="empty-history">暂无会话</p>' : ""}</aside><section class="chat-main" aria-label="AI 对话"><div class="chat-header"><h1 tabindex="-1" id="page-title">${session ? e(session.title) : "新对话"}</h1><div>${session ? rowActions("会话操作",
    button("export-session", "导出会话", "download", "btn btn-quiet", `data-id="${e(session.id)}"`),
    button("delete-session", "删除会话", "trash", "btn btn-quiet menu-danger", `data-id="${e(session.id)}"`)) : ""}</div></div><div class="messages" id="messages" data-session-id="${e(session?.id || "")}">${
    session
      ? session.messages
          .map(
            (m) =>
              `<article class="message ${m.role}"><div class="avatar">${m.role === "user" ? "我" : icon("spark")}</div><div class="message-body"><div class="message-label">${m.role === "user" ? "你" : `智作台 <span class="demo-badge">${m.demo ? "历史演示消息" : e(m.model)}</span>`}<time datetime="${e(m.createdAt)}">${dateText(m.createdAt, true)}</time></div><div class="message-content">${m.role === "user" ? e(m.content) : markdown(m.content)}</div><div class="message-actions">${button("copy-message", `${icon("copy")} 复制`, "", "btn btn-quiet", `data-id="${m.id}"`)}${m.role === "assistant" ? button("regenerate", `${icon("refresh")} 重新生成`, "", "btn btn-quiet", `data-id="${m.id}"`) : ""}</div></div></article>`,
          )
          .join("")
      : `<div class="chat-welcome"><div class="brand-mark">${icon("spark")}</div>${starterButtons()}</div>`
  }${chatRequestNotice(session)}</div><div class="chat-composer">${composer()}</div></section></div>`;
}
function settingsPage() {
  const themes = [["light", "浅色"], ["dark", "深色"], ["system", "系统"]];
  const themePicker = themes.map(([id, label]) => button("theme", label, "", state.settings.theme === id ? "active" : "",
    `data-id="${id}" aria-pressed="${state.settings.theme === id}"`)).join("");
  return heading("设置") +
    `<div class="settings-grid">
      ${accountSettings()}
      <section class="settings-card">
        <h2>${icon("sun")}外观与偏好</h2>
        <div class="setting-row"><strong>界面主题</strong><div class="segmented" role="group" aria-label="界面主题">${themePicker}</div></div>
        <div class="setting-row"><strong>默认助手</strong><select class="input" data-setting="model" aria-label="默认助手">${modelOptions()}</select></div>
      </section>
      ${workspaceSettings()}
      <section class="settings-card data-settings">
        <h2>${icon("download")}数据与备份</h2>
        <div class="settings-actions">
          ${button("export-all", "导出全部数据", "download", "btn btn-tinted")}
          ${button("import-backup", "恢复备份", "upload", "btn")}
          ${rowActions("更多数据操作", button("reset", "重置工作台", "trash", "btn btn-quiet menu-danger"))}
        </div>
        <input type="file" id="backup-input" accept="application/json,.json" hidden />
      </section>
      ${serverSettings()}
      <section class="settings-card help-settings">
        <h2>${icon("help")}使用帮助</h2>
        <div class="settings-actions">
          ${button("help", "打开使用帮助", "arrow", "btn")}
          ${button("prompt-guide", "提问示例", "bulb", "btn btn-quiet")}
        </div>
      </section>
    </div>`;
}
function accountSettings() {
  const user = sync?.authenticated ? sync.user : null;
  const enabled = sync?.mode === "server" && Boolean(user);
  const account = user?.account || (sync?.mode === "local" ? "浏览器模式" : "未登录");
  return `<section class="settings-card account-settings" data-account-management aria-labelledby="account-settings-title">
    <h2 id="account-settings-title">${icon("shield")}账号管理</h2>
    <div class="account-summary">
      <span class="account-avatar" aria-hidden="true">${e(user?.account?.slice(0, 1).toUpperCase() || "我")}</span>
      <div class="account-identity"><strong data-current-account>${e(account)}</strong>${user?.email ? `<small data-current-email>${e(user.email)}</small>` : ""}</div>
    </div>
    <div class="settings-actions">
      <button type="button" class="btn btn-tinted" data-sync="add-account" ${enabled ? "" : "disabled"}>${icon("plus")}添加其他账号登录</button>
      <button type="button" class="btn btn-quiet" data-sync="logout" ${enabled ? "" : "disabled"}>退出当前账号</button>
    </div>
  </section>`;
}
function workspaceSettings() {
  return `<section class="settings-card settings-workspace" data-settings-workspace aria-labelledby="workspace-settings-title">
    <h2 id="workspace-settings-title">${icon("layers")}我的工作空间</h2>
    <div class="settings-workspace-stats">
      <a href="#prompts"><strong>${state.prompts.filter(prompt => prompt.favorite).length}</strong><span>收藏提示词</span></a>
      <a href="#knowledge"><strong>${state.documents.length}</strong><span>知识资料</span></a>
      <a href="#tasks"><strong>${state.sessions.length}</strong><span>累计对话</span></a>
    </div>
  </section>`;
}
function serverSettings() {
  const model = activeModel();
  return `<section class="settings-card">
    <h2>${icon("shield")}连接</h2>
    <div class="setting-row"><strong>模型</strong><span data-model-label>${e(model.ready ? model.model : "模型未就绪")}</span></div>
    <div class="setting-row"><strong>保存状态</strong><span data-server-label>${e(sync?.label || "正在连接")}</span></div>
    <details class="inline-details connection-details">
      <summary>版本与连接详情</summary>
      <div class="setting-row"><strong>运行版本</strong><code data-server-version>${e(sync?.version?.slice(0, 12) || "静态版")}</code></div>
      <div class="settings-actions">
        <button type="button" class="btn" data-sync="retry">${icon("refresh")}重新连接</button>
        ${button("connection-help", "模型接入", "arrow", "btn btn-quiet")}
      </div>
    </details>
  </section>`;
}
function render() {
  const showCalls = app.querySelector(".plugin-recent")?.open;
  const previousMessages = app.querySelector("#messages");
  const previousTop = previousMessages?.scrollTop;
  const wasReading = previousMessages && previousMessages.scrollHeight - previousMessages.clientHeight - previousTop > 24;
  const textarea = document.querySelector("#message-input");
  if (textarea) drafts.set(textarea.form.dataset.draft, textarea.value);
  const { page } = route();
  applyTheme();
  const title = nav.find((n) => n[0] === page)[1];
  document.title = `${title} · 智作台`;
  document.body.classList.remove("sidebar-open");
  app.innerHTML = `<div class="app-shell"><aside class="sidebar" id="sidebar" aria-label="主导航"><a class="brand" href="#home" aria-label="智作台首页"><span class="brand-mark">${icon("spark")}</span><span><span class="brand-name">智作台</span></span></a><nav aria-label="工作空间导航">${button("new-chat", "新对话", "plus", "btn btn-primary sidebar-new-chat")}${nav
    .filter(([id]) => id !== "settings")
    .map(
      ([id, label, name]) =>
        `<a class="nav-link ${page === id ? "active" : ""}" href="#${id}" ${page === id ? 'aria-current="page"' : ""}>${icon(name)}${label}</a>`,
    )
    .join(
      "",
    )}</nav><div class="sidebar-bottom"><div class="sidebar-settings-wrap"><a href="#settings" class="nav-link sidebar-settings ${page === "settings" ? "active" : ""}" ${page === "settings" ? 'aria-current="page"' : ""}>${icon("settings")}<span>设置</span>${icon("chevron")}</a></div></div></aside><button class="sidebar-backdrop" data-action="close-menu" aria-label="关闭导航" tabindex="-1"></button><div class="workspace"><header class="topbar">${button("toggle-sidebar", '<span data-sidebar-toggle-label>收起侧边栏</span>', "sidebar-close", "sidebar-toggle", 'aria-label="收起侧边栏" title="收起侧边栏" aria-expanded="true" aria-controls="sidebar" data-menu-button')}<div class="breadcrumb"><span>工作空间</span><span class="mobile-page-name">${title}</span></div><div class="topbar-tools">${button("search", "<span>搜索</span><kbd>⌘ K</kbd>", "search", "search-trigger", 'aria-label="搜索工作空间"')}<a class="sync-indicator" href="#settings" data-sync-indicator aria-label="${e(sync?.label || "正在连接")}"><i aria-hidden="true"></i><span class="visually-hidden" data-server-label>${e(sync?.label || "正在连接")}</span></a></div></header><main class="main" id="main" tabindex="-1"><div id="sync-conflict" class="sync-banner" ${sync?.conflict ? "" : "hidden"}><span>其他页面有新修改。本页内容已保留，请选择同步版本。</span><button type="button" class="btn" data-sync="use-server">采用服务器版本</button><button type="button" class="btn" data-sync="use-local">保留本页内容</button></div><div id="sync-version" class="sync-banner" ${newServerVersion ? "" : "hidden"}><span>新版本已部署。你的输入仍保留，刷新即可使用。</span><button type="button" class="btn" data-sync="reload">刷新到新版本</button></div>${{ home: homePage, todo: todoPage, plugins: pluginsPage, prompts: promptsPage, knowledge: knowledgePage, tasks: historyPage, chat: chatPage, settings: settingsPage }[page]()}</main></div></div>`;
  if (showCalls && page === "plugins") app.querySelector(".plugin-recent")?.setAttribute("open", "");
  syncSidebar();
  const messages = document.querySelector("#messages");
  if (messages) {
    const sameConversation = messages.dataset.sessionId === previousMessages?.dataset.sessionId;
    messages.scrollTop = sameConversation && wasReading ? previousTop : messages.scrollHeight;
  }
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
    p ? "编辑提示词" : "新建提示词",
    `<form id="prompt-form" class="dialog-body" data-id="${p?.id || ""}"><label>名称<input class="input" name="title" maxlength="80" required value="${e(p?.title || "")}" /></label><label>分类<select class="input" name="category">${CATEGORIES.map((c) => `<option ${p?.category === c ? "selected" : ""}>${c}</option>`).join("")}</select></label><label>一句话描述<input class="input" name="description" maxlength="200" value="${e(p?.description || "")}" placeholder="选填" /></label><label>提示词内容<textarea class="input" name="content" maxlength="20000" required>${e(p?.content || "")}</textarea></label><p class="dialog-error" id="form-error" role="alert"></p><div class="dialog-actions">${p ? button("delete-prompt", "删除", "trash", "btn btn-danger", `data-id="${p.id}"`) : ""}${button("close-dialog", "取消", "", "btn")}<button class="btn btn-primary" type="submit">保存提示词</button></div></form>`,
  );
}
function showDocument(id) {
  const d = state.documents.find((d) => d.id === id);
  if (!d) return;
  openDialog(
    d.name,
    `<div class="dialog-body"><p>${e(d.tag)} · ${d.size} 字节</p>${d.kind === "text" ? `<pre class="preview-text">${e(d.content)}</pre><div class="dialog-actions">${button("copy-document", "复制文本", "copy", "btn", `data-id="${d.id}"`)}${button("attach-document", "带入对话", "chat", "btn btn-primary", `data-id="${d.id}"`)}</div>` : notice("此格式仅保存文件信息。可将正文转为 TXT 或 Markdown 后添加。")}</div>`,
  );
}
function showSearch() {
  openDialog(
    "搜索工作空间",
    `<div class="global-search-input">${icon("search")}<input type="search" id="global-search" aria-label="搜索任务、提示词、历史对话与资料" maxlength="100" placeholder="搜索任务、提示词、历史对话与资料…" autocomplete="off" autofocus /></div><div id="global-results" class="search-results" aria-live="polite"></div>`,
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
        query.trim() ? "没有找到相关内容" : "输入关键词",
        "",
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
  else if (count) toast(`已添加 ${count} 份资料`);
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
    case "data-use":
      openDialog("消息如何处理", `<div class="dialog-body"><p>${e(modelPrivacy())}</p><p>使用插件时，确认的参数会发送到对应服务。</p></div>`);
      break;
    case "connection-help":
      openDialog("模型接入", '<div class="dialog-body"><p>在智作台服务端的“API 接口设置”中添加服务商和模型，再设为默认。</p><p>对话框也可以为下一条消息选择模型。</p></div>');
      break;
    case "help":
      openDialog(
        "欢迎使用智作台",
        `<div class="dialog-body"><ol class="help-list"><li>从首页快捷操作开始，或在提示词库选择一个模板。</li><li>发送后调用服务端配置的模型，保存真实回答和任务结果。</li><li>支持多轮会话、重新生成、复制和导出。Token 用量可在服务端总览查看。</li><li>在任务中记录待办；在插件中连接外部服务，选择对话工具并确认具体操作。</li><li>使用 Ctrl / ⌘ + K 搜索，按 Esc 关闭弹窗。</li></ol>${notice("会话由本机数据库保存。发送的消息和所选文本会交给配置的模型服务处理。")}</div>`,
      );
      break;
  }
}

document.addEventListener("click", (event) => {
  const target = event.target.closest("[data-action]");
  document.querySelectorAll(".row-actions[open]").forEach(menu => {
    if (menu.contains(event.target) && !target) return;
    menu.open = false;
    if (menu.contains(target)) menu.querySelector("summary").focus();
  });
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
  const menu = document.querySelector(".row-actions[open]");
  if (event.key === "Escape" && menu) {
    event.preventDefault();
    menu.open = false;
    menu.querySelector("summary").focus();
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
