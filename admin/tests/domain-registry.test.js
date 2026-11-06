import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { AdminStore } from '../src/store.js';
import { DomainRegistry, normalizeDomainHostname, isPublicDomainAddress, resolveDomainDns, verifyDomainBinding } from '../src/domain-registry.js';

const HOST = 'fixture-workbench.net';
const STATUS = { mode: 'server', serverId: 'a'.repeat(32) };
const dns = { state: 'resolved', records: [{ type: 'A', value: '8.8.8.8' }] };
const certificate = hostname => ({ subject: { CN: hostname }, subjectaltname: `DNS:${hostname}`,
  issuer: { CN: 'Fixture public CA' }, valid_to: new Date(Date.now() + 86400_000).toUTCString() });
function active() { return { state: 'active', dns, ssl: { state: 'valid', issuer: 'Fixture public CA', expiresAt: new Date(Date.now() + 86400_000).toISOString() }, checkedAt: new Date().toISOString(), message: 'Fixture route verified' }; }
async function fixture(t, verifier = async () => active()) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'domain-registry-'));
  const store = new AdminStore(directory);
  const registry = new DomainRegistry(store, { verifier });
  t.after(async () => { store.close(); await rm(directory, { recursive: true, force: true }); });
  return { directory, store, registry };
}
function requester({ remote = STATUS, remoteStatus = 200, cert, certificateError, onRequest = () => {} } = {}) {
  return (url, options, callback) => {
    onRequest(url, options);
    const request = new EventEmitter();
    request.destroy = () => {};
    request.end = () => queueMicrotask(() => {
      const publicRequest = url.protocol === 'https:';
      if (publicRequest && certificateError) { request.emit('error', Object.assign(new Error('upstream secret omitted'), { code: certificateError })); return; }
      const response = new PassThrough();
      response.statusCode = publicRequest ? remoteStatus : 200;
      response.socket = publicRequest ? { authorized: true, getPeerCertificate: () => cert || certificate(url.hostname) } : {};
      callback(response);
      response.end(JSON.stringify(publicRequest ? remote : STATUS));
    });
    return request;
  };
}
const verify = (options = {}, host = HOST) => verifyDomainBinding({ hostname: host, workbenchOrigin: 'http://127.0.0.1:3000' }, { resolveDns: async () => dns, requester: requester(options) });

test('domain names are normalized but URLs, IPs, wildcards and reserved names are rejected', () => {
  assert.equal(normalizeDomainHostname('WWW.Fixture-Workbench.NET'), 'www.fixture-workbench.net');
  assert.equal(normalizeDomainHostname('例子.公司.cn'), 'xn--fsqu00a.xn--55qx5d.cn');
  for (const invalid of ['https://fixture-workbench.net', 'fixture-workbench.net/path', 'fixture-workbench.net:443',
    '*.fixture-workbench.net', 'localhost', '127.0.0.1', '2130706433', '0x7f000001', '[::1]',
    'service.local', 'service.internal', 'service.test', 'service.onion', 'example.com', 'sub.example.org',
    'bad..net', '-bad.net', 'bad-.net', 'bad.net.', 'bad.net\nheader', 'bad.net\n', 'user@bad.net', 'bad.123']) {
    assert.throws(() => normalizeDomainHostname(invalid), error => error.status === 400, invalid);
  }
});

test('SSRF protection excludes private, metadata, VPN fake-IP and IPv6 mapped destinations', () => {
  for (const address of ['0.0.0.0', '10.1.2.3', '100.64.0.1', '127.0.0.2', '169.254.169.254',
    '172.16.0.1', '192.168.0.1', '192.0.0.1', '192.0.2.1', '198.18.0.113', '198.19.255.254',
    '198.51.100.1', '203.0.113.1', '224.0.0.1', '255.255.255.255', '::', '::1', 'fe80::1',
    'fc00::1', 'ff02::1', '::ffff:127.0.0.1', '::ffff:8.8.8.8', '64:ff9b::7f00:1',
    '2001:db8::1', '2001:2::1', '2002:0a00:0001::', '3fff::1', 'fe80::1%eth0']) assert.equal(isPublicDomainAddress(address), false, address);
  for (const address of ['8.8.8.8', '1.1.1.1', '172.32.0.1', '2606:4700:4700::1111', '2001:4860:4860::8888']) assert.equal(isPublicDomainAddress(address), true, address);
});

