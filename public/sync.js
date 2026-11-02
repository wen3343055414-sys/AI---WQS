import { STORAGE_KEY, validateState, escapeHtml } from "./core.js";

export class WorkspaceSync {
  constructor(callbacks) {
    this.callbacks = callbacks;
    this.mode = "connecting";
    this.authenticated = false;
    this.revision = 0;
    this.sequence = 0;
    this.version = "";
    this.pending = null;
    this.conflict = null;
    this.busy = false;
    this.label = "正在连接服务器";
    this.dialog = document.createElement("dialog");
    this.dialog.className = "server-access";
    this.dialog.setAttribute("aria-label", "本机服务器登录");
    this.dialog.addEventListener("cancel", event => event.preventDefault());
    document.body.append(this.dialog);
    window.addEventListener("online", () => this.connect());
    window.addEventListener("beforeunload", event => { if (this.pending) { event.preventDefault(); event.returnValue = ""; } });
    document.addEventListener("click", event => {
      const action = event.target.closest("[data-sync]")?.dataset.sync;
      if (action === "retry") this.connect();
      if (action === "logout") this.logout().catch(error => this.callbacks.onNotice?.(error.message, true));
      if (action === "reload") location.reload();
      if (action === "use-server") this.resolveConflict(false);
      if (action === "use-local") this.resolveConflict(true);
    });
  }
  get canWrite() { return this.mode === "local" || this.authenticated; }
  status(label) {
    this.label = label;
    this.refreshStatus();
  }
  refreshStatus() {
    for (const element of document.querySelectorAll("[data-server-label]")) element.textContent = this.label;
    for (const element of document.querySelectorAll("[data-server-version]")) element.textContent = this.version ? this.version.slice(0, 12) : "静态演示版";
    const banner = document.querySelector("#sync-conflict");
    if (banner) banner.hidden = !this.conflict;
    this.callbacks.onStatus?.(this);
  }
  async request(path, options = {}) {
    const response = await fetch(path, { credentials: "same-origin", cache: "no-store", signal: AbortSignal.timeout(10000), ...options });
    let body;
    try { body = await response.json(); } catch { throw new Error("服务器暂时不可用，修改仍保留在此页面。"); }
    if (!response.ok) { const error = new Error(body.message || "服务器暂时无法完成操作。"); error.status = response.status; error.body = body; throw error; }
    return body;
  }
  async connect() {
    if (this.connecting) return;
    this.connecting = true;
    const previousServer = this.serverId;
    const inMemory = this.pending ? { state: this.pending, baseRevision: this.revision } : null;
    try {
      const response = await fetch("/api/status", { credentials: "same-origin", cache: "no-store", signal: AbortSignal.timeout(5000) });
      if (response.status === 404 && this.mode === "connecting") { this.mode = "local"; this.status("静态版 · 浏览器保存"); return; }
      if (!response.ok) throw new Error("服务器未就绪，请稍后重试。");
      const status = await response.json();
      if (status.mode !== "server") throw new Error("服务器响应无法识别。");
      this.mode = "server";
      this.serverId = status.serverId;
      this.version = status.version;
      this.authenticated = status.authenticated;
      if (!status.authenticated) { this.status("请登录本机服务器"); this.showLogin(status.setupRequired); return; }
      document.body.classList.remove("server-locked");
      if (this.dialog.open) this.dialog.close();
      const snapshot = await this.request("/api/workspace");
      this.revision = snapshot.revision;
      let queued = previousServer === this.serverId ? inMemory : null;
      if (!queued) { try { queued = JSON.parse(localStorage.getItem(`${STORAGE_KEY}.pending.${this.serverId}`)); } catch { /* A corrupt draft never replaces the server. */ } }
      if (queued && validateState(queued.state) && Number.isSafeInteger(queued.baseRevision)) {
        this.pending = queued.state;
        this.sequence++;
        this.callbacks.onState(structuredClone(this.pending));
        if (queued.baseRevision !== snapshot.revision) { this.conflict = snapshot; this.status("有未同步修改，请处理版本冲突"); }
        else { this.status("正在补发未同步修改"); await this.flush(); }
      } else {
        let migrated;
        if (snapshot.revision === 0) { try { migrated = JSON.parse(localStorage.getItem(STORAGE_KEY)); } catch {} }
        if (migrated && validateState(migrated)) {
          this.callbacks.onState(migrated);
          this.enqueue(migrated);
          await this.flush();
          this.callbacks.onNotice?.("浏览器原有记录已迁入本机服务器，旧缓存继续保留。");
        } else {
          this.callbacks.onState(snapshot.state);
          this.status("已同步到本机数据库");
        }
      }
      clearInterval(this.timer);
      this.timer = setInterval(() => this.poll(), 8000);
    } catch (error) { this.status("服务器离线 · 等待重试"); this.callbacks.onNotice?.(error.message, true); }
    finally { this.connecting = false; }
  }
  showLogin(setup) {
    document.body.classList.add("server-locked");
    this.dialog.innerHTML = `<form class="server-login"><div class="server-login-mark">智</div><p class="server-eyebrow">智作台 · 本机服务器</p><h1>${setup ? "给你的工作空间设一把钥匙" : "欢迎回到你的工作空间"}</h1><p>${setup ? "首次启动，请设置访问密码。提示词、会话和资料将保存在这台服务器的数据库中。" : "输入本机服务器的访问密码，继续你的工作。"}</p><label>访问密码<input type="password" name="password" minlength="10" maxlength="128" autocomplete="${setup ? "new-password" : "current-password"}" required placeholder="至少 10 个字符"/></label>${setup ? '<label>再次输入<input type="password" name="confirm" minlength="10" maxlength="128" autocomplete="new-password" required placeholder="再次输入访问密码"/></label>' : ''}<p class="server-auth-error" role="alert"></p><button type="submit" class="btn btn-primary">${setup ? "创建并进入工作台" : "登录工作台"}</button><small>数据由本机服务器统一保存，浏览器会自动同步。</small></form>`;
    this.dialog.querySelector("form").addEventListener("submit", async event => {
      event.preventDefault();
      const form = event.currentTarget;
      const data = new FormData(form);
      const error = form.querySelector(".server-auth-error");
      if (setup && data.get("password") !== data.get("confirm")) { error.textContent = "两次输入的密码不一致。"; return; }
      const button = form.querySelector("button");
      button.disabled = true;
      try {
        await this.request(setup ? "/api/setup" : "/api/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: data.get("password") }) });
        form.reset(); await this.connect();
      } catch (failure) { error.textContent = failure.message; }
      finally { button.disabled = false; }
    });
    if (!this.dialog.open) this.dialog.showModal();
  }
  enqueue(state) {
    if (!this.authenticated) throw new Error("请先登录服务器再保存。");
    this.pending = structuredClone(state);
    this.sequence++;
    this.cachePending();
    this.status(this.conflict ? "版本冲突 · 当前修改已保留" : "正在保存到本机服务器");
    clearTimeout(this.flushTimer);
    this.flushTimer = setTimeout(() => this.flush(), 300);
  }
  cachePending() {
    try { localStorage.setItem(`${STORAGE_KEY}.pending.${this.serverId}`, JSON.stringify({ state: this.pending, baseRevision: this.revision })); }
    catch { this.callbacks.onNotice?.("浏览器缓存空间不足，请保持页面打开，等待服务器保存完成。", true); }
  }
  async flush() {
    if (this.busy || !this.pending || this.conflict || !this.authenticated) return;
    this.busy = true;
    const sequence = this.sequence;
    try {
      const result = await this.request("/api/workspace", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ state: this.pending, baseRevision: this.revision }) });
      this.revision = result.revision;
      if (this.sequence === sequence) {
        this.pending = null;
        try { localStorage.removeItem(`${STORAGE_KEY}.pending.${this.serverId}`); } catch {}
        this.status("已同步到本机数据库");
      } else this.cachePending();
    } catch (error) {
      if (error.status === 409) { this.conflict = error.body; this.status("版本冲突 · 当前修改已保留"); }
      else if (error.status === 401) { this.authenticated = false; this.status("登录已过期 · 修改待同步"); this.showLogin(false); }
      else this.status("尚未同步 · 自动重试中");
    } finally { this.busy = false; if (this.pending && !this.conflict && this.authenticated) this.flushTimer = setTimeout(() => this.flush(), 2500); }
  }
  async poll() {
    if (!this.authenticated || this.busy || this.pending || this.conflict) return;
    this.busy = true;
    try {
      const status = await this.request("/api/status");
      if (!status.authenticated) { this.authenticated = false; this.showLogin(false); return; }
      if (status.serverId !== this.serverId) { location.reload(); return; }
      if (status.version !== this.version) {
        if (this.callbacks.canReload?.()) location.reload();
        else this.callbacks.onVersion?.(status.version);
        return;
      }
      const remote = await this.request("/api/workspace");
      if (remote.revision !== this.revision) {
        if (this.callbacks.canApply?.() === false) { this.status("服务器有更新 · 编辑结束后同步"); return; }
        this.revision = remote.revision;
        this.callbacks.onState(remote.state);
      }
      this.status("已同步到本机数据库");
    } catch { this.status("服务器暂时离线 · 保留当前内容"); }
    finally { this.busy = false; }
  }
  resolveConflict(useLocal) {
    if (!this.conflict || !this.pending) return;
    if (useLocal && !confirm("将使用本页内容替换服务器的最新工作空间。请确认其他页面的修改已备份。")) return;
    try { localStorage.setItem(`${STORAGE_KEY}.conflict-backup.${Date.now()}`, JSON.stringify({ local: this.pending, remote: this.conflict.state })); } catch { this.callbacks.onNotice?.("请先导出本页备份，再处理冲突。", true); return; }
    this.revision = this.conflict.revision;
    if (!useLocal) { this.callbacks.onState(this.conflict.state); this.pending = null; localStorage.removeItem(`${STORAGE_KEY}.pending.${this.serverId}`); }
    this.conflict = null;
    if (useLocal) { this.cachePending(); this.flush(); } else this.status("已载入服务器版本，冲突内容已在浏览器备份");
  }
  async logout() {
    if (this.pending) { this.callbacks.onNotice?.("还有未同步修改，请等待保存完成或先处理冲突。", true); return; }
    await this.request("/api/logout", { method: "POST" });
    this.authenticated = false;
    clearInterval(this.timer);
    this.showLogin(false);
    this.status("已退出本机服务器");
  }
}
