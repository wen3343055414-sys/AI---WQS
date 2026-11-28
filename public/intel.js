import { escapeHtml as e, markdown, INTEL_TOPICS } from './core.js';

const views = { feed: '信息流', sources: '信源', alerts: '提醒', saved: '收藏' };
const tiers = { official: '官方', community: '社区', research: '研究', media: '媒体', custom: '自定义' };
const topicIcons = { technology: 'code', policy: 'briefcase', markets: 'chart', research: 'bulb', world: 'globe' };
const localDate = new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', timeZone: 'Asia/Shanghai' });
const localTime = new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'Asia/Shanghai' });
const numberText = new Intl.NumberFormat('zh-CN');
const millisPerDay = 86_400_000;
const midnight = () => Math.floor((Date.now() + 8 * 3_600_000) / millisPerDay) * millisPerDay - 8 * 3_600_000;
const formatStamp = value => `${localDate.format(value)} ${localTime.format(value)}`;
const lc = value => value.trim().normalize('NFKC').toLocaleLowerCase();
function safeLink(value) {
  try {
    const url = new URL(value);
    if (['https:', 'http:'].includes(url.protocol) && !url.username && !url.password) return e(url.href);
  } catch { /* Unavailable link. */ }
  return '#home';
}
function timeLabel(value) {
  const minutes = Math.floor(Math.max(0, Date.now() - value) / 60_000);
  if (minutes === 0) return '刚刚';
  if (minutes < 60) return `${minutes} 分钟前`;
  if (minutes < 24 * 60) return `${Math.floor(minutes / 60)} 小时前`;
  return localDate.format(value);
}

