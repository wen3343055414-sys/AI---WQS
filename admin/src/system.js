import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, open, mkdtemp, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { HttpError } from './store.js';

const execute = promisify(execFile);
const jsonLines = text => text.trim().split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
export const ACTIONS = new Map([
  ['start', '启动工作台'], ['stop', '停止工作台'], ['restart', '重启工作台'],
  ['update', '检查并更新版本'], ['backup', '创建数据库备份'], ['rollback', '回退上一版本'],
  ['pause', '暂停自动更新'], ['resume', '恢复自动更新'],
]);
const FILE_PATTERN = /^workspace-[A-Za-z0-9-]{10,120}\.sqlite$/;
export function redact(value) {
  return String(value).replace(/((?:password|api[_-]?key|authorization|access[_-]?token)\s*[:=]\s*)[^\s,;]+/gi, '$1[已隐藏]');
}
async function jsonFile(file, fallback = null) {
  try { return JSON.parse((await readFile(file, 'utf8')).replace(/^\uFEFF/, '')); }
  catch (error) { if (error.code === 'ENOENT') return fallback; throw error; }
}
export async function tail(file, lines = 140) {
  let handle;
  try {
    handle = await open(file, 'r');
    const size = (await handle.stat()).size;
    const length = Math.min(size, 150000);
    const buffer = Buffer.alloc(length);
    await handle.read(buffer, 0, length, size - length);
    const rows = buffer.toString('utf8').split(/\r?\n/);
    if (size > length) rows.shift();
    return redact(rows.slice(-lines).join('\n'));
  } catch (error) { if (error.code === 'ENOENT') return ''; throw error; }
  finally { await handle?.close(); }
}

