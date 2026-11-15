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

const rememberedKey = "zhizuotai.auth.preferences.v1";
function readRemembered() {
  try {
    const value = JSON.parse(localStorage.getItem(rememberedKey));
    if (!value || !["account", "email"].includes(value.method)) return null;
    const name = value.method === "email" ? "email" : "account";
    return typeof value[name] === "string" && value[name].length <= (name === "email" ? 254 : 32) ? value : null;
  } catch { return null; }
}
const illustration = mode => `<svg class="auth-illustration" viewBox="0 0 360 290" fill="none" aria-hidden="true">
<defs>
  <linearGradient id="auth-card-edge" x1="66" y1="35" x2="275" y2="204" gradientUnits="userSpaceOnUse"><stop stop-color="#e8f2ff"/><stop offset=".48" stop-color="#91b7ff"/><stop offset="1" stop-color="#4c7df0"/></linearGradient>
  <linearGradient id="auth-card-face" x1="88" y1="55" x2="252" y2="192" gradientUnits="userSpaceOnUse"><stop stop-color="#8fb7ff"/><stop offset=".46" stop-color="#518dff"/><stop offset="1" stop-color="#235ce5"/></linearGradient>
  <linearGradient id="auth-shield" x1="234" y1="150" x2="305" y2="248" gradientUnits="userSpaceOnUse"><stop stop-color="#6eaaff"/><stop offset="1" stop-color="#1357ed"/></linearGradient>
  <linearGradient id="auth-white" x1="115" y1="81" x2="143" y2="144" gradientUnits="userSpaceOnUse"><stop stop-color="white"/><stop offset="1" stop-color="#c7deff"/></linearGradient>
  <linearGradient id="auth-stage" x1="74" y1="223" x2="283" y2="264" gradientUnits="userSpaceOnUse"><stop stop-color="#f7fbff"/><stop offset=".55" stop-color="#d6e6ff"/><stop offset="1" stop-color="#a7c5ff"/></linearGradient>
  <radialGradient id="auth-glow"><stop stop-color="#80adff" stop-opacity=".24"/><stop offset="1" stop-color="#80adff" stop-opacity="0"/></radialGradient>
  <filter id="auth-shadow" x="-45%" y="-45%" width="190%" height="210%"><feDropShadow dx="0" dy="13" stdDeviation="11" flood-color="#477bdb" flood-opacity=".2"/></filter>
</defs>
<ellipse cx="180" cy="170" rx="169" ry="119" fill="url(#auth-glow)"/>
<path d="M40 151c-9-43 36-90 115-104 76-15 151 4 164 42" stroke="#fff" stroke-width="1.5" stroke-dasharray="3 7"/>
<circle cx="45" cy="143" r="4" fill="#fff"/><circle cx="318" cy="89" r="4" fill="#fff"/>
<ellipse cx="183" cy="264" rx="137" ry="18" fill="#6c9cf2" opacity=".12"/>
<path d="M62 233v13c0 15 53 27 118 27s118-12 118-27v-13H62Z" fill="url(#auth-stage)"/>
<ellipse cx="180" cy="232" rx="118" ry="26" fill="#f5f9ff"/><ellipse cx="180" cy="232" rx="98" ry="18" fill="#e5eeff"/>
<g filter="url(#auth-shadow)" transform="rotate(-8 171 132)">
  <rect x="69" y="46" width="218" height="153" rx="18" fill="url(#auth-card-edge)"/>
  <rect x="75" y="49" width="205" height="142" rx="13" fill="url(#auth-card-face)" stroke="#e3eeff" stroke-width="2"/>
  <path d="M88 58h177" stroke="white" stroke-opacity=".36" stroke-width="2" stroke-linecap="round"/>
  <circle cx="127" cy="105" r="19" fill="url(#auth-white)"/>
  <path d="M94 151c0-17 14-26 33-26s33 9 33 26v5H94v-5Z" fill="url(#auth-white)"/>
  <rect x="179" y="91" width="70" height="9" rx="4.5" fill="#f0f6ff"/><rect x="179" y="112" width="53" height="7" rx="3.5" fill="#b5d4ff"/>
  <rect x="179" y="137" width="28" height="7" rx="3.5" fill="#c8dfff"/><rect x="215" y="137" width="29" height="7" rx="3.5" fill="#c8dfff"/>
</g>
<path d="m135 202-8 18h102l-8-18" fill="#bdd4ff"/><path d="M113 220h129l12 10H100l13-10Z" fill="#f4f8ff" stroke="#c5dbff" stroke-width="2"/>
<g filter="url(#auth-shadow)">
  <path d="M268 151c14 9 27 12 39 14v35c0 22-15 38-39 49-24-11-39-27-39-49v-35c12-2 25-5 39-14Z" fill="#b2d0ff" stroke="#eef6ff" stroke-width="3"/>
  <path d="M268 160c11 6 20 9 30 11v29c0 17-10 29-30 39-20-10-30-22-30-39v-29c10-2 19-5 30-11Z" fill="url(#auth-shield)"/>
  ${mode === "register" ? '<path d="m253 198 10 10 20-22" stroke="white" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>' : mode === "sms" ? '<rect x="256" y="178" width="24" height="39" rx="5" stroke="white" stroke-width="3"/><path d="M264 209h8" stroke="white" stroke-width="3" stroke-linecap="round"/>' : '<rect x="253" y="193" width="30" height="23" rx="5" fill="#edf5ff"/><path d="M259 193v-7a9 9 0 0 1 18 0v7" stroke="#edf5ff" stroke-width="4"/><path d="M268 202v6" stroke="#4b83f4" stroke-width="3" stroke-linecap="round"/>'}
</g>
<g transform="translate(49 177) rotate(-12)" filter="url(#auth-shadow)"><rect width="53" height="43" rx="12" fill="#f9fcff" stroke="white" stroke-width="2"/><path d="m13 21 9 8 18-17" stroke="#5b93fb" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/></g>
<path d="m298 40 3 8 8 3-8 3-3 8-3-8-8-3 8-3 3-8Z" fill="#8eb6ff"/><path d="m51 86 2 6 6 2-6 2-2 6-2-6-6-2 6-2 2-6Z" fill="#a5c7ff"/>
<circle cx="308" cy="132" r="3" fill="#9bbcff"/><circle cx="85" cy="29" r="3" fill="#bed4ff"/>
</svg>`;
const socialIcons = {
  wechat: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#22b84f" d="M9.4 3C4.2 3 1 6 1 9.6c0 2.1 1.1 4 3.2 5.2l-.8 2.4 3-1.4c.9.3 1.9.4 3 .4 5.1 0 8.4-2.9 8.4-6.6S14.5 3 9.4 3Z"/><path fill="#49cf71" stroke="#fff" stroke-width=".7" d="M16.1 10c-4.1 0-6.9 2.4-6.9 5.4s2.8 5.3 6.9 5.3c.7 0 1.5-.1 2.2-.3l2.5 1.2-.6-2c1.8-1 2.8-2.5 2.8-4.2 0-3-2.8-5.4-6.9-5.4Z"/><circle cx="6.3" cy="8" r="1" fill="#fff"/><circle cx="12.3" cy="8" r="1" fill="#fff"/><circle cx="13.7" cy="14.5" r=".8" fill="#fff"/><circle cx="18.5" cy="14.5" r=".8" fill="#fff"/></svg>',
  google: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#4285f4" d="M21.6 12.2c0-.7-.1-1.4-.2-2.1H12v4h5.4a4.6 4.6 0 0 1-2 3v2.6h3.3c1.9-1.7 2.9-4.3 2.9-7.5Z"/><path fill="#34a853" d="M12 22c2.7 0 5-.9 6.7-2.3l-3.3-2.6c-.9.6-2 .9-3.4.9a6 6 0 0 1-5.7-4.2H2.9v2.7A10 10 0 0 0 12 22Z"/><path fill="#fbbc05" d="M6.3 13.8a6 6 0 0 1 0-3.6V7.5H2.9a10 10 0 0 0 0 9l3.4-2.7Z"/><path fill="#ea4335" d="M12 6c1.5 0 2.9.5 3.9 1.5l2.9-2.9A9.8 9.8 0 0 0 12 2a10 10 0 0 0-9.1 5.5l3.4 2.7A6 6 0 0 1 12 6Z"/></svg>',
  apple: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#29364b" d="M15.8 5.1c.9-1.1.8-2.6.8-2.6s-1.5.1-2.5 1.2c-1 1.1-.9 2.5-.9 2.5s1.5.1 2.6-1.1Zm3.4 12.6c-.6 1.3-.9 1.8-1.7 2.9-1.1 1.5-2.6 3.3-4.5 2.3-1.6-.8-2-.8-3.5 0-1.8.9-3.3-.8-4.4-2.3C2 16.2 1.5 11.7 3.5 8.8c1.5-2.1 3.8-2.3 5.4-1.8 1.2.4 2 .9 2.4.9.4 0 1.3-.6 2.7-1 1.3-.4 3.3-.3 4.8 1.3-4.2 2.3-3.5 8.3.4 9.5Z" transform="translate(1 -.6) scale(.91)"/></svg>',
};
const thirdParty = () => `<div class="auth-other"><p class="auth-divider">其他登录方式</p><div class="auth-socials">${[["wechat", "微信"], ["google", "Google"], ["apple", "Apple"]].map(([key, name]) => `<button type="button" class="auth-social" aria-label="${name}登录（暂未开通）" title="${name}登录暂未开通" disabled>${socialIcons[key]}</button>`).join("")}</div><p class="auth-social-note">第三方登录暂未开通</p></div>`;

