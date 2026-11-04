import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

// Check precisely the source intended for GitHub, never runtime directories.
const files = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { encoding: 'utf8' }).split('\0').filter(Boolean);
const failures = [];
for (const file of new Set(files)) {
  if (/(^|\/)(data|node_modules|outputs|releases|integrated|work|\.codex|\.aws)\//.test(file) || /(^|\/)\.env(\.|$)/.test(file) && !file.endsWith('.env.example') || /\.(sqlite(?:-wal|-shm)?|log|pem|key)$/.test(file) || /(^|\/)(config\.json|scheduled-task\.xml|model-bridge-token)$/.test(file)) {
    failures.push(`${file}: runtime or credential file`);
    continue;
  }
  const data = readFileSync(file);
  if (data.includes(0)) continue;
  const text = data.toString('utf8');
  if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\bgh[pousr]_[A-Za-z0-9]{25,}|\bgithub_pat_[A-Za-z0-9_]{30,}|\bsk-[A-Za-z0-9_-]{28,}/.test(text)) failures.push(`${file}: possible secret; inspect locally`);
}
if (failures.length) { console.error(failures.join('\n')); process.exitCode = 1; }
else console.log(`Public-source check passed (${new Set(files).size} files; no runtime state or credential patterns).`);
