export function initWebsites({ api, toast, escape: e, icon, date }) {
  const root = document.getElementById('website-management');
  const $ = id => root.querySelector(`#${id}`);
  const post = (url, value) => api(url, { method: 'POST', body: JSON.stringify(value) });
  let data = null, tab = 'domains', query = '', busy = false, loading = false, epoch = 0, detailId = '', renderedPanel = '';
  const access = () => data?.access || {};
  const domains = () => data?.domains || [];
  const addresses = () => Array.isArray(access().addresses) ? access().addresses : [];
  const findDomain = id => domains().find(item => item.id === id);
  const ready = () => Boolean(access().enabled && access().available && access().workbench?.ready && !access().workbench?.setupRequired);
  const isDirty = () => Boolean($('domain-add-dialog')?.open && $('domain-hostname')?.value.trim());
  const pill = (label, tone = 'neutral') => `<span class="dm-status ${tone}"><i></i>${e(label)}</span>`;
  function safeUrl(value) {
    try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.href : ''; }
    catch { return ''; }
  }
  function link(value, label = value, className = '') {
    const url = safeUrl(value);
    return url ? `<a class="${className}" href="${e(url)}" target="_blank" rel="noopener noreferrer">${e(label)}</a>` : '<span class="dm-muted">尚未读取到地址</span>';
  }
  function accessStatus() {
    if (!access().enabled) return { label: '待启用', tone: 'neutral' };
    if (!access().available) return { label: '入口未就绪', tone: 'warning' };
    if (!access().workbench?.ready) return { label: '工作台未就绪', tone: 'warning' };
    if (access().workbench?.setupRequired) return { label: '待设置登录密码', tone: 'warning' };
    return { label: '监听中', tone: 'success' };
  }
  function domainStatus(item) {
    if (!item.enabled) return pill('已停用');
    const state = item.verification?.state;
    return state === 'active' ? pill('已验证', 'success') : state === 'error' ? pill('验证失败', 'failed') : pill('待验证', 'warning');
  }
  function certificate(item) {
    const ssl = item.verification?.ssl;
    if (ssl?.state === 'valid' && Date.parse(ssl.expiresAt) > Date.now()) return { label: '证书有效', tone: 'success' };
    if (ssl?.expiresAt && Date.parse(ssl.expiresAt) <= Date.now()) return { label: '证书已过期', tone: 'failed' };
    return { label: ssl?.state === 'error' ? '证书检测失败' : '证书未验证', tone: ssl?.state === 'error' ? 'warning' : 'neutral' };
  }
  function error(message = '') { $('domain-error').hidden = !message; $('domain-error').textContent = message; }
  function shell() {
    root.innerHTML = `<div id="domain-error" class="dm-alert warning" role="alert" hidden></div>
      <section id="domain-access-summary" class="dm-access-card" aria-label="工作台局域网访问"><div class="dm-loading">正在读取访问状态…</div></section>
      <div class="dm-tabs" role="tablist" aria-label="域名与网站设置">
        <button id="domain-tab-domains" role="tab" aria-controls="domain-content" data-domain-tab="domains">${icon('globe')}域名</button>
        <button id="domain-tab-deployment" role="tab" aria-controls="domain-content" data-domain-tab="deployment">${icon('server')}局域网</button>
        <button id="domain-tab-ssl" role="tab" aria-controls="domain-content" data-domain-tab="ssl">${icon('lock')}HTTPS</button>
      </div><section id="domain-content" class="dm-content" role="tabpanel" aria-labelledby="domain-tab-domains"><div class="dm-loading">正在读取…</div></section>
      <dialog id="domain-add-dialog" class="dm-dialog" aria-labelledby="domain-add-title"><form id="domain-add-form"><div class="dm-dialog-heading"><h2 id="domain-add-title">添加域名</h2><button class="dm-icon-button" type="button" data-domain-action="close-add" aria-label="关闭添加域名">×</button></div><label for="domain-hostname">域名</label><input id="domain-hostname" name="hostname" type="text" required maxlength="253" autocomplete="off" autocapitalize="none" spellcheck="false" inputmode="url" aria-describedby="domain-add-note domain-add-error" placeholder="app.example.com"><div id="domain-add-note" class="dm-dialog-note">添加后，在域名服务商配置 DNS，并为接入地址部署 HTTPS。</div><p id="domain-add-error" class="dm-form-error" role="alert"></p><div class="dm-dialog-actions"><button type="button" class="dm-button" data-domain-action="close-add">取消</button><button id="domain-add-submit" class="dm-button primary" type="submit">添加域名</button></div></form></dialog>
      <dialog id="domain-detail-dialog" class="dm-dialog dm-detail-dialog" aria-labelledby="domain-detail-title"><div class="dm-dialog-heading"><h2 id="domain-detail-title">访问详情</h2><button class="dm-icon-button" type="button" data-domain-action="close-detail" aria-label="关闭访问详情">×</button></div><div id="domain-detail-body"></div></dialog>`;
    $('domain-add-form').addEventListener('submit', addDomain);
    $('domain-add-dialog').addEventListener('cancel', event => { if (busy || (isDirty() && !window.confirm('域名尚未添加，确定放弃输入？'))) event.preventDefault(); });
    $('domain-detail-dialog').addEventListener('cancel', event => { if (busy) event.preventDefault(); });
  }
  function accessSummary(preserveFocus) {
    const primary = safeUrl(access().primaryUrl);
    const state = accessStatus();
    const content = `<div class="dm-access-main">
      <div class="dm-access-title"><h2>工作台访问</h2>${pill(state.label, state.tone)}</div>
      <div class="dm-access-url">${primary ? (ready() ? link(primary, primary, 'dm-primary-url') : `<span class="dm-address">${e(primary)}</span>`)
        : '<span class="dm-muted">暂无局域网地址</span>'}
        ${primary ? `<button class="dm-icon-button" data-domain-action="copy-primary" aria-label="复制局域网网址" title="复制局域网网址">${icon('copy')}</button>` : ''}
      </div>
    </div>
    <button class="dm-button dm-access-refresh" data-domain-action="access-check" aria-label="刷新检测" title="刷新检测">${icon('refresh')}<span>刷新检测</span></button>`;
    const card = $('domain-access-summary');
    if (!preserveFocus || !card.contains(document.activeElement)) card.innerHTML = content;
  }
  function firewallNotice() {
    const firewall = access().firewall || {};
    if (firewall.state === 'allowed') return '';
    return `<div class="dm-network-note warning">${icon('info')}<div>
      <strong>${firewall.state === 'missing' ? '需允许局域网入站' : '防火墙状态待确认'}</strong>
      <p>${e(firewall.message || `在 Windows 防火墙允许 TCP ${access().gatewayPort || '访客端口'} 入站。`)}</p>
    </div></div>`;
  }
  function lanRows() {
    const state = accessStatus(), search = query.trim().toLocaleLowerCase();
    return addresses().filter(item => `${item.address} ${item.name} ${item.url}`.toLocaleLowerCase().includes(search)).map(item => {
      const url = safeUrl(item.url);
      const label = url ? new URL(url).host : item.address;
      return `<tr role="row">
        <td role="cell"><div class="dm-domain-cell"><span class="dm-row-icon">${icon('server')}</span>
          <div><strong class="dm-mono">${e(label)}</strong>${item.name ? `<small>${e(item.name)}</small>` : ''}</div>
        </div></td>
        <td role="cell">${pill(state.label, state.tone)}</td>
        <td role="cell">HTTP</td>
        <td role="cell"><div class="dm-row-actions">
          ${url && ready() ? link(url, '打开 ↗') : ''}
          ${url ? `<button data-domain-action="copy-lan" data-address="${e(item.address)}">复制</button>` : ''}
          <button data-domain-action="lan-detail" data-address="${e(item.address)}">详情</button>
        </div></td>
      </tr>`;
    }).join('');
  }
  function customRows() {
    const search = query.trim().toLocaleLowerCase();
    return domains().filter(item => item.hostname.toLocaleLowerCase().includes(search)).map(item => {
      const ssl = certificate(item);
      return `<tr role="row">
        <td role="cell"><div class="dm-domain-cell"><span class="dm-row-icon">${icon('globe')}</span>
          <div><strong>${e(item.hostname)}</strong>${item.isDefault ? '<small>默认域名</small>' : ''}</div>
        </div></td>
        <td role="cell">${domainStatus(item)}</td>
        <td role="cell">${pill(ssl.label, ssl.tone)}</td>
        <td role="cell"><div class="dm-row-actions">
          <button data-domain-action="verify" data-id="${e(item.id)}">检测</button>
          <button data-domain-action="detail" data-id="${e(item.id)}">详情</button>
        </div></td>
      </tr>`;
    }).join('');
  }
  function domainRows() {
    return lanRows() + customRows() ||
      `<tr role="row"><td role="cell" colspan="4"><div class="dm-empty">${icon('globe')}<h3>${query.trim() ? '没有匹配的地址' : '暂无访问地址'}</h3></div></td></tr>`;
  }
  function domainPanel() {
    return `<div class="dm-toolbar">
      <label class="dm-search">${icon('search')}<input id="domain-search" type="search" aria-label="搜索域名或 IP" placeholder="搜索域名或 IP" value="${e(query)}"></label>
      <button class="dm-button primary" data-domain-action="add">＋ 添加域名</button>
    </div>
    <div class="dm-table-wrap" tabindex="0" role="region" aria-label="访问地址列表">
      <table class="dm-table dm-address-table" role="table"><thead role="rowgroup"><tr role="row"><th role="columnheader" scope="col">访问地址</th><th role="columnheader" scope="col">状态</th><th role="columnheader" scope="col">证书</th><th role="columnheader" scope="col">操作</th></tr></thead>
      <tbody id="domain-rows" role="rowgroup">${domainRows()}</tbody></table>
    </div>`;
  }
  function deploymentPanel() {
    const a = access(), workbench = a.workbench || {};
    const disabled = !a.enabled && (!a.available || !workbench.ready || workbench.setupRequired);
    return `<article class="dm-deployment-card">
      <div class="dm-deployment-title"><h2>局域网访问</h2>
        <button class="dm-button ${a.enabled ? 'danger' : 'primary'}" data-domain-action="access-toggle" ${disabled ? 'disabled' : ''}>${a.enabled ? '停用局域网访问' : '启用局域网访问'}</button>
      </div>
      <dl class="dm-deployment-details">
        <div><dt>本机地址</dt><dd>${link(a.localUrl, a.localUrl, 'dm-mono')}</dd></div>
        <div><dt>局域网地址</dt><dd>${safeUrl(a.primaryUrl) ? (ready() ? link(a.primaryUrl, a.primaryUrl, 'dm-mono') : e(a.primaryUrl)) : '—'}</dd></div>
      </dl>
      ${workbench.setupRequired ? '<div class="dm-alert warning">先打开本机工作台设置登录密码。</div>' : !workbench.ready ? '<div class="dm-alert warning">请在服务管理中启动工作台。</div>' : ''}
      <details class="dm-meta">
        <summary>连接详情</summary>
        <dl class="dm-detail-list">
          <div><dt>访客端口</dt><dd>${e(a.gatewayPort ?? '—')}</dd></div>
          <div><dt>工作台版本</dt><dd class="dm-mono">${e(workbench.version || '—')}</dd></div>
        </dl>
        <p>同一局域网的设备可以访问。路由器重新分配 IP 时，网址可能变化。</p>
      </details>
    </article>${firewallNotice()}`;
  }
  function sslPanel() {
    const rows = domains().map(item => {
      const ssl = item.verification?.ssl || {}, state = certificate(item);
      return `<tr><td><strong>${e(item.hostname)}</strong></td><td>${pill(state.label, state.tone)}</td><td>${e(ssl.issuer || '—')}</td><td>${e(ssl.expiresAt ? date(ssl.expiresAt) : '—')}</td><td>${e(item.verification?.checkedAt ? date(item.verification.checkedAt, true) : '—')}</td><td><div class="dm-row-actions"><button data-domain-action="detail" data-id="${e(item.id)}">详情</button><button data-domain-action="verify" data-id="${e(item.id)}">重新检测</button></div></td></tr>`;
    }).join('');
    return rows
      ? `<div class="dm-table-wrap" tabindex="0" role="region" aria-label="证书列表"><table class="dm-table"><thead><tr><th>域名</th><th>证书状态</th><th>颁发者</th><th>到期时间</th><th>最近检测</th><th>操作</th></tr></thead><tbody>${rows}</tbody></table></div>`
      : `<div class="dm-empty dm-empty-large">${icon('lock')}<h3>暂无证书</h3><button class="dm-button" data-domain-action="add">添加域名</button></div>`;
  }
  function render(preserveFocus = false) {
    if (!data) return;
    accessSummary(preserveFocus);
    root.querySelectorAll('[data-domain-tab]').forEach(button => {
      const selected = button.dataset.domainTab === tab;
      button.setAttribute('aria-selected', String(selected));
      button.tabIndex = selected ? 0 : -1;
    });
    const panel = $('domain-content');
    panel.setAttribute('aria-labelledby', `domain-tab-${tab}`);
    if (!preserveFocus || !panel.contains(document.activeElement)) {
      const content = tab === 'deployment' ? deploymentPanel() : tab === 'ssl' ? sslPanel() : domainPanel();
      if (content !== renderedPanel) {
        const scroll = preserveFocus ? panel.querySelector('.dm-table-wrap')?.scrollLeft : 0;
        panel.innerHTML = content;
        const table = panel.querySelector('.dm-table-wrap');
        if (table && scroll) table.scrollLeft = scroll;
        renderedPanel = content;
      }
    }
    if ($('domain-detail-dialog').open && detailId && !preserveFocus) renderDetails();
    updateBusy();
  }
  function updateBusy() {
    root.setAttribute('aria-busy', String(busy || loading));
    root.querySelectorAll('[data-domain-action],#domain-add-submit,#domain-hostname').forEach(node => {
      if (busy) { if (!node.disabled) { node.dataset.busyDisabled = 'true'; node.disabled = true; } }
      else if (node.dataset.busyDisabled) { node.disabled = false; delete node.dataset.busyDisabled; }
    });
    $('domain-add-submit').textContent = busy ? '正在处理…' : '添加域名';
  }
  function validate(value) {
    if (!value || !Array.isArray(value.domains) || !value.access || typeof value.access !== 'object') throw new Error('管理服务返回的访问状态无法识别，请刷新重试。');
    return value;
  }
  async function load(preserveFocus = false) {
    if (busy || loading) return;
    const requested = ++epoch; loading = true; updateBusy();
    try { const value = validate(await api('/api/domains')); if (requested === epoch) { data = value; render(preserveFocus); error(); } }
    catch (failure) { if (requested === epoch) error(failure.message); }
    finally { loading = false; updateBusy(); }
  }
  async function mutate(url, input, message, onSuccess) {
    if (busy) return false;
    busy = true; ++epoch; error(); updateBusy();
    try { await post(url, input); onSuccess?.(); data = validate(await api('/api/domains')); render(); toast(message); return true; }
    catch (failure) { error(failure.message); if ($('domain-add-dialog').open) $('domain-add-error').textContent = failure.message; return false; }
    finally { busy = false; render(); updateBusy(); }
  }
  function openAdd() {
    if (busy) return;
    $('domain-hostname').value = ''; $('domain-add-error').textContent = '';
    $('domain-add-dialog').showModal(); $('domain-hostname').focus();
  }
  async function addDomain(event) {
    event.preventDefault(); const hostname = $('domain-hostname').value.trim(); if (!hostname || busy) return;
    await mutate('/api/domains', { hostname }, '域名已添加，请完成 DNS 配置后检测。', () => { $('domain-add-dialog').close(); $('domain-hostname').value = ''; });
  }
  function renderDetails() {
    const container = $('domain-detail-body');
    if (detailId.startsWith('lan:')) {
      const item = addresses().find(address => address.address === detailId.slice(4));
      if (!item) { $('domain-detail-dialog').close(); return; }
      $('domain-detail-title').textContent = item.address;
      container.innerHTML = `<dl class="dm-detail-list">
        <div><dt>网卡</dt><dd>${e(item.name || '—')}</dd></div>
        <div><dt>访问网址</dt><dd>${ready() ? link(item.url, item.url, 'dm-mono') : e(item.url)}</dd></div>
        <div><dt>网络范围</dt><dd class="dm-mono">${e(item.subnet || (Number.isInteger(item.prefixLength) ? `${item.address}/${item.prefixLength}` : '—'))}</dd></div>
        <div><dt>地址分配</dt><dd>${item.dhcp === true ? 'DHCP' : item.dhcp === false ? '非 DHCP' : '—'}</dd></div>
      </dl>
      <div class="dm-dialog-actions"><button class="dm-button" data-domain-action="copy-lan" data-address="${e(item.address)}">复制网址</button><button class="dm-button primary" data-domain-action="close-detail">完成</button></div>`;
      return;
    }
    const item = findDomain(detailId);
    if (!item) { $('domain-detail-dialog').close(); return; }
    const verification = item.verification || {}, ssl = verification.ssl || {};
    const records = Array.isArray(verification.dns?.records) ? verification.dns.records : [];
    const cert = certificate(item);
    const target = `data-id="${e(item.id)}"`;
    $('domain-detail-title').textContent = item.hostname;
    container.innerHTML = `<div class="dm-detail-status">${domainStatus(item)}${pill(cert.label, cert.tone)}</div>
      ${verification.message ? `<p class="dm-detail-message">${e(verification.message)}</p>` : ''}
      <details class="dm-meta">
        <summary>DNS 记录</summary>
        ${records.length ? `<div class="dm-table-wrap" tabindex="0" role="region" aria-label="DNS 记录"><table class="dm-table"><thead><tr><th>类型</th><th>解析值</th></tr></thead><tbody>${records.map(record => `<tr><td>${e(record.type)}</td><td class="dm-mono">${e(record.value)}</td></tr>`).join('')}</tbody></table></div>` : '<p class="dm-muted">暂无解析记录</p>'}
      </details>
      <details class="dm-meta">
        <summary>证书信息</summary>
        <dl class="dm-detail-list">
          <div><dt>颁发者</dt><dd>${e(ssl.issuer || '—')}</dd></div>
          <div><dt>到期时间</dt><dd>${e(ssl.expiresAt ? date(ssl.expiresAt) : '—')}</dd></div>
          <div><dt>最近检测</dt><dd>${e(verification.checkedAt ? date(verification.checkedAt) : '—')}</dd></div>
        </dl>
      </details>
      <div class="dm-dialog-actions dm-detail-actions">
        <button class="dm-button primary" data-domain-action="verify" ${target}>重新检测</button>
        ${!item.isDefault && item.enabled && verification.state === 'active' ? `<button class="dm-button" data-domain-action="default" ${target}>设为默认</button>` : ''}
        <button class="dm-button" data-domain-action="toggle-domain" ${target}>${item.enabled ? '停用' : '启用'}</button>
        <button class="dm-button danger" data-domain-action="delete" ${target}>移除</button>
      </div>`;
  }
  async function copy(value) {
    const url = safeUrl(value); if (!url) return;
    try { await navigator.clipboard.writeText(url); toast('访问网址已复制。'); }
    catch { error('复制失败，请手动选中网址复制。'); }
  }
  root.addEventListener('input', event => {
    if (event.target.id !== 'domain-search') return;
    query = event.target.value;
    $('domain-rows').innerHTML = domainRows();
    renderedPanel = domainPanel();
    updateBusy();
  });
  root.addEventListener('click', async event => {
    const navigation = event.target.closest('[data-domain-tab]');
    if (navigation) { tab = navigation.dataset.domainTab; render(); navigation.focus(); return; }
    const button = event.target.closest('[data-domain-action]');
    if (!button || button.disabled || busy) return;
    const action = button.dataset.domainAction, item = findDomain(button.dataset.id);
    if (action === 'add') return openAdd();
    if (action === 'close-add') { if (!isDirty() || window.confirm('域名尚未添加，确定放弃输入？')) $('domain-add-dialog').close(); return; }
    if (action === 'close-detail') return $('domain-detail-dialog').close();
    if (action === 'copy-primary') return copy(access().primaryUrl);
    if (action === 'copy-lan') return copy(addresses().find(address => address.address === button.dataset.address)?.url);
    if (action === 'lan-detail' || action === 'detail') { detailId = action === 'detail' ? button.dataset.id : `lan:${button.dataset.address}`; renderDetails(); if (!$('domain-detail-dialog').open) $('domain-detail-dialog').showModal(); return; }
    if (action === 'access-check') return mutate('/api/domain-access/check', {}, '检测完成');
    if (action === 'access-toggle') {
      const a = access(); if (a.enabled && !window.confirm('停用后，其他设备将无法通过局域网入口访问工作台。确认停用？')) return;
      return mutate('/api/domain-access', { revision: a.revision, enabled: !a.enabled }, a.enabled ? '局域网访问已停用。' : '局域网访问已启用。');
    }
    if (!item) return error('域名记录已更新，请刷新后重试。');
    const endpoint = `/api/domains/${encodeURIComponent(item.id)}`;
    if (action === 'verify') return mutate(`${endpoint}/verify`, { revision: item.revision }, '检测完成');
    if (action === 'default') return mutate(`${endpoint}/default`, { revision: item.revision }, '默认域名已更新。');
    if (action === 'toggle-domain') return mutate(endpoint, { revision: item.revision, enabled: !item.enabled }, item.enabled ? '域名已停用。' : '域名已启用，请检查验证结果。');
    if (action === 'delete' && window.confirm(`移除域名 ${item.hostname}？此操作不会删除工作台数据，也不会修改域名服务商的 DNS。`)) return mutate(`${endpoint}/delete`, { revision: item.revision, confirmation: item.id }, '域名记录已移除。');
  });
  root.addEventListener('keydown', event => {
    const current = event.target.closest('[data-domain-tab]'); if (!current || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault(); const tabs = [...root.querySelectorAll('[data-domain-tab]')], index = tabs.indexOf(current);
    const next = event.key === 'Home' ? tabs[0] : event.key === 'End' ? tabs.at(-1) : tabs[(index + (event.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
    tab = next.dataset.domainTab; render(); next.focus();
  });
  window.addEventListener('beforeunload', event => { if (busy || isDirty()) { event.preventDefault(); event.returnValue = ''; } });
  function canLeave() {
    if (busy) { toast('正在处理访问设置，请等待完成。'); return false; }
    if (isDirty() && !window.confirm('域名尚未添加，确定放弃输入？')) return false;
    $('domain-add-dialog').close(); $('domain-detail-dialog').close(); return true;
  }
  shell();
  return { load, refreshHosting: () => load(true), canLeave, isDirty };
}
