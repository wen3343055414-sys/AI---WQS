import { initApiSettings } from './api-settings.js';
import { initWebsites } from './websites.js';
const $ = id => document.getElementById(id);
const icon = name => `<svg aria-hidden="true"><use href="#i-${name}"/></svg>`;
const number = value => new Intl.NumberFormat('zh-CN').format(value || 0);
const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const pages = {
  overview: '服务器总览',
  services: '服务管理',
  logs: '运行日志',
  backups: '数据备份',
  deployment: '版本与更新',
  audit: '操作记录',
  'api-settings': 'API 接口设置',
  websites: '域名与网站',
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
let report = null, refreshPending = false, logRequest = null, actionPending = false;
const mobile = matchMedia('(max-width: 760px)');
const menu = $('admin-menu'), sidebar = $('admin-sidebar');
function setMenu(open, restoreFocus = false) {
  const expanded = mobile.matches && open;
  menu.hidden = !mobile.matches;
  menu.setAttribute('aria-expanded', String(expanded));
  menu.setAttribute('aria-label', expanded ? '收起后台导航' : '展开后台导航');
  sidebar.classList.toggle('is-open', expanded);
  sidebar.inert = mobile.matches && !expanded;
  $('admin-nav-backdrop').hidden = !expanded;
  $('admin-main').inert = expanded;
  document.querySelector('.top-actions').inert = expanded;
  document.body.classList.toggle('admin-nav-open', expanded);
  if (expanded) sidebar.querySelector('.nav-item.active')?.focus();
  else if (restoreFocus) menu.focus();
}
menu.addEventListener('click', () => setMenu(menu.getAttribute('aria-expanded') !== 'true', true));
$('admin-nav-backdrop').addEventListener('click', () => setMenu(false, true));
mobile.addEventListener('change', () => setMenu(false));
document.addEventListener('keydown', event => {
  if (menu.getAttribute('aria-expanded') !== 'true') return;
  if (event.key === 'Escape') {
    event.preventDefault();
    setMenu(false, true);
  } else if (event.key === 'Tab') {
    const first = sidebar.querySelector('button');
    if (!event.shiftKey && document.activeElement === menu) {
      event.preventDefault();
      first.focus();
    } else if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      menu.focus();
    }
  }
});
setMenu(false);
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
  setMenu(false);
  $('auth-title').textContent = setup ? '设置管理密码' : '登录';
  $('auth-description').textContent = setup ? '使用 10–128 个字符的独立管理密码。' : '';
  $('auth-description').hidden = !setup;
  $('auth-submit').textContent = setup ? '设置密码并登录' : '登录';
  $('password').focus();
}
async function enter() {
  authenticated = true; $('auth-view').hidden = true; $('app-view').hidden = false;
  const requested = location.hash.slice(1);
  navigate(Object.hasOwn(pages, requested) ? requested : 'overview');
  await refresh();
}
$('auth-form').addEventListener('submit', async event => {
  event.preventDefault(); $('auth-error').textContent = '';
  const password = $('password').value;
  if (setupRequired && password !== $('password-confirm').value) { $('auth-error').textContent = '两次输入的密码不一致。'; return; }
  const submit = $('auth-submit'), label = submit.textContent;
  submit.disabled = true;
  submit.textContent = '正在登录…';
  try {
    const result = await api(setupRequired ? '/api/setup' : '/api/login', { method: 'POST', body: JSON.stringify({ password }) });
    csrf = result.csrf; $('password').value = ''; $('password-confirm').value = ''; await enter();
  } catch (error) { $('auth-error').textContent = error.message; }
  finally { submit.disabled = false; submit.textContent = label; }
});
$('logout').addEventListener('click', async () => { if (currentPage === 'websites' && !websiteUI.canLeave()) return; try { await api('/api/logout', { method: 'POST', body: '{}' }); authenticated = false; csrf = ''; showAuth(false); } catch (error) { toast(error.message); } });
function navigate(page) {
  if (!Object.hasOwn(pages, page)) return;
  if (currentPage === 'websites' && page !== currentPage && !websiteUI.canLeave()) return false;
  currentPage = page;
  document.querySelectorAll('.page-panel').forEach(node => { node.hidden = node.id !== `page-${page}`; });
  document.querySelectorAll('.nav-item').forEach(node => { const selected = node.dataset.page === page; node.classList.toggle('active', selected); node.setAttribute('aria-current', selected ? 'page' : 'false'); });
  const title = pages[page];
  $('page-title').textContent = title;
  setMenu(false);
  document.title = `${title} · 智作台服务端`; history.replaceState(null, '', `#${page}`);
  if (page === 'logs' && authenticated) loadLogs();
  if (page === 'api-settings' && authenticated) modelUI.load();
  if (page === 'websites' && authenticated) websiteUI.load();
  return true;
}
document.addEventListener('click', event => {
  const navigation = event.target.closest('[data-page]');
  if (navigation && navigate(navigation.dataset.page)) $('page-title').focus({ preventScroll: true });
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
    return `<div class="service-row"><span class="service-symbol">${icon(container.service === 'backend' ? 'server' : 'grid')}</span><div class="service-name"><strong>${name}</strong>${detailed ? `<small title="${escape(container.image)}">${escape(container.image)}</small><small>${escape(container.ports || '仅容器内部访问')}</small>` : ''}</div><div class="service-stat"><strong>${escape(metric?.cpu || '—')}</strong>CPU 使用</div><div class="service-stat"><strong>${escape(metric?.memory?.split('/')[0].trim() || '—')}</strong>内存占用</div><span class="badge ${type}">${label}</span></div>`;
  }).join('');
}
function renderJobs(jobs) {
  if (!jobs.length) return '<div class="empty">暂无管理任务</div>';
  return jobs.slice(0, 5).map(job => {
    const status = { success: '已完成', running: '执行中', failed: '未完成', interrupted: '已中断' }[job.status] || job.status;
    const tone = job.status === 'success' ? 'success' : job.status === 'failed' ? 'failed' : 'neutral';
    return `<button type="button" class="activity-item" data-job="${escape(job.id)}">
      <span class="activity-text"><strong>${escape(actions[job.action]?.[0] || job.action)}</strong><small>${escape(job.message)}</small></span>
      <time class="activity-time" datetime="${escape(job.created)}">${date(job.created, true)}</time>
      <span class="badge ${tone}">${escape(status)}</span>${icon('arrow')}
    </button>`;
  }).join('');
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
  $('chart-start').textContent = date(cpuHistory[0].time, true);
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
  $('open-workbench').href = r.appUrl;
  $('metric-status').textContent = !r.docker.available ? '未连接' : healthy ? '运行正常' : running ? '检查中' : '已停止';
  $('metric-status-detail').textContent = !r.docker.available ? '请先打开 Docker Desktop' : `${running} / ${containers.length} 个服务运行中`;
  $('metric-cpu').innerHTML = r.stats.length ? `${cpu.toFixed(2)}<small>%</small>` : '—';
  $('metric-memory').innerHTML = r.stats.length ? escape(bytes(memory)) : '—';
  $('metric-memory-detail').textContent = r.stats.length ? `${memoryPercent.toFixed(1)}% 已用` : '';
  $('memory-meter').value = Math.min(100, memoryPercent);
  $('metric-backups').innerHTML = `${files.length}<small>份</small>`;
  $('metric-backup-detail').textContent = files[0] ? relative(files[0].modifiedAt) : r.backups.error ? '暂时无法读取备份' : '尚未创建备份';
  $('overview-services').innerHTML = renderServices(containers); $('detailed-services').innerHTML = renderServices(containers, true);
  badge($('services-badge'), $('metric-status').textContent, healthy ? 'success' : running ? 'warning' : 'neutral');
  const schedulerText = r.scheduler.error ? '无法读取' : r.scheduler.enabled ? '已启用' : '已暂停';
  for (const id of ['auto-update-badge', 'deploy-scheduler-badge']) badge($(id), schedulerText, r.scheduler.enabled ? 'success' : 'neutral');
  const schedulerAction = $('scheduler-action');
  schedulerAction.dataset.action = r.scheduler.enabled ? 'pause' : 'resume';
  schedulerAction.textContent = r.scheduler.enabled ? '暂停自动更新' : '恢复自动更新';
  $('sidebar-branch').textContent = r.branch; $('sidebar-deployed').textContent = date(r.deployment.updatedAt, true); $('sidebar-version').textContent = r.deployment.sha?.slice(0, 7) || '—';
  $('host-cpus').textContent = `${r.host.cpuCount} 核`; $('host-memory').textContent = `${bytes(r.host.memoryUsed)} / ${bytes(r.host.memoryTotal)}`;
  $('host-uptime').textContent = duration(r.host.uptimeSeconds); $('admin-uptime').textContent = duration(r.admin.uptimeSeconds);
  $('admin-details').innerHTML = [['访问地址', `127.0.0.1:${r.admin.port}`], ['进程 ID', r.admin.pid], ['管理服务内存', bytes(r.admin.memoryBytes)], ['连续运行', duration(r.admin.uptimeSeconds)]].map(([key, value]) => `<div><span>${key}</span><strong>${escape(value)}</strong></div>`).join('');
  $('backup-count').textContent = `${files.length} 份`; $('backup-size').textContent = bytes(files.reduce((sum, file) => sum + file.size, 0)); $('database-size').textContent = bytes(r.backups.databaseBytes);
  $('backup-table').innerHTML = files.length ? files.map(file => `<tr><td><span class="mono">${escape(file.name)}</span></td><td>${date(file.modifiedAt)}</td><td>${bytes(file.size)}</td><td class="right"><a href="/api/backups/${encodeURIComponent(file.name)}" download>${icon('download')}下载</a></td></tr>`).join('') : '<tr><td colspan="4" class="empty">暂无可显示的备份文件</td></tr>';
  $('backup-error').hidden = !r.backups.error; $('backup-error').textContent = r.backups.error || '';
  $('current-sha').textContent = r.deployment.sha?.slice(0, 12) || '尚未部署';
  if (/^[\w.-]+\/[\w.-]+$/.test(r.repository)) $('commit-link').href = `https://github.com/${r.repository}/commit/${r.deployment.sha}`;
  const detailRows = fields => fields.map(([key, value]) => `<div><dt>${key}</dt><dd>${escape(value)}</dd></div>`).join('');
  const containerVersion = service => {
    const container = containers.find(item => item.service === service && item.state === 'running');
    return container?.image?.match(/:([a-f0-9]{40})(?:-models-v1)?$/)?.[1].slice(0, 12) || '—';
  };
  $('release-summary').innerHTML = detailRows([
    ['跟随分支', r.branch], ['上次部署', date(r.deployment.updatedAt)], ['上一版本', r.deployment.previous?.slice(0, 12) || '—'],
  ]);
  $('deployment-details').innerHTML = detailRows([
    ['代码仓库', r.repository], ['前端容器版本', containerVersion('frontend')], ['后端容器版本', containerVersion('backend')],
    ['管理服务版本', r.admin.revision?.slice(0, 12) || '—'], ['部署项目', r.project], ['最近备份', date(r.deployment.lastBackup)],
  ]);
  const jobsMarkup = renderJobs(r.jobs);
  for (const id of ['recent-jobs', 'deployment-jobs']) {
    const target = $(id);
    if (target.innerHTML !== jobsMarkup && !target.contains(document.activeElement)) target.innerHTML = jobsMarkup;
  }
  $('audit-table').innerHTML = r.audit.length ? r.audit.map(entry => `<tr><td>${date(entry.time)}</td><td>${escape(actions[entry.action]?.[0] || ({ login: '管理后台登录', setup: '初始化管理后台', download: '下载数据库备份', api_settings_save: '保存 API 接口设置', api_connection_test: '检测模型目录', api_model_add: '添加模型', api_model_update: '更新模型', api_default_model: '设置默认模型', api_provider_delete: '删除模型连接', api_model_delete: '移除模型' })[entry.action] || entry.action)}</td><td><span class="badge ${entry.result === 'success' ? 'success' : entry.result === 'failed' ? 'failed' : 'neutral'}">${({ success: '成功', failed: '未完成', started: '已开始', interrupted: '已中断' })[entry.result] || entry.result}</span></td><td>${escape(entry.detail || '—')}</td></tr>`).join('') : '<tr><td colspan="4" class="empty">暂无操作记录</td></tr>';
  const busy = actionPending || r.jobs.some(job => job.status === 'running');
  document.querySelectorAll('[data-action]').forEach(button => {
    const action = button.dataset.action;
    button.disabled = busy || (button.id === 'scheduler-action' && (!r.scheduler.exists || Boolean(r.scheduler.error))) || (action === 'rollback' && !r.deployment.previous) || (action === 'pause' && !r.scheduler.enabled) || (action === 'resume' && (r.scheduler.enabled || r.maintenance?.stoppedByAdmin));
  });
  const currentJob = r.jobs.find(job => job.status === 'running');
  $('job-notice').hidden = !currentJob;
  $('job-notice').textContent = currentJob ? `${actions[currentJob.action]?.[0] || '操作'}进行中…` : '';
  const finished = r.jobs.find(job => job.status !== 'running');
  if (lastFinishedJob && finished && finished.id !== lastFinishedJob) toast(finished.message);
  if (finished) lastFinishedJob = finished.id;
  const errors = [r.previewOnly && '界面验收环境：本页用于检查布局和交互，操作不会影响真实服务。', !r.docker.available && '未连接 Docker。请打开 Docker Desktop。', r.scheduler.error].filter(Boolean);
  $('connection-error').hidden = !errors.length; $('connection-error').textContent = errors.join(' ');
  if (r.stats.length) renderChart(cpu, r.updatedAt);
}
function renderModelUsage(usage) {
  if (!usage) return;
  const { model, today, total } = usage;
  $('model-active-description').textContent = model.ready ? `${model.provider} · ${model.model}` : '尚未配置默认模型';
  $('token-today').textContent = number(today.totalTokens);
  $('token-total').textContent = number(total.totalTokens);
  $('token-today-requests').textContent = `${number(today.requests)} 次请求`;
  $('token-total-requests').textContent = usage.since ? `${number(total.requests)} 次请求` : '';
  $('token-input-output').textContent = `${number(total.promptTokens)} / ${number(total.completionTokens)}`;
  $('token-cached').textContent = total.cachedTokens ? `缓存命中 ${number(total.cachedTokens)}` : '';
  $('token-results').textContent = `${number(total.succeeded)} / ${number(total.failed)}`;
  const unknown = total.requests - total.meteredRequests;
  $('token-missing').textContent = [total.pending ? `${number(total.pending)} 次进行中` : '', unknown > 0 ? `${number(unknown)} 次用量未知` : ''].filter(Boolean).join(' · ');
  $('token-recent').innerHTML = usage.recent.length ? usage.recent.map(item => `<tr><td>${date(item.time, true)}${item.error ? `<small title="${escape(item.error)}">${escape(item.error)}</small>` : ''}</td><td class="mono">${escape(item.model)}</td><td><span class="badge ${item.status === 'success' ? 'success' : item.status === 'failed' ? 'failed' : 'neutral'}">${({ success: '已回复', failed: '失败', pending: '进行中', unknown: '结果未确认' })[item.status]}</span></td><td>${item.promptTokens === null ? '—' : number(item.promptTokens)}</td><td>${item.completionTokens === null ? '—' : number(item.completionTokens)}</td><td>${item.totalTokens === null ? '—' : number(item.totalTokens)}</td><td>${item.latencyMs === null ? '—' : `${(item.latencyMs / 1000).toFixed(1)} s`}</td></tr>`).join('') : '<tr><td colspan="7" class="empty">暂无请求</td></tr>';
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
  if (!authenticated) return;
  logRequest?.abort();
  const request = new AbortController();
  logRequest = request;
  const source = $('log-source').value;
  const lines = $('log-lines').value;
  const output = $('log-output');
  $('log-refresh').classList.add('spinning');
  output.setAttribute('aria-busy', 'true');
  try {
    const result = await api(`/api/logs?source=${encodeURIComponent(source)}&lines=${lines}`, { signal: request.signal });
    if (logRequest !== request) return;
    const previousTop = output.scrollTop;
    const atEnd = output.scrollHeight - output.clientHeight - previousTop < 8;
    const text = result.text || '暂无日志';
    if (output.textContent !== text) {
      output.textContent = text;
      output.scrollTop = $('log-follow').checked && atEnd ? output.scrollHeight : previousTop;
    }
    $('log-updated').textContent = date(result.updatedAt);
  } catch (error) {
    if (logRequest === request && !request.signal.aborted) output.textContent = error.message;
  } finally {
    if (logRequest === request) {
      logRequest = null;
      $('log-refresh').classList.remove('spinning');
      output.removeAttribute('aria-busy');
    }
  }
}
for (const id of ['log-source', 'log-lines']) $(id).addEventListener('change', loadLogs);
$('log-refresh').addEventListener('click', loadLogs);
function requestAction(action) {
  if (!actions[action] || actionPending) return;
  if (!['stop', 'restart', 'rollback'].includes(action)) { performAction(action); return; }
  pendingAction = action; $('confirm-title').textContent = actions[action][0]; $('confirm-description').textContent = actions[action][1];
  $('confirm-accept').className = action === 'stop' ? 'btn danger' : 'btn primary';
  $('confirm-accept').textContent = actions[action][0];
  $('confirm-dialog').showModal();
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
setInterval(() => { if (!document.hidden) { refresh(); if (currentPage === 'logs' && $('log-follow').checked && !logRequest) loadLogs(); if (currentPage === 'websites' && authenticated) websiteUI.refreshHosting(); } }, 8000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
try {
  const session = await api('/api/session'); csrf = session.csrf || '';
  if (session.authenticated) await enter(); else showAuth(session.setupRequired);
} catch (error) { $('auth-title').textContent = '暂时无法连接管理服务'; $('auth-description').textContent = `${error.message} 请刷新页面重试。`; }
