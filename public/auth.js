import { escapeHtml as e } from "./core.js";

const symbols = {
  user: '<circle cx="12" cy="8" r="3.5"/><path d="M5 21v-2a7 7 0 0 1 14 0v2"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="3"/><path d="m4 7 8 6 8-6"/>',
  lock: '<rect x="5" y="10" width="14" height="11" rx="3"/><path d="M8 10V7a4 4 0 0 1 8 0v3m-4 5v2"/>',
  phone: '<rect x="6" y="2" width="12" height="20" rx="3"/><path d="M10 18h4"/>',
  key: '<circle cx="8" cy="9" r="4"/><path d="m11 12 9 9m-3-3 3-3m-6 0 3-3"/>',
  eye: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
  hidden: '<path d="m3 3 18 18M10.6 5.1A11 11 0 0 1 12 5c6 0 10 7 10 7a18 18 0 0 1-3.1 3.8M6 6.5A23 23 0 0 0 2 12s4 7 10 7a12 12 0 0 0 5.5-1.5"/>',
  arrow: '<path d="M4 12h16m-6-6 6 6-6 6"/>',
  chat: '<path d="M21 11a8 8 0 0 1-8 8H5l-3 3V11a9.5 9.5 0 0 1 19 0Z"/><path d="M7 9h9m-9 4h6"/>',
  spark: '<path d="m12 2 3 7 7 3-7 3-3 7-3-7-7-3 7-3 3-7Z"/>',
};
const icon = name => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${symbols[name]}</svg>`;
const methods = [["account", "账号密码"], ["sms", "手机验证码"], ["email", "邮箱密码"]];

export class AuthDialog {
  constructor({ request, onAuthenticated }) {
    this.request = request;
    this.onAuthenticated = onAuthenticated;
    this.method = "account";
    this.registration = false;
    this.drafts = {};
    this.remaining = 0;
    this.busy = false;
    this.element = document.createElement("dialog");
    this.element.className = "server-access";
    this.element.setAttribute("aria-labelledby", "auth-title");
    this.element.addEventListener("cancel", event => event.preventDefault());
    this.element.addEventListener("click", event => {
      const target = event.target.closest("[data-auth]");
      if (!target || this.busy) return;
      const action = target.dataset.auth;
      if (action === "method") this.switchMethod(target.dataset.method);
      if (action === "register" || action === "login") {
        this.capture();
        this.registration = action === "register";
        if (this.registration) { this.drafts.account = ""; this.drafts.email = ""; }
        this.render();
      }
      if (action === "password") {
        const input = this.element.querySelector('[name="' + target.dataset.field + '"]');
        const visible = input.type === "password";
        input.type = visible ? "text" : "password";
        target.innerHTML = icon(visible ? "hidden" : "eye");
        target.setAttribute("aria-label", visible ? "隐藏密码" : "显示密码");
        target.setAttribute("aria-pressed", String(visible));
        input.focus();
      }
      if (action === "send-code") this.sendCode();
    });
    this.element.addEventListener("keydown", event => {
      if (!event.target.matches('[role="tab"]') || !["ArrowLeft", "ArrowRight"].includes(event.key)) return;
      event.preventDefault();
      const index = methods.findIndex(([key]) => key === this.method);
      this.switchMethod(methods[(index + (event.key === "ArrowRight" ? 1 : 2)) % 3][0]);
      this.element.querySelector('[aria-selected="true"]')?.focus();
    });
    document.body.append(this.element);
  }
  open({ register = false, legacyAccount = "", smsEnabled = false } = {}) {
    this.registration = register;
    this.smsEnabled = smsEnabled;
    if (this.drafts.account === undefined && legacyAccount) this.drafts.account = legacyAccount;
    this.render();
    if (!this.element.open) this.element.showModal();
  }
  close() {
    if (this.element.open) this.element.close();
    clearInterval(this.codeTimer);
    this.remaining = 0;
  }
  capture() {
    const form = this.element.querySelector("form");
    if (!form) return;
    for (const name of ["account", "email", "phone"]) {
      if (form.elements[name]) this.drafts[name] = form.elements[name].value;
    }
  }
  switchMethod(method) {
    if (!methods.some(([key]) => key === method)) return;
    this.capture();
    this.method = method;
    this.render();
  }
  field(name, label, placeholder, type = "text", symbol = "user") {
    const password = type === "password";
    const autocomplete = password ? (this.registration ? "new-password" : "current-password") : name === "email" ? "email" : "username";
    return `<div class="auth-field"><label for="auth-${name}">${label}</label><div class="auth-input-wrap">${icon(symbol)}<input id="auth-${name}" name="${name}" type="${type}" autocomplete="${autocomplete}" placeholder="${placeholder}" value="${password ? "" : e(this.drafts[name] || "")}" maxlength="${password ? 128 : name === "email" ? 254 : 32}" ${password && this.registration ? 'minlength="10"' : ""} required />${password ? `<button type="button" class="auth-eye" data-auth="password" data-field="${name}" aria-label="显示密码" aria-pressed="false">${icon("eye")}</button>` : ""}</div></div>`;
  }
  render() {
    const register = this.registration;
    const password = () => this.field("password", "密码", register ? "设置密码，至少 10 个字符" : "请输入密码", "password", "lock");
    let fields;
    if (register) {
      fields = this.field("account", "账号", "设置你的账号") +
        '<p class="auth-field-hint">3–32 位字母、数字、下划线或短横线</p>' +
        this.field("email", "邮箱", "请输入邮箱地址", "email", "mail") +
        password() +
        this.field("confirm", "确认密码", "请再次输入密码", "password", "lock");
    } else if (this.method === "sms") {
      fields = `<div class="auth-field"><label for="auth-phone">手机号</label><div class="auth-input-wrap auth-phone-wrap">${icon("phone")}<span class="auth-country">+86</span><input id="auth-phone" name="phone" type="tel" inputmode="tel" autocomplete="tel-national" placeholder="请输入手机号" value="${e(this.drafts.phone || "")}" maxlength="11" pattern="1[3-9][0-9]{9}" required /></div></div><div class="auth-field"><label for="auth-code">验证码</label><div class="auth-input-wrap auth-code-wrap">${icon("key")}<input id="auth-code" name="code" inputmode="numeric" autocomplete="one-time-code" placeholder="请输入 6 位验证码" maxlength="6" pattern="[0-9]{6}" required /><button type="button" class="auth-send-code" data-auth="send-code" ${this.remaining ? "disabled" : ""}>${this.remaining ? this.remaining + "s 后重试" : "获取验证码"}</button></div></div>${this.smsEnabled ? "" : '<p class="auth-method-note">验证码登录暂未开通，可使用账号或邮箱登录。</p>'}`;
    } else {
      fields = this.method === "email"
        ? this.field("email", "邮箱", "请输入邮箱地址", "email", "mail") + password()
        : this.field("account", "账号", "请输入账号", "text", "user") + password();
    }
    this.element.innerHTML = `<div class="auth-layout ${register ? "auth-register" : ""}"><aside class="auth-story"><a class="auth-brand" href="#home" aria-label="智作台"><span class="auth-logo">智</span><span>智作台<small>YOUR AI WORKSPACE</small></span></a><div class="auth-story-copy"><p class="auth-kicker">一点灵感，无限可能</p><h2>把想法，<br>变成<span>下一步。</span></h2><p>让创作、思考与日常工作，<br>在同一个空间里从容发生。</p></div><div class="auth-art" aria-hidden="true"><span class="auth-orbit auth-orbit-one"></span><span class="auth-orbit auth-orbit-two"></span><div class="auth-note auth-note-back"><span class="auth-note-icon">${icon("spark")}</span><div><strong>留住每一个好想法</strong><i></i><i></i></div></div><div class="auth-note auth-note-front"><span class="auth-note-icon">${icon("chat")}</span><div><strong>今天，想一起完成什么？</strong><i></i><i></i></div><span class="auth-note-arrow">${icon("arrow")}</span></div><span class="auth-art-spark">${icon("spark")}</span></div><p class="auth-story-footer">对话创作 <span>·</span> 灵感管理 <span>·</span> 知识整理</p></aside><section class="auth-panel"><div class="auth-mobile-brand"><span class="auth-logo">智</span><span>智作台</span></div><header class="auth-heading"><p class="auth-welcome">${register ? "A NEW BEGINNING" : "WELCOME BACK"}</p><h1 id="auth-title">${register ? "创建你的账号" : "欢迎回来"}</h1><p>${register ? "加入智作台，让好想法从这里开始。" : "登录智作台，继续你的灵感与工作。"}</p></header>${register ? "" : `<div class="auth-tabs" role="tablist" aria-label="登录方式">${methods.map(([key, label]) => `<button type="button" role="tab" id="auth-tab-${key}" aria-controls="auth-form" aria-selected="${this.method === key}" tabindex="${this.method === key ? 0 : -1}" data-auth="method" data-method="${key}">${label}</button>`).join("")}</div>`}<form class="auth-form" id="auth-form" ${register ? 'aria-label="注册账号"' : `role="tabpanel" aria-labelledby="auth-tab-${this.method}"`}>${fields}<p class="server-auth-error" id="auth-error" role="alert" aria-live="polite"></p><button type="submit" class="auth-submit"><span>${register ? "注册并登录" : "登录"}</span>${icon("arrow")}</button></form><p class="auth-switch">${register ? "已有账号？" : "没有账号？"} <button type="button" data-auth="${register ? "login" : "register"}">${register ? "去登录" : "去注册"}</button></p><p class="auth-panel-footer">为每一份专注，留一片灵感空间。</p></section></div>`;
    this.element.querySelector("form").addEventListener("submit", event => this.submit(event));
  }
  error(message) {
    const output = this.element.querySelector("#auth-error");
    if (output) output.textContent = message;
  }
  friendly(error) { return error.status ? error.message : "网络连接异常，请稍后重试。"; }
  async sendCode() {
    const form = this.element.querySelector("form");
    const phone = form.elements.phone?.value;
    if (!/^1[3-9][0-9]{9}$/.test(phone || "")) { this.error("请输入有效的手机号。"); return; }
    const button = form.querySelector(".auth-send-code");
    button.disabled = true;
    try {
      await this.request("/api/sms/send", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ phone: "+86" + phone }) });
      this.remaining = 60;
      this.codeTimer = setInterval(() => {
        this.remaining--;
        const current = this.element.querySelector(".auth-send-code");
        if (current) { current.textContent = this.remaining ? this.remaining + "s 后重试" : "获取验证码"; current.disabled = this.remaining > 0; }
        if (!this.remaining) clearInterval(this.codeTimer);
      }, 1000);
      button.textContent = "60s 后重试";
      this.error("");
    } catch (error) {
      this.error(this.friendly(error));
      if (button.isConnected) button.disabled = false;
    }
  }
  async submit(event) {
    event.preventDefault();
    if (this.busy) return;
    const form = event.currentTarget;
    const data = Object.fromEntries(new FormData(form));
    if (this.registration && data.password !== data.confirm) { this.error("两次输入的密码不一致。"); return; }
    this.capture();
    const registration = this.registration;
    const method = this.method;
    const payload = registration ? { account: data.account.trim(), email: data.email.trim(), password: data.password }
      : method === "sms" ? { phone: "+86" + data.phone, code: data.code }
      : { method, [method === "email" ? "email" : "account"]: (data.email || data.account).trim(), password: data.password };
    const endpoint = registration ? "/api/register" : method === "sms" ? "/api/login/sms" : "/api/login";
    const button = form.querySelector('[type="submit"]');
    this.busy = true;
    button.disabled = true;
    button.setAttribute("aria-busy", "true");
    button.querySelector("span").textContent = registration ? "正在创建账号…" : "正在登录…";
    this.error("");
    try {
      await this.request(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      form.reset();
      await this.onAuthenticated();
    } catch (error) { this.error(this.friendly(error)); }
    finally {
      this.busy = false;
      if (button.isConnected) {
        button.disabled = false;
        button.removeAttribute("aria-busy");
        button.querySelector("span").textContent = registration ? "注册并登录" : "登录";
      }
    }
  }
}
