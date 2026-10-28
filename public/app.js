import {
  CATEGORIES,
  MODELS,
  MAX_FILE_SIZE,
  MAX_DOCUMENT_CHARS,
  createInitialState,
  uid,
  readState,
  saveState,
  escapeHtml as e,
  markdown,
  demoReply,
  recordExchange,
  removeSession,
  searchWorkspace,
  STARTERS,
} from "./core.js";

const paths = {
  spark:
    '<path d="m14 3 2.5 6.5L23 12l-6.5 2.5L14 21l-2.5-6.5L5 12l6.5-2.5L14 3Z"/><path d="m4 2 .8 2.2L7 5l-2.2.8L4 8l-.8-2.2L1 5l2.2-.8L4 2Z"/>',
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
  ["home", "首页", "home"],
  ["chat", "AI 对话", "chat"],
  ["prompts", "提示词库", "layers"],
  ["knowledge", "知识库", "book"],
  ["tasks", "任务记录", "history"],
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
let promptFilter = "全部",
  promptQuery = "",
  documentFilter = "全部",
  documentQuery = "",
  taskFilter = "全部",
  taskQuery = "";
const drafts = new Map();
let pendingType = "AI 对话";
let toastTimer;
let dialogOrigin;
let uploadQueue = Promise.resolve();
const dialog = document.querySelector("#dialog");
const app = document.querySelector("#app");
const systemTheme = matchMedia("(prefers-color-scheme: dark)");
const mobile = matchMedia("(max-width: 760px)");

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
  saveState(localStorage, next);
  state = next;
  return result;
}
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
        `<option value="${key}" ${state.settings.model === key ? "selected" : ""}>${label} · 演示</option>`,
    )
    .join("");
}
function composer(home = false) {
  const key = home ? "home" : route().id || "new";
  return `<form class="composer" id="message-form" data-draft="${e(key)}">
    ${home ? `<label class="composer-label" for="message-input">${icon("spark")}今天，想一起完成什么？</label>` : '<label class="visually-hidden" for="message-input">输入消息</label>'}
    <textarea id="message-input" name="message" maxlength="20000" required placeholder="${home ? "写下你的想法，或者从下方选择一个灵感起点…" : "输入你的问题，继续这段思考…"}">${e(drafts.get(key) || "")}</textarea>
    <div class="composer-bottom"><div class="composer-controls">${iconButton("attach", "从知识库添加文本", "clip")}<select class="model-select" aria-label="选择演示助手" data-setting="model">${modelOptions()}</select><span class="composer-hint">Enter 发送 · Shift + Enter 换行</span></div><button type="submit" class="btn btn-primary">${home ? "开始对话" : "发送"}${icon("arrow")}</button></div>
  </form>`;
}
function promptCard(p) {
  return `<article class="prompt-card"><div class="prompt-card-top">${category(p.category)}${button("favorite", "", "star", `icon-button favorite ${p.favorite ? "active" : ""}`, `data-id="${p.id}" aria-label="${p.favorite ? "取消收藏" : "收藏"}：${e(p.title)}" aria-pressed="${p.favorite}"`)}</div><h3>${e(p.title)}</h3><p>${e(p.description || "一个值得保留的好提示词。")}</p><div class="prompt-card-bottom">${button("use-prompt", `使用提示词 ${icon("arrow")}`, "", "btn btn-quiet", `data-id="${p.id}"`)}${button("view-prompt", "查看与编辑", "", "btn btn-quiet", `data-id="${p.id}"`)}</div></article>`;
}
function taskTable(tasks, filtered = false) {
  if (!tasks.length)
    return `<div class="table-wrap">${empty("history", filtered ? "没有符合条件的任务" : "下一件好作品，从这里开始", filtered ? "试试其他关键词或类型。" : "发起一次对话后，你的工作记录会出现在这里。", filtered ? "" : button("new-chat", "开始第一次对话", "plus", "btn"))}</div>`;
  return `<div class="table-wrap"><table><caption class="visually-hidden">${filtered ? "筛选后的任务记录" : "最近的任务记录"}</caption><thead><tr><th scope="col">任务名称</th><th scope="col">类型</th><th scope="col">状态</th><th scope="col">创建时间</th><th scope="col">操作</th></tr></thead><tbody>${tasks.map((t) => `<tr><td><div class="task-name">${icon("chat")}<span class="task-title" title="${e(t.title)}">${e(t.title)}</span></div></td><td class="table-type">${e(t.type)}</td><td><span class="status-pill">演示已记录</span></td><td class="muted">${dateText(t.createdAt, true)}</td><td>${button("open-session", "查看", "", "btn btn-quiet", `data-id="${t.sessionId}"`)}</td></tr>`).join("")}</tbody></table></div>`;
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
  ${composer(true)}<div class="privacy-line">${icon("shield")}演示模式 · 内容仅保存在当前浏览器，不会发送给模型</div>
  ${section("从一个灵感开始", "为日常工作，找到更好的起点")}
  <div class="quick-grid">${STARTERS.map((s) => `<button class="quick-card" data-action="starter" data-id="${s.id}"><span class="tile-icon tone-${s.tone}">${icon(s.icon)}</span><strong>${s.title}</strong><small>${s.subtitle}</small></button>`).join("")}</div>
  <div class="dashboard-lower"><div>${section("常用提示词", "收藏好方法，下次直接用", '<a class="btn btn-quiet" href="#prompts">查看全部 ' + icon("arrow") + "</a>")}<div class="prompt-grid">${favorites.length ? favorites.map(promptCard).join("") : empty("star", "把好用的提示词收藏在这里", "去提示词库点亮星标，建立你的常用清单。", '<a class="btn" href="#prompts">浏览提示词库</a>')}</div>
  ${section("最近任务", "每一份思考，都有迹可循", '<a class="btn btn-quiet" href="#tasks">全部记录 ' + icon("arrow") + "</a>")}${taskTable(state.tasks.slice(0, 3))}</div>
  <aside class="side-panel"><div class="note-card"><span class="eyebrow">${icon("bulb")}灵感便签 / 01</span><h3>好的回答，<br>从好的提问开始。</h3><p>给 AI 一个角色、一点背景，<br>再告诉它你期待的结果。</p><div class="mini-example">“你是一位内容编辑，请面向初学者，用一个例子解释这个概念。”</div>${button("prompt-guide", `看看怎么提问 ${icon("arrow")}`, "", "btn btn-quiet")}</div><div class="workspace-stats"><h3>我的工作空间</h3><div class="stat-line"><span>收藏提示词</span><b>${state.prompts.filter((p) => p.favorite).length}</b></div><div class="stat-line"><span>知识资料</span><b>${state.documents.length}</b></div><div class="stat-line"><span>累计对话</span><b>${state.sessions.length}</b></div></div></aside></div>`;
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
function taskResults() {
  return taskTable(
    state.tasks.filter(
      (t) =>
        (taskFilter === "全部" || t.type === taskFilter) &&
        t.title.toLocaleLowerCase().includes(taskQuery.toLocaleLowerCase()),
    ),
    Boolean(taskQuery || taskFilter !== "全部"),
  );
}
function tasksPage() {
  return (
    heading(
      "任务记录",
      "回到每一次思考，接着完成下一步。",
      button("export-tasks", "导出记录", "download", "btn"),
    ) +
    notice(
      "所有任务均为演示对话记录。“演示已记录”仅表示输入已保存，不代表模型已执行或任务已完成。",
    ) +
    `<div class="toolbar">${tabs(["全部", ...new Set(state.tasks.map((t) => t.type))], taskFilter, "task-filter")}${searchField("task-search", "搜索任务…", taskQuery)}</div><div id="task-results" aria-live="polite">${taskResults()}</div>`
  );
}
function chatPage() {
  const session = state.sessions.find((s) => s.id === route().id);
  return `<div class="chat-layout"><aside class="chat-sidebar" aria-label="历史会话">${button("new-chat", "新建对话", "plus", "btn")}<p>历史会话 · ${state.sessions.length}</p>${[
    ...state.sessions,
  ]
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .map(
      (s) =>
        `<a href="#chat/${s.id}" class="session-link ${session?.id === s.id ? "active" : ""}" ${session?.id === s.id ? 'aria-current="page"' : ""} title="${e(s.title)}">${e(s.title)}<small>${dateText(s.updatedAt)} · 本地保存</small></a>`,
    )
    .join(
      "",
    )}${!state.sessions.length ? '<p class="empty-history">还没有会话，<br>从一个小问题开始吧。</p>' : ""}</aside><section class="chat-main" aria-label="AI 对话"><div class="chat-header"><h1 tabindex="-1" id="page-title">${session ? e(session.title) : "新的一段思考"}</h1><div><span class="demo-badge">演示模式</span>${session ? iconButton("export-session", "导出会话", "download", `data-id="${session.id}"`) + iconButton("delete-session", "删除会话", "trash", `data-id="${session.id}"`) : ""}</div></div><div class="messages" id="messages">${
    session
      ? session.messages
          .map(
            (m) =>
              `<article class="message ${m.role}"><div class="avatar">${m.role === "user" ? "我" : icon("spark")}</div><div class="message-body"><div class="message-label">${m.role === "user" ? "你" : `智作台 <span class="demo-badge">演示消息</span>`}<time datetime="${e(m.createdAt)}">${dateText(m.createdAt, true)}</time></div><div class="message-content">${m.role === "user" ? e(m.content) : markdown(m.content)}</div><div class="message-actions">${button("copy-message", `${icon("copy")} 复制`, "", "btn btn-quiet", `data-id="${m.id}"`)}${m.role === "assistant" ? button("regenerate", `${icon("refresh")} 重新生成（演示）`, "", "btn btn-quiet", `data-id="${m.id}"`) : ""}</div></div></article>`,
          )
          .join("")
      : `<div class="chat-welcome"><div class="brand-mark">${icon("spark")}</div><h2>让每个想法，都有回响。</h2><p>写下一个问题，或选一个方向开始。<br>当前为演示模式，不会调用模型。</p><div class="suggestions">${STARTERS.filter(
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
  }</div><div class="chat-composer">${composer()}<div class="privacy-line">${icon("shield")}本地保存 · 演示消息不是真实 AI 回答</div></div></section></div>`;
}
function settingsPage() {
  return (
    heading("设置", "按你的习惯，整理这片工作空间。") +
    `<div class="settings-grid"><div><section class="settings-card"><h2>${icon("sun")}外观与偏好</h2><p>让工作台呈现你喜欢的样子。</p><div class="setting-row"><div><strong>界面主题</strong><small>跟随系统或选择固定主题</small></div><div class="segmented" role="group" aria-label="界面主题">${[
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
      )}</div></div><div class="setting-row"><div><strong>默认助手</strong><small>首版仅切换演示标签，不调用模型</small></div><select class="input" data-setting="model" aria-label="默认演示助手">${modelOptions()}</select></div></section><section class="settings-card"><h2>${icon("spark")}模型连接</h2><p>接入模型后，才能获得真实的 AI 回答。</p><div class="connection-state"><strong>AI 模型服务</strong><span class="status-pill">尚未连接</span></div>${notice("此版本不收集 API 密钥，也不向外部服务发送对话。实际接入需要在服务端配置密钥与鉴权。")}<div class="setting-row">${button("connection-help", "查看接入说明", "arrow", "btn")}</div></section><section class="settings-card"><h2>${icon("shield")}本地数据</h2><p>提示词、会话、资料和设置保存在当前浏览器，清除浏览器数据后会丢失。可导出 JSON 备份，再从备份恢复。</p><div class="settings-actions">${button("export-all", "导出全部数据", "download", "btn")}${button("import-backup", "恢复备份", "upload", "btn")}${button("reset", "重置工作台", "trash", "btn btn-danger")}</div><input type="file" id="backup-input" accept="application/json,.json" hidden /></section></div><aside><section class="settings-card"><h2>${icon("help")}使用小贴士</h2><ol class="help-list"><li>在提示词库点亮星标，常用方法就会出现在首页。</li><li>用全局搜索查找提示词、会话、资料正文和任务。</li><li>在知识库添加文本，可将内容带入对话输入框。</li><li>按 Ctrl / ⌘ + K 打开搜索，按 Esc 关闭弹窗。</li></ol></section><section class="settings-card"><h2>${icon("layers")}关于智作台</h2><p>一个让创作、思考与日常工作从容发生的 AI 工作空间。</p><div class="connection-state"><span>版本</span><strong>0.2.0 · 演示版</strong></div></section></aside></div>`
  );
}
function render() {
  const textarea = document.querySelector("#message-input");
  if (textarea) drafts.set(textarea.form.dataset.draft, textarea.value);
  const { page } = route();
  applyTheme();
  const title = nav.find((n) => n[0] === page)[1];
  document.title = `${title} · 智作台`;
  document.body.classList.remove("sidebar-open");
  app.innerHTML = `<div class="app-shell"><aside class="sidebar" id="sidebar" aria-label="主导航"><a class="brand" href="#home" aria-label="智作台首页"><span class="brand-mark">${icon("spark")}</span><span><span class="brand-name">智作台</span><span class="brand-caption">YOUR AI WORKSPACE</span></span></a><p class="workspace-label">工作空间</p><nav>${nav
    .slice(0, 5)
    .map(
      ([id, label, name]) =>
        `<a class="nav-link ${page === id ? "active" : ""}" href="#${id}" ${page === id ? 'aria-current="page"' : ""}>${icon(name)}${label}${id === "prompts" && page !== id ? `<span class="count">${state.prompts.length}</span>` : ""}</a>`,
    )
    .join(
      "",
    )}</nav><div class="sidebar-bottom"><a class="nav-link ${page === "settings" ? "active" : ""}" href="#settings" ${page === "settings" ? 'aria-current="page"' : ""}>${icon("settings")}设置</a><div class="local-card"><strong>${icon("shield")}灵感在这里，安心留下</strong><p>内容仅保存在当前浏览器。<br>你的工作空间，由你掌握。</p></div><a href="#settings" class="profile"><span class="avatar">我</span><span><strong>我的工作空间</strong><small>本地演示版</small></span>${icon("chevron")}</a></div></aside><button class="sidebar-backdrop" data-action="close-menu" aria-label="关闭导航"></button><div class="workspace"><header class="topbar">${iconButton("menu", "打开导航", "menu", 'aria-expanded="false" aria-controls="sidebar" data-menu-button')}<div class="breadcrumb"><span>工作空间</span><span>/</span><span>${title}</span></div><div class="topbar-tools">${button("search", "<span>搜索工作空间…</span><kbd>⌘ K</kbd>", "search", "search-trigger", 'aria-label="搜索工作空间"')}<span class="demo-badge">演示模式</span>${iconButton("help", "使用帮助", "help")}${button("new", "新建", "plus", "btn btn-primary")}</div></header><main class="main" id="main" tabindex="-1">${{ home: homePage, prompts: promptsPage, knowledge: knowledgePage, tasks: tasksPage, chat: chatPage, settings: settingsPage }[page]()}${page === "chat" ? "" : '<footer class="footer"><span>智作台 · 让想法有处落地</span><span>为每一份专注而设计 &nbsp; / &nbsp; 演示版 0.2</span></footer>'}</main></div></div>`;
  // The menu button needs one class attribute to remain available on small screens.
  document.querySelector("[data-menu-button]").classList.add("mobile-menu");
  document.querySelector("#sidebar").inert = mobile.matches;
  const messages = document.querySelector("#messages");
  if (messages) messages.scrollTop = messages.scrollHeight;
}

let confirmAction = null;
function openDialog(title, content, className = "") {
  if (!dialog.open) dialogOrigin = document.activeElement;
  dialog.className = className;
  dialog.innerHTML = `<div class="dialog-header"><h2 id="dialog-title">${e(title)}</h2>${iconButton("close-dialog", "关闭弹窗", "close")}</div>${content}`;
  if (!dialog.open) dialog.showModal();
}
function closeDialog() {
  dialog.close();
  confirmAction = null;
  if (dialogOrigin?.isConnected) dialogOrigin.focus();
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
    `<div class="global-search-input">${icon("search")}<input type="search" id="global-search" aria-label="搜索提示词、会话、资料和任务" maxlength="100" placeholder="搜索提示词、会话、资料和任务…" autocomplete="off" autofocus /></div><div id="global-results" class="search-results" aria-live="polite">${empty("search", "把需要的内容，找回来", "输入关键词，搜索你的整个工作空间。")}</div><div class="search-help">输入关键词搜索 · Tab 选择结果 · Esc 关闭</div>`,
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
            `<button class="search-result" data-action="search-result" data-kind="${r.kind}" data-id="${r.id}">${icon({ prompt: "layers", session: "chat", document: "file", task: "history" }[r.kind])}<span><strong>${e(r.title)}</strong><small>${e(r.label)}</small></span></button>`,
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
function setMenu(open) {
  document.body.classList.toggle("sidebar-open", open);
  const sidebar = document.querySelector("#sidebar");
  sidebar.inert = mobile.matches && !open;
  document.querySelector(".workspace").inert = open;
  document
    .querySelector("[data-menu-button]")
    .setAttribute("aria-expanded", String(open));
  if (open) sidebar.querySelector("a").focus();
  else document.querySelector("[data-menu-button]").focus();
}

async function handleAction(target) {
  const { action, id } = target.dataset;
  const session = state.sessions.find((s) => s.id === route().id);
  switch (action) {
    case "menu":
      setMenu(true);
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
      go("chat");
      break;
    case "new":
      openDialog(
        "从哪里开始？",
        `<div class="dialog-body"><p>一个新问题、一份好方法，或一段背景资料。</p><div class="settings-actions">${button("new-dialog-chat", "新建对话", "chat", "btn")}${button("new-prompt", "新建提示词", "layers", "btn")}${button("new-document", "添加资料", "file", "btn")}</div></div>`,
      );
      break;
    case "new-dialog-chat":
      closeDialog();
      pendingType = "AI 对话";
      drafts.set("new", "");
      if (
        document.querySelector("#message-input")?.form.dataset.draft === "new"
      )
        document.querySelector("#message-input").value = "";
      go("chat");
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
    case "task-filter":
      taskFilter = id;
      render();
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
        "会话及其关联的演示任务记录将一起从当前浏览器删除。",
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
    case "regenerate":
      mutate((next) => {
        const m = next.sessions
          .find((s) => s.id === session?.id)
          ?.messages.find((m) => m.id === id && m.role === "assistant");
        if (m) m.content = demoReply();
      });
      render();
      toast("已重新显示演示消息，未调用模型");
      break;
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
    case "export-tasks":
      exportJSON("智作台-任务记录.json", state.tasks);
      break;
    case "import-backup":
      document.querySelector("#backup-input").click();
      break;
    case "reset":
      confirmDialog(
        "重置整个工作台？",
        "所有会话、任务和资料将被清除，提示词和设置恢复初始值。建议先导出备份。此操作无法撤销。",
        "确认重置",
        () => {
          const next = createInitialState();
          saveState(localStorage, next);
          state = next;
          drafts.clear();
          promptFilter = documentFilter = taskFilter = "全部";
          promptQuery = documentQuery = taskQuery = "";
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
        `<div class="dialog-body"><p>当前发布的是可交互的前端演示版，还没有配置模型后端。</p><ol class="help-list"><li>实际接入时，需要先选择模型服务与部署环境。</li><li>API 密钥应保存在服务端环境变量中，不写入页面、浏览器存储或公开仓库。</li><li>接入前需补齐身份验证、请求限流、超时和错误处理。</li></ol><p>演示助手的切换只用于体验界面，所有演示消息都有明确标记。</p></div>`,
      );
      break;
    case "help":
      openDialog(
        "欢迎使用智作台",
        `<div class="dialog-body"><p>把常用提示词、资料和每次思考放在同一个地方。</p><ol class="help-list"><li>从首页快捷操作开始，或在提示词库选择一个模板。</li><li>发送后会保存会话和任务，并显示一条明确标注的演示消息。</li><li>支持多轮会话、复制和导出。当前没有调用任何 AI 服务。</li><li>使用 Ctrl / ⌘ + K 搜索，按 Esc 关闭弹窗。</li></ol>${notice("内容仅保存在当前浏览器，不支持跨设备同步。建议定期在设置中导出备份。")}</div>`,
      );
      break;
  }
}

document.addEventListener("click", (event) => {
  const target = event.target.closest("[data-action]");
  if (target) handleAction(target).catch((error) => toast(error.message, true));
  if (event.target.closest(".sidebar a") && mobile.matches) {
    document.body.classList.remove("sidebar-open");
    document.querySelector(".workspace").inert = false;
    document.querySelector("#sidebar").inert = true;
    document
      .querySelector("[data-menu-button]")
      .setAttribute("aria-expanded", "false");
  }
});
document.addEventListener("submit", (event) => {
  const form = event.target;
  if (!["message-form", "prompt-form", "tag-form"].includes(form.id)) return;
  event.preventDefault();
  const data = new FormData(form);
  try {
    if (form.id === "message-form") {
      const content = String(data.get("message"));
      const id = mutate((next) =>
        recordExchange(
          next,
          route().page === "chat" ? route().id : "",
          content,
          pendingType,
        ),
      );
      drafts.delete(form.dataset.draft);
      form.querySelector("textarea").value = "";
      pendingType = "AI 对话";
      go("chat", id);
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
  if (id === "task-search") {
    taskQuery = value;
    document.querySelector("#task-results").innerHTML = taskResults();
  }
  if (id === "global-search") updateSearch(value);
  if (id === "message-input")
    drafts.set(event.target.form.dataset.draft, value);
});
document.addEventListener("change", async (event) => {
  const target = event.target;
  try {
    if (
      target.dataset.setting === "model" &&
      Object.hasOwn(MODELS, target.value)
    ) {
      mutate((next) => {
        next.settings.model = target.value;
      });
      toast("已切换演示助手，未连接模型");
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
        `将替换当前本地数据：${next.prompts.length} 个提示词、${next.sessions.length} 段会话、${next.documents.length} 份资料。建议先导出现有数据。`,
        "替换并恢复",
        () => {
          saveState(localStorage, next);
          state = next;
          drafts.clear();
          promptFilter = documentFilter = taskFilter = "全部";
          promptQuery = documentQuery = taskQuery = "";
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
  if (event.key === "Tab" && document.body.classList.contains("sidebar-open")) {
    const focusable = [...document.querySelectorAll(".sidebar a")];
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
mobile.addEventListener("change", () => {
  document.body.classList.remove("sidebar-open");
  document.querySelector("#sidebar").inert = mobile.matches;
  document.querySelector(".workspace").inert = false;
  document
    .querySelector("[data-menu-button]")
    .setAttribute("aria-expanded", "false");
});
render();
if (initial.warning) toast(initial.warning, true);