test('VPN fake DNS triggers a public resolver and never appears as a real public record', async () => {
  let fallback = 0;
  const result = await resolveDomainDns(HOST, {
    system: async () => ({ records: [{ type: 'A', value: '198.18.0.113' }], failed: false }),
    fallback: async hostname => { fallback++; assert.equal(hostname, HOST); return { records: dns.records, failed: false }; },
  });
  assert.equal(fallback, 1); assert.deepEqual(result, dns);
  const unsafe = await resolveDomainDns(HOST, {
    system: async () => ({ records: [], failed: true }),
    fallback: async () => ({ records: [{ type: 'A', value: '169.254.169.254' }], failed: false }),
  });
  assert.equal(unsafe.state, 'error'); assert.deepEqual(unsafe.records, []);
  const missing = await resolveDomainDns(HOST, { system: async () => ({ records: [], failed: false }), fallback: async () => ({ records: [], failed: false }) });
  assert.equal(missing.state, 'pending');
});

test('configured domains remain pending until DNS, TLS and the exact workbench are verified', async t => {
  const { registry } = await fixture(t);
  let domain = registry.add({ hostname: HOST.toUpperCase(), verification: active(), target: 'http://169.254.169.254' });
  assert.match(domain.id, /^domain_[a-f0-9]{24}$/); assert.equal(domain.hostname, HOST);
  assert.equal(domain.isDefault, true); assert.equal(domain.verification.state, 'pending');
  assert.equal(registry.defaultOrigin(), null); assert.equal(registry.allowedHost(HOST), true);
  assert.equal(registry.allowedHost(`${HOST}:443`), false); assert.equal(registry.allowedHost(`evil.${HOST}`), false);
  assert.throws(() => registry.add({ hostname: HOST }), error => error.status === 409);
  domain = await registry.verify(domain.id, { revision: domain.revision });
  assert.equal(domain.verification.state, 'active'); assert.equal(registry.defaultOrigin(), `https://${HOST}`);
  domain = registry.save(domain.id, { revision: domain.revision, enabled: false });
  assert.equal(domain.verification.state, 'pending'); assert.equal(registry.defaultOrigin(), null); assert.equal(registry.allowedHost(HOST), false);
  await assert.rejects(registry.verify(domain.id, { revision: domain.revision }), error => error.status === 400);
  assert.throws(() => registry.setDefault(domain.id, { revision: domain.revision }), error => error.status === 400);
});

test('default selection and deletion honor revisions and explicit confirmation', async t => {
  const { registry } = await fixture(t);
  const first = registry.add({ hostname: HOST }), second = registry.add({ hostname: 'second-fixture-workbench.net' });
  assert.throws(() => registry.save(first.id, { revision: 0 }), error => error.status === 409);
  const chosen = registry.setDefault(second.id, { revision: second.revision });
  assert.equal(chosen.isDefault, true); assert.equal(registry.get(first.id).isDefault, false);
  assert.equal(registry.get(first.id).revision, first.revision + 1);
  assert.equal(registry.defaultOrigin(), null);
  assert.throws(() => registry.remove(chosen.id, { revision: chosen.revision }), error => error.status === 400);
  assert.deepEqual(registry.remove(chosen.id, { revision: chosen.revision, confirmation: chosen.id }), { ok: true });
  assert.throws(() => registry.get(chosen.id), error => error.status === 404);
});

test('verification cannot overwrite edits or removals made while a check is in flight', async t => {
  let finish;
  const { registry } = await fixture(t, () => new Promise(resolve => { finish = resolve; }));
  const domain = registry.add({ hostname: HOST });
  const check = registry.verify(domain.id, { revision: domain.revision });
  await assert.rejects(registry.verify(domain.id, { revision: domain.revision }), error => error.status === 409);
  const edited = registry.save(domain.id, { revision: domain.revision, hostname: 'edited-fixture-workbench.net' });
  finish(active()); await assert.rejects(check, error => error.status === 409);
  assert.equal(registry.get(domain.id).hostname, edited.hostname); assert.equal(registry.get(domain.id).verification.state, 'pending');
  const removed = registry.verify(domain.id, { revision: edited.revision });
  registry.remove(domain.id, { revision: edited.revision, confirmation: domain.id });
  finish(active()); await assert.rejects(removed, error => error.status === 409);
});

