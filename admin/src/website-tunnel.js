import { spawn } from 'node:child_process';
import { statSync } from 'node:fs';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { HttpError } from './store.js';

const STARTUP_TIMEOUT = 90_000;
const NOTE = '公网地址由 Cloudflare 临时分配，重新连接后可能变化；电脑和通道需保持运行。';

function installed(file) {
  try { return statSync(file).isFile(); } catch { return false; }
}
function publicAddress(line) {
  for (const match of line.matchAll(/https:\/\/[^\s"|\\]+/g)) {
    try {
      const url = new URL(match[0]);
      if (url.protocol === 'https:' && !url.username && !url.password && !url.port && url.pathname === '/' && !url.search && !url.hash && /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.trycloudflare\.com$/.test(url.hostname)) return url.origin;
    } catch { /* Only an exact provider-issued HTTPS origin is accepted. */ }
  }
  return null;
}
function childEnvironment() {
  // Only OS/network settings are needed; unrelated application secrets and tunnel routing stay out.
  const allowed = /^(?:SystemRoot|windir|ComSpec|PATH|PATHEXT|TEMP|TMP|USERPROFILE|HOME|HOMEDRIVE|HOMEPATH|APPDATA|LOCALAPPDATA|ProgramData|HTTP_PROXY|HTTPS_PROXY|ALL_PROXY|NO_PROXY|SSL_CERT_FILE|SSL_CERT_DIR)$/i;
  return Object.fromEntries(Object.entries(process.env).filter(([name]) => allowed.test(name)));
}

export class WebsiteTunnel {
  constructor({ root, port, executable, spawnProcess = spawn }) {
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('网站访客服务端口无效。');
    this.root = path.resolve(root);
    this.port = port;
    this.executable = executable || path.join(this.root, 'tools', process.platform === 'win32' ? 'cloudflared.exe' : 'cloudflared');
    if (typeof this.executable !== 'string' || !path.isAbsolute(this.executable) || this.executable.includes('\0')) throw new Error('公网通道程序路径无效，请使用绝对路径。');
    this.spawnProcess = spawnProcess;
    this.directory = path.join(this.root, 'data');
    this.stateFile = path.join(this.directory, 'website-tunnel.json');
    this.child = null;
    this.enabled = false;
    this.state = 'stopped';
    this.message = '公网通道未开启。';
    this.address = null;
    this.connected = false;
    this.generation = 0;
    this.timer = null;
    this.pending = Promise.resolve();
  }
  status() {
    return { state: this.state, url: this.state === 'ready' ? this.address : null, enabled: this.enabled,
      installed: installed(this.executable), message: this.message, temporary: true, note: NOTE };
  }
  enqueue(operation) {
    const result = this.pending.then(operation, operation);
    this.pending = result.catch(() => {});
    return result;
  }
  async persist() {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const temporary = `${this.stateFile}.${randomBytes(8).toString('hex')}.tmp`;
    try {
      await writeFile(temporary, JSON.stringify({ enabled: this.enabled }) + '\n', { mode: 0o600, flag: 'wx' });
      await rename(temporary, this.stateFile);
    } finally { await rm(temporary, { force: true }); }
  }
  start() { return this.enqueue(() => this.startChild()); }
  stop() {
    return this.enqueue(async () => {
      this.enabled = false;
      await this.stopChild();
      await this.persist();
      return this.status();
    });
  }
  shutdown() {
    return this.enqueue(async () => {
      await this.stopChild();
      return this.status();
    });
  }
  restore() {
    return this.enqueue(async () => {
      let saved;
      try { saved = JSON.parse(await readFile(this.stateFile, 'utf8')); }
      catch (error) {
        if (error.code !== 'ENOENT') { this.state = 'error'; this.message = '公网通道运行设置无法读取，请重新开启。'; }
        return this.status();
      }
      if (!saved || typeof saved.enabled !== 'boolean') {
        this.state = 'error'; this.message = '公网通道运行设置格式无效，请重新开启。';
        return this.status();
      }
      if (saved.enabled) return this.startChild();
      return this.status();
    });
  }
  async startChild() {
    if (this.child && ['starting', 'connecting', 'ready'].includes(this.state)) return this.status();
    if (this.child) await this.stopChild();
    this.enabled = true;
    await this.persist();
    if (!installed(this.executable)) {
      this.state = 'error';
      this.message = '尚未安装公网通道程序，请先运行网站通道安装脚本。';
      return this.status();
    }
    // An explicit empty config avoids exposing a pre-existing user's named tunnel or ingress.
    const config = path.join(this.directory, 'website-tunnel-config.yml');
    await writeFile(config, '{}\n', { mode: 0o600 });
    this.state = 'starting';
    this.message = '正在申请公网地址…';
    this.address = null;
    this.connected = false;
    const generation = ++this.generation;
    let child;
    try {
      child = this.spawnProcess(this.executable, ['tunnel', '--config', config, '--no-autoupdate', '--protocol', 'http2',
        '--url', `http://127.0.0.1:${this.port}`, '--metrics', '127.0.0.1:0', '--output', 'json', '--loglevel', 'info', '--grace-period', '1s'],
      { windowsHide: true, shell: false, cwd: this.directory, env: childEnvironment(), stdio: ['ignore', 'pipe', 'pipe'] });
    } catch {
      this.state = 'error'; this.message = '公网通道程序无法启动，请检查安装和运行权限。';
      return this.status();
    }
    this.child = child;
    const current = () => generation === this.generation && this.child === child;
    child.once('spawn', () => {
      if (!current()) return;
      this.state = 'connecting'; this.message = '正在连接公网通道…';
    });
    for (const stream of [child.stdout, child.stderr]) {
      let remainder = '';
      stream?.setEncoding('utf8');
      stream?.on('data', text => {
        if (!current()) return;
        remainder += text;
        const lines = remainder.split(/\r?\n/);
        remainder = lines.pop().slice(-16384);
        for (const line of lines) this.readLine(line.slice(0, 16384));
      });
      stream?.on('end', () => { if (current() && remainder) this.readLine(remainder); });
    }
    child.once('error', () => {
      if (!current()) return;
      clearTimeout(this.timer);
      this.state = 'error'; this.address = null; this.connected = false;
      this.message = '公网通道程序无法运行，请检查安装和运行权限。';
    });
    child.once('close', () => {
      if (!current()) return;
      clearTimeout(this.timer);
      this.child = null; this.address = null; this.connected = false;
      this.state = 'error';
      this.message = '公网通道已断开，请检查网络后重新连接。';
    });
    this.timer = setTimeout(() => {
      if (!current() || this.state === 'ready') return;
      this.enqueue(async () => {
        if (!current() || this.state === 'ready') return;
        await this.stopChild();
        this.state = 'error'; this.message = '公网通道连接超时，请检查网络后重新连接。';
      }).catch(() => {});
    }, STARTUP_TIMEOUT);
    this.timer.unref();
    return this.status();
  }
  readLine(line) {
    // Return fixed descriptions only; upstream logs may contain local paths or request metadata.
    this.address = publicAddress(line) || this.address;
    if (/Registered tunnel connection\b/i.test(line)) this.connected = true;
    if (/Unregistered tunnel connection|Failed to serve tunnel connection|Serve tunnel error|connection terminated|Retrying connection|Unable to establish connection/i.test(line)) {
      this.connected = false;
      this.state = 'connecting'; this.message = '公网连接中断，通道正在重连…';
      return;
    }
    if (this.connected && this.address) {
      clearTimeout(this.timer);
      this.state = 'ready'; this.message = '公网通道已连接。';
    }
  }
  async stopChild() {
    const child = this.child;
    ++this.generation;
    clearTimeout(this.timer);
    this.address = null; this.connected = false;
    this.state = 'stopped'; this.message = '公网通道已停止。';
    if (!child) return;
    const exited = () => child.exitCode != null || child.signalCode != null;
    if (!exited()) {
      const ended = new Promise(resolve => child.once('close', resolve));
      const wait = milliseconds => new Promise(resolve => {
        const timer = setTimeout(() => resolve(false), milliseconds);
        ended.then(() => { clearTimeout(timer); resolve(true); });
      });
      child.kill('SIGTERM');
      if (!await wait(2000) && !exited()) {
        child.kill('SIGKILL');
        if (!await wait(1500) && !exited()) {
          this.state = 'error'; this.message = '公网通道未能停止，请检查本机进程后重试。';
          throw new HttpError(503, this.message);
        }
      }
    }
    this.child = null;
  }
}
