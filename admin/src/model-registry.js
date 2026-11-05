import { randomBytes } from 'node:crypto';
import { ModelSettings, probeModels, ProbeError, validateSettings } from './model-settings.js';
import { PROTOCOLS } from './model-protocols.js';
import { PRESETS, inferPreset } from './provider-presets.js';
import { HttpError } from './store.js';

const timestamp = () => new Date().toISOString();
const uid = prefix => `${prefix}_${randomBytes(10).toString('hex')}`;
const conflict = () => new HttpError(409, '配置已在其他页面更新，请重新加载后再操作。');
function text(value, limit, label) {
  if (typeof value !== 'string' || !value.trim() || value.length > limit || /[\x00-\x1f\x7f]/.test(value)) throw new HttpError(400, `${label}格式无效。`);
  return value.trim();
}

export class ModelRegistry {
  constructor(store, vault, probe = probeModels) {
    this.store = store; this.db = store.db; this.vault = vault; this.probe = probe; this.saving = false; this.testing = new Set();
    this.legacy = new ModelSettings(store, vault, probe);
    this.db.exec(`CREATE TABLE IF NOT EXISTS ai_providers (id TEXT PRIMARY KEY, config TEXT NOT NULL, key_cipher TEXT,
      last_test TEXT, revision INTEGER NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS ai_models (id TEXT PRIMARY KEY, provider_id TEXT NOT NULL, model_id TEXT NOT NULL,
      display_name TEXT NOT NULL, enabled INTEGER NOT NULL, source TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL, UNIQUE(provider_id,model_id));
      CREATE TABLE IF NOT EXISTS ai_routing (id INTEGER PRIMARY KEY CHECK(id=1), default_model TEXT, revision INTEGER NOT NULL, migrated INTEGER NOT NULL);
      INSERT OR IGNORE INTO ai_routing VALUES (1,NULL,0,0);`);
    if (!this.meta().migrated) this.transaction(() => {
      const old = this.legacy.row();
      if (old) {
        const saved = JSON.parse(old.config), preset = inferPreset(saved.baseUrl);
        const config = { ...saved, protocol: 'openai', preset: preset.id, enabled: true, monthlyTokenLimit: 0 };
        this.db.prepare('INSERT INTO ai_providers VALUES (?,?,?,?,?,?,?)').run('provider_legacy', JSON.stringify(config), old.key_cipher, old.last_test, old.revision, old.updated_at, old.updated_at);
        if (saved.model) {
          this.db.prepare('INSERT INTO ai_models VALUES (?,?,?,?,?,?,1,?)').run('model_legacy', 'provider_legacy', saved.model, saved.model, 1, 'migrated', old.updated_at);
          this.db.prepare('UPDATE ai_routing SET default_model=? WHERE id=1').run('model_legacy');
        }
        this.db.prepare('UPDATE ai_routing SET revision=? WHERE id=1').run(old.revision);
      }
      this.db.exec('UPDATE ai_routing SET migrated=1 WHERE id=1');
    });
  }
  transaction(fn) {
    this.db.exec('BEGIN IMMEDIATE');
    try { const result = fn(); this.db.exec('COMMIT'); return result; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  meta() { return this.db.prepare('SELECT * FROM ai_routing WHERE id=1').get(); }
  provider(id) { return this.db.prepare('SELECT * FROM ai_providers WHERE id=?').get(id); }
  model(id) { return this.db.prepare('SELECT * FROM ai_models WHERE id=?').get(id); }
  checkRevision(row, revision) { if (!row || !Number.isSafeInteger(revision) || row.revision !== revision) throw conflict(); }
  checkIdle() { if (this.saving) throw new HttpError(409, '正在保存连接，请稍后重试。'); }
  publicProvider(row) {
    return { ...JSON.parse(row.config), id: row.id, hasApiKey: Boolean(row.key_cipher), revision: row.revision,
      createdAt: row.created_at, updatedAt: row.updated_at, lastTest: row.last_test ? JSON.parse(row.last_test) : null };
  }
  publicModel(row) { return { id: row.id, providerId: row.provider_id, modelId: row.model_id, name: row.display_name, enabled: Boolean(row.enabled), source: row.source, revision: row.revision }; }
  list() {
    const meta = this.meta();
    return { providers: this.db.prepare('SELECT * FROM ai_providers ORDER BY created_at,id').all().map(row => this.publicProvider(row)),
      models: this.db.prepare('SELECT * FROM ai_models ORDER BY created_at,id').all().map(row => this.publicModel(row)),
      defaultModelKey: meta.default_model, revision: meta.revision, presets: PRESETS, protocols: PROTOCOLS };
  }
  selected(key = this.meta().default_model) {
    const model = key ? this.model(key) : null, provider = model ? this.provider(model.provider_id) : null;
    return provider && model ? { model, provider, config: { ...JSON.parse(provider.config), model: model.model_id } } : null;
  }
  resolve(key) {
    const selected = this.selected(key || this.meta().default_model);
    if (!selected) throw new HttpError(503, '尚未选择可用模型，请在服务端启用模型并设置默认模型。');
    if (!selected.config.enabled || !selected.model.enabled) throw new HttpError(503, '所选模型或服务商已停用，请选择其他模型。');
    if (selected.config.authMode !== 'none' && !selected.provider.key_cipher) throw new HttpError(503, '所选服务商尚未保存 API 密钥。');
    return { ...selected.provider, provider_id: selected.provider.id, model_key: selected.model.id, config: JSON.stringify(selected.config) };
  }
  publicConfig() {
    const data = this.list();
    const models = data.models.flatMap(model => {
      const p = data.providers.find(p => p.id === model.providerId);
      return p?.enabled && model.enabled && (p.authMode === 'none' || p.hasApiKey)
        ? [{ key: model.id, id: model.modelId, name: model.name, providerId: p.id, provider: p.name }] : [];
    });
    const chosen = models.find(m => m.key === data.defaultModelKey), provider = data.providers.find(p => p.id === chosen?.providerId);
    return { ready: Boolean(chosen), provider: chosen?.provider || '', model: chosen?.id || '', revision: data.revision, defaultModelKey: data.defaultModelKey,
      timeoutSeconds: provider?.timeoutSeconds || 30, models, message: chosen ? '真实模型已配置，工作台自动同步可用模型。' : '请在服务端启用模型并设置默认模型；也可选择其他已启用模型。' };
  }
  row() {
    const selected = this.selected();
    return selected ? { ...selected.provider, provider_id: selected.provider.id, model_key: selected.model.id, revision: this.meta().revision, config: JSON.stringify(selected.config) } : null;
  }
  read() {
    const row = this.row();
    return row ? { ...JSON.parse(row.config), configured: true, hasApiKey: Boolean(row.key_cipher), revision: row.revision, updatedAt: row.updated_at, lastTest: row.last_test ? JSON.parse(row.last_test) : null }
      : { name: '自定义模型接口', baseUrl: '', model: '', authMode: 'bearer', timeoutSeconds: 30, configured: false, hasApiKey: false, revision: this.meta().revision };
  }
  syncLegacy() {
    const selected = this.selected(), revision = this.meta().revision;
    if (!selected) { this.db.exec('DELETE FROM model_settings WHERE id=1'); return; }
    const { config, provider, model } = selected;
    const legacy = { name: config.name, baseUrl: config.baseUrl, model: config.enabled && model.enabled ? model.model_id : '', authMode: config.authMode, timeoutSeconds: config.timeoutSeconds };
    // Old code only understands Chat Completions; never forward a native key
    // through a different protocol after a rollback.
    if (config.protocol !== 'openai') legacy.model = '';
    this.db.prepare('INSERT INTO model_settings VALUES (1,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET config=excluded.config,key_cipher=excluded.key_cipher,last_test=excluded.last_test,revision=excluded.revision,updated_at=excluded.updated_at')
      .run(JSON.stringify(legacy), provider.key_cipher, provider.last_test, revision, provider.updated_at);
  }
  bump() { this.db.exec('UPDATE ai_routing SET revision=revision+1 WHERE id=1'); this.syncLegacy(); }
  configInput(input) {
    if (!input || typeof input !== 'object') throw new HttpError(400, '连接配置无效。');
    const common = validateSettings({ ...input, model: '' });
    if (!PRESETS.some(p => p.id === input.preset) || !Object.hasOwn(PROTOCOLS, input.protocol)) throw new HttpError(400, '请选择支持的服务商和接口协议。');
    if (typeof input.enabled !== 'boolean') throw new HttpError(400, '服务商启用状态无效。');
    if (!Number.isSafeInteger(input.monthlyTokenLimit) || input.monthlyTokenLimit < 0 || input.monthlyTokenLimit > 1_000_000_000_000) throw new HttpError(400, '月 Token 限额需要为 0–1,000,000,000,000 的整数。');
    return { ...common, preset: input.preset, protocol: input.protocol, enabled: input.enabled, monthlyTokenLimit: input.monthlyTokenLimit };
  }
  async saveProvider(id, input, { legacyModel, expectedGlobal } = {}) {
    this.checkIdle(); this.saving = true;
    try {
      const config = this.configInput(input), old = id ? this.provider(id) : null;
      if (id) this.checkRevision(old, input.revision);
      else if (input.revision !== 0) throw conflict();
      if (expectedGlobal !== undefined && expectedGlobal !== this.meta().revision) throw conflict();
      if (!id && this.db.prepare('SELECT COUNT(*) AS n FROM ai_providers').get().n >= 32) throw new HttpError(400, '最多保存 32 个服务商连接。');
      let cipher = old?.key_cipher || null;
      if (cipher && config.authMode !== 'none' && !input.apiKey && !input.clearKey) {
        const previous = JSON.parse(old.config);
        if (new URL(previous.baseUrl).origin !== new URL(config.baseUrl).origin || previous.protocol !== config.protocol) throw new HttpError(400, '接口地址或协议已更换，请重新输入密钥，避免转发旧凭据。');
      }
      if (config.authMode === 'none' || input.clearKey) cipher = null;
      else if (input.apiKey) cipher = await this.vault.protect(input.apiKey);
      return this.transaction(() => {
        if (id) this.checkRevision(this.provider(id), input.revision);
        if (expectedGlobal !== undefined && expectedGlobal !== this.meta().revision) throw conflict();
        const key = id || uid('provider'), now = timestamp();
        this.db.prepare('INSERT INTO ai_providers VALUES (?,?,?,NULL,?,?,?) ON CONFLICT(id) DO UPDATE SET config=excluded.config,key_cipher=excluded.key_cipher,last_test=NULL,revision=excluded.revision,updated_at=excluded.updated_at')
          .run(key, JSON.stringify(config), cipher, (old?.revision || 0) + 1, old?.created_at || now, now);
        if (legacyModel !== undefined) {
          if (legacyModel) {
            const existing = this.db.prepare('SELECT * FROM ai_models WHERE provider_id=? AND model_id=?').get(key, legacyModel);
            const modelKey = existing?.id || this.insertModel(key, legacyModel, legacyModel, true, 'manual');
            if (existing) this.db.prepare('UPDATE ai_models SET enabled=1,revision=revision+1 WHERE id=?').run(modelKey);
            this.db.prepare('UPDATE ai_routing SET default_model=? WHERE id=1').run(modelKey);
          } else this.db.exec('UPDATE ai_routing SET default_model=NULL WHERE id=1');
        }
        this.bump(); this.store.audit('api_settings_save', 'success', `保存模型连接：${config.name}`);
        return this.publicProvider(this.provider(key));
      });
    } finally { this.saving = false; }
  }
  async save(input) {
    const common = validateSettings(input), row = this.selected()?.provider || this.db.prepare('SELECT * FROM ai_providers ORDER BY created_at LIMIT 1').get();
    const previous = row ? JSON.parse(row.config) : { preset: inferPreset(common.baseUrl).id, protocol: 'openai', enabled: true, monthlyTokenLimit: 0 };
    await this.saveProvider(row?.id, { ...previous, ...input, revision: row?.revision || 0 }, { legacyModel: common.model, expectedGlobal: input.revision });
    return this.read();
  }
  insertModel(providerId, modelId, name, enabled, source) {
    if (this.db.prepare('SELECT COUNT(*) AS n FROM ai_models').get().n >= 1000) throw new HttpError(400, '最多管理 1,000 个模型，请先移除不使用的模型。');
    if (enabled && this.db.prepare('SELECT COUNT(*) AS n FROM ai_models WHERE enabled=1').get().n >= 200) throw new HttpError(400, '最多启用 200 个模型。');
    const id = uid('model');
    this.db.prepare('INSERT INTO ai_models VALUES (?,?,?,?,?,?,1,?)').run(id, providerId, modelId, name, enabled ? 1 : 0, source, timestamp());
    return id;
  }
  addModel(providerId, input) {
    this.checkIdle(); const provider = this.provider(providerId); this.checkRevision(provider, input.providerRevision);
    const modelId = text(input.modelId, 200, '模型 ID'), name = text(input.name || modelId.slice(0, 100), 100, '显示名称');
    return this.transaction(() => {
      if (this.db.prepare('SELECT 1 FROM ai_models WHERE provider_id=? AND model_id=?').get(providerId, modelId)) throw new HttpError(409, '该服务商已添加此模型。');
      const id = this.insertModel(providerId, modelId, name, true, 'manual');
      if (!this.meta().default_model) this.db.prepare('UPDATE ai_routing SET default_model=? WHERE id=1').run(id);
      this.bump(); this.store.audit('api_model_add', 'success', `添加模型：${modelId}`);
      return this.publicModel(this.model(id));
    });
  }
  updateModel(id, input) {
    this.checkIdle(); const old = this.model(id); this.checkRevision(old, input.revision);
    if (typeof input.enabled !== 'boolean') throw new HttpError(400, '模型启用状态无效。');
    const name = text(input.name || old.display_name, 100, '显示名称');
    if (input.enabled && !old.enabled && this.db.prepare('SELECT COUNT(*) AS n FROM ai_models WHERE enabled=1').get().n >= 200) throw new HttpError(400, '最多启用 200 个模型。');
    return this.transaction(() => {
      this.db.prepare('UPDATE ai_models SET display_name=?,enabled=?,revision=revision+1 WHERE id=?').run(name, input.enabled ? 1 : 0, id);
      this.bump(); this.store.audit('api_model_update', 'success', `更新模型：${old.model_id}`);
      return this.publicModel(this.model(id));
    });
  }
  setDefault(key, revision) {
    this.checkIdle(); if (!Number.isSafeInteger(revision) || revision !== this.meta().revision) throw conflict();
    if (typeof key !== 'string' || !/^model_[A-Za-z0-9_-]{1,64}$/.test(key)) throw new HttpError(400, '请选择有效的默认模型。');
    this.resolve(key);
    this.transaction(() => { this.db.prepare('UPDATE ai_routing SET default_model=? WHERE id=1').run(key); this.bump(); this.store.audit('api_default_model', 'success', '已更新工作台默认模型'); });
    return this.publicConfig();
  }
  removeProvider(id, revision, confirmation) {
    this.checkIdle(); const provider = this.provider(id); this.checkRevision(provider, revision);
    if (confirmation !== id) throw new HttpError(400, '请确认删除此服务商连接。');
    this.transaction(() => {
      if (this.selected()?.provider.id === id) this.db.exec('UPDATE ai_routing SET default_model=NULL WHERE id=1');
      this.db.prepare('DELETE FROM ai_models WHERE provider_id=?').run(id);
      this.db.prepare('DELETE FROM ai_providers WHERE id=?').run(id);
      this.bump(); this.store.audit('api_provider_delete', 'success', `移除连接：${JSON.parse(provider.config).name}`);
    });
  }
  removeModel(id, revision, confirmation) {
    this.checkIdle(); const model = this.model(id); this.checkRevision(model, revision);
    if (confirmation !== id) throw new HttpError(400, '请确认移除此模型。');
    this.transaction(() => {
      if (this.meta().default_model === id) this.db.exec('UPDATE ai_routing SET default_model=NULL WHERE id=1');
      this.db.prepare('DELETE FROM ai_models WHERE id=?').run(id); this.bump();
      this.store.audit('api_model_delete', 'success', `移除模型：${model.model_id}`);
    });
  }
  async testProvider(id, revision) {
    const row = this.provider(id); this.checkRevision(row, revision);
    if (this.testing.has(id) || this.testing.size >= 2) throw new HttpError(409, '正在检测接口，请稍后重试。');
    const config = JSON.parse(row.config);
    if (config.authMode !== 'none' && !row.key_cipher) throw new HttpError(400, '请先保存此服务商的 API 密钥。');
    this.testing.add(id); const started = Date.now();
    try {
      const key = row.key_cipher ? await this.vault.unprotect(row.key_cipher) : '';
      let result;
      try {
        const models = await this.probe(config, key);
        result = { ok: true, state: models.length ? 'success' : 'warning', models, message: models.length ? `连接成功，获取 ${models.length} 个模型。请选择需要启用的文本对话模型。` : '连接成功，但目录为空，可以手动添加模型。' };
      } catch (error) {
        const unsupported = error instanceof ProbeError && [404, 405, 501].includes(error.status);
        result = { ok: false, state: unsupported ? 'warning' : 'failed', models: [], message: unsupported ? '此接口未提供模型目录，请手动添加模型 ID；目录检测不能确认对话能力。' : error instanceof ProbeError ? error.message : '接口检测未完成，请检查配置。' };
      }
      result = { ...result, latencyMs: Date.now() - started, testedAt: timestamp() };
      this.checkRevision(this.provider(id), revision);
      this.transaction(() => {
        let room = 1000 - this.db.prepare('SELECT COUNT(*) AS n FROM ai_models').get().n, added = 0, skipped = 0;
        for (const model of result.models) {
          if (this.db.prepare('SELECT 1 FROM ai_models WHERE provider_id=? AND model_id=?').get(id, model)) continue;
          if (room <= 0) { skipped++; continue; }
          this.insertModel(id, model, model.slice(0, 100), false, 'discovered'); room--; added++;
        }
        result.addedModels = added; result.skippedModels = skipped;
        if (skipped) { result.state = 'warning'; result.message += ` 模型库容量已满，${skipped} 个新模型尚未加入，请先移除不使用的模型。`; }
        this.db.prepare('UPDATE ai_providers SET last_test=? WHERE id=? AND revision=?').run(JSON.stringify(result), id, revision);
        this.bump(); this.store.audit('api_connection_test', result.ok ? 'success' : 'failed', result.message);
      });
      return result;
    } finally { this.testing.delete(id); }
  }
  async test(revision) {
    if (revision !== this.meta().revision) throw conflict();
    const selected = this.selected(); if (!selected) throw new HttpError(400, '请先保存接口配置和默认模型。');
    return this.testProvider(selected.provider.id, selected.provider.revision);
  }
}
