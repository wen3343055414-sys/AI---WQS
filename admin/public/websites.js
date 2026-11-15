export function initWebsites({ api, toast, escape: e, icon, date }) {
  const root = document.getElementById('website-management');
  const $ = id => root.querySelector(`#${id}`);
  const post = (url, value) => api(url, { method: 'POST', body: JSON.stringify(value) });
  let data = null, tab = 'domains', query = '', busy = false, loading = false, epoch = 0, detailId = '';
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
      <section id="domain-access-summary" class="dm-access-card" aria-label="工作台局域网访问"><div class="dm-loading">正在读取真实网络与工作台状态…</div></section>
      <div class="dm-tabs" role="tablist" aria-label="域名与网站设置">
        <button id="domain-tab-domains" role="tab" aria-controls="domain-content" data-domain-tab="domains">${icon('globe')}域名管理</button>
        <button id="domain-tab-deployment" role="tab" aria-controls="domain-content" data-domain-tab="deployment">${icon('server')}网站部署</button>
        <button id="domain-tab-ssl" role="tab" aria-controls="domain-content" data-domain-tab="ssl">${icon('lock')}SSL 证书</button>
      </div><section id="domain-content" class="dm-content" role="tabpanel" aria-labelledby="domain-tab-domains"><div class="dm-loading">正在读取…</div></section>
      <dialog id="domain-add-dialog" class="dm-dialog"><form id="domain-add-form"><div class="dm-dialog-heading"><span class="dm-symbol">${icon('globe')}</span><button class="dm-icon-button" type="button" data-domain-action="close-add" aria-label="关闭添加域名">×</button></div><h2>添加域名</h2><p>绑定你有 DNS 管理权限的域名，连接当前 AI 智作台。</p><label for="domain-hostname">域名</label><input id="domain-hostname" name="hostname" type="text" required maxlength="253" autocomplete="off" autocapitalize="none" spellcheck="false" inputmode="url" aria-describedby="domain-add-note domain-add-error" placeholder="输入完整域名，不含 https:// 或路径"><div id="domain-add-note" class="dm-dialog-note">仅添加记录不会修改 DNS，也不会生成证书。需要在域名服务商配置解析，并在接入服务部署 HTTPS。没有域名管理权限时，可直接使用局域网地址。</div><p id="domain-add-error" class="dm-form-error" role="alert"></p><div class="dm-dialog-actions"><button type="button" class="dm-button" data-domain-action="close-add">取消</button><button id="domain-add-submit" class="dm-button primary" type="submit">添加域名</button></div></form></dialog>
      <dialog id="domain-detail-dialog" class="dm-dialog dm-detail-dialog"><div class="dm-dialog-heading"><h2 id="domain-detail-title">访问详情</h2><button class="dm-icon-button" type="button" data-domain-action="close-detail" aria-label="关闭访问详情">×</button></div><div id="domain-detail-body"></div></dialog>`;
    $('domain-add-form').addEventListener('submit', addDomain);
    $('domain-add-dialog').addEventListener('cancel', event => { if (busy || (isDirty() && !window.confirm('域名尚未添加，确定放弃输入？'))) event.preventDefault(); });
    $('domain-detail-dialog').addEventListener('cancel', event => { if (busy) event.preventDefault(); });
  }
  function accessSummary() {
    const a = access(), state = accessStatus(), primary = safeUrl(a.primaryUrl);
    $('domain-access-summary').innerHTML = `<div class="dm-access-main"><div class="dm-eyebrow"><span class="dm-access-dot"></span>本地工作台 · 局域网访问</div><div class="dm-access-title"><h2>一个工作台，多设备连接。</h2>${pill(state.label, state.tone)}</div><p>同一网络下，其他设备通过局域网地址登录，共享本机工作空间。</p><div class="dm-access-url">${primary ? link(primary, primary, 'dm-primary-url') : '<span class="dm-muted">暂未检测到可用的局域网 IPv4 地址</span>'}${primary ? '<button class="dm-icon-button" data-domain-action="copy-primary" aria-label="复制局域网网址" title="复制局域网网址">⧉</button>' : ''}</div><div class="dm-access-notes"><span>${addresses().length} 个实际网络地址</span><span>仅同一局域网访问</span><span>HTTP · 未启用 SSL</span></div></div><div class="dm-access-side"><span class="dm-access-symbol">${icon('server')}</span><span class="dm-server-label">AI 智作台工作台</span><div class="dm-access-buttons">${primary && ready() ? link(primary, '打开工作台 ↗', 'dm-button primary') : '<button class="dm-button primary" disabled title="启用访问并确认工作台就绪后可打开">打开工作台 ↗</button>'}<button class="dm-button" data-domain-action="access-check">${icon('refresh')}刷新检测</button></div></div>`;
  }
  function firewallNotice() {
    const firewall = access().firewall || {}, allowed = firewall.state === 'allowed';
    return `<div class="dm-network-note ${allowed ? '' : 'warning'}">${icon(allowed ? 'check' : 'info')}<div><strong>${allowed ? 'Windows 防火墙规则已配置' : firewall.state === 'missing' ? '需要允许局域网入站连接' : '防火墙状态待确认'}</strong><p>${e(firewall.message || (allowed ? '入站范围以当前本机规则为准。' : `其他设备连接需要 Windows 防火墙允许 TCP ${access().gatewayPort || '访客端口'}；配置入站规则需要 Windows 管理员权限。`))}</p></div></div>`;
  }
  function lanRows() {
    const a = access(), state = accessStatus();
    return addresses().filter(item => `${item.address} ${item.name} ${item.url}`.toLocaleLowerCase().includes(query.toLocaleLowerCase())).map(item => {
      const url = safeUrl(item.url), primary = url && url === safeUrl(a.primaryUrl);
      let label = item.address || ''; try { label = new URL(url).host; } catch { /* Use only the detected address. */ }
      return `<tr><td><div class="dm-domain-cell"><span class="dm-row-icon">${icon('server')}</span><div><strong class="dm-mono">${e(label)}</strong><small>${e(item.name || '本机网络接口')} <span class="dm-tag">局域网</span>${primary ? '<span class="dm-tag blue">主要入口</span>' : ''}</small></div></div></td><td>${pill(state.label, state.tone)}</td><td><span class="dm-target">AI 智作台工作台</span><small class="dm-mono">${e(a.localUrl || '本机工作台未就绪')}</small></td><td><span class="dm-http">HTTP</span><small>未启用 SSL</small></td><td><div class="dm-row-actions">${url && ready() ? link(url, '打开 ↗') : '<span class="dm-muted">待启用</span>'}${url ? `<button data-domain-action="copy-lan" data-address="${e(item.address)}">复制</button>` : ''}<button data-domain-action="lan-detail" data-address="${e(item.address)}">详情</button></div></td></tr>`;
    }).join('');
  }
  function customRows() {
    return domains().filter(item => item.hostname.toLocaleLowerCase().includes(query.toLocaleLowerCase())).map(item => {
      const ssl = certificate(item), verified = item.enabled && item.verification?.state === 'active';
      return `<tr><td><div class="dm-domain-cell"><span class="dm-row-icon">${icon('globe')}</span><div><strong>${e(item.hostname)}</strong><small>自定义域名${item.isDefault ? '<span class="dm-tag blue">默认域名</span>' : ''}</small></div></div></td><td>${domainStatus(item)}</td><td><span class="dm-target">AI 智作台工作台</span><small class="dm-mono">${e(access().localUrl || '本机工作台')}</small></td><td>${pill(ssl.label, ssl.tone)}${item.verification?.ssl?.expiresAt ? `<small>到期 ${e(date(item.verification.ssl.expiresAt, true))}</small>` : ''}</td><td><div class="dm-row-actions"><button data-domain-action="verify" data-id="${e(item.id)}">检测</button><button data-domain-action="detail" data-id="${e(item.id)}">详情</button><button data-domain-action="default" data-id="${e(item.id)}" ${item.isDefault || !verified ? 'disabled' : ''} title="${item.isDefault ? '当前默认域名' : verified ? '设为默认域名' : '需先启用并验证域名'}">${item.isDefault ? '已默认' : '设默认'}</button><button data-domain-action="toggle-domain" data-id="${e(item.id)}">${item.enabled ? '停用' : '启用'}</button><button class="danger" data-domain-action="delete" data-id="${e(item.id)}">移除</button></div></td></tr>`;
    }).join('');
  }
  function domainPanel() {
    const rows = lanRows() + customRows(), count = addresses().length + domains().length;
    return `<div class="dm-section-heading"><div><h2>域名管理 <span>${count}</span></h2><p>查看真实访问地址，管理工作台域名绑定。</p></div><div class="dm-toolbar"><label class="dm-search">${icon('globe')}<input id="domain-search" type="search" aria-label="搜索域名或局域网地址" placeholder="搜索域名或 IP" value="${e(query)}"></label><button class="dm-button primary" data-domain-action="add">＋ 添加域名</button></div></div><div class="dm-table-wrap"><table class="dm-table"><thead><tr><th>域名 / 访问地址</th><th>状态</th><th>目标服务</th><th>SSL 证书</th><th>操作</th></tr></thead><tbody>${rows || `<tr><td colspan="5"><div class="dm-empty">${icon('globe')}<h3>${query ? '没有匹配的地址' : '尚未检测到访问地址'}</h3><p>${query ? '请尝试其他域名或 IP。' : '连接可用网络后刷新检测，或添加你可以管理的真实域名。'}</p></div></td></tr>`}</tbody></table></div><div class="dm-table-footer"><span>局域网地址来自当前物理网络接口，域名状态以最近一次检测为准。</span><span>最近检测 ${e(date(access().checkedAt, true))}</span></div><div class="dm-address-note">${icon('info')}<p>局域网网址使用本机 IP。如果网络通过 DHCP 分配地址，IP 可能变化；需要长期保持同一网址时，请在路由器为此设备配置 DHCP 地址保留。</p></div>${firewallNotice()}`;
  }
  function deploymentPanel() {
    const a = access(), workbench = a.workbench || {}, state = accessStatus(), disabled = !a.enabled && (!a.available || !workbench.ready || workbench.setupRequired);
    return `<div class="dm-section-heading"><div><h2>网站部署</h2><p>连接本机正在运行的完整 AI 智作台。</p></div>${pill(state.label, state.tone)}</div><article class="dm-deployment-card"><div class="dm-deployment-title"><span class="dm-symbol">${icon('server')}</span><div><h3>AI 智作台工作台</h3><p>同一服务器 · 同一工作空间 · 独立浏览器登录</p></div>${pill(workbench.ready ? '服务已就绪' : '服务未就绪', workbench.ready ? 'success' : 'warning')}</div><dl class="dm-deployment-details"><div><dt>本机工作台地址</dt><dd>${link(a.localUrl, a.localUrl, 'dm-mono')}</dd></div><div><dt>局域网访问地址</dt><dd>${safeUrl(a.primaryUrl) ? link(a.primaryUrl, a.primaryUrl, 'dm-mono') : '<span class="dm-muted">未检测到可用地址</span>'}</dd></div><div><dt>访客入口端口</dt><dd class="dm-mono">${e(a.gatewayPort ?? '尚未读取')}</dd></div><div><dt>工作台版本</dt><dd class="dm-mono">${e(workbench.version || '尚未读取')}</dd></div><div><dt>管理后台</dt><dd>保留在本机，使用独立管理登录</dd></div><div><dt>访问范围</dt><dd>同一局域网内的设备</dd></div></dl>${workbench.setupRequired ? '<div class="dm-alert warning">请先打开本机工作台设置登录密码，再启用其他设备访问。</div>' : !workbench.ready ? '<div class="dm-alert warning">工作台尚未就绪，请先在“服务管理”中启动前后端服务。</div>' : ''}<div class="dm-deployment-actions"><button class="dm-button ${a.enabled ? 'danger' : 'primary'}" data-domain-action="access-toggle" ${disabled ? 'disabled' : ''}>${a.enabled ? '停用局域网访问' : '启用局域网访问'}</button><button class="dm-button" data-domain-action="access-check">${icon('refresh')}刷新检测</button>${safeUrl(a.localUrl) ? link(a.localUrl, '打开本机工作台 ↗', 'dm-text-link') : ''}</div></article>${firewallNotice()}<div class="dm-address-note">${icon('info')}<p>电脑、本机工作台和网络需要保持运行。其他设备使用工作台密码登录；登录后访问的是本机保存的真实数据。</p></div>`;
  }
  function sslPanel() {
    const rows = domains().map(item => {
      const ssl = item.verification?.ssl || {}, state = certificate(item);
      return `<tr><td><strong>${e(item.hostname)}</strong></td><td>${pill(state.label, state.tone)}</td><td>${e(ssl.issuer || '尚未读取')}</td><td>${e(ssl.expiresAt ? date(ssl.expiresAt) : '尚未读取')}</td><td>${e(item.verification?.checkedAt ? date(item.verification.checkedAt, true) : '尚未检测')}</td><td><div class="dm-row-actions"><button data-domain-action="detail" data-id="${e(item.id)}">详情</button><button data-domain-action="verify" data-id="${e(item.id)}">重新检测</button></div></td></tr>`;
    }).join('');
    return `<div class="dm-section-heading"><div><h2>SSL 证书</h2><p>仅展示实际检测到的域名证书信息。</p></div><button class="dm-button primary" data-domain-action="add">＋ 添加域名</button></div>${rows ? `<div class="dm-table-wrap"><table class="dm-table"><thead><tr><th>域名</th><th>证书状态</th><th>颁发者</th><th>到期时间</th><th>最近检测</th><th>操作</th></tr></thead><tbody>${rows}</tbody></table></div>` : `<div class="dm-empty dm-empty-large">${icon('lock')}<h3>尚未配置 HTTPS 证书</h3><p>当前局域网地址通过 HTTP 访问，无 HTTPS 证书。<br>使用 HTTPS 需要你能管理的真实域名和已部署的有效证书。</p></div>`}<div class="dm-address-note">${icon('info')}<p>登记域名不会自动签发或安装证书。证书状态来自当前域名 HTTPS 接入的实际检测结果。</p></div>`;
  }
  function render() {
    if (!data) return;
    const focused = document.activeElement?.id === 'domain-search', cursor = focused ? document.activeElement.selectionStart : null;
    accessSummary();
    root.querySelectorAll('[data-domain-tab]').forEach(button => { const selected = button.dataset.domainTab === tab; button.setAttribute('aria-selected', String(selected)); button.tabIndex = selected ? 0 : -1; });
    $('domain-content').setAttribute('aria-labelledby', `domain-tab-${tab}`);
    $('domain-content').innerHTML = tab === 'deployment' ? deploymentPanel() : tab === 'ssl' ? sslPanel() : domainPanel();
    document.getElementById('nav-website-count').textContent = addresses().length + domains().length;
    if ($('domain-search')) $('domain-search').addEventListener('input', event => { query = event.target.value; render(); });
    if (focused && $('domain-search')) { $('domain-search').focus(); if (cursor !== null) $('domain-search').setSelectionRange(cursor, cursor); }
    if ($('domain-detail-dialog').open && detailId) renderDetails();
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
  async function load() {
    if (busy || loading) return;
    const requested = ++epoch; loading = true; updateBusy();
    try { const value = validate(await api('/api/domains')); if (requested === epoch) { data = value; render(); error(); } }
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
      $('domain-detail-title').textContent = '局域网访问详情';
      container.innerHTML = `<dl class="dm-detail-list"><div><dt>网络接口</dt><dd>${e(item.name || '尚未读取')}</dd></div><div><dt>IPv4 地址</dt><dd class="dm-mono">${e(item.address)}</dd></div><div><dt>访问网址</dt><dd>${link(item.url, item.url, 'dm-mono')}</dd></div><div><dt>网络范围</dt><dd class="dm-mono">${e(item.subnet || (Number.isInteger(item.prefixLength) ? `${item.address}/${item.prefixLength}` : '尚未读取'))}</dd></div><div><dt>地址分配</dt><dd>${item.dhcp === true ? 'DHCP 自动分配' : item.dhcp === false ? '非 DHCP 自动分配' : '尚未确认'}</dd></div><div><dt>SSL</dt><dd>HTTP · 未启用 SSL</dd></div></dl><div class="dm-dialog-note">其他设备需要连接同一局域网。若地址由 DHCP 分配，建议在路由器设置地址保留，以保持网址稳定。</div>`; return;
    }
    const item = findDomain(detailId);
    if (!item) { $('domain-detail-dialog').close(); return; }
    const v = item.verification || {}, ssl = v.ssl || {}, records = Array.isArray(v.dns?.records) ? v.dns.records : [], cert = certificate(item);
    $('domain-detail-title').textContent = item.hostname;
    container.innerHTML = `<div class="dm-detail-status">${domainStatus(item)}${pill(cert.label, cert.tone)}</div><p class="dm-detail-message">${e(v.message || '尚未检测此域名与本机工作台的连接。')}</p><h3>实际 DNS 记录</h3>${records.length ? `<div class="dm-table-wrap"><table class="dm-table"><thead><tr><th>类型</th><th>当前解析值</th></tr></thead><tbody>${records.map(record => `<tr><td>${e(record.type)}</td><td class="dm-mono">${e(record.value)}</td></tr>`).join('')}</tbody></table></div>` : '<p class="dm-muted">尚未获取到有效 DNS 记录。</p>'}<h3>HTTPS 证书</h3><dl class="dm-detail-list"><div><dt>颁发者</dt><dd>${e(ssl.issuer || '尚未读取')}</dd></div><div><dt>到期时间</dt><dd>${e(ssl.expiresAt ? date(ssl.expiresAt) : '尚未读取')}</dd></div><div><dt>最近检测</dt><dd>${e(v.checkedAt ? date(v.checkedAt) : '尚未检测')}</dd></div><div><dt>目标服务</dt><dd>本机 AI 智作台工作台</dd></div></dl><div class="dm-dialog-note">DNS 解析和有效证书不等于网站已连接；域名还需要通过工作台身份检测。配置 DNS 或 HTTPS 需要对应域名和接入服务的管理权限。</div><div class="dm-dialog-actions"><button class="dm-button" data-domain-action="verify" data-id="${e(item.id)}">重新检测</button><button class="dm-button primary" data-domain-action="close-detail">完成</button></div>`;
  }
  async function copy(value) {
    const url = safeUrl(value); if (!url) return;
    try { await navigator.clipboard.writeText(url); toast('访问网址已复制。'); }
    catch { error('复制失败，请手动选中网址复制。'); }
  }
  root.addEventListener('click', async event => {
    const navigation = event.target.closest('[data-domain-tab]');
    if (navigation) { tab = navigation.dataset.domainTab; render(); return; }
    const button = event.target.closest('[data-domain-action]');
    if (!button || button.disabled || busy) return;
    const action = button.dataset.domainAction, item = findDomain(button.dataset.id);
    if (action === 'add') return openAdd();
    if (action === 'close-add') { if (!isDirty() || window.confirm('域名尚未添加，确定放弃输入？')) $('domain-add-dialog').close(); return; }
    if (action === 'close-detail') return $('domain-detail-dialog').close();
    if (action === 'copy-primary') return copy(access().primaryUrl);
    if (action === 'copy-lan') return copy(addresses().find(address => address.address === button.dataset.address)?.url);
    if (action === 'lan-detail' || action === 'detail') { detailId = action === 'detail' ? button.dataset.id : `lan:${button.dataset.address}`; renderDetails(); if (!$('domain-detail-dialog').open) $('domain-detail-dialog').showModal(); return; }
    if (action === 'access-check') return mutate('/api/domain-access/check', {}, '访问状态已重新检测。');
    if (action === 'access-toggle') {
      const a = access(); if (a.enabled && !window.confirm('停用后，其他设备将无法通过局域网入口访问工作台。确认停用？')) return;
      return mutate('/api/domain-access', { revision: a.revision, enabled: !a.enabled }, a.enabled ? '局域网访问已停用。' : '局域网访问已启用。');
    }
    if (!item) return error('域名记录已更新，请刷新后重试。');
    const endpoint = `/api/domains/${encodeURIComponent(item.id)}`;
    if (action === 'verify') return mutate(`${endpoint}/verify`, { revision: item.revision }, '域名检测完成，请查看实际验证结果。');
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
  return { load, refreshHosting: load, canLeave, isDirty };
}