test('additive domain storage survives restart and preserves existing admin sessions', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'domain-restart-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  let store = new AdminStore(directory);
  const session = store.createSession();
  let registry = new DomainRegistry(store, { verifier: async () => active() });
  const domain = registry.add({ hostname: HOST }); await registry.verify(domain.id, { revision: domain.revision });
  store.close(); store = new AdminStore(directory);
  try {
    registry = new DomainRegistry(store);
    assert.ok(store.session(session.token)); assert.equal(registry.list().length, 1); assert.equal(registry.defaultOrigin(), `https://${HOST}`);
  } finally { store.close(); }
});

test('production probe pins a validated IP, checks real TLS, and reads only fixed status paths', async () => {
  const calls = [];
  const result = await verify({ onRequest: (url, options) => calls.push({ url, options }) });
  assert.equal(result.state, 'active'); assert.equal(result.ssl.issuer, 'Fixture public CA');
  assert.equal(calls.length, 2); assert.ok(calls.every(call => call.url.pathname === '/api/status'));
  const remote = calls.find(call => call.url.protocol === 'https:');
  assert.equal(remote.options.rejectUnauthorized, true); assert.equal(remote.options.servername, HOST); assert.equal(remote.options.agent, false);
  remote.options.lookup(HOST, { all: true }, (error, addresses) => { assert.equal(error, null); assert.deepEqual(addresses, [{ address: '8.8.8.8', family: 4 }]); });
  assert.equal(remote.options.headers.Cookie, undefined); assert.equal(remote.options.headers.Authorization, undefined);
  assert.equal(remote.options.headers['ngrok-skip-browser-warning'], undefined);
});

test('different workbench, redirects, expired certs and certificate failures never become active', async () => {
  const different = await verify({ remote: { mode: 'server', serverId: 'b'.repeat(32) } });
  assert.equal(different.state, 'error'); assert.match(different.message, /另一工作台/); assert.equal(different.ssl.state, 'valid');
  let requests = 0;
  const redirect = await verify({ remoteStatus: 302, onRequest: () => requests++ });
  assert.equal(redirect.state, 'error'); assert.match(redirect.message, /重定向/); assert.equal(requests, 2);
  const expired = await verify({ cert: { ...certificate(HOST), valid_to: new Date(Date.now() - 86400_000).toUTCString() } });
  assert.equal(expired.state, 'error'); assert.equal(expired.ssl.state, 'error');
  const failed = await verify({ certificateError: 'ERR_TLS_CERT_ALTNAME_INVALID' });
  assert.equal(failed.state, 'error'); assert.equal(failed.ssl.state, 'error'); assert.ok(!failed.message.includes('secret'));
});

test('unsafe DNS prevents an HTTPS request and ngrok warning headers apply only to known suffixes', async () => {
  let publicCalls = 0;
  const unsafe = await verifyDomainBinding({ hostname: HOST, workbenchOrigin: 'http://127.0.0.1:3000' }, {
    resolveDns: async () => ({ state: 'resolved', records: [{ type: 'AAAA', value: '::ffff:127.0.0.1' }] }),
    requester: requester({ onRequest: url => { if (url.protocol === 'https:') publicCalls++; } }),
  });
  assert.equal(unsafe.state, 'error'); assert.equal(publicCalls, 0); assert.deepEqual(unsafe.dns.records, []);
  for (const hostname of ['fixture.ngrok-free.dev', 'fixture.ngrok-free.app', 'fixture.ngrok.app', 'fixture.ngrok-free.app.attacker.net']) {
    let header;
    const result = await verify({ onRequest: (url, options) => { if (url.protocol === 'https:') header = options.headers['ngrok-skip-browser-warning']; } }, hostname);
    assert.equal(result.state, 'active'); assert.equal(header, hostname.endsWith('.attacker.net') ? undefined : '1');
  }
});

test('malformed verifier results and local-origin overrides cannot manufacture a usable origin', async t => {
  const { registry } = await fixture(t, async () => ({ ...active(), dns: { state: 'resolved', records: [{ type: 'A', value: '198.18.0.113' }] } }));
  const domain = registry.add({ hostname: HOST });
  const checked = await registry.verify(domain.id, { revision: domain.revision });
  assert.equal(checked.verification.state, 'error'); assert.equal(registry.defaultOrigin(), null);
  assert.throws(() => new DomainRegistry(registry.store, { workbenchOrigin: 'http://169.254.169.254' }), /本机/);
  assert.throws(() => new DomainRegistry(registry.store, { workbenchOrigin: 'http://127.0.0.1:3000/private' }), /本机/);
});
