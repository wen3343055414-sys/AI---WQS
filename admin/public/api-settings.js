export function initApiSettings({ api, toast, escape: e, icon, date, number }) {
  const root = document.getElementById('model-management');
  let data = null, usage = null, selectedId = null, draft = null, dirty = false, busy = false, loaded = false;
  let tab = 'providers', providerQuery = '', region = '全部', modelQuery = '', modelProvider = 'all', pendingConfirm = null;
  const $ = id => document.getElementById(id);
  const post = (url, body) => api(url, { method: 'POST', body: JSON.stringify(body) });
  const selected = () => data?.providers.find(p => p.id === selectedId);
  const preset = p => data?.presets.find(item => item.id === p?.preset) || data?.presets.at(-1);
  const modelOf = key => data?.models.find(m => m.id === key);
  const providerOf = id => data?.providers.find(p => p.id === id);
  const logo = p => { const s = preset(p); return `<span class="provider-logo" data-brand="${e(s?.id)}">${e(s?.mark || '+')}</span>`; };
  const badge = (label, type = 'neutral') => `<span class="badge ${type}">${e(label)}</span>`;
  const enabledModels = id => data.models.filter(m => m.providerId === id && m.enabled);
  function status(p) {
    if (!p.enabled) return badge('已停用');
    if (p.authMode !== 'none' && !p.hasApiKey) return badge('待配置密钥', 'warning');
    const test = p.lastTest;
    return !test ? badge('未检测') : test.state === 'success' ? badge('目录已连接', 'success') : test.state === 'warning' ? badge('可手动配置', 'warning') : badge('检测失败', 'failed');
  }
  root.innerHTML = `<div id="model-summary" class="model-summary"></div>
    <div class="model-toolbar"><div class="model-tabs" role="tablist" aria-label="API 管理分类"><button role="tab" data-ms-tab="providers">服务商连接 <span id="provider-tab-count">0</span></button><button role="tab" data-ms-tab="models">模型列表 <span id="model-tab-count">0</span></button><button role="tab" data-ms-tab="usage">用量与限额</button></div><div class="model-toolbar-actions"><button class="btn" data-ms-action="reload">${icon('refresh')}刷新配置</button><button class="btn primary" data-ms-action="add-provider"><span aria-hidden="true">＋</span>添加服务商</button></div></div>
    <div id="model-error" class="model-error" role="alert" hidden></div>
    <div id="provider-workspace" class="provider-workspace"><aside class="panel provider-sidebar"><div class="provider-sidebar-head"><h2>我的服务商 <span id="provider-count"></span></h2><label class="model-search"><span aria-hidden="true">⌕</span><input id="provider-search" type="search" placeholder="搜索服务商…" aria-label="搜索服务商"></label><select id="provider-region" aria-label="按地区筛选"><option>全部</option><option>中国</option><option>海外</option><option>本地</option><option>自定义</option></select></div><div id="provider-list" class="provider-list"></div><div class="provider-sidebar-note">${icon('lock')}凭据在本机加密保管</div></aside><div id="provider-editor"></div></div>
    <div id="models-workspace" class="panel model-table-panel" hidden><div class="panel-heading"><div><h2>已添加模型</h2><p>管理工作台可以选择的模型，默认模型会自动同步。</p></div><button class="btn" data-ms-action="add-model">＋ 手动添加模型</button></div><div class="model-filters"><label class="model-search"><span aria-hidden="true">⌕</span><input id="model-search" type="search" placeholder="搜索模型名称或 ID…" aria-label="搜索模型"></label><select id="model-provider-filter" aria-label="按服务商筛选模型"></select><span id="model-filter-count"></span></div><div class="table-scroll"><table class="models-table"><thead><tr><th>模型 / ID</th><th>服务商</th><th>状态</th><th>今日 Token</th><th>工作台默认</th><th class="right">操作</th></tr></thead><tbody id="all-models"></tbody></table></div><div class="model-table-note">仅启用支持文本对话的模型。绘图、语音、嵌入模型不用于当前对话。</div></div>
    <div id="usage-workspace" hidden><div class="panel"><div class="panel-heading"><div><h2>服务商用量</h2><p>按北京时间统计本机实际请求，支持每个连接单独设置月限额。</p></div>${badge('真实返回用量', 'info')}</div><div class="table-scroll"><table class="models-table"><thead><tr><th>服务商</th><th>本月 Token / 限额</th><th>累计输入 / 输出</th><th>成功 / 失败</th><th>用量未知</th><th class="right">设置</th></tr></thead><tbody id="provider-usage"></tbody></table></div></div><div class="model-usage-note">${icon('info')}<div><strong>限额是本机规则，不等同于服务商账单</strong><p>达到限额后停止接收新请求；进行中的请求可能超出限额。未返回 usage 的请求按未知记录，无法精确计入限额。缓存命中已包含在输入 Token 中。</p></div></div></div>
    <dialog id="provider-picker" class="model-dialog provider-picker"><div class="dialog-title-row"><div><span class="model-kicker">CONNECT A PROVIDER</span><h2>接入新的模型服务</h2></div><button class="icon-btn" data-ms-close="provider-picker" aria-label="关闭服务商选择">×</button></div><p>选择一个模板开始，也可以接入自定义或本机接口。</p><label class="model-search"><span aria-hidden="true">⌕</span><input id="preset-search" type="search" placeholder="搜索国内、海外或本机服务商…" aria-label="搜索服务商模板"></label><div id="preset-grid" class="preset-grid"></div><div class="model-dialog-note">模板提供接口地址和协议。模型及额度以服务商账户为准。</div></dialog>
    <dialog id="model-editor-dialog" class="model-dialog"><div class="dialog-title-row"><h2 id="model-dialog-title">手动添加模型</h2><button class="icon-btn" data-ms-close="model-editor-dialog" aria-label="关闭模型编辑">×</button></div><form id="model-editor-form"><label>所属服务商<select id="manual-provider" required></select></label><label>模型 ID <span>*</span><input id="manual-model-id" required maxlength="200" placeholder="复制服务商提供的精确模型 ID"></label><label>显示名称<input id="manual-model-name" maxlength="100" placeholder="选填，例如：日常写作"></label><p class="helper">显示名称只用于辨认，不会修改实际请求中的模型 ID。</p><div id="manual-model-error" class="form-error" role="alert"></div><div class="dialog-buttons"><button type="button" class="btn" data-ms-close="model-editor-dialog">取消</button><button class="btn primary" type="submit">保存模型</button></div></form></dialog>
    <dialog id="model-confirm-dialog" class="model-dialog"><div class="dialog-icon">${icon('info')}</div><h2 id="model-confirm-title"></h2><p id="model-confirm-message"></p><div class="dialog-buttons"><button class="btn" id="model-confirm-cancel">取消</button><button class="btn primary" id="model-confirm-accept">确认</button></div></dialog>`;
  function error(message = '') { $('model-error').textContent = message; $('model-error').hidden = !message; }
  function confirm(title, message, accept = '确认') {
    $('model-confirm-title').textContent = title; $('model-confirm-message').textContent = message; $('model-confirm-accept').textContent = accept;
    $('model-confirm-dialog').showModal();
    return new Promise(resolve => { pendingConfirm = resolve; });
  }
  function finishConfirm(value) { $('model-confirm-dialog').close(); pendingConfirm?.(value); pendingConfirm = null; }
  $('model-confirm-cancel').addEventListener('click', () => finishConfirm(false));
  $('model-confirm-accept').addEventListener('click', () => finishConfirm(true));
  $('model-confirm-dialog').addEventListener('cancel', () => { pendingConfirm?.(false); pendingConfirm = null; });
  async function discard() { return !dirty || await confirm('放弃未保存的修改？', '当前连接有尚未保存的修改。放弃后才能切换或重新加载。', '放弃修改'); }
  function fill(p) { draft = p ? { ...p } : null; if (draft) { delete draft.apiKey; draft.clearKey = false; } dirty = false; }
  function summary() {
    if (!data) return;
    const def = modelOf(data.defaultModelKey), p = providerOf(def?.providerId);
    const count = data.models.filter(m => { const p = providerOf(m.providerId); return m.enabled && p?.enabled && (p.authMode === 'none' || p.hasApiKey); }).length;
    $('model-summary').innerHTML = `<article><span>已启用连接</span><strong>${data.providers.filter(p => p.enabled).length}<small> / ${data.providers.length}</small></strong><p>国内、海外与本机统一管理</p></article><article><span>工作台可选模型</span><strong>${count}<small>个</small></strong><p>从目录获取，或手动添加</p></article><article class="default-model-card"><span>工作台默认模型</span><strong title="${e(def?.modelId || '')}">${e(def?.name || '尚未设置')}</strong><p>${e(p?.name || '启用模型后即可设为默认')}${def && (!def.enabled || !p?.enabled || p.authMode !== 'none' && !p.hasApiKey) ? ' · 未就绪' : ''}</p></article><article><span>今日 Token</span><strong>${number(usage?.today?.totalTokens || 0)}</strong><p>${usage ? `${number(usage.today.requests)} 次请求 · ${number(usage.today.meteredRequests)} 次已取得用量` : '正在读取本机使用记录'}</p></article>`;
    $('provider-tab-count').textContent = $('provider-count').textContent = data.providers.length;
    $('model-tab-count').textContent = data.models.length;
  }
  function providerList() {
    if (!data) return;
    const list = data.providers.filter(p => (region === '全部' || preset(p).region === region) && `${p.name} ${preset(p).name}`.toLowerCase().includes(providerQuery.toLowerCase()));
    $('provider-list').innerHTML = (!selectedId && draft ? `<div class="provider-row selected provider-new">${logo(draft)}<span><strong>${e(draft.name)}</strong><small>新连接 · 尚未保存</small></span></div>` : '') + list.map(p => `<button class="provider-row ${selectedId === p.id ? 'selected' : ''}" data-ms-action="select-provider" data-id="${e(p.id)}">${logo(p)}<span><strong>${e(p.name)}</strong><small>${enabledModels(p.id).length} 个已启用模型${data.models.some(m => m.providerId === p.id && m.id === data.defaultModelKey) ? ' · 默认' : ''}</small></span><i class="provider-dot ${!p.enabled ? 'off' : p.lastTest?.state === 'success' ? 'online' : p.lastTest?.state === 'failed' ? 'failed' : ''}" title="${p.enabled ? '已启用' : '已停用'}"></i></button>`).join('') || '<div class="empty">暂无匹配的服务商</div>';
  }
  function controls() {
    const save = $('provider-save'), test = $('provider-test');
    if (save) save.disabled = busy || !draft || !dirty;
    if (test) test.disabled = busy || dirty || !selected() || selected().authMode !== 'none' && !selected().hasApiKey;
    const state = $('provider-save-state');
    if (state) { state.textContent = busy ? '正在处理…' : dirty ? '有未保存的修改' : '所有修改已保存'; state.classList.toggle('dirty', dirty); }
  }
  function providerModels(p) {
    const list = data.models.filter(m => m.providerId === p.id), test = p.lastTest;
    return `<section class="panel provider-model-panel"><div class="panel-heading"><div><h2>此连接的模型 <span class="model-count-pill">${list.length}</span></h2><p>获取目录后，选择需要启用的文本对话模型。</p></div><button class="text-btn" data-ms-action="add-model" data-id="${e(p.id)}">＋ 手动添加</button></div>${test ? `<div class="model-test-result ${test.state}">${icon(test.ok ? 'check' : 'info')}<span>${e(test.message)}<small>${e(date(test.testedAt, true))} · ${test.latencyMs} ms · ${test.ok ? '只检测模型目录，未生成对话' : '可修正配置或手动添加模型'}</small></span></div>` : ''}<div class="provider-model-list">${list.length ? list.map(model => `<div class="provider-model-row"><button class="model-switch ${model.enabled ? 'on' : ''}" role="switch" aria-checked="${model.enabled}" aria-label="${e(model.enabled ? '停用' : '启用')}模型 ${e(model.modelId)}" data-ms-action="toggle-model" data-id="${e(model.id)}"><span></span></button><div><strong>${e(model.name)}</strong><code>${e(model.modelId)}</code></div>${data.defaultModelKey === model.id ? badge('默认模型', 'info') : `<button class="text-btn" data-ms-action="default-model" data-id="${e(model.id)}" ${!model.enabled || !p.enabled || p.authMode !== 'none' && !p.hasApiKey ? 'disabled' : ''}>设为默认</button>`}</div>`).join('') : '<div class="model-empty"><span>◇</span><strong>把常用模型加入工作台</strong><p>点击“获取模型 / 检测连接”，或手动填写精确模型 ID。</p></div>'}</div></section>`;
  }
  function editor() {
    if (!draft) { $('provider-editor').innerHTML = `<div class="panel model-onboarding"><span class="model-onboarding-icon">${icon('api')}</span><span class="model-kicker">YOUR MODEL CONNECTIONS</span><h2>让每一种模型，都各就其位。</h2><p>连接多个服务商，选择常用模型。<br>在一个地方管理接口、密钥与使用情况。</p><button class="btn primary" data-ms-action="add-provider">＋ 添加第一个服务商</button><div class="onboarding-brands">DeepSeek <span>·</span> Qwen <span>·</span> Claude <span>·</span> Gemini</div></div>`; return; }
    const d = draft, p = selected(), s = preset(d);
    $('provider-editor').innerHTML = `<article class="panel provider-connection"><div class="provider-connection-head"><div class="provider-heading">${logo(d)}<div><h2>${e(d.name)}</h2><p>${e(s.name)} <span> / </span> ${e(data.protocols[d.protocol])}</p></div></div><div class="provider-head-actions">${p ? status(p) : badge('新连接', 'info')}<button class="model-switch ${d.enabled ? 'on' : ''}" role="switch" aria-checked="${d.enabled}" aria-label="启用此连接" data-ms-action="toggle-provider"><span></span></button></div></div><form id="provider-config-form" class="provider-config-form"><div class="provider-form-title"><h3>连接设置</h3><span id="provider-save-state"></span></div><div class="provider-fields"><label>连接名称 <span>*</span><input name="name" value="${e(d.name)}" required maxlength="50" autocomplete="off"></label><label>接口协议<select name="protocol">${Object.entries(data.protocols).map(([id, label]) => `<option value="${id}" ${d.protocol === id ? 'selected' : ''}>${e(label)}</option>`).join('')}</select></label></div><label>接口地址 · Base URL <span>*</span><input name="baseUrl" type="url" value="${e(d.baseUrl)}" required maxlength="1000" placeholder="https://api.example.com/v1" autocomplete="off" spellcheck="false"><small>填写基础地址，保留版本路径；不用添加 /chat/completions、/messages 或模型名称。</small></label><label>API 密钥 <span class="model-field-status">${d.authMode === 'none' ? '本机接口可免密钥' : p?.hasApiKey ? '已加密保存' : '尚未保存'}</span><div class="provider-key-field"><input id="provider-api-key" type="password" name="apiKey" maxlength="4096" placeholder="${p?.hasApiKey ? '留空保留现有密钥；输入新值替换' : '填写此服务商的 API Key'}" autocomplete="new-password" ${d.authMode === 'none' ? 'disabled' : ''}><span>${icon('lock')}</span></div><small>密钥仅在本机加密保存，不会同步到工作台浏览器。</small></label>${p?.hasApiKey ? `<label class="provider-clear-key"><input type="checkbox" name="clearKey">清除此连接已保存的密钥</label>` : ''}<details class="provider-advanced"><summary>高级设置 <span>超时、认证与月限额</span></summary><div class="provider-fields"><label>认证方式<select name="authMode"><option value="bearer" ${d.authMode !== 'none' ? 'selected' : ''}>API Key · 按所选协议认证</option><option value="none" ${d.authMode === 'none' ? 'selected' : ''}>无需密钥 · 本机接口</option></select></label><label>连接超时（秒）<input name="timeoutSeconds" type="number" min="5" max="120" value="${d.timeoutSeconds}" required></label></div><label>月 Token 限额<input name="monthlyTokenLimit" type="number" min="0" max="1000000000000" step="1" value="${d.monthlyTokenLimit}" required><small>0 表示不限额。达到本机已报告用量限额后停止新请求，进行中的请求可能超额。</small></label></details>${s.note ? `<div class="provider-template-note">${icon('info')}<span>${e(s.note)}</span></div>` : ''}<div class="provider-form-actions"><button id="provider-save" class="btn primary" type="submit">${icon('check')}保存连接</button><button id="provider-test" class="btn" type="button" data-ms-action="test-provider">${icon('refresh')}获取模型 / 检测连接</button>${s.docs ? `<a class="text-btn" href="${e(s.docs)}" target="_blank" rel="noopener noreferrer">接口文档 ↗</a>` : ''}</div></form>${p ? `<div class="provider-connection-foot"><span>最近保存 · ${e(date(p.updatedAt, true))}</span><button class="text-btn model-danger" data-ms-action="delete-provider" data-id="${e(p.id)}">删除连接</button></div>` : ''}</article>${p ? providerModels(p) : '<div class="provider-after-save-note">保存连接后，即可获取目录或手动添加模型。</div>'}`;
    if (d.apiKey) $('provider-api-key').value = d.apiKey;
    const clear = root.querySelector('#provider-config-form input[name="clearKey"]');
    if (clear) clear.checked = Boolean(d.clearKey);
    $('provider-api-key').disabled = d.authMode === 'none' || Boolean(d.clearKey);
    controls();
  }
  function modelTable() {
    if (!data) return;
    const list = data.models.filter(m => (modelProvider === 'all' || m.providerId === modelProvider) && `${m.modelId} ${m.name}`.toLowerCase().includes(modelQuery.toLowerCase()));
    $('model-filter-count').textContent = `${list.length} 个模型`;
    $('all-models').innerHTML = list.length ? list.map(m => {
      const p = providerOf(m.providerId), metric = usage?.byModel?.find(row => row.modelKey === m.id);
      const ready = m.enabled && p?.enabled && (p.authMode === 'none' || p.hasApiKey);
      return `<tr><td><strong>${e(m.name)}</strong><code>${e(m.modelId)}</code></td><td><span class="table-provider">${logo(p)}${e(p?.name)}</span></td><td><button class="model-switch ${m.enabled ? 'on' : ''}" role="switch" aria-checked="${m.enabled}" aria-label="${e(m.enabled ? '停用' : '启用')}模型 ${e(m.modelId)}" data-ms-action="toggle-model" data-id="${e(m.id)}"><span></span></button><span class="model-ready-text">${ready ? '可选' : m.enabled ? '连接未就绪' : '已停用'}</span></td><td class="model-numeric">${number(metric?.todayTokens || 0)}</td><td>${data.defaultModelKey === m.id ? badge('默认模型', 'info') : `<button class="text-btn" data-ms-action="default-model" data-id="${e(m.id)}" ${ready ? '' : 'disabled'}>设为默认</button>`}</td><td class="right"><button class="text-btn" data-ms-action="edit-model" data-id="${e(m.id)}">编辑</button><button class="text-btn model-danger" data-ms-action="delete-model" data-id="${e(m.id)}">移除</button></td></tr>`;
    }).join('') : '<tr><td colspan="6" class="empty">暂无匹配模型。先获取目录，或手动添加模型。</td></tr>';
  }
  function usageTable() {
    if (!data) return;
    const rows = data.providers.map(p => ({ p, metric: usage?.byProvider?.find(row => row.providerId === p.id) }));
    for (const metric of usage?.byProvider || []) if (!metric.providerId || !providerOf(metric.providerId)) rows.push({ p: { name: metric.provider || '历史连接', monthlyTokenLimit: 0 }, metric });
    $('provider-usage').innerHTML = rows.length ? rows.map(({ p, metric: m }) => {
      const used = m?.monthlyTokens || 0, limit = p.monthlyTokenLimit || 0;
      return `<tr><td><strong>${e(p.name)}</strong><small>${p.id ? p.enabled ? '已启用连接' : '已停用连接' : '历史用量保留'}</small></td><td><div class="token-budget"><strong>${number(used)} <span>/ ${limit ? number(limit) : '不限额'}</span></strong>${limit ? `<progress max="${limit}" value="${Math.min(limit, used)}" aria-label="${e(p.name)}月 Token 用量"></progress>` : ''}</div></td><td>${number(m?.promptTokens || 0)} <span class="muted">/</span> ${number(m?.completionTokens || 0)}</td><td>${number(m?.succeeded || 0)} <span class="muted">/</span> ${number(m?.failed || 0)}</td><td>${number(m?.unknownRequests || 0)} 次</td><td class="right">${p.id ? `<button class="text-btn" data-ms-action="select-provider" data-id="${e(p.id)}">编辑限额</button>` : '—'}</td></tr>`;
    }).join('') : '<tr><td colspan="6" class="empty">接入服务商后，在这里查看真实用量。</td></tr>';
  }
  function render() {
    if (!data) return;
    summary(); providerList(); editor(); modelTable(); usageTable();
    $('model-provider-filter').innerHTML = '<option value="all">全部服务商</option>' + data.providers.map(p => `<option value="${e(p.id)}" ${p.id === modelProvider ? 'selected' : ''}>${e(p.name)}</option>`).join('');
    for (const button of root.querySelectorAll('[data-ms-tab]')) { const active = button.dataset.msTab === tab; button.classList.toggle('active', active); button.setAttribute('aria-selected', active); }
    $('provider-workspace').hidden = tab !== 'providers'; $('models-workspace').hidden = tab !== 'models'; $('usage-workspace').hidden = tab !== 'usage';
  }
  async function load(force = false) {
    if (!force && loaded) return;
    try {
      data = await api('/api/model-providers'); loaded = true;
      if (!data.providers.some(p => p.id === selectedId)) selectedId = providerOf(modelOf(data.defaultModelKey)?.providerId)?.id || data.providers[0]?.id || null;
      if (modelProvider !== 'all' && !providerOf(modelProvider)) modelProvider = 'all';
      fill(selected()); error(); render(); return true;
    } catch (failure) { error(failure.message); return false; }
  }
  async function perform(action, success) {
    if (busy) return; busy = true; controls(); error();
    root.querySelectorAll('button[data-ms-action],#provider-config-form input,#provider-config-form select').forEach(node => { node.disabled = true; });
    try { await action(); if (await load(true) && success) toast(success); }
    catch (failure) { error(failure.message); }
    finally {
      busy = false;
      root.querySelectorAll('button[data-ms-action]').forEach(node => { node.disabled = false; });
      render();
    }
  }
  function picker() {
    const query = $('preset-search').value.toLowerCase();
    $('preset-grid').innerHTML = data.presets.filter(p => `${p.name} ${p.region} ${p.id}`.toLowerCase().includes(query)).map(p => `<button class="preset-option" data-preset="${e(p.id)}">${logo({ preset: p.id })}<span><strong>${e(p.name)}</strong><small>${e(p.region)} · ${e(data.protocols[p.protocol])}</small></span><span class="preset-add" aria-hidden="true">＋</span></button>`).join('');
  }
  function modelDialog(id, providerId) {
    if (!data.providers.length) { toast('请先添加服务商连接。'); return; }
    const m = id ? modelOf(id) : null;
    $('model-editor-form').dataset.id = id || '';
    $('model-dialog-title').textContent = m ? '编辑模型名称' : '手动添加模型';
    $('manual-provider').innerHTML = data.providers.map(p => `<option value="${e(p.id)}">${e(p.name)}</option>`).join('');
    $('manual-provider').value = m?.providerId || providerId || selectedId || data.providers[0].id;
    $('manual-provider').disabled = Boolean(m); $('manual-model-id').disabled = Boolean(m);
    $('manual-model-id').value = m?.modelId || ''; $('manual-model-name').value = m?.name || ''; $('manual-model-error').textContent = '';
    $('model-editor-dialog').showModal();
  }
  root.addEventListener('input', event => {
    const t = event.target;
    if (t.id === 'provider-search') { providerQuery = t.value; providerList(); return; }
    if (t.id === 'model-search') { modelQuery = t.value; modelTable(); return; }
    if (t.id === 'preset-search') { picker(); return; }
    if (!t.closest('#provider-config-form') || !draft) return;
    draft[t.name] = t.type === 'checkbox' ? t.checked : t.type === 'number' ? Number(t.value) : t.value;
    dirty = true; controls();
  });
  root.addEventListener('change', event => {
    const t = event.target;
    if (t.id === 'provider-region') { region = t.value; providerList(); }
    if (t.id === 'model-provider-filter') { modelProvider = t.value; modelTable(); }
    if (t.name === 'authMode' || t.name === 'clearKey') {
      const key = $('provider-api-key'); key.disabled = draft.authMode === 'none' || draft.clearKey; if (key.disabled) { key.value = ''; delete draft.apiKey; }
    }
  });
  root.addEventListener('click', async event => {
    const close = event.target.closest('[data-ms-close]'); if (close) { $(close.dataset.msClose).close(); return; }
    const t = event.target.closest('[data-ms-action],[data-ms-tab],[data-preset]'); if (!t || t.disabled || busy || !data) return;
    if (t.dataset.msTab) { if (!await discard()) return; if (dirty) fill(selected()); tab = t.dataset.msTab; render(); return; }
    if (t.dataset.preset) {
      if (!await discard()) return;
      const p = data.presets.find(p => p.id === t.dataset.preset);
      selectedId = null; draft = { ...p, preset: p.id, name: p.id === 'custom' ? '自定义接口' : p.name, authMode: p.authMode || 'bearer', enabled: true, timeoutSeconds: 30, monthlyTokenLimit: 0, revision: 0 };
      delete draft.id; dirty = true; tab = 'providers'; $('provider-picker').close(); render(); return;
    }
    const id = t.dataset.id, action = t.dataset.msAction;
    if (dirty && ['add-model', 'edit-model', 'toggle-model', 'default-model', 'delete-provider', 'delete-model', 'test-provider'].includes(action)) { toast('请先保存当前连接的修改。'); return; }
    if (action === 'add-provider') { $('preset-search').value = ''; picker(); $('provider-picker').showModal(); }
    else if (action === 'select-provider') { if (await discard()) { selectedId = id; fill(selected()); tab = 'providers'; render(); if (t.textContent.includes('限额')) root.querySelector('#provider-editor details')?.setAttribute('open', ''); } }
    else if (action === 'toggle-provider') { draft.enabled = !draft.enabled; dirty = true; editor(); }
    else if (action === 'reload') { if (await discard()) await load(true); }
    else if (action === 'test-provider') await perform(() => post(`/api/model-providers/${selectedId}/test`, { revision: selected().revision }));
    else if (action === 'add-model') modelDialog(null, id);
    else if (action === 'edit-model') modelDialog(id);
    else if (action === 'toggle-model') {
      const m = modelOf(id);
      if (m.enabled && data.defaultModelKey === id && !await confirm('停用默认模型？', '默认对话将暂停。你可以先把其他可用模型设为默认。', '停用模型')) return;
      await perform(() => post(`/api/model-catalog/${id}`, { revision: m.revision, name: m.name, enabled: !m.enabled }));
    } else if (action === 'default-model') await perform(() => post('/api/model-routing', { modelKey: id, revision: data.revision }), '默认模型已更新，工作台将自动同步。');
    else if (action === 'delete-provider') {
      const p = providerOf(id);
      if (await confirm('删除此服务商连接？', `将移除“${p.name}”的连接、密钥和模型配置。历史用量保留；如果包含默认模型，默认对话将暂停。`, '删除连接')) await perform(() => post(`/api/model-providers/${id}/delete`, { revision: p.revision, confirmation: id }), '连接已删除。');
    } else if (action === 'delete-model') {
      const m = modelOf(id);
      if (await confirm('移除此模型？', `将移除“${m.name}”的模型配置，历史对话和用量保留。默认模型被移除后，需要重新设置。`, '移除模型')) await perform(() => post(`/api/model-catalog/${id}/delete`, { revision: m.revision, confirmation: id }));
    }
  });
  root.addEventListener('submit', async event => {
    event.preventDefault(); if (busy) return;
    if (event.target.id === 'provider-config-form') {
      const p = selected();
      if (p?.enabled && !draft.enabled && data.models.some(m => m.providerId === p.id && m.id === data.defaultModelKey) && !await confirm('停用默认模型所在连接？', '默认对话将暂停。其他服务商的已启用模型仍然可以选择。', '保存并停用')) return;
      const body = { name: draft.name, preset: draft.preset, protocol: draft.protocol, baseUrl: draft.baseUrl.trim(), authMode: draft.authMode,
        enabled: draft.enabled, timeoutSeconds: draft.timeoutSeconds, monthlyTokenLimit: draft.monthlyTokenLimit, revision: p?.revision || 0, clearKey: Boolean(draft.clearKey), ...(draft.apiKey ? { apiKey: draft.apiKey } : {}) };
      await perform(async () => { const saved = await post(p ? `/api/model-providers/${p.id}` : '/api/model-providers', body); selectedId = saved.id; dirty = false; delete draft.apiKey; }, '连接已保存。');
      delete body.apiKey;
    } else if (event.target.id === 'model-editor-form') {
      const id = event.target.dataset.id, p = providerOf($('manual-provider').value), m = modelOf(id);
      const body = id ? { revision: m.revision, enabled: m.enabled, name: $('manual-model-name').value || m.modelId.slice(0, 100) }
        : { providerRevision: p.revision, modelId: $('manual-model-id').value.trim(), name: $('manual-model-name').value.trim() };
      busy = true;
      try { await post(id ? `/api/model-catalog/${id}` : `/api/model-providers/${p.id}/models`, body); $('model-editor-dialog').close(); if (await load(true)) toast('模型已保存。'); }
      catch (failure) { $('manual-model-error').textContent = failure.message; }
      finally { busy = false; controls(); }
    }
  });
  window.addEventListener('beforeunload', event => { if (dirty) { event.preventDefault(); event.returnValue = ''; } });
  return { load, isDirty: () => dirty, updateUsage(value) { usage = value; if (data) { summary(); modelTable(); usageTable(); } } };
}