export class IntelligenceView {
  constructor({ getSync, getModelReady, icon, toast, openDialog, closeDialog, copy, download }) {
    Object.assign(this, { getSync, getModelReady, icon, toast, openDialog, closeDialog, copy, download });
    this.clear();
    document.addEventListener('click', event => {
      const target = event.target.closest('[data-intel-action]');
      if (target) this.action(target).catch(error => this.toast(error.message, true));
    });
    document.addEventListener('input', event => {
      if (event.target.id !== 'intel-search') return;
      this.query = event.target.value;
      this.limit = 12;
      this.update();
    });
    document.addEventListener('change', event => {
      if (event.target.id !== 'intel-brief-choice') return;
      this.briefId = event.target.value;
      this.update();
      document.querySelector('#intel-brief-choice')?.focus();
    });
    document.addEventListener('submit', event => {
      const form = event.target;
      if (!form.matches('form[data-intel-form]')) return;
      event.preventDefault();
      this.submit(form);
    });
    setInterval(() => {
      if (!document.hidden || this.notificationsEnabled()) this.refresh();
    }, 7000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) this.refresh(true); });
  }
  clear() {
    this.cycle = (this.cycle || 0) + 1;
    this.data = null;
    this.view = 'feed';
    this.topic = '';
    this.source = '';
    this.query = '';
    this.todayOnly = false;
    this.limit = 12;
    this.selected = new Set();
    this.briefId = '';
    this.lastAlert = null;
    this.error = '';
    this.refreshing = null;
    this.lastCheck = 0;
    this.writing = false;
    this.fragments = new WeakMap();
  }
  control(action, label, icon, { kind = 'intel-button', id, extra = '' } = {}) {
    const target = id === undefined ? '' : ` data-id="${e(id)}"`;
    return `<button type="button" class="${kind}" data-intel-action="${action}"${target} ${extra}>${icon ? this.icon(icon) : ''}${label}</button>`;
  }
  iconControl(action, label, icon, id, extra = '') {
    return this.control(action, '', icon, { kind: 'intel-icon-button', id, extra: `aria-label="${e(label)}" title="${e(label)}" ${extra}` });
  }
  opened() { return Boolean(document.querySelector('#intel-desk')); }
  mount() {
    this.refresh(false, !this.data);
  }
  async refresh(force = false, initialize = false) {
    const sync = this.getSync();
    if (!initialize && !this.opened() && !this.data?.rules.length) return;
    if (!sync?.authenticated) { this.update(); return; }
    if (this.refreshing) return this.refreshing;
    if (!force && Date.now() - this.lastCheck < 2400) return;
    const cycle = this.cycle;
    const identity = sync.identity;
    this.lastCheck = Date.now();
    const version = this.data?.revision;
    this.refreshing = (async () => {
      try {
        const result = await sync.request('/api/intelligence' + (version ? '?since=' + encodeURIComponent(version) : ''));
        if (cycle !== this.cycle || !sync.authenticated || identity !== sync.identity) return;
        if (!result.unchanged) this.accept(result);
        else if (this.error) { this.error = ''; this.update(); }
      } catch (error) {
        if (cycle !== this.cycle || !sync.authenticated || identity !== sync.identity) return;
        const message = error.status === 404 ? '当前服务版本暂未提供自动采集。' : '暂时无法读取采集状态。';
        if (message !== this.error) { this.error = message; this.update(); }
      } finally { if (cycle === this.cycle) this.refreshing = null; }
    })();
    return this.refreshing;
  }
  accept(data) {
    const previous = this.data?.revision;
    const split = data.revision.lastIndexOf('-');
    if (previous?.startsWith(data.revision.slice(0, split + 1)) && Number(previous.slice(split + 1)) > Number(data.revision.slice(split + 1))) return;
    const last = data.alerts[0]?.alertId || 0;
    const fresh = this.lastAlert === null ? [] : data.alerts.filter(item => !item.readAt && item.alertId > this.lastAlert);
    this.lastAlert = Math.max(this.lastAlert || 0, last);
    this.data = data;
    const available = this.availableIds();
    for (const id of this.selected) if (!available.has(id)) this.selected.delete(id);
    this.error = '';
    if (data.briefId) this.briefId = data.briefId;
    if (fresh.length) {
      this.toast(fresh.length === 1 ? `订阅提醒 · ${fresh[0].title}` : `有 ${fresh.length} 条新订阅提醒`);
      if (this.notificationsEnabled()) {
        try {
          const notification = new Notification('智作台 · 订阅提醒', { body: fresh.length === 1 ? fresh[0].title : `${fresh.length} 条新提醒`, tag: 'wqs-intelligence' });
          notification.onclick = () => { window.focus(); this.setView('alerts'); location.hash = '#home'; };
        }
        catch { /* In-app alerts are kept even if device notifications are unavailable. */ }
      }
    }
    this.update();
  }
  async mutate(action, values = {}) {
    const sync = this.getSync();
    if (!sync?.authenticated) throw new Error('请先登录工作台服务。');
    const cycle = this.cycle;
    const identity = sync.identity;
    await this.refreshing;
    if (cycle !== this.cycle || identity !== sync.identity || !sync.authenticated) return null;
    const result = await sync.request('/api/intelligence/' + action, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...values, userId: sync.user.id }),
      ...(action === 'brief' ? { signal: AbortSignal.timeout(145000) } : {}),
    });
    if (cycle !== this.cycle || identity !== sync.identity || !sync.authenticated) return null;
    this.accept(result);
    return result;
  }
  notificationsAvailable() { return window.isSecureContext && typeof Notification === 'function'; }
  notificationKey() { return `zhizuotai.intel.desktop.${this.getSync()?.identity || ''}`; }
  notificationsEnabled() {
    try { return this.notificationsAvailable() && Notification.permission === 'granted' && localStorage.getItem(this.notificationKey()) === 'true'; }
    catch { return false; }
  }
  async toggleNotifications() {
    const key = this.notificationKey();
    if (this.notificationsEnabled()) { localStorage.removeItem(key); this.update(); return; }
    if (await Notification.requestPermission() !== 'granted') { this.toast('浏览器未授权桌面通知。'); return; }
    if (key === this.notificationKey()) { localStorage.setItem(key, 'true'); this.update(); }
  }
  status() {
    const data = this.data;
    if (this.error) return { state: 'error', text: this.error };
    if (this.getSync()?.mode === 'local') return { state: 'offline', text: '连接工作台服务后开始采集' };
    if (!data) return { state: 'offline', text: '正在读取信源' };
    if (data.sources.some(source => source.updating)) return { state: 'busy', text: '正在采集信息' };
    if (data.updated) return { state: 'ready', text: `上次检查 ${formatStamp(data.updated)} · 每 ${data.intervalMinutes} 分钟检查` };
    if (data.sources.some(source => source.enabled && source.error)) return { state: 'error', text: '信源连接待恢复' };
    return { state: 'offline', text: data.sources.some(source => source.enabled) ? '等待首次更新' : '请选择要采集的信源' };
  }
  statusMarkup() {
    const info = this.status();
    return `<span class="intel-status" data-state="${info.state}"><i aria-hidden="true"></i>${e(info.text)}</span>`;
  }
  heroActions() {
    const connected = this.getSync()?.authenticated;
    const busy = this.data?.sources.some(source => source.updating);
    return this.control('refresh', busy ? '采集中…' : '立即更新', 'refresh', { kind: 'intel-button intel-hero-primary', extra: !connected || busy ? 'disabled' : '' }) +
      this.control('add-source', '添加信源', 'plus', { kind: 'intel-button intel-hero-secondary', extra: !connected ? 'disabled' : '' });
  }
  metrics() {
    const data = this.data;
    return [
      ['sources', '启用信源', data && data.sources.filter(source => source.enabled).length, 'rss'],
      ['today', '今日发布', data?.today, 'globe'],
      ['alerts', '未读提醒', data?.unread, 'bell'],
      ['saved', '已收藏', data?.saved.length, 'bookmark'],
    ].map(([id, name, value, icon]) => this.control('metric', `<span class="intel-metric-icon" data-metric="${id}">${this.icon(icon)}</span>
      <span><small>${name}</small><strong>${value == null ? '—' : numberText.format(value)}</strong></span>${this.icon('chevron')}`, '', { id, kind: 'intel-metric' })).join('');
  }
  navigation() {
    return Object.entries(views).map(([key, label]) => this.control('view', `${label}${key === 'alerts' && this.data?.unread ? `<span class="intel-unread-count">${numberText.format(this.data.unread)}</span>` : ''}`, '',
      { id: key, kind: 'intel-tab', extra: `aria-pressed="${this.view === key}"` })).join('') +
      this.control('jump-brief', '简报', '', { kind: 'intel-tab intel-mobile-brief' });
  }
  topicFilters() {
    if (!['feed', 'saved'].includes(this.view)) return '';
    return Object.entries({ '': '全部', ...INTEL_TOPICS }).map(([key, label]) => this.control('topic', label, '',
      { id: key, kind: 'intel-topic-filter', extra: `aria-pressed="${this.topic === key}"` })).join('');
  }
  listControls() {
    if (!['feed', 'saved'].includes(this.view)) return '';
    return `<div class="intel-filters" data-intel-topics role="group" aria-label="按主题筛选">${this.topicFilters()}</div>
      <label class="intel-search">${this.icon('search')}<span class="visually-hidden">搜索信息</span><input type="search" id="intel-search" maxlength="120" autocomplete="off" placeholder="搜索标题、摘要或信源" value="${e(this.query)}"></label>`;
  }
  articles() {
    if (!this.data) return [];
    const rows = this.view === 'saved' ? this.data.saved : this.data.articles;
    const terms = lc(this.query).split(/\s+/).filter(Boolean);
    return rows.filter(article => {
      const sources = [article, ...(article.otherSources || [])];
      const match = sources.some(row => (!this.topic || row.topic === this.topic) && (!this.source || row.sourceId === this.source));
      const query = terms.length ? lc(`${article.title} ${article.summary} ${sources.map(row => row.source).join(' ')}`) : '';
      return match && (!this.todayOnly || article.published !== null && article.published >= midnight()) && terms.every(term => query.includes(term));
    });
  }
  articleCard(article, { alert = false } = {}) {
    const date = alert ? article.alertedAt : article.published || article.detected;
    const alternate = article.otherSources?.find(row => this.source ? row.sourceId === this.source : this.topic && this.topic !== article.topic && row.topic === this.topic);
    const { source, topic } = alternate || article;
    const selected = this.selected.has(article.id);
    const readAttributes = alert && !article.readAt ? `data-intel-action="read-link" data-id="${article.alertId}"` : '';
    const meta = alert ? `<span class="intel-match">${e(article.keyword)}</span>` : `<span class="intel-story-topic">${e(INTEL_TOPICS[topic])}</span>`;
    return `<article class="intel-story${alert && !article.readAt ? ' intel-story-unread' : ''}">
      <span class="intel-story-icon" data-topic="${e(topic)}" aria-hidden="true">${this.icon(topicIcons[topic])}</span>
      <div class="intel-story-main"><div class="intel-story-meta">${meta}<span>${e(source)}</span><span class="intel-meta-dot" aria-hidden="true">·</span><time datetime="${new Date(date).toISOString()}" title="${e(formatStamp(date))}">${!alert && !article.published ? '采集于 ' : ''}${e(timeLabel(date))}</time></div>
      <h3><a href="${safeLink(article.url)}" target="_blank" rel="noopener noreferrer" ${readAttributes}>${e(article.title)}${this.icon('external')}</a></h3>
      ${article.summary ? `<p>${e(article.summary)}</p>` : ''}</div>
      <div class="intel-story-actions">${this.iconControl('select', selected ? '移出简报选取' : '选入简报', selected ? 'check' : 'square-plus', article.id, `aria-pressed="${selected}"`)}
        ${alert ? (article.readAt ? '' : this.iconControl('read', '标记已读', 'check', article.alertId)) :
          this.iconControl('bookmark', article.saved ? '取消收藏' : '收藏信息', 'bookmark', article.id, `aria-pressed="${Boolean(article.saved)}"`)}
      </div></article>`;
  }
  empty(icon, heading, action = '') {
    return `<div class="intel-empty"><span aria-hidden="true">${this.icon(icon)}</span><h3>${heading}</h3>${action}</div>`;
  }
  list() {
    if (!this.data) return this.empty('rss', this.getSync()?.mode === 'local' ? '连接工作台服务后查看信息' : this.error ? '暂时无法载入信息' : '正在读取信息',
      this.error && this.getSync()?.authenticated ? this.control('retry-load', '重新读取', 'refresh') : '');
    if (this.view === 'sources') return this.sourceList();
    if (this.view === 'alerts') return this.alertList();
    const rows = this.articles();
    const filtered = Boolean(this.query.trim() || this.topic || this.source || this.todayOnly);
    const filter = this.todayOnly ? '今日发布' : this.source ? this.data.sources.find(source => source.id === this.source)?.name : '';
    return `${filter ? `<div class="intel-filter-indicator">${this.control('clear-filter', e(filter) + this.icon('close'), '', { kind: 'intel-chip', extra: 'aria-label="清除筛选"' })}</div>` : ''}
      ${rows.length ? rows.slice(0, this.limit).map(article => this.articleCard(article)).join('') :
        this.empty(this.view === 'saved' ? 'bookmark' : 'rss', filtered ? '没有符合条件的信息' :
          this.view === 'saved' ? '暂无收藏' : this.data.sources.some(source => source.updating) ? '正在采集第一批信息' : '暂无可用信息',
        filtered ? this.control('reset-filters', '清除筛选', 'close') :
          this.view === 'feed' ? this.control('view', '查看信源', 'arrow', { id: 'sources' }) : '')}
      ${rows.length > this.limit ? `<div class="intel-more">${this.control('more', '显示更多', 'down')}</div>` : ''}`;
  }
  sourceList() {
    return `<div class="intel-list-heading"><span>${this.data.sources.length} 个信源</span>${this.control('add-source', '添加', 'plus')}</div>
      ${this.data.sources.map(source => {
        const state = !source.enabled ? ['offline', '已停用'] : source.updating ? ['busy', '采集中'] : source.error ? ['error', source.error] :
          source.collected ? ['ready', `检查于 ${formatStamp(source.collected)}`] : ['offline', '等待更新'];
        return `<article class="intel-source-row"><span class="intel-story-icon" data-topic="${e(source.topic)}">${this.icon('rss')}</span><div class="intel-source-main">
          <h3><a href="${safeLink(source.url)}" target="_blank" rel="noopener noreferrer">${e(source.name)}${this.icon('external')}</a></h3>
          <p>${e(INTEL_TOPICS[source.topic])} · ${e(tiers[source.tier])} · ${e(source.region)}</p>
          <span class="intel-status intel-source-state" data-state="${state[0]}"><i aria-hidden="true"></i>${e(state[1])}</span></div>
          <div class="intel-source-actions">${this.control('filter-source', '看信息', '', { id: source.id, extra: source.enabled ? '' : 'disabled' })}
          ${this.iconControl('toggle-source', source.enabled ? `停用 ${source.name}` : `启用 ${source.name}`, 'toggle', source.id, `aria-pressed="${source.enabled}"`)}
          ${source.custom ? this.iconControl('remove-source', `移除 ${source.name}`, 'trash', source.id) : ''}</div></article>`;
      }).join('')}`;
  }
  alertList() {
    return `<div class="intel-list-heading"><span>${this.data.unread ? `${this.data.unread} 条未读` : '全部提醒'}</span>
      <div class="intel-list-actions">${this.data.unread ? this.control('read-all', '全部已读', 'check') : ''}
      ${this.data.alerts.length ? this.control('add-rule', '订阅关键词', 'plus') : ''}</div></div>
      ${this.data.alerts.length ? this.data.alerts.slice(0, this.limit).map(item => this.articleCard(item, { alert: true })).join('') :
        this.empty('bell', '暂无匹配的提醒', this.control('add-rule', '订阅关键词', 'plus'))}
      ${this.data.alerts.length > this.limit ? `<div class="intel-more">${this.control('more', '显示更多', 'down')}</div>` : ''}`;
  }
  brief() { return this.data?.briefs.find(brief => brief.id === this.briefId) || this.data?.briefs[0]; }
  availableIds() { return new Set([...(this.data?.articles || []), ...(this.data?.saved || []), ...(this.data?.alerts || [])].map(article => article.id)); }
  briefIds() {
    const available = this.availableIds();
    const chosen = [...this.selected].filter(id => available.has(id));
    if (chosen.length) return chosen;
    const list = ['feed', 'saved'].includes(this.view) ? this.articles() : (this.view === 'alerts' ? this.data?.alerts : this.data?.articles) || [];
    return list.slice(0, 8).map(article => article.id);
  }
  briefBody(brief) {
    const body = markdown(brief.body).replace(/\[(\d{1,2})\]/g, (match, index) => {
      const ref = brief.refs[Number(index) - 1];
      return ref ? `<a class="intel-cite" href="${safeLink(ref.url)}" target="_blank" rel="noopener noreferrer" title="${e(ref.title)}">${match}</a>` : match;
    });
    const open = document.querySelector('[data-intel-refs]')?.open;
    return `<div class="intel-brief-content"><div class="intel-brief-title"><h3>${e(brief.title)}</h3>
      <p>${brief.model ? e(brief.model) : '按主题整理'} · ${e(formatStamp(brief.created))}</p></div>
      <div class="intel-markdown">${body}</div><details data-intel-refs ${open ? 'open' : ''}><summary>引用信源 <span>${brief.refs.length}</span></summary><ol>${brief.refs.map(ref =>
        `<li><a href="${safeLink(ref.url)}" target="_blank" rel="noopener noreferrer">${e(ref.source)} · ${e(ref.title)}</a></li>`).join('')}</ol></details>
      <div class="intel-brief-tools">${this.iconControl('copy-brief', '复制简报', 'copy')}${this.iconControl('download-brief', '下载简报', 'download')}</div></div>`;
  }
  briefPanel() {
    const brief = this.brief();
    const count = this.briefIds().length;
    const available = this.availableIds();
    const selection = [...this.selected].filter(id => available.has(id)).length;
    const needed = !count || this.writing || !this.getSync()?.authenticated ? 'disabled' : '';
    const aiReady = this.getModelReady();
    return `<section class="intel-side-card intel-brief"><div class="intel-side-heading"><span class="intel-side-icon">${this.icon('spark')}</span><h2 tabindex="-1">分析简报</h2>
      ${this.data?.briefs.length > 1 ? `<select id="intel-brief-choice" aria-label="选择历史简报">${this.data.briefs.map(item =>
        `<option value="${e(item.id)}" ${item.id === brief.id ? 'selected' : ''}>${e(formatStamp(item.created))} · ${e(item.title)}</option>`).join('')}</select>` : ''}</div>
      ${brief ? this.briefBody(brief) : `<div class="intel-brief-empty"><div class="intel-brief-visual" aria-hidden="true">${this.icon('file')}${this.icon('spark')}</div>
        <h3>${count ? '提炼当前信息' : '待采集信息'}</h3></div>`}
      <div class="intel-brief-foot"><div class="intel-brief-count" role="status">${selection ? `已选 ${selection} 条` : count ? (this.view === 'sources' ? `使用最新 ${count} 条` : `使用当前列表前 ${count} 条`) : ''}
        ${selection ? this.control('clear-selection', '清空', '', { kind: 'intel-plain-button' }) : ''}
        ${count && !aiReady ? '<a href="#settings">模型连接</a>' : ''}</div>
        <div class="intel-brief-actions">${this.control('brief', this.writing ? '正在生成…' : '生成 AI 简报', 'spark', { id: 'ai', kind: aiReady ? 'intel-button intel-primary' : 'intel-button', extra: aiReady ? needed : 'disabled' })}
        ${this.control('brief', '按主题整理', 'layers', { id: 'organize', kind: aiReady ? 'intel-button' : 'intel-button intel-primary', extra: needed })}</div></div></section>`;
  }
  watchPanel() {
    const rules = this.data?.rules || [];
    const available = this.getSync()?.authenticated;
    const notifications = this.notificationsEnabled();
    return `<section class="intel-side-card"><div class="intel-side-heading"><span class="intel-side-icon intel-bell-icon">${this.icon('bell')}</span><h2>订阅提醒</h2>
      ${this.iconControl('add-rule', '订阅关键词', 'plus', undefined, available ? '' : 'disabled')}</div>
      <div class="intel-watch-list">${rules.length ? rules.map(rule => `<div class="intel-rule"><div><strong>${e(rule.keyword)}</strong><small>${e(INTEL_TOPICS[rule.topic] || '全部主题')}</small></div>
        ${this.iconControl('remove-rule', `取消订阅 ${rule.keyword}`, 'close', rule.id)}</div>`).join('') : `<p>订阅关键词，接收匹配的新信息。</p>`}</div>
      ${this.notificationsAvailable() && available ? `<div class="intel-device">${this.control('desktop', notifications ? '关闭桌面通知' : '开启桌面通知', 'monitor',
        { kind: 'intel-plain-button', extra: `aria-pressed="${notifications}"` })}</div>` : ''}</section>`;
  }
  render() {
    return `<div id="intel-desk" class="intel-desk"><section class="intel-hero" aria-labelledby="page-title"><div class="intel-hero-copy">
      <div data-intel-status role="status">${this.statusMarkup()}</div><h1 id="page-title" tabindex="-1">信息收集与分析</h1>
      <div class="intel-hero-actions" data-intel-hero-actions>${this.heroActions()}</div></div>
      <div class="intel-hero-art" aria-hidden="true"><div class="intel-orbit"></div><div class="intel-globe"><div class="intel-globe-meridian"></div><div class="intel-globe-latitude"></div></div><i></i><i></i><i></i><i></i></div></section>
      <section class="intel-metrics" data-intel-metrics aria-label="采集概况">${this.metrics()}</section>
      <div class="intel-grid"><section class="intel-feed" aria-label="信息浏览"><nav class="intel-nav" data-intel-nav aria-label="信息视图">${this.navigation()}</nav>
        <div class="intel-list-controls" data-intel-controls>${this.listControls()}</div><div data-intel-list>${this.list()}</div></section>
      <aside class="intel-aside" data-intel-aside aria-label="简报和订阅">${this.briefPanel()}${this.watchPanel()}</aside></div></div>`;
  }
  update(resetControls = false) {
    const root = document.querySelector('#intel-desk');
    if (!root) return;
    const active = document.activeElement.closest('[data-intel-action]');
    const fragments = {
      status: this.statusMarkup(), 'hero-actions': this.heroActions(), metrics: this.metrics(), nav: this.navigation(),
      list: this.list(), aside: this.briefPanel() + this.watchPanel(),
    };
    if (resetControls) fragments.controls = this.listControls();
    else if (root.querySelector('[data-intel-topics]')) fragments.topics = this.topicFilters();
    for (const [name, html] of Object.entries(fragments)) {
      const target = root.querySelector(`[data-intel-${name}]`);
      if (target && this.fragments.get(target) !== html) {
        target.innerHTML = html;
        this.fragments.set(target, html);
      }
    }
    if (active && !active.isConnected) {
      const same = [...root.querySelectorAll('[data-intel-action]')].find(item => item.dataset.intelAction === active.dataset.intelAction && item.dataset.id === active.dataset.id);
      same?.focus({ preventScroll: true });
    }
  }
  setView(view, query = '') {
    this.view = view;
    this.query = query;
    this.topic = this.source = '';
    this.todayOnly = false;
    this.limit = 12;
    this.update(true);
  }
  showSourceForm() {
    this.openDialog('添加信源', `<form class="dialog-body intel-dialog" data-intel-form="sources"><label>RSS 或 Atom 地址<input class="input" type="url" name="url" placeholder="https://…" maxlength="1800" required autofocus></label>
      <label>信源名称<input class="input" name="name" maxlength="60" placeholder="选填"></label><div class="intel-dialog-row">
      ${topicField(false)}<label>地区<input class="input" name="region" maxlength="28" placeholder="全球"></label></div>
      <p class="dialog-error" id="form-error" role="alert"></p><div class="dialog-actions"><button type="button" class="btn" data-action="close-dialog">取消</button>
      <button type="submit" class="btn btn-primary">添加信源</button></div></form>`);
  }
  showRuleForm() {
    this.openDialog('订阅关键词', `<form class="dialog-body intel-dialog" data-intel-form="subscriptions"><label>关键词<input class="input" name="keyword" maxlength="80" placeholder="例如 AI Agent" required autofocus></label>
      ${topicField(true)}<p class="dialog-error" id="form-error" role="alert"></p><div class="dialog-actions"><button type="button" class="btn" data-action="close-dialog">取消</button>
      <button type="submit" class="btn btn-primary">保存订阅</button></div></form>`);
  }
  async submit(form) {
    const send = form.querySelector('button[type="submit"]');
    if (send.disabled) return;
    send.disabled = true;
    try {
      const result = await this.mutate(form.dataset.intelForm, Object.fromEntries(new FormData(form)));
      if (result && form.isConnected && form.closest('dialog')?.open) this.closeDialog();
      if (result) this.toast(form.dataset.intelForm === 'sources' ? '信源已添加' : '订阅已保存');
    } catch (error) { if (form.isConnected) form.querySelector('#form-error').textContent = error.message; }
    finally { send.disabled = false; }
  }
  async generate(ai) {
    const ids = this.briefIds();
    if (!ids.length || this.writing) return;
    const cycle = this.cycle;
    this.writing = true;
    this.update();
    try { await this.mutate('brief', { ids, ai }); }
    finally { if (cycle === this.cycle) { this.writing = false; this.update(); } }
  }
  async action(button) {
    const id = button.dataset.id;
    switch (button.dataset.intelAction) {
      case 'view': this.setView(id); break;
      case 'metric':
        this.setView(id === 'today' ? 'feed' : id);
        if (id === 'today') { this.todayOnly = true; this.update(); }
        break;
      case 'topic': this.topic = id; this.limit = 12; this.update(); break;
      case 'filter-source': this.setView('feed'); this.source = id; this.update(); break;
      case 'clear-filter': this.source = ''; this.todayOnly = false; this.limit = 12; this.update(); break;
      case 'reset-filters':
        this.setView(this.view);
        document.querySelector('#intel-search')?.focus();
        break;
      case 'retry-load': await this.refresh(true, true); break;
      case 'more': this.limit += 12; this.update(); break;
      case 'jump-brief': document.querySelector('.intel-brief h2')?.focus(); break;
      case 'refresh': {
        const result = await this.mutate('refresh');
        if (result && !result.queued && !result.sources.some(source => source.updating))
          this.toast(result.sources.some(source => source.enabled) ? '信源刚检查过或正在等待恢复。' : '请先启用信源。');
        break;
      }
      case 'add-source': this.showSourceForm(); break;
      case 'add-rule': this.showRuleForm(); break;
      case 'remove-rule': await this.mutate('unsubscribe', { id }); break;
      case 'desktop': await this.toggleNotifications(); break;
      case 'toggle-source': {
        const source = this.data?.sources.find(item => item.id === id);
        if (source) await this.mutate('source', { id, action: source.enabled ? 'disable' : 'enable' });
        break;
      }
      case 'remove-source': await this.mutate('source', { id, action: 'remove' }); break;
      case 'read-link':
      case 'read': await this.mutate('read', { id: Number(id) }); break;
      case 'read-all': await this.mutate('read', { id: 'all' }); break;
      case 'bookmark': await this.mutate('saved', { id, saved: button.getAttribute('aria-pressed') !== 'true' }); break;
      case 'select':
        if (this.selected.has(id)) this.selected.delete(id);
        else if (this.selected.size < 12) this.selected.add(id);
        else { this.toast('最多选择 12 条信息。'); return; }
        this.update();
        break;
      case 'clear-selection': this.selected.clear(); this.update(); break;
      case 'brief': await this.generate(id === 'ai'); break;
      case 'copy-brief': await this.copy(exportBrief(this.brief())); break;
      case 'download-brief': this.download(`${this.brief().title}.md`, exportBrief(this.brief()), 'text/markdown'); break;
    }
  }
}
function topicField(all) {
  return `<label>主题<select class="input" name="topic" aria-label="主题">${all ? '<option value="">全部主题</option>' : ''}
    ${Object.entries(INTEL_TOPICS).map(([id, label]) => `<option value="${id}">${label}</option>`).join('')}</select></label>`;
}
function exportBrief(brief) {
  return `# ${brief.title}\n\n${brief.body}\n\n## 引用信源\n\n${brief.refs.map((ref, i) => `${i + 1}. ${ref.source} · ${ref.title}\n   ${ref.url}`).join('\n')}`;
}
