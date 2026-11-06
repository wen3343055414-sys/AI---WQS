import { HttpError } from './store.js';

export class LanAccess {
  constructor(store) {
    this.store = store;
    this.db = store.db;
    this.db.exec(`CREATE TABLE IF NOT EXISTS lan_access (
      id INTEGER PRIMARY KEY CHECK(id=1), enabled INTEGER NOT NULL,
      revision INTEGER NOT NULL, updated_at TEXT NOT NULL
    )`);
  }
  read() {
    const row = this.db.prepare('SELECT enabled,revision,updated_at FROM lan_access WHERE id=1').get();
    return row ? { enabled: Boolean(row.enabled), revision: row.revision, updatedAt: row.updated_at } : { enabled: false, revision: 0, updatedAt: null };
  }
  save(input) {
    if (!input || typeof input.enabled !== 'boolean' || !Number.isSafeInteger(input.revision)) throw new HttpError(400, '局域网访问设置无效。');
    if (input.revision !== this.read().revision) throw new HttpError(409, '访问设置已更新，请刷新后重试。');
    const changed = this.db.prepare(`INSERT INTO lan_access VALUES (1,?,1,?)
      ON CONFLICT(id) DO UPDATE SET enabled=excluded.enabled,revision=lan_access.revision+1,updated_at=excluded.updated_at
      WHERE lan_access.revision=?`).run(input.enabled ? 1 : 0, new Date().toISOString(), input.revision);
    if (!changed.changes) throw new HttpError(409, '访问设置已更新，请刷新后重试。');
    this.store.audit('lan_access', 'success', input.enabled ? '启用工作台局域网访问' : '停用工作台局域网访问');
    return this.read();
  }
}

export async function probeWorkbench(origin) {
  try {
    const response = await fetch(`${origin}/api/status`, { signal: AbortSignal.timeout(4000), redirect: 'error' });
    if (!response.ok || Number(response.headers.get('content-length')) > 8192) return { ready: false, message: '工作台服务暂时不可用。' };
    const content = await response.text();
    if (content.length > 8192) return { ready: false, message: '工作台响应无效。' };
    const status = JSON.parse(content);
    if (status.mode !== 'server' || !/^[a-f0-9]{32}$/.test(status.serverId || '') || typeof status.setupRequired !== 'boolean') return { ready: false, message: '工作台尚未连接真实服务器。' };
    return { ready: true, setupRequired: status.setupRequired, version: String(status.version || '').slice(0, 100), message: status.setupRequired ? '请先在本机工作台设置访问密码。' : '工作台已连接服务器。' };
  } catch { return { ready: false, message: '工作台服务暂时不可用。' }; }
}
