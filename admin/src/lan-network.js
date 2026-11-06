import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { networkInterfaces, hostname as systemHostname } from 'node:os';
import { isIP } from 'node:net';
import path from 'node:path';

const execute = promisify(execFile);
const CACHE_MS = 30_000;
const RULE_NAME = 'AI-WQS-LAN-Gateway';
const VIRTUAL = /(?:vpn|openvpn|wireguard|tailscale|zerotier|docker|wsl|vethernet|veth|virtual|vmware|hyper-v|loopback|npcap|hamachi|nordlynx|proton|(?:^|[^a-z])meta(?:$|[^a-z])|(?:^|[^a-z])(?:tap|tun|utun)\d*(?:$|[^a-z]))/i;
const QUERY = String.raw`
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$snapshot = [ordered]@{ hostname = [System.Net.Dns]::GetHostName(); networkReadable = $false; addresses = @(); firewall = @{ readable = $false; rules = @() } }
try {
  $cards = @(Get-NetAdapter -Physical -ErrorAction Stop | Where-Object { $_.Status -eq 'Up' -and $_.HardwareInterface -and -not $_.Virtual })
  $ips = @(Get-NetIPAddress -AddressFamily IPv4 -ErrorAction Stop)
  $snapshot.addresses = @(foreach ($card in $cards) {
    foreach ($ip in $ips | Where-Object { $_.InterfaceIndex -eq $card.ifIndex -and $_.AddressState -eq 'Preferred' -and -not $_.SkipAsSource }) {
      [ordered]@{ name = [string]$card.Name; description = [string]$card.InterfaceDescription; address = [string]$ip.IPAddress; prefixLength = [int]$ip.PrefixLength; dhcp = ([string]$ip.PrefixOrigin -eq 'Dhcp'); physical = [bool]$card.HardwareInterface; virtual = [bool]$card.Virtual; state = [string]$card.Status }
    }
  })
  $snapshot.networkReadable = $true
} catch { $snapshot.addresses = @() }
try {
  try { $rules = @(Get-NetFirewallRule -PolicyStore ActiveStore -Name 'AI-WQS-LAN-Gateway' -ErrorAction Stop) }
  catch { if ($_.CategoryInfo.Category -eq [System.Management.Automation.ErrorCategory]::ObjectNotFound) { $rules = @() } else { throw } }
  $snapshot.firewall.rules = @(foreach ($rule in $rules) {
    $ports = Get-NetFirewallPortFilter -AssociatedNetFirewallRule $rule -ErrorAction Stop
    $addresses = Get-NetFirewallAddressFilter -AssociatedNetFirewallRule $rule -ErrorAction Stop
    $application = Get-NetFirewallApplicationFilter -AssociatedNetFirewallRule $rule -ErrorAction Stop
    [ordered]@{ name = [string]$rule.Name; enabled = [string]$rule.Enabled; direction = [string]$rule.Direction; action = [string]$rule.Action; profile = [string]$rule.Profile; protocol = [string]$ports.Protocol; localPort = @($ports.LocalPort | ForEach-Object { [string]$_ }); remoteAddress = @($addresses.RemoteAddress | ForEach-Object { [string]$_ }); program = [string]$application.Program }
  })
  $snapshot.firewall.readable = $true
} catch { $snapshot.firewall = @{ readable = $false; rules = @() } }
$snapshot | ConvertTo-Json -Depth 7 -Compress
`;

