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

const digest = (value) => createHash("sha256").update(value).digest("hex");
const passwordValid = (value) => typeof value === "string" && value.length >= 10 && value.length <= 128;

export class WorkspaceStore {
  constructor(directory) {
    this.directory = path.resolve(directory);
    mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(path.join(this.directory, "workspace.sqlite"));
    this.db.exec(`
      PRAGMA journal_mode=WAL;
      PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS owner (id INTEGER PRIMARY KEY CHECK(id=1), salt TEXT NOT NULL, hash TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS instance (id INTEGER PRIMARY KEY CHECK(id=1), value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, expires_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS workspace (id INTEGER PRIMARY KEY CHECK(id=1), body TEXT NOT NULL, revision INTEGER NOT NULL, updated_at TEXT NOT NULL);
    `);
    this.db.prepare("INSERT OR IGNORE INTO workspace VALUES (1, ?, 0, ?)").run(JSON.stringify(createInitialState()), new Date().toISOString());
    this.db.prepare("INSERT OR IGNORE INTO instance VALUES (1, ?)").run(randomBytes(16).toString("hex"));
  }
  instanceId() { return this.db.prepare("SELECT value FROM instance WHERE id=1").get().value; }
  hasOwner() { return Boolean(this.db.prepare("SELECT 1 FROM owner WHERE id=1").get()); }
  setup(password) {
    if (!passwordValid(password)) throw new HttpError(400, "invalid_password", "密码需要 10–128 个字符。");
    const salt = randomBytes(16).toString("hex");
    const hash = scryptSync(password, salt, 64).toString("hex");
    const result = this.db.prepare("INSERT OR IGNORE INTO owner VALUES (1, ?, ?)").run(salt, hash);
    if (!result.changes) throw new HttpError(409, "already_setup", "服务器已初始化，请登录。");
  }
  checkPassword(password) {
    if (typeof password !== "string" || password.length > 128) return false;
    const owner = this.db.prepare("SELECT * FROM owner WHERE id=1").get();
    if (!owner) return false;
    return timingSafeEqual(scryptSync(password, owner.salt, 64), Buffer.from(owner.hash, "hex"));
  }
  createSession() {
    this.db.prepare("DELETE FROM sessions WHERE expires_at < ?").run(Date.now());
    const token = randomBytes(32).toString("hex");
    this.db.prepare("INSERT INTO sessions VALUES (?, ?)").run(digest(token), Date.now() + 7 * 86400_000);
    return token;
  }
  authenticated(token) {
    return /^[a-f0-9]{64}$/.test(token || "") && Boolean(this.db.prepare("SELECT 1 FROM sessions WHERE token_hash=? AND expires_at>?").get(digest(token), Date.now()));
  }
  logout(token) { if (token) this.db.prepare("DELETE FROM sessions WHERE token_hash=?").run(digest(token)); }
  read() {
    const row = this.db.prepare("SELECT body, revision, updated_at FROM workspace WHERE id=1").get();
    return { state: JSON.parse(row.body), revision: row.revision, updatedAt: row.updated_at };
  }
  save(state, baseRevision) {
    if (!validateState(state) || !Number.isSafeInteger(baseRevision) || baseRevision < 0) throw new HttpError(400, "invalid_state", "工作空间格式或版本无效，已有数据未修改。");
    const updatedAt = new Date().toISOString();
    const result = this.db.prepare("UPDATE workspace SET body=?, revision=revision+1, updated_at=? WHERE id=1 AND revision=?").run(JSON.stringify(state), updatedAt, baseRevision);
    if (!result.changes) throw new HttpError(409, "revision_conflict", "其他页面有更新，当前修改已保留，请选择如何同步。", this.read());
    return { revision: baseRevision + 1, updatedAt };
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
