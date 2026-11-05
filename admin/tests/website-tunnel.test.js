import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { WebsiteTunnel } from '../src/website-tunnel.js';

class FakeChild extends EventEmitter {
  constructor() {
    super();
    this.stdout = new PassThrough(); this.stderr = new PassThrough();
    this.exitCode = null; this.signalCode = null; this.signals = [];
  }
  kill(signal) {
    this.signals.push(signal);
    this.signalCode = signal;
    queueMicrotask(() => this.emit('close', null, signal));
    return true;
  }
  log(message) { this.stderr.write(JSON.stringify({ level: 'info', message }) + '\n'); }
  finish(code) { this.exitCode = code; this.emit('close', code, null); }
}
async function fixture(t, { missing = false, spawnProcess } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'website-tunnel-'));
  await mkdir(path.join(root, 'tools'));
  const executable = path.join(root, 'tools', process.platform === 'win32' ? 'cloudflared.exe' : 'cloudflared');
  if (!missing) await writeFile(executable, 'fixture executable; never executed');
  const children = [], calls = [];
  const spawn = (file, args, options) => {
    const child = new FakeChild(); children.push(child); calls.push({ file, args, options });
    queueMicrotask(() => child.emit('spawn'));
    return child;
  };
  const tunnel = new WebsiteTunnel({ root, port: 3200, spawnProcess: spawnProcess || spawn });
  t.after(async () => { await tunnel.shutdown(); await rm(root, { recursive: true, force: true }); });
  return { root, executable, children, calls, tunnel, spawn };
}
const tick = () => new Promise(resolve => setImmediate(resolve));

test('quick tunnel launches only its fixed website listener with isolated config and no shell', async t => {
  const f = await fixture(t);
  await f.tunnel.start(); await tick();
  assert.equal(f.calls.length, 1);
  const { file, args, options } = f.calls[0];
  assert.equal(file, f.executable); assert.equal(options.windowsHide, true); assert.equal(options.shell, false);
  assert.equal(args[args.indexOf('--url') + 1], 'http://127.0.0.1:3200');
  assert.equal(args[args.indexOf('--protocol') + 1], 'http2');
  assert.equal(args[args.indexOf('--metrics') + 1], '127.0.0.1:0');
  assert.equal(await readFile(args[args.indexOf('--config') + 1], 'utf8'), '{}\n');
  assert.ok(!Object.keys(options.env).some(key => /^TUNNEL_|^CLOUDFLARED_/i.test(key)));
  assert.equal(f.tunnel.status().state, 'connecting');
  assert.equal(f.tunnel.status().url, null);
  assert.equal(JSON.parse(await readFile(path.join(f.root, 'data/website-tunnel.json'))).enabled, true);
});

test('a printed hostname is not ready until a real tunnel connection is registered', async t => {
  const f = await fixture(t); await f.tunnel.start(); await tick();
  f.children[0].log('| https://fixture-live-site.trycloudflare.com |');
  assert.equal(f.tunnel.status().url, null);
  f.children[0].log('Registered tunnel connection connIndex=0 connection=fixture');
  assert.equal(f.tunnel.status().state, 'ready');
  assert.equal(f.tunnel.status().url, 'https://fixture-live-site.trycloudflare.com');
  f.children[0].log('Failed to serve tunnel connection error=fixture');
  assert.equal(f.tunnel.status().state, 'connecting');
  assert.equal(f.tunnel.status().url, null);
  f.children[0].log('Registered tunnel connection connIndex=0');
  assert.equal(f.tunnel.status().state, 'ready');
  f.children[0].finish(1);
  assert.equal(f.tunnel.status().state, 'error'); assert.equal(f.tunnel.status().url, null);
  assert.ok(!f.tunnel.status().message.includes('fixture'));
});

test('only exact provider HTTPS origins are accepted, including chunked log lines', async t => {
  const f = await fixture(t); await f.tunnel.start(); await tick();
  const child = f.children[0];
  child.log('Registered tunnel connection connIndex=0');
  for (const unsafe of ['http://fixture.trycloudflare.com', 'https://fixture.trycloudflare.com.attacker.invalid',
    'https://fixture.trycloudflare.com/path', 'https://fixture.trycloudflare.com?credential=secret',
    'https://user:password@fixture.trycloudflare.com', 'https://fixture.trycloudflare.com:8443', 'https://example.com']) {
    child.log(unsafe); assert.equal(f.tunnel.status().url, null);
  }
  child.stderr.write('{"message":"https://fixture-real.trycloud');
  child.stderr.write('flare.com"}\n');
  assert.equal(f.tunnel.status().url, 'https://fixture-real.trycloudflare.com');
});

test('simultaneous starts share one child; a stop disables persistence and ignores stale output', async t => {
  const f = await fixture(t);
  await Promise.all([f.tunnel.start(), f.tunnel.start(), f.tunnel.start()]);
  assert.equal(f.calls.length, 1);
  await f.tunnel.stop();
  assert.deepEqual(f.children[0].signals, ['SIGTERM']);
  f.children[0].log('https://stale-site.trycloudflare.com');
  f.children[0].log('Registered tunnel connection connIndex=0');
  assert.equal(f.tunnel.status().state, 'stopped'); assert.equal(f.tunnel.status().enabled, false);
  assert.equal(JSON.parse(await readFile(path.join(f.root, 'data/website-tunnel.json'))).enabled, false);
  await f.tunnel.start(); assert.equal(f.calls.length, 2);
});

test('shutdown retains enabled intent and restore opens a fresh tunnel after restart', async t => {
  const f = await fixture(t); await f.tunnel.start();
  await f.tunnel.shutdown();
  const restarted = new WebsiteTunnel({ root: f.root, port: 3200, spawnProcess: f.spawn });
  t.after(() => restarted.shutdown());
  await restarted.restore(); assert.equal(f.calls.length, 2); assert.equal(restarted.status().enabled, true);
  assert.equal(restarted.status().url, null);
  await restarted.stop();
  const disabled = new WebsiteTunnel({ root: f.root, port: 3200, spawnProcess: f.spawn });
  await disabled.restore(); assert.equal(f.calls.length, 2); assert.equal(disabled.status().enabled, false);
});

test('missing executable and spawn failures report a real error without claiming a URL', async t => {
  const missing = await fixture(t, { missing: true });
  assert.equal((await missing.tunnel.start()).state, 'error'); assert.equal(missing.calls.length, 0);
  assert.equal(missing.tunnel.status().installed, false);
  const broken = await fixture(t, { spawnProcess: () => { throw new Error('unsafe detail'); } });
  assert.equal((await broken.tunnel.start()).state, 'error');
  assert.equal(broken.tunnel.status().url, null); assert.ok(!broken.tunnel.status().message.includes('unsafe'));
});

test('invalid persisted settings fail safely and an explicit new start can repair them', async t => {
  const f = await fixture(t); await mkdir(path.join(f.root, 'data'));
  await writeFile(path.join(f.root, 'data/website-tunnel.json'), '{invalid');
  assert.equal((await f.tunnel.restore()).state, 'error'); assert.equal(f.calls.length, 0);
  await f.tunnel.start(); assert.equal(f.calls.length, 1);
  assert.throws(() => new WebsiteTunnel({ root: f.root, port: 3100, executable: 'cmd /c something' }), /绝对路径/);
  assert.throws(() => new WebsiteTunnel({ root: f.root, port: '3200' }), /端口/);
});