function ipv4(value) {
  if (typeof value !== 'string' || isIP(value) !== 4) return null;
  const parts = value.split('.').map(Number);
  return (parts[0] * 16777216 + parts[1] * 65536 + parts[2] * 256 + parts[3]) >>> 0;
}
function ipv6Words(value) {
  if (typeof value !== 'string' || value.includes('%') || isIP(value) !== 6) return null;
  let address = value.toLowerCase();
  if (address.includes('.')) {
    const index = address.lastIndexOf(':'), tail = ipv4(address.slice(index + 1));
    if (tail === null) return null;
    address = `${address.slice(0, index + 1)}${(tail >>> 16).toString(16)}:${(tail & 65535).toString(16)}`;
  }
  const sides = address.split('::'), left = sides[0] ? sides[0].split(':') : [];
  const right = sides.length === 2 && sides[1] ? sides[1].split(':') : [];
  const parts = sides.length === 1 ? left : [...left, ...Array(8 - left.length - right.length).fill('0'), ...right];
  return parts.length === 8 ? parts.map(part => parseInt(part, 16)) : null;
}
function clientIPv4(value) {
  const plain = ipv4(value);
  if (plain !== null) return plain;
  const words = ipv6Words(value);
  return words && words.slice(0, 5).every(part => part === 0) && words[5] === 65535 ? (words[6] * 65536 + words[7]) >>> 0 : null;
}
function loopback(value) {
  const address = clientIPv4(value);
  if (address !== null) return address >>> 24 === 127;
  const words = ipv6Words(value);
  return Boolean(words && words.slice(0, 7).every(part => part === 0) && words[7] === 1);
}
function privatePrefix(address) {
  const number = ipv4(address);
  if (number === null) return null;
  const [a, b] = address.split('.').map(Number);
  return a === 10 ? 8 : a === 172 && b >= 16 && b <= 31 ? 12 : a === 192 && b === 168 ? 16 : null;
}
const mask = prefix => (0xffffffff << (32 - prefix)) >>> 0;
const dotted = address => [address >>> 24, address >>> 16 & 255, address >>> 8 & 255, address & 255].join('.');
const safeName = value => typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 200) : '';
function parseAddress(record, port, physical) {
  if (!record || typeof record.address !== 'string' || VIRTUAL.test(`${record.name || ''} ${record.description || ''}`) ||
      physical && (record.physical !== true || record.virtual !== false || record.state !== 'Up')) return null;
  const minimum = privatePrefix(record.address), prefix = record.prefixLength;
  if (minimum === null || !Number.isInteger(prefix) || prefix < minimum || prefix > 32) return null;
  const name = safeName(record.name);
  if (!name) return null;
  const subnet = `${dotted((ipv4(record.address) & mask(prefix)) >>> 0)}/${prefix}`;
  return { name, address: record.address, prefixLength: prefix, subnet, url: `http://${record.address}:${port}`, dhcp: record.dhcp === true };
}
function firewallStatus(raw, port, nodePath) {
  if (!raw || raw.readable !== true || !Array.isArray(raw.rules)) return { state: 'unknown', message: '无法核验 Windows 防火墙规则，请检查权限或手动确认局域网端口。' };
  const rules = raw.rules.filter(rule => rule?.name === RULE_NAME);
  if (rules.length !== 1) return { state: 'missing', message: '尚未检测到匹配的网站局域网放行规则。' };
  const rule = rules[0], one = (value, expected) => (Array.isArray(value) ? value : [value]).length === 1 && String((Array.isArray(value) ? value : [value])[0]).toLowerCase() === expected.toLowerCase();
  const expectedProgram = path.win32.normalize(nodePath).toLowerCase();
  const valid = String(rule.enabled).toLowerCase() === 'true' && String(rule.direction).toLowerCase() === 'inbound' &&
    String(rule.action).toLowerCase() === 'allow' && ['tcp', '6'].includes(String(rule.protocol).toLowerCase()) &&
    one(rule.localPort, String(port)) && one(rule.remoteAddress, 'LocalSubnet') &&
    ['any', '0'].includes(String(rule.profile).toLowerCase()) && typeof rule.program === 'string' && path.win32.isAbsolute(rule.program) &&
    path.win32.normalize(rule.program).toLowerCase() === expectedProgram;
  return valid ? { state: 'allowed', message: '已核验此 Node.js 程序、端口及 LocalSubnet 入站规则；仍需同一局域网设备实际访问确认。' } :
    { state: 'missing', message: '现有局域网规则与当前程序、端口或本地子网范围不匹配，请重新配置。' };
}

