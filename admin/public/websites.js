export function initWebsites({ api, toast, escape: e, icon, date }) {
  const root = document.getElementById('website-management');
  const $ = id => root.querySelector(`#${id}`);
  let data = null, site = null, activeFile = 'index.html', dirty = false, busy = false, loading = false, view = 'code';
  let selection = 0, previewUrl = '', generationRunning = false;
  const post = (url, value) => api(url, { method: 'POST', body: JSON.stringify(value) });
  const urlFor = (item, publicUrl = true) => {
    const hosting = data?.hosting;
    const origin = publicUrl ? hosting?.publicOrigin || (hosting?.tunnel?.state === 'ready' ? hosting.tunnel.url : null) : hosting?.localOrigin;
    return origin && item.published ? `${origin}/${item.publishedSlug || item.slug}/` : '';
  };
  const statusLabel = item => !item.published ? '未发布' : item.revision === item.publishedRevision ? '已发布' : '草稿有更新';
  const file = () => site?.files.find(item => item.path === activeFile);
  function setDirty(value = true) {
    dirty = value;
    const label = $('ws-save-state');
    if (label) { label.textContent = dirty ? '有未保存的修改' : site ? `已保存 · ${date(site.updatedAt, true)}` : ''; label.classList.toggle('unsaved', dirty); }
  }
  function canLeave() {
    if (busy || loading) { toast('正在处理网站操作，请等待完成。'); return false; }
    return !dirty || window.confirm('有未保存的网站修改，确定放弃这些修改？');
  }
  function showError(message = '') { const node = $('ws-error'); if (node) { node.hidden = !message; node.textContent = message; } }
  function shell() {
    root.innerHTML = `<div class="ws-toolbar"><div class="ws-title"><span class="ws-title-symbol">${icon('globe')}</span><div><h2>我的网站</h2><p>独立网址，草稿与发布内容分别保存</p></div></div><div class="button-row"><button class="btn" data-ws="import-project">导入网站</button><button class="btn primary" data-ws="create">＋ 创建网站</button></div></div>
      <div id="ws-error" class="notice warning" role="alert" hidden></div>
      <article class="panel ws-hosting"><div class="ws-hosting-icon">${icon('globe')}</div><div class="ws-hosting-main"><div class="ws-hosting-heading"><h3>公网访问</h3><span id="ws-tunnel-badge" class="badge neutral">读取中</span></div><p id="ws-tunnel-message"></p><code id="ws-tunnel-url" class="mono" hidden></code><small>临时公网地址在通道重启后会改变。电脑和本地服务需要持续运行；固定域名可在服务配置中接入。</small></div><div class="ws-hosting-actions"><button class="btn" data-ws="tunnel-start">开启公网访问</button><button class="btn danger" data-ws="tunnel-stop" hidden>关闭公网访问</button></div></article>
      <div class="ws-layout"><aside class="panel ws-sidebar"><div class="ws-sidebar-heading"><h3>网站列表</h3><span id="ws-count">0</span></div><div id="ws-list" class="ws-list"></div><p class="ws-sidebar-note">保存不影响访客。点击“发布网站”后，网址才会展示新的内容。</p></aside><div id="ws-editor" class="ws-editor"></div></div>
      <dialog id="ws-dialog" class="ws-dialog"><form id="ws-project-form"><div class="dialog-title-row"><h2 id="ws-dialog-title">创建网站</h2><button class="icon-btn" type="button" data-ws="dialog-close" aria-label="关闭">×</button></div><label>网站名称<input name="name" id="ws-name" required maxlength="100" placeholder="例如：我的品牌官网"></label><label>网址路径<input name="slug" id="ws-slug" required pattern="[a-z0-9][a-z0-9-]{0,59}" maxlength="60" placeholder="my-website"></label><p class="helper">使用小写英文字母、数字或连字符，例如 /my-website/。</p><label>网站说明<textarea name="description" id="ws-description" maxlength="500" rows="3" placeholder="简单介绍网站的用途"></textarea></label><label id="ws-template-field">起始页面<select id="ws-template"><option value="brand">品牌 / 项目主页</option><option value="portfolio">个人 / 作品主页</option><option value="blank">空白页面</option></select></label><p id="ws-dialog-error" class="form-error" role="alert"></p><div class="dialog-buttons"><button type="button" class="btn" data-ws="dialog-close">取消</button><button type="submit" class="btn primary" id="ws-project-submit">创建网站</button></div></form></dialog>
      <input id="ws-file-input" type="file" multiple hidden><input id="ws-import-input" type="file" accept="application/json,.json" hidden>`;
    $('ws-project-form').addEventListener('submit', submitProject);
    $('ws-file-input').addEventListener('change', uploadFiles);
    $('ws-import-input').addEventListener('change', importProject);
  }
  function hosting() {
    const h = data?.hosting || {}, tunnel = h.tunnel || {};
    const available = h.available;
    const ready = tunnel.state === 'ready';
    const badge = $('ws-tunnel-badge');
    badge.className = `badge ${h.publicOrigin || ready ? 'success' : tunnel.state === 'error' || !available ? 'warning' : 'neutral'}`;
    badge.textContent = h.publicOrigin ? '固定地址已配置' : ({ stopped: '未开启', starting: '正在启动', connecting: '正在连接', ready: '已连接', error: '连接失败' })[tunnel.state] || '未开启';
    $('ws-tunnel-message').textContent = !available ? '网站访客服务不可用，请查看管理服务日志。' : h.publicOrigin ? '已配置固定公网入口，请确保域名通道指向网站访客服务。' : tunnel.message || '开启后获取真实的 HTTPS 公网网址。';
    const origin = h.publicOrigin || (ready ? tunnel.url : null), link = $('ws-tunnel-url');
    link.hidden = !origin; if (origin) link.textContent = origin;
    const start = root.querySelector('[data-ws="tunnel-start"]'), stop = root.querySelector('[data-ws="tunnel-stop"]');
    start.hidden = Boolean(h.publicOrigin || ['starting', 'connecting', 'ready'].includes(tunnel.state));
    start.disabled = busy || loading || !available || !tunnel.installed;
    if (!tunnel.installed && available && !h.publicOrigin) $('ws-tunnel-message').textContent = '公网通道组件尚未安装，请按管理服务文档安装 Cloudflare Tunnel。';
    stop.hidden = !tunnel.enabled && !['starting', 'connecting', 'ready'].includes(tunnel.state); stop.disabled = busy || loading;
    renderLinks();
  }
  function list() {
    const sites = data?.sites || [];
    document.getElementById('nav-website-count').textContent = sites.length;
    $('ws-count').textContent = sites.length;
    $('ws-list').innerHTML = sites.length ? sites.map(item => `<button class="ws-site${site?.id === item.id ? ' selected' : ''}" data-ws="select" data-id="${e(item.id)}"><span class="ws-site-icon">${icon('globe')}</span><span><strong>${e(item.name)}</strong><small>/${e(item.slug)}/</small><span class="ws-site-status ${item.published ? 'published' : ''}"><i></i>${statusLabel(item)}</span></span></button>`).join('') : '<div class="ws-no-sites"><span>＋</span><h3>从第一个网站开始</h3><p>创建页面、编辑内容，发布后即可通过网址访问。</p><button class="btn small primary" data-ws="create">创建网站</button></div>';
  }
  function renderLinks() {
    if (!site || !$('ws-public-link')) return;
    const pub = urlFor(site), local = urlFor(site, false), node = $('ws-public-link');
    node.hidden = !pub; if (pub) { node.href = pub; node.textContent = pub; }
    $('ws-link-placeholder').hidden = Boolean(pub);
    $('ws-link-placeholder').textContent = !site.published ? '发布后生成访问网址' : '已在本机发布，开启公网访问后生成外网网址';
    const localNode = $('ws-local-link'); localNode.hidden = !local;
    if (local) { localNode.href = local; localNode.textContent = local; }
    const copy = root.querySelector('[data-ws="copy-url"]'); if (copy) copy.disabled = busy || loading || !pub;
  }
  function editor() {
    if (!site) { $('ws-editor').innerHTML = '<div class="panel ws-welcome"><span class="ws-welcome-icon">🌐</span><h2>让你的想法，拥有一个网址</h2><p>选择网站继续编辑，或从起始页面创建。<br>支持 HTML、CSS、JavaScript 和图片，AI 也可以帮助你生成页面。</p><button class="btn primary" data-ws="create">＋ 创建第一个网站</button><div class="ws-welcome-steps"><span>01 创建</span><span>02 编辑</span><span>03 发布</span></div></div>'; return; }
    $('ws-editor').innerHTML = `<article class="panel ws-project"><div class="ws-project-heading"><div><div class="ws-title-line"><h2>${e(site.name)}</h2><span class="badge ${site.published ? 'success' : 'neutral'}">${statusLabel(site)}</span></div><p>${e(site.description || '在下方编辑页面文件，保存后预览，确认后发布。')}</p></div><button class="btn small" data-ws="settings">网站设置</button></div><div class="ws-url-box"><span class="ws-url-label">公网网址</span><div><a id="ws-public-link" class="mono" target="_blank" rel="noopener noreferrer" hidden></a><span id="ws-link-placeholder"></span><a id="ws-local-link" class="ws-local-link mono" target="_blank" rel="noopener noreferrer" hidden></a></div><button class="btn small" data-ws="copy-url">复制网址</button></div><div class="ws-project-actions"><span id="ws-save-state"></span><div class="button-row"><button class="btn" data-ws="save">保存草稿</button><button class="btn" data-ws="preview">${icon('play')}预览草稿</button><button class="btn primary" data-ws="publish">${icon('arrow')}发布网站</button></div></div></article>
      <article class="panel ws-ai"><div><span class="ws-ai-symbol">✦</span><h3>AI 生成与修改</h3><small>调用已配置的真实模型，结果保存为草稿</small></div><textarea id="ws-prompt" rows="2" maxlength="6000" placeholder="描述你想要的网站，或告诉 AI 如何修改当前页面…" aria-label="网站生成需求"></textarea><div class="ws-ai-bottom"><select id="ws-model" aria-label="网站生成模型"><option value="">跟随默认模型</option>${(data.models?.models || []).map(model => `<option value="${e(model.key)}">${e(model.provider)} · ${e(model.name)}</option>`).join('')}</select><button class="btn primary" data-ws="generate">✦ 生成网站</button></div><p id="ws-ai-state" class="helper">${data.models?.ready || data.models?.models?.length ? '生成会使用服务商额度。请检查生成内容后再发布。' : '请先在“API 接口设置”中配置并启用模型。手动编辑和发布可直接使用。'}</p></article>
      <article class="panel ws-files"><div class="ws-files-toolbar"><div class="ws-tabs"><button data-ws="code" class="${view === 'code' ? 'active' : ''}">代码编辑</button><button data-ws="visual" class="${view === 'visual' ? 'active' : ''}">文字与链接</button></div><div class="button-row"><button class="text-btn" data-ws="add-file">＋ 新建文件</button><button class="text-btn" data-ws="upload">导入文件 / 图片</button></div></div><div class="ws-file-workspace"><aside id="ws-file-list" class="ws-file-list"></aside><div id="ws-file-editor" class="ws-file-editor"></div></div></article>
      <article class="panel ws-preview" id="ws-preview-panel" hidden><div class="panel-heading"><div><h3>草稿预览</h3><p>此处展示已保存草稿；访客仍看到上一次发布的版本。</p></div><div class="button-row"><button class="btn small" data-ws="mobile">手机宽度</button><button class="btn small" data-ws="desktop">桌面宽度</button><a id="ws-preview-open" class="btn small" target="_blank" rel="noopener noreferrer">单独打开 ↗</a></div></div><div class="ws-frame-wrap"><iframe id="ws-preview-frame" title="网站草稿预览" sandbox="allow-scripts allow-forms allow-popups allow-downloads" referrerpolicy="no-referrer"></iframe></div></article>
      <div class="ws-bottom-actions"><a class="text-btn" href="/api/websites/${site.id}/export" download>导出网站文件</a><span>每站最多 100 个文件 / 5 MB</span><div><button class="text-btn" data-ws="unpublish" ${site.published ? '' : 'disabled'}>下架网站</button><button class="text-btn ws-danger" data-ws="delete">删除网站</button></div></div>`;
    renderLinks(); renderFiles(); setDirty(dirty); updateBusy();
  }
  function renderFiles() {
    $('ws-file-list').innerHTML = site.files.map(item => `<button data-ws="file" data-path="${e(item.path)}" class="${item.path === activeFile ? 'active' : ''}"><span>${item.encoding === 'base64' ? '▧' : '⌘'}</span>${e(item.path)}</button>`).join('') || '<p>尚无文件</p>';
    const current = file();
    if (!current) { activeFile = site.files[0]?.path || ''; if (activeFile) { renderFiles(); return; } $('ws-file-editor').innerHTML = '<div class="empty">新建 index.html，或导入网站文件。</div>'; return; }
    if (view === 'visual') { visualEditor(); return; }
    $('ws-file-editor').innerHTML = `<div class="ws-code-heading"><span class="mono">${e(current.path)}</span><div><button class="text-btn" data-ws="rename-file">重命名</button><button class="text-btn ws-danger" data-ws="remove-file">移除</button></div></div>${current.encoding === 'base64' ? `<div class="ws-binary"><span>▧</span><h3>${e(current.path)}</h3><p>二进制资源 · ${Math.round(current.content.length * 0.75 / 1024)} KB</p><p>在 HTML 或 CSS 中使用相对路径引用此文件。</p></div>` : '<textarea id="ws-code" class="ws-code" spellcheck="false" autocapitalize="off" autocomplete="off" aria-label="网站文件代码"></textarea>'}`;
    if ($('ws-code')) { $('ws-code').value = current.content; $('ws-code').addEventListener('input', () => { current.content = $('ws-code').value; setDirty(); }); $('ws-code').addEventListener('keydown', event => { if (event.key === 'Tab') { event.preventDefault(); const node = event.target, start = node.selectionStart, end = node.selectionEnd; node.setRangeText('  ', start, end, 'end'); current.content = node.value; setDirty(); } }); }
  }
  function visualDocument() {
    const html = site.files.find(item => item.path === 'index.html' && item.encoding !== 'base64');
    if (!html) return null;
    const doc = new DOMParser().parseFromString(html.content, 'text/html');
    const nodes = [...doc.body.querySelectorAll('h1,h2,h3,h4,p,a,button,li,span,label,small,strong')].filter(node => !node.children.length && !node.closest('script,style,template'));
    return { html, doc, nodes };
  }
  function visualEditor() {
    const parsed = visualDocument();
    if (!parsed?.nodes.length) { $('ws-file-editor').innerHTML = '<div class="empty">首页没有可编辑的文字元素，请切换到代码编辑。</div>'; return; }
    selection = Math.min(selection, parsed.nodes.length - 1);
    const selected = parsed.nodes[selection];
    $('ws-file-editor').innerHTML = `<div class="ws-visual"><h3>编辑首页文字与链接</h3><p>选择元素修改内容，布局和样式可以在代码中自由调整。</p><label>选择内容<select id="ws-element">${parsed.nodes.map((node, index) => `<option value="${index}" ${index === selection ? 'selected' : ''}>${e(node.tagName.toLowerCase())} · ${e(node.textContent.slice(0, 65))}</option>`).join('')}</select></label><label>文字内容<textarea id="ws-element-text" rows="5"></textarea></label>${selected.tagName === 'A' ? '<label>链接地址<input id="ws-element-href" placeholder="https://example.com 或 #section"></label>' : ''}<button class="btn" data-ws="apply-element">应用到草稿</button><p class="helper">修改后请保存并刷新预览，确认后再发布。</p></div>`;
    $('ws-element-text').value = selected.textContent;
    if ($('ws-element-href')) $('ws-element-href').value = selected.getAttribute('href') || '';
    const apply = () => {
      selected.textContent = $('ws-element-text').value;
      if ($('ws-element-href')) selected.setAttribute('href', $('ws-element-href').value);
      parsed.html.content = '<!doctype html>\n' + parsed.doc.documentElement.outerHTML;
      setDirty();
    };
    $('ws-element-text').addEventListener('input', apply);
    $('ws-element-href')?.addEventListener('input', apply);
    $('ws-element').addEventListener('change', event => { selection = Number(event.target.value); visualEditor(); });
  }
  function updateBusy() {
    const locked = busy || loading;
    root.querySelectorAll('button[data-ws]').forEach(button => { button.disabled = locked; });
    root.querySelectorAll('input,textarea,select').forEach(node => { node.disabled = locked; });
    if (site && !site.published) root.querySelector('[data-ws="unpublish"]').disabled = true;
    const generate = root.querySelector('[data-ws="generate"]');
    if (generate) { generate.disabled = locked || !(data.models?.ready || data.models?.models?.length); generate.textContent = generationRunning ? '正在生成…' : '✦ 生成网站'; }
    if ($('ws-code')) $('ws-code').readOnly = busy;
    if ($('ws-prompt')) $('ws-prompt').disabled = busy;
    if (data && $('ws-tunnel-badge')) hosting();
  }
  async function load() {
    if (loading || busy) return;
    loading = true;
    updateBusy();
    try {
      data = await api('/api/websites');
      if (!$('ws-list')) shell();
      if (site && !dirty) { try { site = await api(`/api/websites/${site.id}`); } catch (error) { if (!data.sites.some(item => item.id === site.id)) site = null; else throw error; } }
      if (!site && data.sites.length) site = await api(`/api/websites/${data.sites[0].id}`);
      list(); if (!dirty) editor(); hosting(); showError();
    } catch (error) { if (!$('ws-list')) shell(); showError(error.message); }
    finally { loading = false; updateBusy(); }
  }
  async function refreshHosting() {
    if (busy || loading || !$('ws-list')) return;
    try { const fresh = await api('/api/websites'); data.hosting = fresh.hosting; data.models = fresh.models; hosting(); }
    catch (error) { showError(error.message); }
  }
  async function updateList() { const fresh = await api('/api/websites'); data = fresh; list(); hosting(); }
  async function save() {
    if (!site || !dirty) return;
    site = await post(`/api/websites/${site.id}`, { name: site.name, slug: site.slug, description: site.description, files: site.files, revision: site.revision });
    setDirty(false); await updateList();
  }
  async function preview() {
    await save();
    const result = await post(`/api/websites/${site.id}/preview`, { revision: site.revision });
    previewUrl = result.url;
    $('ws-preview-panel').hidden = false; $('ws-preview-frame').src = previewUrl; $('ws-preview-open').href = previewUrl;
    $('ws-preview-panel').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  function projectDialog(edit = false) {
    if (!canLeave()) return;
    $('ws-dialog-title').textContent = edit ? '网站设置' : '创建网站';
    $('ws-project-form').dataset.edit = edit ? 'true' : '';
    $('ws-name').value = edit ? site.name : '';
    $('ws-slug').value = edit ? site.slug : `website-${Date.now().toString(36)}`;
    $('ws-description').value = edit ? site.description : '';
    $('ws-template-field').hidden = edit;
    $('ws-dialog-error').textContent = ''; $('ws-project-submit').textContent = edit ? '保存设置' : '创建网站';
    $('ws-dialog').showModal(); $('ws-name').focus();
  }
  async function submitProject(event) {
    event.preventDefault();
    if (busy || loading) return;
    busy = true; updateBusy();
    const button = $('ws-project-submit'); button.disabled = true;
    try {
      const input = { name: $('ws-name').value.trim(), slug: $('ws-slug').value.trim(), description: $('ws-description').value.trim() };
      if ($('ws-project-form').dataset.edit) {
        // A settings change saves the current draft too, never the published snapshot.
        site = await post(`/api/websites/${site.id}`, { ...input, files: site.files, revision: site.revision });
      } else site = await post('/api/websites', { ...input, files: starterFiles(input, $('ws-template').value) });
      dirty = false; activeFile = 'index.html'; $('ws-dialog').close(); await updateList(); editor(); toast('网站草稿已保存。');
    } catch (error) { $('ws-dialog-error').textContent = error.message; }
    finally { busy = false; updateBusy(); button.disabled = false; }
  }
  async function uploadFiles(event) {
    const incoming = [...event.target.files]; event.target.value = '';
    if (!site || !incoming.length) return;
    busy = true; updateBusy();
    try {
      const files = await Promise.all(incoming.map(async item => {
        if (item.size > 5 * 1024 * 1024) throw new Error(`${item.name} 超过 5 MB。`);
        const binary = /\.(?:png|jpe?g|gif|webp|avif|ico|woff2?|ttf|otf)$/i.test(item.name);
        const content = binary ? await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1]); reader.onerror = reject; reader.readAsDataURL(item); }) : await item.text();
        return { path: item.webkitRelativePath || item.name, content, encoding: binary ? 'base64' : 'utf8' };
      }));
      if (files.some(item => site.files.some(existing => existing.path === item.path)) && !window.confirm('导入包含同名文件，是否覆盖草稿中的这些文件？')) return;
      const merged = new Map(site.files.map(item => [item.path, item])); files.forEach(item => merged.set(item.path, item));
      site.files = [...merged.values()]; activeFile = files[0].path; setDirty(); renderFiles(); toast('文件已加入草稿，请保存后预览。');
    } catch (error) { showError(error.message || '文件读取失败。'); }
    finally { busy = false; updateBusy(); }
  }
  async function importProject(event) {
    const incoming = event.target.files[0]; event.target.value = '';
    if (!incoming || !canLeave()) return;
    busy = true; updateBusy();
    try {
      if (incoming.size > 8_000_000) throw new Error('导入文件超过大小限制。');
      const input = JSON.parse(await incoming.text());
      if (input.schemaVersion !== 1 || !Array.isArray(input.files)) throw new Error('请选择从网站管理导出的 JSON 文件。');
      site = await post('/api/websites', { name: input.name, slug: `${String(input.slug).slice(0, 40)}-${Date.now().toString(36)}`, description: input.description, files: input.files });
      dirty = false; activeFile = 'index.html'; await updateList(); editor(); toast('网站已导入为新草稿。');
    } catch (error) { showError(error.message); }
    finally { busy = false; updateBusy(); }
  }
  root.addEventListener('click', async event => {
    const button = event.target.closest('[data-ws]'); if (!button || button.disabled) return;
    const action = button.dataset.ws;
    if (busy || loading) return;
    if (action === 'create') return projectDialog();
    if (action === 'settings') return projectDialog(true);
    if (action === 'dialog-close') return $('ws-dialog').close();
    if (action === 'import-project') { if (canLeave()) $('ws-import-input').click(); return; }
    if (action === 'upload') return $('ws-file-input').click();
    if (action === 'file') { activeFile = button.dataset.path; renderFiles(); return; }
    if (action === 'code' || action === 'visual') { view = action; root.querySelectorAll('.ws-tabs button').forEach(node => node.classList.toggle('active', node.dataset.ws === view)); renderFiles(); return; }
    if (action === 'add-file') {
      const name = window.prompt('文件路径，例如 about.html、styles.css 或 assets/app.js');
      if (!name) return; if (site.files.some(item => item.path === name)) return showError('此路径已存在。');
      site.files.push({ path: name, content: '', encoding: 'utf8' }); activeFile = name; setDirty(); renderFiles(); return;
    }
    if (action === 'rename-file') {
      const name = window.prompt('新的文件路径', activeFile); if (!name || name === activeFile) return;
      if (site.files.some(item => item.path === name)) return showError('此路径已存在。');
      file().path = name; activeFile = name; setDirty(); renderFiles(); return;
    }
    if (action === 'remove-file') { if (window.confirm(`从草稿移除 ${activeFile}？`)) { site.files = site.files.filter(item => item.path !== activeFile); activeFile = site.files[0]?.path || ''; setDirty(); renderFiles(); } return; }
    if (action === 'apply-element') {
      const parsed = visualDocument(), selected = parsed?.nodes[selection]; if (!selected) return;
      selected.textContent = $('ws-element-text').value;
      if ($('ws-element-href')) selected.setAttribute('href', $('ws-element-href').value);
      parsed.html.content = '<!doctype html>\n' + parsed.doc.documentElement.outerHTML; setDirty(); toast('文字已更新到草稿。'); return;
    }
    if (action === 'mobile' || action === 'desktop') { $('ws-preview-frame').classList.toggle('mobile', action === 'mobile'); return; }
    if (action === 'copy-url') { try { await navigator.clipboard.writeText(urlFor(site)); toast('公网网址已复制。'); } catch { showError('复制失败，请手动选中网址复制。'); } return; }
    busy = true; showError(); updateBusy();
    try {
      if (action === 'select') {
        busy = false; if (!canLeave()) return; busy = true;
        site = await api(`/api/websites/${button.dataset.id}`); dirty = false; activeFile = 'index.html'; editor(); list();
      }
      if (action === 'save') { await save(); editor(); toast('草稿已保存。'); }
      if (action === 'preview') await preview();
      if (action === 'publish') {
        await save();
        if (!window.confirm('将当前已保存草稿发布到网站网址？知道公网网址的任何人都可以访问。')) return;
        site = await post(`/api/websites/${site.id}/publish`, { revision: site.revision });
        await updateList(); editor(); toast(urlFor(site) ? '网站已发布，公网网址可以直接访问。' : '网站已在本机发布，开启公网访问即可获取外网网址。');
      }
      if (action === 'unpublish' || action === 'delete') {
        if (!window.confirm(action === 'delete' ? '确定永久删除此网站及其所有草稿和发布文件？' : '确定下架网站？访客网址将无法再打开，草稿会保留。')) return;
        if (action === 'unpublish') await save();
        await post(`/api/websites/${site.id}/${action}`, { revision: site.revision, confirmation: site.id });
        if (action === 'delete') { site = null; dirty = false; await updateList(); editor(); }
        else { site = await api(`/api/websites/${site.id}`); await updateList(); editor(); }
        toast(action === 'delete' ? '网站已删除。' : '网站已下架。');
      }
      if (action === 'tunnel-start') { await post('/api/website-hosting/start', {}); await updateList(); toast('公网通道正在连接，连接成功后会显示 HTTPS 网址。'); }
      if (action === 'tunnel-stop') { if (!window.confirm('关闭后，所有网站的临时公网网址将无法访问。确定继续？')) return; await post('/api/website-hosting/stop', { confirmation: 'stop' }); await updateList(); }
      if (action === 'generate') {
        const prompt = $('ws-prompt').value.trim(), modelKey = $('ws-model').value;
        if (!prompt) throw new Error('请先填写网站需求。');
        await save(); generationRunning = true; updateBusy();
        $('ws-ai-state').textContent = '模型正在生成，完成后会保存为草稿。请保持页面打开。';
        const result = await post(`/api/websites/${site.id}/generate`, { prompt, modelKey: modelKey || undefined, revision: site.revision, requestId: `website_${crypto.randomUUID()}` });
        site = result.site; dirty = false; activeFile = 'index.html'; await updateList(); editor(); await preview(); toast(`AI 草稿已保存 · ${result.model}`);
      }
    } catch (error) { showError(error.message); }
    finally { busy = false; generationRunning = false; updateBusy(); }
  });
  window.addEventListener('beforeunload', event => { if (dirty || busy) { event.preventDefault(); event.returnValue = ''; } });
  window.addEventListener('keydown', event => { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's' && !document.getElementById('page-websites').hidden) { event.preventDefault(); root.querySelector('[data-ws="save"]')?.click(); } });
  return { load, refreshHosting, canLeave, isDirty: () => dirty };

  function starterFiles(input, template) {
    const name = e(input.name), description = e(input.description || '在这里，介绍你的产品、想法与作品。');
    if (template === 'blank') return [{ path: 'index.html', content: `<!doctype html>\n<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${name}</title></head><body><h1>${name}</h1><p>${description}</p></body></html>`, encoding: 'utf8' }];
    const personal = template === 'portfolio';
    return [{ path: 'index.html', encoding: 'utf8', content: `<!doctype html>
<html lang="zh-CN">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="description" content="${description}"><title>${name}</title><link rel="stylesheet" href="styles.css"></head>
<body>
  <header><a class="brand" href="#">${name}</a><nav><a href="#about">${personal ? '关于我' : '关于我们'}</a><a href="#details">${personal ? '我的方向' : '核心价值'}</a></nav></header>
  <main>
    <section class="hero"><span class="eyebrow">${personal ? 'IDEAS / CRAFT / EVERYDAY' : 'A NEW PERSPECTIVE'}</span><h1>${name}</h1><p>${description}</p><a class="button" href="#about">进一步了解 <span aria-hidden="true">↗</span></a><div class="hero-art" aria-hidden="true"><i></i><b></b><em></em><span>CREATE<br>SOMETHING<br>THAT MATTERS.</span></div></section>
    <section id="about" class="about"><span class="eyebrow">01 / ABOUT</span><h2>${personal ? '把热爱变成作品。' : '让每一个好想法，向前一步。'}</h2><p>${description}</p><p>这是你的网站。你可以在编辑器中自由调整文字、颜色、布局与交互，加入自己的图片和页面。</p></section>
    <section id="details" class="details"><span class="eyebrow">02 / OUR FOCUS</span><h2>${personal ? '专注于我所热爱的事。' : '用心做好每一个细节。'}</h2><div class="cards"><article><span>01</span><h3>清晰的表达</h3><p>用你自己的语言，向访客介绍网站的主题和价值。</p></article><article><span>02</span><h3>有用的内容</h3><p>添加真实的介绍、作品、产品信息或资源链接。</p></article><article><span>03</span><h3>持续的创造</h3><p>随时编辑草稿，准备好后发布最新内容。</p></article></div></section>
  </main><footer><span>${name}</span><a href="#">回到顶部 ↑</a></footer>
</body></html>` }, { path: 'styles.css', encoding: 'utf8', content: `:root{--accent:${personal ? '#b84729' : '#415bdf'};--ink:#18212b;--paper:#f7f5ef}*{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;background:var(--paper);color:var(--ink);font-family:system-ui,-apple-system,"Segoe UI",sans-serif;line-height:1.7}a{color:inherit;text-decoration:none}header,footer{max-width:1200px;margin:auto;padding:28px 36px;display:flex;align-items:center;justify-content:space-between}header{border-bottom:1px solid #dddcd5}.brand{font-size:21px;font-weight:750}nav{display:flex;gap:30px;font-size:14px}main{max-width:1200px;margin:auto}.hero{position:relative;padding:110px 36px 120px;min-height:640px;overflow:hidden}.eyebrow{display:block;letter-spacing:.17em;font-size:11px;font-weight:700;color:var(--accent)}h1{font-size:clamp(42px,6vw,76px);letter-spacing:-.055em;line-height:1.15;max-width:58%;margin:25px 0}p{color:#5f6771}.hero>p{max-width:46%;font-size:18px;margin-bottom:34px}.button{display:inline-flex;gap:30px;align-items:center;padding:13px 22px;border-radius:6px;background:var(--accent);color:white;font-size:14px}.hero-art{position:absolute;width:33%;height:340px;right:5%;top:100px;background:var(--accent);border-radius:160px 160px 16px 16px;color:white;isolation:isolate;overflow:hidden}.hero-art i,.hero-art b,.hero-art em{position:absolute;border:1px solid #ffffff70;border-radius:50%;width:280px;height:280px;top:15px;left:60px}.hero-art b{top:80px;left:10px}.hero-art em{top:145px;left:-40px}.hero-art>span{position:absolute;bottom:28px;left:30px;font-size:19px;letter-spacing:.05em;font-weight:650;line-height:1.35}.about,.details{padding:70px 36px;border-top:1px solid #dddcd5}h2{font-size:clamp(28px,4vw,40px);line-height:1.4;letter-spacing:-.03em}.about p{max-width:750px}.cards{display:grid;grid-template-columns:repeat(3,1fr);gap:26px;margin-top:38px}.cards article{padding:30px;border:1px solid #dadbd5;border-radius:8px}.cards article>span{color:var(--accent);font-size:13px}.cards h3{font-size:19px}.cards p{font-size:14px}footer{border-top:1px solid #dddcd5;font-size:13px;color:#6a727b}@media(max-width:700px){header,footer{padding:22px}.hero{padding:65px 22px 36px;min-height:auto}h1,.hero>p{max-width:100%}.hero-art{position:relative;top:auto;right:auto;width:100%;height:250px;margin-top:50px;border-radius:100px 100px 10px 10px}.hero-art i{left:50%}.about,.details{padding:46px 22px}.cards{grid-template-columns:1fr}nav{gap:14px;font-size:12px}}` }];
  }
}