export class SystemManager {
  constructor(root, settings, runner = execute) {
    this.root = root;
    this.codeRoot = settings.codeRoot || root;
    this.settings = settings;
    this.deploymentRoot = path.resolve(root, settings.deploymentRoot || '../AI-WQS-local');
    this.runner = runner;
    this.cache = null;
    this.inflight = null;
    this.taskCache = null;
    this.backupCache = null;
    this.startedAt = Date.now();
  }
  async config() {
    const config = await jsonFile(path.join(this.deploymentRoot, 'config.json'));
    if (!config || !/^[a-z0-9][a-z0-9_-]{1,62}$/.test(config.project)) throw new Error('工作台部署配置不存在或格式不正确。');
    return config;
  }
  async run(file, args, timeout = 20000, maxBuffer = 2 * 1024 * 1024) {
    return this.runner(file, args, { windowsHide: true, timeout, maxBuffer, encoding: 'utf8' });
  }
  async docker(args, timeout) {
    const config = await this.config();
    return this.run(config.docker, ['--context', config.context, ...args], timeout);
  }
  async taskStatus() {
    if (this.taskCache && Date.now() - this.taskCache.at < 10000) return this.taskCache.value;
    const config = await this.config();
    const result = await this.run(config.python, [path.join(this.codeRoot, 'scripts/task_control.py'), 'status', this.settings.schtasks]);
    const value = JSON.parse(result.stdout.replace(/^\uFEFF/, ''));
    this.taskCache = { at: Date.now(), value };
    return value;
  }
  async containers() {
    const config = await this.config();
    const listed = await this.docker(['ps', '--all', '--filter', `label=com.docker.compose.project=${config.project}`, '--format', '{{json .}}']);
    const rows = jsonLines(listed.stdout).filter(row => row.Names === `${config.project}-backend-1` || row.Names === `${config.project}-frontend-1`);
    return rows.map(row => ({ id: row.ID, name: row.Names, service: row.Names.includes('-backend-') ? 'backend' : 'frontend', image: row.Image, state: row.State, status: row.Status, ports: row.Ports }));
  }
  async backups(containers, current) {
    if (this.backupCache && Date.now() - this.backupCache.at < 20000) return this.backupCache.value;
    const config = await this.config();
    if (!/^[0-9a-f]{40}$/.test(current?.sha || '')) return { files: [], error: '尚无已部署版本' };
    const code = "const fs=require('node:fs');let files=[];if(fs.existsSync('/data/backups'))files=fs.readdirSync('/data/backups').filter(n=>/^workspace-[A-Za-z0-9-]+\\.sqlite$/.test(n)).map(name=>{let s=fs.statSync('/data/backups/'+name);return{name,size:s.size,modifiedAt:s.mtime.toISOString()}}).sort((a,b)=>b.name.localeCompare(a.name));let db=['/data/workspace.sqlite','/data/workspace.sqlite-wal'].reduce((size,file)=>size+(fs.existsSync(file)?fs.statSync(file).size:0),0);console.log(JSON.stringify({files,databaseBytes:db}))";
    const backend = containers.find(c => c.service === 'backend' && c.state === 'running');
    const result = backend
      ? await this.docker(['exec', backend.id, 'node', '-e', code])
      : await this.docker(['run', '--rm', '--pull=never', '--network', 'none', '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges:true', '--mount', `type=volume,source=${config.project}_workspace-data,target=/data,readonly`, `ai-wqs-backend:${current.sha}${config.modelIntegration ? '-models-v1' : ''}`, 'node', '-e', code]);
    const value = JSON.parse(result.stdout);
    this.backupCache = { at: Date.now(), value };
    return value;
  }
  async collect() {
    const config = await this.config();
    const current = await jsonFile(path.join(this.deploymentRoot, 'current.json'), {});
    const maintenance = await jsonFile(path.join(this.root, 'data/maintenance.json'), {});
    const result = {
      updatedAt: new Date().toISOString(), project: config.project, branch: config.branch,
      repository: config.repository, appUrl: `http://127.0.0.1:${config.port}`, deployment: current,
      admin: { port: this.settings.port, pid: process.pid, uptimeSeconds: process.uptime(), memoryBytes: process.memoryUsage().rss, revision: this.settings.revision || null },
      host: { platform: 'Windows', cpuCount: os.cpus().length, memoryTotal: os.totalmem(), memoryUsed: os.totalmem() - os.freemem(), uptimeSeconds: os.uptime() },
      docker: { available: false }, containers: [], stats: [], backups: { files: [] }, scheduler: {}, maintenance,
    };
    const scheduler = this.taskStatus().then(value => { result.scheduler = value; }).catch(error => { result.scheduler = { error: error.message }; });
    try {
      result.containers = await this.containers();
      result.docker.available = true;
      const running = result.containers.filter(c => c.state === 'running');
      const checks = [];
      if (running.length) checks.push(this.docker(['stats', '--no-stream', '--format', '{{json .}}', ...running.map(c => c.id)], 15000).then(r => {
        result.stats = jsonLines(r.stdout).map(row => ({ name: row.Name, cpu: row.CPUPerc, memory: row.MemUsage, memoryPercent: row.MemPerc, network: row.NetIO, pids: row.PIDs }));
      }).catch(error => { result.metricsError = error.message; }));
      checks.push(this.backups(result.containers, current).then(value => { result.backups = value; }).catch(error => { result.backups = { files: [], error: error.message }; }));
      await Promise.all(checks);
      try {
        const response = await fetch(`${result.appUrl}/api/health`, { signal: AbortSignal.timeout(2500) });
        result.application = { healthy: response.ok && (await response.json()).status === 'ok' };
      } catch { result.application = { healthy: false }; }
    } catch (error) { result.docker.error = redact(error.message); }
    await scheduler;
    return result;
  }
  async overview() {
    if (this.cache && Date.now() - this.cache.at < 5000) return this.cache.value;
    if (this.inflight) return this.inflight;
    this.inflight = this.collect().then(value => { this.cache = { at: Date.now(), value }; return value; }).finally(() => { this.inflight = null; });
    return this.inflight;
  }
  async logs(source, lines) {
    if (source === 'update') return tail(path.join(this.deploymentRoot, 'update.log'), lines);
    if (source === 'admin') return tail(path.join(this.root, 'server.log'), lines);
    if (!['backend', 'frontend'].includes(source)) throw new HttpError(400, '未知的日志来源。');
    const container = (await this.containers()).find(c => c.service === source);
    if (!container) throw new HttpError(404, '尚未找到对应的服务容器。');
    const result = await this.docker(['logs', '--timestamps', '--tail', String(lines), container.id]);
    return redact([result.stdout, result.stderr].filter(Boolean).join('\n'));
  }
  async action(action) {
    if (!ACTIONS.has(action)) throw new HttpError(400, '不支持此操作。');
    const config = await this.config();
    try {
      const result = await this.run(config.python, [path.join(this.codeRoot, 'scripts/control.py'), action, this.deploymentRoot, this.root, this.settings.schtasks], 18 * 60 * 1000, 8 * 1024 * 1024);
      const response = JSON.parse(result.stdout.trim());
      if (!response.ok) throw new Error(response.message);
      return { message: response.message, output: redact(result.stderr || '') };
    } catch (error) {
      let response;
      try { response = JSON.parse(error.stdout || '{}'); } catch { /* Non-JSON failures retain the original message. */ }
      const failure = new Error(response?.message || error.message);
      failure.output = redact(error.stderr || '');
      throw failure;
    } finally { this.cache = this.taskCache = this.backupCache = null; }
  }
  async downloadBackup(name) {
    if (!FILE_PATTERN.test(name)) throw new HttpError(400, '备份文件名无效。');
    const containers = await this.containers();
    const config = await this.config();
    const current = await jsonFile(path.join(this.deploymentRoot, 'current.json'), {});
    const backupData = await this.backups(containers, current);
    if (!backupData.files.some(file => file.name === name)) throw new HttpError(404, '备份文件不存在。');
    const backend = containers.find(c => c.service === 'backend');
    if (!backend) throw new HttpError(404, '未找到数据库所在容器。');
    const directory = await mkdtemp(path.join(os.tmpdir(), 'ai-wqs-admin-'));
    const destination = path.join(directory, name);
    try {
      await this.run(config.docker, ['--context', config.context, 'cp', `${backend.id}:/data/backups/${name}`, destination], 60000);
      return { file: destination, size: (await stat(destination)).size, cleanup: () => rm(directory, { recursive: true, force: true }) };
    } catch (error) { await rm(directory, { recursive: true, force: true }); throw error; }
  }
}
