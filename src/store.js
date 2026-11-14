import { DatabaseSync, backup } from "node:sqlite";
import { mkdirSync, readdirSync, unlinkSync } from "node:fs";
import path from "node:path";
import { randomBytes, scryptSync, timingSafeEqual, createHash } from "node:crypto";
import { createInitialState, validateState } from "../public/core.js";

export class HttpError extends Error {
  constructor(status, code, message, extra = {}) {
    super(message);
    Object.assign(this, { status, code, extra });
  }
}
const digest = value => createHash("sha256").update(value).digest("hex");
const passwordValid = value => typeof value === "string" && value.length >= 10 && value.length <= 128;
const accountValid = value => /^[a-zA-Z0-9_-]{3,32}$/.test(value);
const emailValid = value => typeof value === "string" && value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

export class WorkspaceStore {
  constructor(directory) {
    this.directory = path.resolve(directory);
    mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(path.join(this.directory, "workspace.sqlite"));
    this.db.exec([
      "PRAGMA journal_mode=WAL;",
      "PRAGMA busy_timeout=5000;",
      "PRAGMA foreign_keys=ON;",
      "CREATE TABLE IF NOT EXISTS owner (id INTEGER PRIMARY KEY CHECK(id=1), salt TEXT NOT NULL, hash TEXT NOT NULL);",
      "CREATE TABLE IF NOT EXISTS instance (id INTEGER PRIMARY KEY CHECK(id=1), value TEXT NOT NULL);",
      "CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, expires_at INTEGER NOT NULL);",
      "CREATE TABLE IF NOT EXISTS workspace (id INTEGER PRIMARY KEY CHECK(id=1), body TEXT NOT NULL, revision INTEGER NOT NULL, updated_at TEXT NOT NULL);",
      "CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL COLLATE NOCASE UNIQUE, email TEXT COLLATE NOCASE UNIQUE, salt TEXT NOT NULL, hash TEXT NOT NULL, created_at TEXT NOT NULL);",
      "CREATE TABLE IF NOT EXISTS user_workspaces (user_id INTEGER PRIMARY KEY REFERENCES users(id), body TEXT NOT NULL, revision INTEGER NOT NULL, updated_at TEXT NOT NULL);",
      "CREATE TABLE IF NOT EXISTS user_sessions (token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), expires_at INTEGER NOT NULL);",
      "CREATE TABLE IF NOT EXISTS auth_legacy (id INTEGER PRIMARY KEY CHECK(id=1), user_id INTEGER NOT NULL REFERENCES users(id));"
    ].join("\n"));
    this.db.prepare("INSERT OR IGNORE INTO workspace VALUES (1, ?, 0, ?)").run(JSON.stringify(createInitialState()), new Date().toISOString());
    this.db.prepare("INSERT OR IGNORE INTO instance VALUES (1, ?)").run(randomBytes(16).toString("hex"));
    this.migrateAccounts();
  }
  transaction(action) {
    this.db.exec("BEGIN IMMEDIATE");
    try { const result = action(); this.db.exec("COMMIT"); return result; }
    catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }
  legacyId() { return this.db.prepare("SELECT user_id FROM auth_legacy WHERE id=1").get()?.user_id ?? null; }
  migrateAccounts() {
    this.transaction(() => {
      const owner = this.db.prepare("SELECT salt, hash FROM owner WHERE id=1").get();
      if (owner && this.legacyId() === null) {
        const result = this.db.prepare("INSERT INTO users (username,email,salt,hash,created_at) VALUES ('admin',NULL,?,?,?)").run(owner.salt, owner.hash, new Date().toISOString());
        this.db.prepare("INSERT INTO auth_legacy VALUES (1, ?)").run(Number(result.lastInsertRowid));
      }
      const legacy = this.legacyId();
      if (legacy !== null) {
        const old = this.db.prepare("SELECT * FROM workspace WHERE id=1").get();
        const current = this.db.prepare("SELECT revision FROM user_workspaces WHERE user_id=?").get(legacy);
        if (!current || old.revision > current.revision) {
          this.db.prepare("INSERT INTO user_workspaces VALUES (?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET body=excluded.body,revision=excluded.revision,updated_at=excluded.updated_at").run(legacy, old.body, old.revision, old.updated_at);
        }
      }
    });
  }
  instanceId() { return this.db.prepare("SELECT value FROM instance WHERE id=1").get().value; }
  hasOwner() { return Boolean(this.db.prepare("SELECT 1 FROM users LIMIT 1").get()); }
  legacyLoginHint() {
    const row = this.db.prepare("SELECT username,email FROM users WHERE id=?").get(this.legacyId());
    return row?.username === "admin" && !row.email ? "admin" : "";
  }
  publicUser(row) { return row ? { id: row.id, account: row.username, email: row.email, legacy: row.id === this.legacyId() } : null; }
  register({ account, email, password }, allowEmptyEmail = false) {
    account = typeof account === "string" ? account.trim() : "";
    email = typeof email === "string" ? email.trim().toLowerCase() : "";
    if (!accountValid(account)) throw new HttpError(400, "invalid_account", "账号需为 3–32 位字母、数字、下划线或短横线。");
    if (!emailValid(email) && !(allowEmptyEmail && !email)) throw new HttpError(400, "invalid_email", "请输入有效的邮箱地址。");
    if (!passwordValid(password)) throw new HttpError(400, "invalid_password", "密码需要 10–128 个字符。");
    const salt = randomBytes(16).toString("hex");
    const hash = scryptSync(password, salt, 64).toString("hex");
    try {
      return this.transaction(() => {
        const first = !this.hasOwner();
        const now = new Date().toISOString();
        const result = this.db.prepare("INSERT INTO users (username,email,salt,hash,created_at) VALUES (?,?,?,?,?)").run(account, email || null, salt, hash, now);
        const id = Number(result.lastInsertRowid);
        const initial = first ? this.db.prepare("SELECT body,revision,updated_at FROM workspace WHERE id=1").get() : { body: JSON.stringify(createInitialState()), revision: 0, updated_at: now };
        this.db.prepare("INSERT INTO user_workspaces VALUES (?,?,?,?)").run(id, initial.body, initial.revision, initial.updated_at);
        if (first) {
          this.db.prepare("INSERT OR IGNORE INTO owner VALUES (1,?,?)").run(salt, hash);
          this.db.prepare("INSERT INTO auth_legacy VALUES (1,?)").run(id);
        }
        return this.publicUser(this.db.prepare("SELECT * FROM users WHERE id=?").get(id));
      });
    } catch (error) {
      if (String(error.message).includes("UNIQUE constraint failed")) throw new HttpError(409, "account_exists", "账号或邮箱已被注册，请直接登录。");
      throw error;
    }
  }
  setup(password) {
    if (this.hasOwner()) throw new HttpError(409, "already_setup", "账号已创建，请直接登录。");
    return this.register({ account: "admin", email: "", password }, true);
  }
  authenticateUser(identifier, password, method = "account") {
    if (typeof password !== "string" || password.length > 128) return null;
    let row;
    if (identifier === undefined) row = this.db.prepare("SELECT * FROM users WHERE id=?").get(this.legacyId());
    else {
      if (typeof identifier !== "string" || identifier.length > 254) return null;
      const field = method === "email" ? "email" : "username";
      row = this.db.prepare("SELECT * FROM users WHERE " + field + "=? COLLATE NOCASE").get(identifier.trim().toLowerCase());
    }
    if (!row) return null;
    const expected = Buffer.from(row.hash, "hex");
    if (expected.length !== 64 || !timingSafeEqual(scryptSync(password, row.salt, 64), expected)) return null;
    return this.publicUser(row);
  }
  checkPassword(password) { return Boolean(this.authenticateUser(undefined, password)); }
  createSession(userId = this.legacyId()) {
    if (!this.db.prepare("SELECT 1 FROM users WHERE id=?").get(userId)) throw new HttpError(401, "authentication_required", "请先登录账号。");
    const token = randomBytes(32).toString("hex");
    const hash = digest(token);
    const expires = Date.now() + 7 * 86400_000;
    this.transaction(() => {
      this.db.prepare("DELETE FROM sessions WHERE expires_at < ?").run(Date.now());
      this.db.prepare("DELETE FROM user_sessions WHERE expires_at < ?").run(Date.now());
      this.db.prepare("INSERT INTO user_sessions VALUES (?,?,?)").run(hash, userId, expires);
      if (userId === this.legacyId()) this.db.prepare("INSERT INTO sessions VALUES (?,?)").run(hash, expires);
    });
    return token;
  }
  sessionUser(token) {
    if (!/^[a-f0-9]{64}$/.test(token || "")) return null;
    const hash = digest(token);
    let row = this.db.prepare("SELECT users.* FROM user_sessions JOIN users ON users.id=user_sessions.user_id WHERE token_hash=? AND expires_at>?").get(hash, Date.now());
    if (!row && this.db.prepare("SELECT 1 FROM sessions WHERE token_hash=? AND expires_at>?").get(hash, Date.now())) {
      row = this.db.prepare("SELECT * FROM users WHERE id=?").get(this.legacyId());
    }
    return this.publicUser(row);
  }
  authenticated(token) { return Boolean(this.sessionUser(token)); }
  logout(token) {
    if (!token) return;
    this.transaction(() => {
      this.db.prepare("DELETE FROM sessions WHERE token_hash=?").run(digest(token));
      this.db.prepare("DELETE FROM user_sessions WHERE token_hash=?").run(digest(token));
    });
  }
  read(userId = this.legacyId()) {
    const row = userId === null
      ? this.db.prepare("SELECT body,revision,updated_at FROM workspace WHERE id=1").get()
      : this.db.prepare("SELECT body,revision,updated_at FROM user_workspaces WHERE user_id=?").get(userId);
    if (!row) throw new HttpError(404, "workspace_not_found", "工作空间不存在。");
    return { state: JSON.parse(row.body), revision: row.revision, updatedAt: row.updated_at };
  }
  save(state, baseRevision, userId = this.legacyId()) {
    if (userId === null) throw new HttpError(401, "authentication_required", "请先登录账号。");
    if (!validateState(state) || !Number.isSafeInteger(baseRevision) || baseRevision < 0) throw new HttpError(400, "invalid_state", "工作空间格式或版本无效，已有数据未修改。");
    const updatedAt = new Date().toISOString();
    return this.transaction(() => {
      const body = JSON.stringify(state);
      const result = this.db.prepare("UPDATE user_workspaces SET body=?,revision=revision+1,updated_at=? WHERE user_id=? AND revision=?").run(body, updatedAt, userId, baseRevision);
      if (!result.changes) throw new HttpError(409, "revision_conflict", "其他页面有更新，当前修改已保留，请选择如何同步。", this.read(userId));
      if (userId === this.legacyId()) this.db.prepare("UPDATE workspace SET body=?,revision=?,updated_at=? WHERE id=1").run(body, baseRevision + 1, updatedAt);
      return { revision: baseRevision + 1, updatedAt };
    });
  }
  async snapshot() {
    const directory = path.join(this.directory, "backups");
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const filename = `workspace-${new Date().toISOString().replace(/[:.]/g, "-")}-${randomBytes(3).toString("hex")}.sqlite`;
    await backup(this.db, path.join(directory, filename));
    const files = readdirSync(directory).filter(x => /^workspace-[\w-]+\.sqlite$/.test(x)).sort().reverse();
    for (const file of files.slice(30)) unlinkSync(path.join(directory, file));
    return filename;
  }
  close() { this.db.close(); }
}
