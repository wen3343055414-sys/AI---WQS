import { STORAGE_KEY, validateState } from "./core.js";
import { AuthDialog } from "./auth.js";

const syncTime = new Intl.DateTimeFormat("zh-CN", {
  month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone: "Asia/Shanghai",
});

export class WorkspaceSync {
  constructor(callbacks) {
    Object.assign(this, { callbacks, mode: "connecting", authenticated: false, revision: 0, sequence: 0, version: "", pending: null, conflict: null, busy: false, authCycle: 0, switchingAccount: false, accountActionBusy: false, label: "正在连接" });
    this.accountDrafts = new Map();
    this.auth = new AuthDialog({ request: (...args) => this.request(...args), onAuthenticated: () => this.connect(), onCancel: () => this.cancelAccountLogin() });
    this.dialog = this.auth.element;
    document.body.classList.add("server-locked");
    window.addEventListener("online", () => { if (!this.switchingAccount) this.connect(); });
    window.addEventListener("beforeunload", event => {
      if (this.pending || this.accountDrafts.size) { event.preventDefault(); event.returnValue = ""; }
    });
    document.addEventListener("click", event => {
      const action = event.target.closest("[data-sync]")?.dataset.sync;
      if (action === "retry") this.connect();
      if (action === "add-account") this.addAccount().catch(error => this.callbacks.onNotice?.(error.message, true));
      if (action === "logout") this.logout().catch(error => this.callbacks.onNotice?.(error.message, true));
      if (action === "reload") location.reload();
      if (action === "use-server") this.resolveConflict(false);
      if (action === "use-local") this.resolveConflict(true);
    });
  }
  get canWrite() { return this.mode === "local" || this.authenticated; }
  get pendingKey() { return STORAGE_KEY + ".pending." + (this.identity || this.serverId + "." + (this.user?.id ?? "legacy")); }
  status(label) {
    this.label = label;
    if (label === "已同步到本机数据库") this.lastSyncedAt = new Date().toISOString();
    this.refreshStatus();
  }
  refreshStatus() {
    for (const element of document.querySelectorAll("[data-server-label]")) element.textContent = this.label;
    for (const indicator of document.querySelectorAll("[data-sync-indicator]")) {
      indicator.title = this.label;
      indicator.setAttribute("aria-label", "连接：" + this.label);
      indicator.dataset.state = this.label === "已同步到本机数据库" ? "ready" : this.conflict ? "conflict" : "waiting";
    }
    for (const element of document.querySelectorAll("[data-server-version]")) element.textContent = this.version ? this.version.slice(0, 12) : "静态演示版";
    for (const element of document.querySelectorAll("[data-server-synced-at]")) {
      if (this.lastSyncedAt) {
        element.dateTime = this.lastSyncedAt;
        element.textContent = syncTime.format(new Date(this.lastSyncedAt));
      } else {
        element.removeAttribute("datetime");
        element.textContent = "—";
      }
    }
    const banner = document.querySelector("#sync-conflict");
    if (banner) banner.hidden = !this.conflict;
    this.callbacks.onStatus?.(this);
  }
  async request(path, options = {}) {
    const response = await fetch(path, { credentials: "same-origin", cache: "no-store", signal: AbortSignal.timeout(10000), ...options });
    let body;
    try { body = await response.json(); } catch { throw new Error("连接暂时不可用，修改仍保留在此页面。"); }
    if (!response.ok) { const error = new Error(body.message || "暂时无法完成操作，请稍后重试。"); error.status = response.status; error.body = body; throw error; }
    return body;
  }
  showLogin(setup) {
    document.body.classList.add("server-locked");
    this.auth.open({ register: setup, legacyAccount: this.lastStatus?.legacyAccount, smsEnabled: this.lastStatus?.authMethods?.sms });
  }
  unlock() { this.switchingAccount = false; document.body.classList.remove("server-locked"); this.auth.close(); }
  lock() {
    this.switchingAccount = false;
    this.authCycle++;
    this.authenticated = false;
    clearInterval(this.timer);
    this.status("请登录账号");
    this.showLogin(false);
  }
  validateSnapshot(snapshot) {
    if (!validateState(snapshot.state) || snapshot.userId !== this.user.id) {
      const error = new Error("账号状态已变化，请重新登录。");
      error.status = 401;
      throw error;
    }
  }
  async connect() {
    if (this.connecting || this.busy || this.accountActionBusy) return;
    this.connecting = true;
    const cycle = ++this.authCycle;
    const previousIdentity = this.identity;
    clearInterval(this.timer);
    try {
      const response = await fetch("/api/status", { credentials: "same-origin", cache: "no-store", signal: AbortSignal.timeout(5000) });
      if (cycle !== this.authCycle) return;
      if (response.status === 404 && this.mode === "connecting") {
        this.mode = "local"; this.unlock(); this.status("静态版 · 浏览器保存"); return;
      }
      if (!response.ok) throw new Error("连接未就绪，请稍后重试。");
      const status = await response.json();
      if (cycle !== this.authCycle) return;
      if (status.mode !== "server") throw new Error("连接响应无法识别。");
      this.mode = "server";
      this.lastStatus = status;
      this.serverId = status.serverId;
      this.version = status.version;
      this.authenticated = status.authenticated;
      if (!status.authenticated) { this.status("请登录账号"); this.showLogin(status.setupRequired); return; }
      if (!status.user || !Number.isSafeInteger(status.user.id)) throw new Error("登录信息无法识别，请刷新重试。");
      this.user = status.user;
      this.identity = status.serverId + "." + status.user.id;
      if (previousIdentity !== this.identity) {
        document.body.classList.add("server-locked");
        if (previousIdentity && this.pending) this.accountDrafts.set(previousIdentity, { state: structuredClone(this.pending), baseRevision: this.revision });
        this.pending = null;
        this.conflict = null;
        this.lastSyncedAt = null;
        this.sequence++;
        clearTimeout(this.flushTimer);
      }
      if (previousIdentity !== this.identity) this.callbacks.onAccountChange?.(this.user);
      const snapshot = await this.request("/api/workspace");
      if (cycle !== this.authCycle) return;
      this.validateSnapshot(snapshot);
      let queued = this.pending ? { state: this.pending, baseRevision: this.revision } : this.accountDrafts.get(this.identity);
      if (!queued) { try { queued = JSON.parse(localStorage.getItem(this.pendingKey)); } catch {} }
      if (!queued && this.user.legacy) { try { queued = JSON.parse(localStorage.getItem(STORAGE_KEY + ".pending." + this.serverId)); } catch {} }
      if (queued && validateState(queued.state) && Number.isSafeInteger(queued.baseRevision)) {
        this.revision = queued.baseRevision;
        this.pending = structuredClone(queued.state);
        this.sequence++;
        this.callbacks.onState(structuredClone(this.pending));
        if (queued.baseRevision !== snapshot.revision) { this.conflict = snapshot; this.status("有未同步修改，请处理版本冲突"); }
        else { this.conflict = null; this.status("正在补发未同步修改"); await this.flush(true); }
      } else {
        this.revision = snapshot.revision;
        let migrated;
        if (this.user.legacy && snapshot.revision === 0) { try { migrated = JSON.parse(localStorage.getItem(STORAGE_KEY)); } catch {} }
        if (migrated && validateState(migrated)) {
          this.callbacks.onState(migrated);
          this.enqueue(migrated);
          await this.flush(true);
          if (!this.pending) this.callbacks.onNotice?.("原有记录已迁入工作空间，旧缓存继续保留。");
        } else { this.callbacks.onState(snapshot.state); this.status("已同步到本机数据库"); }
      }
      if (cycle !== this.authCycle) return;
      this.unlock();
      this.timer = setInterval(() => this.poll(), 8000);
    } catch (error) {
      if (cycle !== this.authCycle) return;
      if (error.status === 401) this.lock();
      else this.status("连接异常 · 等待重试");
      this.callbacks.onNotice?.(error.message, true);
      if (document.body.classList.contains("server-locked") && !this.dialog.open) this.showLogin(false);
    } finally {
      this.connecting = false;
      this.scheduleFlush();
    }
  }
  enqueue(state) {
    if (!this.authenticated) throw new Error("请先登录账号再保存。");
    this.pending = structuredClone(state);
    this.sequence++;
    this.cachePending();
    this.status(this.conflict ? "版本冲突 · 当前修改已保留" : "正在保存到本机服务器");
    this.scheduleFlush();
  }
  scheduleFlush(delay = 300) {
    if (!this.pending || this.conflict || !this.authenticated || this.connecting) return;
    clearTimeout(this.flushTimer);
    this.flushTimer = setTimeout(() => this.flush(), delay);
  }
  cachePending() {
    const draft = { state: this.pending, baseRevision: this.revision };
    this.accountDrafts?.set(this.identity, structuredClone(draft));
    try { localStorage.setItem(this.pendingKey, JSON.stringify(draft)); }
    catch { this.callbacks.onNotice?.("浏览器缓存空间不足，请保持页面打开，等待保存完成。", true); }
  }
  clearPending() {
    this.accountDrafts?.delete(this.identity);
    try {
      localStorage.removeItem(this.pendingKey);
      if (this.user?.legacy) localStorage.removeItem(STORAGE_KEY + ".pending." + this.serverId);
    } catch {}
  }
  async flush(duringConnect = false) {
    if (this.busy || (this.connecting && !duringConnect) || !this.pending || this.conflict || !this.authenticated) return;
    this.busy = true;
    const sequence = this.sequence;
    const cycle = this.authCycle;
    try {
      const result = await this.request("/api/workspace", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ state: this.pending, baseRevision: this.revision, userId: this.user?.id }) });
      if (cycle !== this.authCycle) return;
      this.revision = result.revision;
      if (this.sequence === sequence) {
        this.pending = null;
        this.clearPending();
        this.status("已同步到本机数据库");
      } else this.cachePending();
    } catch (error) {
      if (cycle !== this.authCycle) return;
      if (error.status === 409) { this.conflict = error.body; this.status("版本冲突 · 当前修改已保留"); }
      else if (error.status === 401) { this.lock(); this.status("登录已过期 · 修改待同步"); }
      else this.status("尚未同步 · 自动重试中");
    } finally {
      this.busy = false;
      this.scheduleFlush(2500);
    }
  }
  async poll() {
    if (!this.authenticated || this.busy || this.connecting || this.pending || this.conflict || this.switchingAccount || this.accountActionBusy) return;
    this.busy = true;
    const cycle = this.authCycle;
    const sequence = this.sequence;
    try {
      const status = await this.request("/api/status");
      if (cycle !== this.authCycle) return;
      if (!status.authenticated || status.user?.id !== this.user?.id) { this.lock(); return; }
      if (status.serverId !== this.serverId) { document.body.classList.add("server-locked"); location.reload(); return; }
      if (status.version !== this.version) {
        if (this.sequence === sequence && !this.pending && !this.accountDrafts?.size && this.callbacks.canReload?.()) location.reload();
        else this.callbacks.onVersion?.(status.version);
        return;
      }
      if (this.sequence !== sequence || this.pending) return;
      const remote = await this.request("/api/workspace");
      if (cycle !== this.authCycle || this.sequence !== sequence || this.pending) return;
      this.validateSnapshot(remote);
      if (remote.revision !== this.revision) {
        if (this.callbacks.canApply?.() === false) { this.status("有新数据 · 编辑结束后同步"); return; }
        this.revision = remote.revision;
        this.callbacks.onState(remote.state);
      }
      this.status("已同步到本机数据库");
    } catch (error) {
      if (cycle !== this.authCycle) return;
      if (error.status === 401) this.lock();
      else this.status("连接暂时离线 · 保留当前内容");
    } finally {
      this.busy = false;
      this.scheduleFlush();
    }
  }
  resolveConflict(useLocal) {
    if (!this.conflict || !this.pending) return;
    if (useLocal && !confirm("将使用本页内容替换当前账号的最新工作空间。请确认其他页面的修改已备份。")) return;
    try { localStorage.setItem(STORAGE_KEY + ".conflict-backup." + this.identity + "." + Date.now(), JSON.stringify({ local: this.pending, remote: this.conflict.state })); }
    catch { this.callbacks.onNotice?.("请先导出本页备份，再处理冲突。", true); return; }
    this.revision = this.conflict.revision;
    if (!useLocal) { this.callbacks.onState(this.conflict.state); this.pending = null; this.clearPending(); }
    this.conflict = null;
    if (useLocal) { this.cachePending(); this.flush(); } else this.status("已载入最新版本，冲突内容已在浏览器备份");
  }
  canChangeAccount(action) {
    if (this.switchingAccount || this.accountActionBusy) return false;
    if (this.mode !== "server" || !this.authenticated) { this.callbacks.onNotice?.("请先连接并登录工作台。", true); return false; }
    if (this.pending || this.conflict) { this.callbacks.onNotice?.("还有未同步修改，请等待保存完成或先处理冲突。", true); return false; }
    if (this.busy || this.connecting) { this.callbacks.onNotice?.("正在同步账号数据，请稍后重试。", true); return false; }
    if (this.callbacks.canChangeAccount?.(action) === false) {
      this.callbacks.onNotice?.(action === "add-account" ? "还有未发送内容或正在进行的对话，请先完成后再添加账号。" : "还有未发送内容，请先保存或清空后再退出账号。", true);
      return false;
    }
    return true;
  }
  async addAccount() {
    if (!this.canChangeAccount("add-account")) return;
    this.switchingAccount = true;
    clearInterval(this.timer);
    document.body.classList.add("server-locked");
    this.auth.open({ smsEnabled: this.lastStatus?.authMethods?.sms, switchAccount: true, cancellable: true });
  }
  async cancelAccountLogin() {
    if (!this.switchingAccount) return;
    this.switchingAccount = false;
    await this.connect();
  }
  async logout() {
    if (!this.canChangeAccount("logout")) return;
    this.accountActionBusy = true;
    clearInterval(this.timer);
    this.authCycle++;
    try {
      await this.request("/api/logout", { method: "POST" });
      this.authenticated = false;
      this.lastSyncedAt = null;
      document.body.classList.add("server-locked");
      this.callbacks.onSignedOut?.();
      this.showLogin(false);
      this.status("已退出账号");
    } catch (error) {
      if (this.authenticated) this.timer = setInterval(() => this.poll(), 8000);
      throw error;
    } finally { this.accountActionBusy = false; }
  }
}