export class AuthDialog {
  constructor({ request, onAuthenticated }) {
    this.request = request;
    this.onAuthenticated = onAuthenticated;
    const remembered = readRemembered();
    this.method = remembered?.method || "account";
    this.registration = false;
    this.recovery = false;
    this.remember = Boolean(remembered);
    this.drafts = remembered ? { account: remembered.account, email: remembered.email } : {};
    this.registrationDrafts = {};
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
      if (["register", "login", "recover"].includes(action)) {
        this.capture();
        this.registration = action === "register";
        this.recovery = action === "recover";
        this.render();
        this.element.querySelector("input, .auth-recovery-back")?.focus();
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
    this.recovery = false;
    this.smsEnabled = smsEnabled;
    if (this.drafts.account === undefined && legacyAccount) this.drafts.account = legacyAccount;
    this.render();
    if (!this.element.open) this.element.showModal();
    this.element.querySelector('input')?.focus();
  }
  close() {
    if (this.element.open) this.element.close();
    clearInterval(this.codeTimer);
    this.remaining = 0;
  }
  capture() {
    const form = this.element.querySelector("form");
    if (!form) return;
    const drafts = this.registration ? this.registrationDrafts : this.drafts;
    for (const name of ["account", "email", "phone"]) {
      if (form.elements[name]) drafts[name] = form.elements[name].value;
    }
    if (form.elements.remember) this.remember = form.elements.remember.checked;
  }
  switchMethod(method) {
    if (!methods.some(([key]) => key === method)) return;
    this.capture();
    this.method = method;
    this.render();
  }
  field(name, label, placeholder, type = "text", symbol = "user") {
    const password = type === "password";
    const drafts = this.registration ? this.registrationDrafts : this.drafts;
    const autocomplete = password ? (this.registration ? "new-password" : "current-password") : name === "email" ? "email" : "username";
    return `<div class="auth-field"><label for="auth-${name}">${label}</label><div class="auth-input-wrap">${icon(symbol)}<input id="auth-${name}" name="${name}" type="${type}" autocomplete="${autocomplete}" placeholder="${placeholder}" value="${password ? "" : e(drafts[name] || "")}" maxlength="${password ? 128 : name === "email" ? 254 : 32}" ${password && this.registration ? 'minlength="10"' : ""} required />${password ? `<button type="button" class="auth-eye" data-auth="password" data-field="${name}" aria-label="显示密码" aria-pressed="false">${icon("eye")}</button>` : ""}</div></div>`;
  }
  story(mode) {
    const copy = mode === "register"
      ? ["从这里，开启新灵感", "创建你的账号，<br>让好想法拥有自己的空间。"]
      : mode === "recovery"
        ? ["找回连接，继续灵感", "每一份专注与创作，<br>都值得被妥善保存。"]
        : mode === "sms"
          ? ["轻松验证，即刻开始", "更便捷地连接你的工作空间，<br>继续下一段灵感旅程。"]
          : ["一个账号，连接每份灵感", "对话、知识与每一个好想法，<br>在这里，有序相遇。"];
    return `<aside class="auth-story">
      <div class="auth-brand"><span class="auth-logo">智</span><span>智作台<small>YOUR AI WORKSPACE</small></span></div>
      <div class="auth-story-content"><div class="auth-visual">${illustration(mode)}</div><div class="auth-story-copy"><h2>${copy[0]}</h2><p>${copy[1]}</p></div></div>
      <p class="auth-story-footer"><span>${icon("chat")}对话创作</span><span>${icon("spark")}灵感管理</span><span>${icon("mail")}知识整理</span></p>
    </aside>`;
  }
  frame(content, mode) {
    return `<div class="auth-layout auth-${mode}">${this.story(mode)}<section class="auth-panel">
      <div class="auth-mobile-brand"><span class="auth-logo">智</span><span>智作台</span></div>
      ${content}<p class="auth-panel-footer">智作台 · 让每一个好想法，有处安放。</p>
    </section></div>`;
  }
  render() {
    if (this.recovery) {
      this.element.innerHTML = this.frame(`<header class="auth-heading"><h1 id="auth-title">找回密码</h1><p>为你的账号，找回熟悉的工作空间。</p></header>
        <div class="auth-recovery-card">${icon("lock")}<h2>自助找回暂未开放</h2><p>暂不支持通过邮箱或手机自助重置密码。请确认账号信息后重试，或联系工作台管理员寻求帮助。</p></div>
        <button type="button" class="auth-submit auth-recovery-back" data-auth="login"><span>返回登录</span>${icon("arrow")}</button>
        <p class="auth-switch">没有账号？ <button type="button" class="auth-text-link" data-auth="register">去注册</button></p>`, "recovery");
      return;
    }
    const register = this.registration;
    const password = () => this.field("password", "密码", register ? "设置密码，至少 10 个字符" : "请输入密码", "password", "lock");
    let fields;
    if (register) {
      fields = this.field("account", "账号", "设置你的账号") +
        '<p class="auth-field-hint">3–32 位字母、数字、下划线或短横线</p>' +
        this.field("email", "邮箱", "请输入邮箱地址", "email", "mail") + password() +
        this.field("confirm", "确认密码", "请再次输入密码", "password", "lock");
    } else if (this.method === "sms") {
      fields = `<div class="auth-field"><label for="auth-phone">手机号</label><div class="auth-input-wrap auth-phone-wrap">${icon("phone")}<span class="auth-country">+86</span><input id="auth-phone" name="phone" type="tel" inputmode="tel" autocomplete="tel-national" placeholder="请输入手机号" value="${e(this.drafts.phone || "")}" maxlength="11" pattern="1[3-9][0-9]{9}" required /></div></div>
        <div class="auth-field"><label for="auth-code">验证码</label><div class="auth-input-wrap auth-code-wrap">${icon("key")}<input id="auth-code" name="code" inputmode="numeric" autocomplete="one-time-code" placeholder="请输入 6 位验证码" maxlength="6" pattern="[0-9]{6}" required /><button type="button" class="auth-send-code" data-auth="send-code" ${this.remaining ? "disabled" : ""}>${this.remaining ? this.remaining + "s 后重试" : "获取验证码"}</button></div></div>`;
    } else {
      fields = this.method === "email" ? this.field("email", "邮箱", "请输入邮箱地址", "email", "mail") + password()
        : this.field("account", "账号", "请输入账号", "text", "user") + password();
    }
    const heading = `<header class="auth-heading"><h1 id="auth-title">${register ? "创建你的账号" : this.method === "sms" ? "验证码登录" : "欢迎登录"}</h1><p>${register ? "加入智作台，让好想法从这里开始。" : this.method === "sms" ? "通过手机验证码，便捷登录工作空间。" : "登录你的账号，开启更有序的创作。"}</p></header>`;
    const tabs = register ? "" : `<div class="auth-tabs" role="tablist" aria-label="登录方式">${methods.map(([key, label]) => `<button type="button" role="tab" id="auth-tab-${key}" aria-controls="auth-form" aria-selected="${this.method === key}" tabindex="${this.method === key ? 0 : -1}" data-auth="method" data-method="${key}">${label}</button>`).join("")}</div>`;
    const options = register ? '<p class="auth-register-note">请使用常用邮箱，并妥善保管你的账号和密码。</p>'
      : this.method === "sms" ? (this.smsEnabled ? "" : '<p class="auth-method-note">验证码登录暂未开通，可使用账号或邮箱密码登录。</p>')
      : `<div class="auth-login-options"><label class="auth-remember" for="auth-remember"><input id="auth-remember" name="remember" type="checkbox" ${this.remember ? "checked" : ""} />记住账号</label><button type="button" class="auth-text-link" data-auth="recover">忘记密码？</button></div>`;
    const form = `<form class="auth-form" id="auth-form" ${register ? 'aria-label="注册账号"' : `role="tabpanel" aria-labelledby="auth-tab-${this.method}"`}>
      <div class="auth-fields">${fields}</div>${options}<p class="server-auth-error" id="auth-error" role="alert" aria-live="polite"></p>
      <button type="submit" class="auth-submit"><span>${register ? "注册并登录" : "登录"}</span>${icon("arrow")}</button>
    </form>`;
    const switcher = `<p class="auth-switch">${register ? "已有账号？" : "没有账号？"} <button type="button" class="auth-text-link" data-auth="${register ? "login" : "register"}">${register ? "去登录" : "去注册"}</button></p>`;
    this.element.innerHTML = this.frame(heading + tabs + form + (register ? "" : thirdParty()) + switcher, register ? "register" : this.method);
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
      if (!registration && method !== "sms") {
        try {
          if (this.remember) {
            const name = method === "email" ? "email" : "account";
            localStorage.setItem(rememberedKey, JSON.stringify({ method, [name]: payload[name] }));
          } else localStorage.removeItem(rememberedKey);
        } catch {}
      }
      if (registration) this.registrationDrafts = {};
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
