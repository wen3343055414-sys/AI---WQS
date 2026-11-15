import { initApiSettings } from './api-settings.js';
import { initWebsites } from './websites.js';
const $ = id => document.getElementById(id);
const icon = name => `<svg aria-hidden="true"><use href="#i-${name}"/></svg>`;
const number = value => new Intl.NumberFormat('zh-CN').format(value || 0);
const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const pages = {
  overview: ['服务器总览', 'SERVER OVERVIEW', '从这里，了解本机服务的每一刻。'],
  services: ['服务管理', 'SERVICE MANAGEMENT', '独立管理前后端服务，掌握每一次启动与停止。'],
  logs: ['运行日志', 'RUNTIME LOGS', '跟随服务输出，快速了解当前运行情况。'],
  backups: ['数据备份', 'DATABASE BACKUPS', '为重要的数据，留一份安心。'],
  deployment: ['版本与更新', 'RELEASE MANAGEMENT', '每一次更新，都有检查和退路。'],
  audit: ['操作记录', 'ACTIVITY HISTORY', '管理操作有记录，运行过程可追溯。'],
  'api-settings': ['API 接口设置', 'MODEL API SETTINGS', '统一连接国内、海外与本机模型，让每次对话都有合适的选择。'],
  websites: ['域名与网站', 'DOMAINS & WEBSITES', '管理工作台的真实访问地址，让同一网络下的设备连接本机服务。'],
};
const actions = {
  start: ['启动工作台', '启动前后端容器，并检查服务是否正常。'],
  stop: ['停止工作台', '工作台将暂时无法访问，自动更新也会暂停。数据库和备份会保留，管理后台继续运行。'],
  restart: ['重启工作台', '前后端服务将短暂中断，正在保存的数据请先完成保存。数据库会被保留。'],
  update: ['检查并更新版本', '检查跟随分支，只部署通过同一提交 CI 验收的版本。'],
  backup: ['创建数据库备份', '创建数据库的一致性快照。'],
  rollback: ['回退上一版本', '先备份数据库，再切换到上一运行版本。业务内容保持当前数据，不会恢复到过去。'],
  pause: ['暂停自动更新', '暂停后不再启动新的定时更新检查。'],
  resume: ['恢复自动更新', '恢复每分钟一次的版本检查。'],
};
let csrf = '', setupRequired = false, authenticated = false, currentPage = 'overview';
let report = null, refreshPending = false, logPending = false, actionPending = false;
let cpuHistory = [], pendingAction = null, toastTimer, lastFinishedJob = null;
const date = (value, compact = false) => {
  if (!value) return '—';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '—';
  return new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', ...(compact ? {} : { year: 'numeric', second: '2-digit' }), hour12: false }).format(parsed);
};
function relative(value) {
  if (!value) return '暂无记录';
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(value)) / 60000));
  return minutes < 1 ? '刚刚' : minutes < 60 ? `${minutes} 分钟前` : minutes < 1440 ? `${Math.floor(minutes / 60)} 小时前` : `${Math.floor(minutes / 1440)} 天前`;
}
function bytes(value, precision = 1) {
  if (!Number.isFinite(value)) return '—';
  if (value < 1024) return `${value} B`;
  const units = ['KB', 'MB', 'GB', 'TB']; let result = value / 1024, unit = 0;
  while (result >= 1024 && unit < units.length - 1) { result /= 1024; unit++; }
  return `${result.toFixed(precision)} ${units[unit]}`;
}
function duration(seconds) {
  const value = Math.max(0, Math.floor(seconds || 0));
  if (value >= 86400) return `${Math.floor(value / 86400)} 天 ${Math.floor(value % 86400 / 3600)} 小时`;
  if (value >= 3600) return `${Math.floor(value / 3600)} 小时 ${Math.floor(value % 3600 / 60)} 分钟`;
  return `${Math.floor(value / 60)} 分钟`;
}
function parseBytes(value) {
  const match = String(value).match(/([\d.]+)\s*(B|KiB|MiB|GiB|TiB|kB|MB|GB|TB)/);
  if (!match) return 0;
  const exponent = { B: 0, KiB: 1, MiB: 2, GiB: 3, TiB: 4, kB: 1, MB: 2, GB: 3, TB: 4 }[match[2]];
  return Number(match[1]) * (match[2].includes('i') || match[2] === 'B' ? 1024 : 1000) ** exponent;
}
async function api(url, options = {}) {
  const headers = { ...(options.method === 'POST' ? { 'Content-Type': 'application/json', 'X-Admin-CSRF': csrf } : {}), ...options.headers };
  const response = await fetch(url, { ...options, headers });
  const data = await response.json();
  if (!response.ok) {
    if (response.status === 401 && authenticated) { authenticated = false; showAuth(false); }
    throw new Error(data.message || '请求未完成，请稍后重试。');
  }
  return data;
}
function toast(message) {
  clearTimeout(toastTimer); $('toast').textContent = message; $('toast').hidden = false;
  toastTimer = setTimeout(() => { $('toast').hidden = true; }, 5500);
}
function showAuth(setup) {
  setupRequired = setup; $('auth-view').hidden = false; $('app-view').hidden = true; $('auth-form').hidden = false;
  $('confirm-field').hidden = !setup; $('password-confirm').required = setup;
  $('password').setAttribute('autocomplete', setup ? 'new-password' : 'current-password');
  $('auth-title').textContent = setup ? '设置管理后台密码' : '欢迎回到管理后台';
  $('auth-description').textContent = setup ? '首次使用，为独立管理服务设置一个 10–128 位密码。' : '输入独立管理密码，查看并管理本机服务。';
  $('auth-submit').textContent = setup ? '设置密码并进入后台 →' : '进入管理后台 →';
}
async function enter() {
  authenticated = true; $('auth-view').hidden = true; $('app-view').hidden = false;
  const requested = location.hash.slice(1); navigate(pages[requested] ? requested : 'overview');
  await refresh();
}
$('auth-form').addEventListener('submit', async event => {
  event.preventDefault(); $('auth-error').textContent = '';
  const password = $('password').value;
  if (setupRequired && password !== $('password-confirm').value) { $('auth-error').textContent = '两次输入的密码不一致。'; return; }
  $('auth-submit').disabled = true;
  try {
    const result = await api(setupRequired ? '/api/setup' : '/api/login', { method: 'POST', body: JSON.stringify({ password }) });
    csrf = result.csrf; $('password').value = ''; $('password-confirm').value = ''; await enter();
  } catch (error) { $('auth-error').textContent = error.message; }
  finally { $('auth-submit').disabled = false; }
});
$('logout').addEventListener('click', async () => { if (currentPage === 'websites' && !websiteUI.canLeave()) return; try { await api('/api/logout', { method: 'POST', body: '{}' }); authenticated = false; csrf = ''; showAuth(false); } catch (error) { toast(error.message); } });
function navigate(page) {
  if (!pages[page]) return;
  if (currentPage === 'websites' && page !== currentPage && !websiteUI.canLeave()) return;
  currentPage = page;
  $('app-view').classList.toggle('domains-mode', page === 'websites');
  document.querySelectorAll('.page-panel').forEach(node => { node.hidden = node.id !== `page-${page}`; });
  document.querySelectorAll('.nav-item').forEach(node => { const selected = node.dataset.page === page; node.classList.toggle('active', selected); node.setAttribute('aria-current', selected ? 'page' : 'false'); });
  const [title, eyebrow, description] = pages[page];
  $('page-title').textContent = $('breadcrumb-page').textContent = title;
  $('page-eyebrow').textContent = eyebrow; $('page-description').textContent = description;
  document.title = `${title} · 智作台服务端`; history.replaceState(null, '', `#${page}`);
  if (page === 'logs' && authenticated) loadLogs();
  if (page === 'api-settings' && authenticated) modelUI.load();
  if (page === 'websites' && authenticated) websiteUI.load();
}
document.addEventListener('click', event => {
  const navigation = event.target.closest('[data-page]');
  if (navigation) navigate(navigation.dataset.page);
  const action = event.target.closest('[data-action]');
  if (action && !action.disabled) requestAction(action.dataset.action);
  const job = event.target.closest('[data-job]');
  if (job) showJob(job.dataset.job);
});
function badge(element, text, type) { element.textContent = text; element.className = `badge ${type}`; }
function renderServices(containers, detailed = false) {
  if (!containers.length) return '<div class="empty">未找到工作台容器。请检查 Docker 是否已启动。</div>';
  return containers.map(container => {
    const metric = report.stats.find(row => row.name === container.name);
    const healthy = container.state === 'running' && container.status.includes('(healthy)');
    const type = healthy ? 'success' : container.state === 'running' ? 'warning' : 'neutral';
    const label = healthy ? '运行正常' : container.state === 'running' ? '健康检查中' : '已停止';
    const name = container.service === 'backend' ? '后端服务' : '前端代理';
    return `<div class="service-row"><span class="service-symbol">${icon(container.service === 'backend' ? 'server' : 'grid')}</span><div class="service-name"><strong>${name}${detailed ? ' · ' + escape(container.name) : ''}</strong><small title="${escape(container.image)}">${escape(container.image)}</small>${detailed ? `<small>${escape(container.ports || '仅容器内部访问')} · ${escape(container.status)}</small>` : ''}</div><div class="service-stat"><strong>${escape(metric?.cpu || '—')}</strong>CPU 使用</div><div class="service-stat"><strong>${escape(metric?.memory?.split('/')[0].trim() || '—')}</strong>内存占用</div><span class="badge ${type}">${label}</span></div>`;
  }).join('');
}
function renderJobs(jobs) {
  if (!jobs.length) return '<div class="empty">暂无管理任务，操作后会显示在这里。</div>';
  return jobs.slice(0, 5).map(job => `<div class="activity-item"><span class="activity-mark">${icon(job.status === 'success' ? 'check' : job.status === 'running' ? 'refresh' : 'info')}</span><div class="activity-text"><strong>${escape(actions[job.action]?.[0] || job.action)}</strong><small>${escape(job.message)}</small></div><span class="activity-time">${relative(job.created)}</span><span class="badge ${job.status === 'success' ? 'success' : job.status === 'failed' ? 'failed' : 'neutral'}">${({ success: '已完成', running: '执行中', failed: '未完成', interrupted: '已中断' })[job.status] || job.status}</span><button class="text-btn" data-job="${escape(job.id)}">详情</button></div>`).join('');
}
function renderChart(cpu, timestamp) {
  if (!cpuHistory.length || cpuHistory.at(-1).time !== timestamp) cpuHistory.push({ value: cpu, time: timestamp });
  cpuHistory = cpuHistory.slice(-40);
  const max = Math.max(1, Math.ceil(Math.max(...cpuHistory.map(item => item.value)) * 1.3 * 10) / 10);
  const values = cpuHistory.length === 1 ? [cpuHistory[0], cpuHistory[0]] : cpuHistory;
  const points = values.map((item, index) => `${(index * 660 / (values.length - 1)).toFixed(1)},${(145 - item.value / max * 135).toFixed(1)}`).join(' ');
  $('chart-line').setAttribute('points', points); $('chart-area').setAttribute('points', `0,145 ${points} 660,145`);
  $('cpu-mini').setAttribute('points', values.map((item, index) => `${index * 180 / (values.length - 1)},${21 - item.value / max * 18}`).join(' '));
  $('chart-max').textContent = `${max}%`; $('chart-mid').textContent = `${(max / 2).toFixed(1)}%`;
  $('chart-start').textContent = date(cpuHistory[0].time, true); $('chart-end').textContent = '现在';
}
function render() {
  const r = report, containers = r.containers || [], files = r.backups?.files || [];
  const running = containers.filter(c => c.state === 'running').length;
  const healthy = r.application?.healthy;
  const cpu = (r.stats || []).reduce((sum, row) => sum + (parseFloat(row.cpu) || 0), 0);
  const memory = (r.stats || []).reduce((sum, row) => sum + parseBytes(row.memory.split('/')[0]), 0);
  const memoryPercent = (r.stats || []).reduce((sum, row) => sum + (parseFloat(row.memoryPercent) || 0), 0);
  renderModelUsage(r.modelUsage);
  modelUI.updateUsage(r.modelUsage);
  $('node-address').textContent = `127.0.0.1:${r.admin.port}`;
  $('open-workbench').href = r.appUrl;
  $('metric-status').textContent = !r.docker.available ? '未连接' : healthy ? '运行正常' : running ? '检查中' : '已停止';
  $('metric-status-detail').textContent = !r.docker.available ? '请先打开 Docker Desktop' : `${running} / ${containers.length} 个服务运行中`;
  $('metric-cpu').innerHTML = r.stats.length ? `${cpu.toFixed(2)}<small>%</small>` : '—';
  $('metric-cpu-detail').textContent = `${r.host.cpuCount} 核本机 · 容器合计使用率`;
  $('metric-memory').innerHTML = r.stats.length ? escape(bytes(memory)) : '—';
  $('metric-memory-detail').textContent = `占可用容器内存 ${memoryPercent.toFixed(2)}%`;
  $('memory-meter').value = Math.min(100, memoryPercent);
  $('metric-backups').innerHTML = `${files.length}<small>份</small>`;
  $('metric-backup-detail').textContent = files[0] ? `最近一次 · ${relative(files[0].modifiedAt)}` : r.backups.error ? '暂时无法读取备份' : '尚未创建备份';
  $('nav-service-count').textContent = containers.length; $('services-total').textContent = `${containers.length} 个服务`;
  $('overview-services').innerHTML = renderServices(containers); $('detailed-services').innerHTML = renderServices(containers, true);
  $('deployment-summary').textContent = `当前版本 ${r.deployment.sha?.slice(0, 7) || '—'} · ${r.project}`;
  badge($('services-badge'), healthy ? '健康检查通过' : '等待服务', healthy ? 'success' : 'neutral');
  const schedulerText = r.scheduler.error ? '无法读取' : r.scheduler.enabled ? '已启用' : '已暂停';
  for (const id of ['auto-update-badge', 'deploy-scheduler-badge']) badge($(id), schedulerText, r.scheduler.enabled ? 'success' : 'neutral');
  $('sidebar-branch').textContent = r.branch; $('sidebar-deployed').textContent = date(r.deployment.updatedAt, true); $('sidebar-version').textContent = r.deployment.sha?.slice(0, 7) || '—';
  $('host-cpus').textContent = `${r.host.cpuCount} 核`; $('host-memory').textContent = `${bytes(r.host.memoryUsed)} / ${bytes(r.host.memoryTotal)}`;
  $('host-uptime').textContent = duration(r.host.uptimeSeconds); $('admin-uptime').textContent = duration(r.admin.uptimeSeconds);
  $('admin-details').innerHTML = [['访问地址', `127.0.0.1:${r.admin.port}`], ['进程 ID', r.admin.pid], ['管理服务内存', bytes(r.admin.memoryBytes)], ['连续运行', duration(r.admin.uptimeSeconds)]].map(([key, value]) => `<div><span>${key}</span><strong>${escape(value)}</strong></div>`).join('');
  $('backup-count').textContent = `${files.length} 份`; $('backup-size').textContent = bytes(files.reduce((sum, file) => sum + file.size, 0)); $('database-size').textContent = bytes(r.backups.databaseBytes);
  $('backup-table').innerHTML = files.length ? files.map(file => `<tr><td><span class="mono">${escape(file.name)}</span><small>SQLite 数据库快照</small></td><td>${date(file.modifiedAt)}</td><td>${bytes(file.size)}</td><td class="right"><a href="/api/backups/${encodeURIComponent(file.name)}" download>${icon('download')}下载</a></td></tr>`).join('') : '<tr><td colspan="4" class="empty">暂无可显示的备份文件</td></tr>';
  $('backup-error').hidden = !r.backups.error; $('backup-error').textContent = r.backups.error || '';
  $('current-sha').textContent = r.deployment.sha?.slice(0, 12) || '尚未部署';
  if (/^[\w.-]+\/[\w.-]+$/.test(r.repository)) $('commit-link').href = `https://github.com/${r.repository}/commit/${r.deployment.sha}`;
  $('deployment-details').innerHTML = [['代码仓库', r.repository], ['跟随分支', r.branch], ['Docker 前后端版本', r.deployment.sha?.slice(0, 12) || '—'], ['独立服务端版本', r.admin.revision?.slice(0, 12) || '本机版本'], ['版本一致性', r.admin.revision === r.deployment.sha ? '前端、后端与管理服务使用同一提交' : '等待管理服务切换或核查'], ['部署项目', r.project], ['上次部署', date(r.deployment.updatedAt)], ['上一版本', r.deployment.previous?.slice(0, 12) || '暂无'], ['最近备份', date(r.deployment.lastBackup)]].map(([key, value]) => `<div><dt>${key}</dt><dd>${escape(value)}</dd></div>`).join('');
  $('recent-jobs').innerHTML = renderJobs(r.jobs); $('deployment-jobs').innerHTML = renderJobs(r.jobs);
  $('audit-table').innerHTML = r.audit.length ? r.audit.map(entry => `<tr><td>${date(entry.time)}</td><td>${escape(actions[entry.action]?.[0] || ({ login: '管理后台登录', setup: '初始化管理后台', download: '下载数据库备份', api_settings_save: '保存 API 接口设置', api_connection_test: '检测模型目录', api_model_add: '添加模型', api_model_update: '更新模型', api_default_model: '设置默认模型', api_provider_delete: '删除模型连接', api_model_delete: '移除模型' })[entry.action] || entry.action)}</td><td><span class="badge ${entry.result === 'success' ? 'success' : entry.result === 'failed' ? 'failed' : 'neutral'}">${({ success: '成功', failed: '未完成', started: '已开始', interrupted: '已中断' })[entry.result] || entry.result}</span></td><td>${escape(entry.detail || '—')}</td></tr>`).join('') : '<tr><td colspan="4" class="empty">暂无操作记录</td></tr>';
  const busy = actionPending || r.jobs.some(job => job.status === 'running');
  document.querySelectorAll('[data-action]').forEach(button => {
    const action = button.dataset.action;
    button.disabled = busy || (action === 'rollback' && !r.deployment.previous) || (action === 'pause' && !r.scheduler.enabled) || (action === 'resume' && (r.scheduler.enabled || r.maintenance?.stoppedByAdmin));
  });
  const currentJob = r.jobs.find(job => job.status === 'running');
  $('job-notice').hidden = !currentJob;
  $('job-notice').textContent = currentJob ? `${actions[currentJob.action]?.[0] || '操作'}正在执行。你可以留在本页等待，或在操作记录中查看结果。` : '';
  const finished = r.jobs.find(job => job.status !== 'running');
  if (lastFinishedJob && finished && finished.id !== lastFinishedJob) toast(finished.message);
  if (finished) lastFinishedJob = finished.id;
  const errors = [r.previewOnly && '界面验收环境：本页用于检查布局和交互，操作不会影响真实服务。', !r.docker.available && '未连接到 Docker 引擎，请打开 Docker Desktop。管理服务仍可访问。', r.scheduler.error].filter(Boolean);
  $('connection-error').hidden = !errors.length; $('connection-error').textContent = errors.join(' ');
  $('last-refreshed').innerHTML = `<i class="live-dot"></i>更新于 ${escape(date(r.updatedAt, true))}`;
  if (r.stats.length) renderChart(cpu, r.updatedAt);
}
function renderModelUsage(usage) {
  if (!usage) return;
  const { model, today, total } = usage;
  badge($('model-ready-badge'), model.ready ? '真实模型已配置' : '等待配置', model.ready ? 'success' : 'warning');
  $('model-active-description').textContent = model.ready ? `${model.provider} · ${model.model} · 保存配置后自动同步到工作台` : model.message;
  $('token-today').textContent = number(today.totalTokens);
  $('token-total').textContent = number(total.totalTokens);
  $('token-today-requests').textContent = `今日 ${number(today.requests)} 次请求 · 北京时间`;
  $('token-total-requests').textContent = usage.since ? `共 ${number(total.requests)} 次 · 起始 ${date(usage.since, true)}` : '首次请求后开始累计';
  $('token-input-output').textContent = `${number(total.promptTokens)} / ${number(total.completionTokens)}`;
  $('token-cached').textContent = `输入缓存命中 ${number(total.cachedTokens)} Token（已包含在输入中）`;
  $('token-results').textContent = `${number(total.succeeded)} 成功 / ${number(total.failed)} 失败`;
  const unknown = total.requests - total.meteredRequests;
  $('token-missing').textContent = `${number(total.pending)} 次进行中 · ${number(unknown)} 次未取得用量`;
  $('token-recent').innerHTML = usage.recent.length ? usage.recent.map(item => `<tr><td>${date(item.time, true)}${item.error ? `<small title="${escape(item.error)}">${escape(item.error)}</small>` : ''}</td><td class="mono">${escape(item.model)}</td><td><span class="badge ${item.status === 'success' ? 'success' : item.status === 'failed' ? 'failed' : 'neutral'}">${({ success: '已回复', failed: '失败', pending: '进行中', unknown: '结果未确认' })[item.status]}</span></td><td>${item.promptTokens === null ? '—' : number(item.promptTokens)}</td><td>${item.completionTokens === null ? '—' : number(item.completionTokens)}</td><td>${item.totalTokens === null ? '—' : number(item.totalTokens)}</td><td>${item.latencyMs === null ? '—' : `${(item.latencyMs / 1000).toFixed(1)} s`}</td></tr>`).join('') : '<tr><td colspan="7" class="empty">尚无模型请求。前往工作台发送第一条消息。</td></tr>';
}
async function refresh() {
  if (!authenticated || refreshPending) return;
  refreshPending = true; $('refresh').classList.add('spinning');
  try { report = await api('/api/overview'); render(); }
  catch (error) { $('connection-error').hidden = false; $('connection-error').textContent = error.message; }
  finally { refreshPending = false; $('refresh').classList.remove('spinning'); }
}
$('refresh').addEventListener('click', () => { refresh(); if (currentPage === 'websites') websiteUI.load(); });
async function loadLogs() {
  if (!authenticated || logPending) return;
  logPending = true; $('log-refresh').disabled = true;
  try {
    const source = $('log-source').value;
    const result = await api(`/api/logs?source=${encodeURIComponent(source)}&lines=${$('log-lines').value}`);
    $('log-output').textContent = result.text || '该服务暂无日志输出。';
    $('log-file-label').textContent = `${source}.log`; $('log-updated').textContent = `更新于 ${date(result.updatedAt)}`;
  } catch (error) { $('log-output').textContent = error.message; }
  finally { logPending = false; $('log-refresh').disabled = false; }
}
for (const id of ['log-source', 'log-lines']) $(id).addEventListener('change', loadLogs);
$('log-refresh').addEventListener('click', loadLogs);
function requestAction(action) {
  if (!actions[action] || actionPending) return;
  if (!['stop', 'restart', 'rollback'].includes(action)) { performAction(action); return; }
  pendingAction = action; $('confirm-title').textContent = actions[action][0]; $('confirm-description').textContent = actions[action][1];
  $('confirm-accept').className = action === 'stop' ? 'btn danger' : 'btn primary'; $('confirm-dialog').showModal();
}
$('confirm-cancel').addEventListener('click', () => { pendingAction = null; $('confirm-dialog').close(); });
$('confirm-accept').addEventListener('click', () => { const action = pendingAction; pendingAction = null; $('confirm-dialog').close(); performAction(action); });
async function performAction(action) {
  if (actionPending) return;
  actionPending = true; document.querySelectorAll('[data-action]').forEach(button => { button.disabled = true; });
  try {
    const result = await api('/api/actions', { method: 'POST', body: JSON.stringify({ action, confirmation: action }) });
    toast(result.message); await refresh();
  } catch (error) { toast(error.message); }
  finally { actionPending = false; if (report) render(); }
}
function showJob(id) {
  const job = report?.jobs.find(item => item.id === id); if (!job) return;
  $('job-dialog-title').textContent = actions[job.action]?.[0] || job.action;
  $('job-dialog-message').textContent = `${date(job.created)} · ${job.message}`;
  $('job-dialog-output').textContent = job.output || (job.status === 'running' ? '操作正在后台执行，完成后将显示输出。' : '此操作没有额外日志输出。');
  $('job-dialog').showModal();
}
$('job-close').addEventListener('click', () => $('job-dialog').close());

const modelUI = initApiSettings({ api, toast, escape, icon, date, number });
const websiteUI = initWebsites({ api, toast, escape, icon, date });
setInterval(() => { if (!document.hidden) { refresh(); if (currentPage === 'logs' && $('log-follow').checked) loadLogs(); if (currentPage === 'websites' && authenticated) websiteUI.refreshHosting(); } }, 8000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
try {
  const session = await api('/api/session'); csrf = session.csrf || ''; $('node-address').textContent = `127.0.0.1:${session.port}`;
  if (session.authenticated) await enter(); else showAuth(session.setupRequired);
} catch (error) { $('auth-title').textContent = '暂时无法连接管理服务'; $('auth-description').textContent = `${error.message} 请刷新页面重试。`; }
