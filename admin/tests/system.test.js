import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, mkdir } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { SystemManager, redact, tail } from '../src/system.js';

async function fixture(t, runner) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'admin-system-test-'));
  const deploy = path.join(root, 'deployment'); await mkdir(deploy);
  await writeFile(path.join(deploy, 'config.json'), JSON.stringify({ project: 'ai-wqs-server', docker: 'docker-fixture.exe', context: 'desktop-linux', python: 'python-fixture.exe', port: 65534, branch: 'development', repository: 'example/workbench' }));
  await writeFile(path.join(deploy, 'current.json'), JSON.stringify({ sha: 'a'.repeat(40) }));
  t.after(() => rm(root, { recursive: true, force: true }));
  return new SystemManager(root, { deploymentRoot: deploy, port: 3100, schtasks: 'schtasks-fixture.exe' }, runner);
}
test('container discovery scopes by exact project and excludes unrelated containers', async t => {
  let captured;
  const manager = await fixture(t, async (exe, args, options) => {
    captured = { exe, args, options };
    return { stdout: [
      { Names: 'ai-wqs-server-backend-1', ID: 'abc123', Image: 'backend:version', State: 'running', Status: 'healthy' },
      { Names: 'unrelated-service', ID: 'bad123', State: 'running' },
    ].map(JSON.stringify).join('\n'), stderr: '' };
  });
  const containers = await manager.containers();
  assert.equal(containers.length, 1); assert.equal(containers[0].service, 'backend');
  assert.ok(captured.args.includes('label=com.docker.compose.project=ai-wqs-server'));
  assert.equal(captured.options.shell, undefined); assert.equal(captured.options.windowsHide, true);
});
test('unrecognized operations and log sources never launch a command', async t => {
  let called = false;
  const manager = await fixture(t, async () => { called = true; });
  await assert.rejects(manager.action('docker rm -f something'), /不支持/);
  await assert.rejects(manager.logs('../../credentials', 100), /未知/);
  await assert.rejects(manager.downloadBackup('../../owner.sqlite'), /无效/);
  assert.equal(called, false);
});
test('backup inspection while stopped uses only the existing application image and a read-only volume', async t => {
  let command;
  const manager = await fixture(t, async (exe, args) => { command = args; return { stdout: '{"files":[],"databaseBytes":4096}', stderr: '' }; });
  const data = await manager.backups([], { sha: 'a'.repeat(40) });
  assert.equal(data.databaseBytes, 4096);
  assert.ok(command.includes('--pull=never')); assert.ok(command.includes('--read-only'));
  assert.ok(command.includes('none')); assert.ok(command.includes('type=volume,source=ai-wqs-server_workspace-data,target=/data,readonly'));
});
test('Docker outages leave the independent manager report and task state accessible', async t => {
  const manager = await fixture(t, async (exe) => {
    if (exe === 'docker-fixture.exe') throw new Error('engine offline');
    return { stdout: '{"exists":true,"enabled":true}', stderr: '' };
  });
  const data = await manager.overview();
  assert.equal(data.docker.available, false); assert.equal(data.scheduler.enabled, true);
  assert.equal(data.admin.port, 3100); assert.ok(data.host.memoryTotal > 0);
});
test('concurrent status refreshes share one collection', async t => {
  const manager = await fixture(t, async () => { throw Error('unused'); });
  let count = 0;
  manager.collect = async () => { count++; await new Promise(resolve => setTimeout(resolve, 20)); return { value: 1 }; };
  const [one, two] = await Promise.all([manager.overview(), manager.overview()]);
  assert.equal(count, 1); assert.deepEqual(one, two);
});
test('log tail bounds output and hides assigned credentials', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'admin-log-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'fixture.log');
  await writeFile(file, 'old\npassword=fixture-secret\nlast line');
  const result = await tail(file, 2);
  assert.ok(!result.includes('old')); assert.ok(!result.includes('fixture-secret'));
  assert.match(redact('api_key=fake-token'), /已隐藏/);
});