export class LanNetwork {
  constructor({ port = 3200, nodePath = process.execPath, runner = execute, platform = process.platform,
    interfaces = networkInterfaces, host = systemHostname } = {}) {
    if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('局域网入口端口无效。');
    const paths = platform === 'win32' ? path.win32 : path;
    if (typeof nodePath !== 'string' || !paths.isAbsolute(nodePath) || nodePath.includes('\0')) throw new Error('Node.js 程序路径必须是绝对路径。');
    this.port = port; this.nodePath = nodePath; this.runner = runner; this.platform = platform; this.interfaces = interfaces; this.host = host;
    this.cachedAt = 0; this.inflight = null;
    this.snapshot = { hostname: safeName(host()), addresses: [], firewall: { state: 'unknown', message: '尚未检查局域网和防火墙状态。' }, checkedAt: null };
  }
  async read({ force = false } = {}) {
    if (!force && this.cachedAt && Date.now() - this.cachedAt < CACHE_MS) return structuredClone(this.snapshot);
    if (this.inflight) return structuredClone(await this.inflight);
    this.inflight = this.collect().then(result => { this.snapshot = result; this.cachedAt = Date.now(); return result; });
    try { return structuredClone(await this.inflight); } finally { this.inflight = null; }
  }
  async collect() {
    let hostname = safeName(this.host()), addresses = [], firewall = { state: 'unknown', message: '此系统未自动核验防火墙，请手动确认局域网端口。' };
    if (this.platform === 'win32') {
      try {
        const powershell = path.win32.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
        const result = await this.runner(powershell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', QUERY], { windowsHide: true, timeout: 12000, maxBuffer: 256 * 1024, encoding: 'utf8' });
        const raw = JSON.parse(result.stdout.replace(/^\uFEFF/, ''));
        hostname = safeName(raw.hostname) || hostname;
        if (raw.networkReadable === true && Array.isArray(raw.addresses)) addresses = raw.addresses.map(record => parseAddress(record, this.port, true)).filter(Boolean);
        firewall = firewallStatus(raw.firewall, this.port, this.nodePath);
      } catch { firewall = { state: 'unknown', message: '无法读取物理网卡或防火墙状态，暂未开放新的局域网来源。' }; }
    } else {
      try {
        for (const [name, entries] of Object.entries(this.interfaces())) {
          if (VIRTUAL.test(name) || !/^(?:en|eth|wl|wi-?fi|ethernet)/i.test(name)) continue;
          for (const entry of entries || []) {
            if (entry.internal || ![4, 'IPv4'].includes(entry.family) || !entry.cidr) continue;
            const prefixLength = Number(entry.cidr.split('/')[1]);
            const address = parseAddress({ name, address: entry.address, prefixLength, dhcp: false }, this.port, false);
            if (address) addresses.push(address);
          }
        }
      } catch { addresses = []; }
    }
    const seen = new Set();
    addresses = addresses.filter(record => !seen.has(record.address) && seen.add(record.address)).sort((left, right) => left.name.localeCompare(right.name) || left.address.localeCompare(right.address));
    return { hostname, addresses, firewall, checkedAt: new Date().toISOString() };
  }
  allowedHost(hostname) {
    if (typeof hostname !== 'string' || !hostname || hostname.includes('%') || hostname.trim() !== hostname) return false;
    const bare = hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname;
    if (bare.toLowerCase() === 'localhost' || loopback(bare)) return true;
    if (this.snapshot.addresses.some(record => record.address === bare)) return true;
    const computer = this.snapshot.hostname.toLowerCase();
    return this.snapshot.addresses.length > 0 && /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(computer) &&
      [computer, `${computer}.local`].includes(hostname.toLowerCase());
  }
  allowedClient(address) {
    if (loopback(address)) return true;
    const number = clientIPv4(address);
    if (number === null) return false;
    return this.snapshot.addresses.some(record => (number & mask(record.prefixLength)) >>> 0 === (ipv4(record.address) & mask(record.prefixLength)) >>> 0);
  }
}
