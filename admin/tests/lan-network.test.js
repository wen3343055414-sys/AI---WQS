import test from 'node:test';
import assert from 'node:assert/strict';
import { LanNetwork } from '../src/lan-network.js';

const NODE = 'D:\\Program Files\\nodejs\\node.exe';
const physical = (name, address, prefixLength = 24, extra = {}) => ({ name, address, prefixLength, description: 'Fixture physical wireless adapter', physical: true, virtual: false, state: 'Up', dhcp: true, ...extra });
const rule = (extra = {}) => ({ name: 'AI-WQS-LAN-Gateway', enabled: 'True', direction: 'Inbound', action: 'Allow', profile: 'Any',
  protocol: 'TCP', localPort: ['3200'], remoteAddress: ['LocalSubnet'], program: NODE, ...extra });
const snapshot = (extra = {}) => ({ hostname: 'FIXTURE-PC', networkReadable: true, addresses: [physical('WLAN', '10.42.12.35')], firewall: { readable: true, rules: [rule()] }, ...extra });
function fixture(raw = snapshot()) {
  const calls = [];
  const network = new LanNetwork({ nodePath: NODE, platform: 'win32', runner: async (...args) => { calls.push(args); return { stdout: JSON.stringify(raw) }; } });
  return { network, calls };
}

test('physical RFC1918 adapters produce real URLs, CIDRs and DHCP information', async () => {
  const { network, calls } = fixture(snapshot({ addresses: [physical('WLAN', '10.42.12.35'), physical('Ethernet', '192.168.7.34', 23, { dhcp: false }), physical('Other', '172.20.4.15', 20)] }));
  const data = await network.read();
  assert.equal(data.hostname, 'FIXTURE-PC'); assert.equal(data.addresses.length, 3);
  assert.ok(data.addresses.some(address => address.subnet === '192.168.6.0/23' && address.dhcp === false));
  assert.ok(data.addresses.some(address => address.subnet === '10.42.12.0/24' && address.url === 'http://10.42.12.35:3200' && address.dhcp));
  assert.equal(data.firewall.state, 'allowed'); assert.ok(Date.parse(data.checkedAt));
  assert.equal(calls.length, 1); const [, args, options] = calls[0];
  assert.equal(options.windowsHide, true); assert.equal(options.shell, undefined); assert.ok(args.includes('-NoProfile'));
  const query = args.at(-1); assert.match(query, /Get-NetAdapter -Physical/); assert.match(query, /Get-NetFirewallRule -PolicyStore ActiveStore/);
  assert.ok(!/New-Net|Set-Net|Remove-Net/.test(query));
});

test('VPN, Docker, WSL, fake-IP, public and invalid broad subnets are excluded', async () => {
  const { network } = fixture(snapshot({ addresses: [physical('WLAN', '10.42.12.35'), physical('Meta', '198.18.0.1', 30),
    physical('WireGuard', '10.8.0.1'), physical('OpenVPN', '10.9.0.1'), physical('vEthernet (WSL)', '172.30.32.1', 20),
    physical('Docker', '172.17.0.1', 16), physical('WLAN2', '169.254.1.1', 16), physical('WLAN3', '8.8.8.8'),
    physical('WLAN4', '10.1.1.1', 0), physical('WLAN5', '192.168.1.1', 8), physical('WLAN6', '10.6.0.1', 24, { virtual: true }),
    physical('WLAN7', '10.7.0.1', 24, { physical: false }), physical('WLAN8', '10.8.0.1', 24, { state: 'Down' })] }));
  const data = await network.read(); assert.deepEqual(data.addresses.map(address => address.address), ['10.42.12.35']);
  assert.equal(network.allowedHost('198.18.0.1'), false); assert.equal(network.allowedHost('172.30.32.1'), false);
});

test('client authorization uses actual physical CIDRs and safely handles mapped IPv4', async () => {
  const { network } = fixture();
  assert.equal(network.allowedClient('127.0.0.1'), true); assert.equal(network.allowedClient('::1'), true);
  assert.equal(network.allowedClient('10.42.12.50'), false);
  await network.read();
  for (const address of ['10.42.12.1', '10.42.12.255', '::ffff:10.42.12.50', '0:0:0:0:0:ffff:0a2a:0c32', '::ffff:127.0.0.2', '0:0:0:0:0:0:0:1']) assert.equal(network.allowedClient(address), true, address);
  for (const address of ['10.42.13.50', '192.168.1.1', '198.18.0.113', '8.8.8.8', '::ffff:8.8.8.8', '::10.42.12.50', 'fe80::1', '::1%lo', '10.42.12.1:3200', '2130706433']) assert.equal(network.allowedClient(address), false, address);
  for (const host of ['10.42.12.35', 'fixture-pc', 'FIXTURE-PC.local', 'localhost', '[::1]']) assert.equal(network.allowedHost(host), true, host);
  for (const host of ['10.42.12.35:3200', '10.42.12.50', 'fixture-pc.attacker.net', 'fixture-pc.local.', ' fixture-pc']) assert.equal(network.allowedHost(host), false, host);
});

test('firewall status requires the exact enabled program, TCP port and LocalSubnet scope', async () => {
  for (const mismatch of [{ enabled: 'False' }, { direction: 'Outbound' }, { action: 'Block' }, { protocol: 'UDP' },
    { localPort: ['3100'] }, { localPort: ['3200', '3100'] }, { remoteAddress: ['Any'] }, { remoteAddress: ['LocalSubnet', 'Internet'] },
    { program: 'C:\\another\\node.exe' }, { program: 'Any' }, { profile: 'Private' }]) {
    const { network } = fixture(snapshot({ firewall: { readable: true, rules: [rule(mismatch)] } }));
    assert.equal((await network.read()).firewall.state, 'missing', JSON.stringify(mismatch));
  }
  const unknown = fixture(snapshot({ firewall: { readable: false, rules: [rule()] } }));
  assert.equal((await unknown.network.read()).firewall.state, 'unknown');
  const absent = fixture(snapshot({ firewall: { readable: true, rules: [] } }));
  assert.equal((await absent.network.read()).firewall.state, 'missing');
});

test('read caches for thirty seconds, shares concurrent queries and returns immutable snapshots', async () => {
  const { network, calls } = fixture();
  const [one, two] = await Promise.all([network.read(), network.read()]); assert.deepEqual(one, two); assert.equal(calls.length, 1);
  one.addresses[0].address = '8.8.8.8'; one.addresses.length = 0;
  assert.equal(network.allowedHost('10.42.12.35'), true); assert.equal(network.allowedHost('8.8.8.8'), false);
  await network.read(); assert.equal(calls.length, 1);
  await network.read({ force: true }); assert.equal(calls.length, 2);
});

test('Windows inspection failures fail closed without guessing from virtual adapters', async () => {
  const network = new LanNetwork({ platform: 'win32', nodePath: NODE, runner: async () => { throw new Error('raw fixture diagnostic'); } });
  const result = await network.read(); assert.deepEqual(result.addresses, []); assert.equal(result.firewall.state, 'unknown');
  assert.equal(network.allowedClient('10.42.12.50'), false); assert.equal(network.allowedClient('127.1.2.3'), true);
  assert.ok(!result.firewall.message.includes('raw fixture'));
});

test('other OS fallback remains conservative and never claims a firewall rule or static DHCP setting', async () => {
  const entry = (address, cidr, extra = {}) => ({ family: 'IPv4', internal: false, address, cidr, ...extra });
  const network = new LanNetwork({ platform: 'linux', nodePath: '/usr/bin/node', host: () => 'fixture-host', interfaces: () => ({
    eth0: [entry('192.168.5.2', '192.168.5.2/24')], docker0: [entry('172.17.0.1', '172.17.0.1/16')],
    veth123: [entry('10.1.1.2', '10.1.1.2/24')], tun0: [entry('10.8.0.1', '10.8.0.1/24')],
    en1: [entry('10.3.4.5', '10.3.4.5/24', { internal: true })], unusual: [entry('10.4.4.5', '10.4.4.5/24')],
  }) });
  const result = await network.read(); assert.deepEqual(result.addresses.map(address => address.address), ['192.168.5.2']);
  assert.equal(result.firewall.state, 'unknown'); assert.equal(result.addresses[0].dhcp, false);
  assert.throws(() => new LanNetwork({ port: 80 }), /端口/);
});
