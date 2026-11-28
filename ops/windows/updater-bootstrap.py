"""Stable installed entry point; load the updater from the accepted release."""
import importlib.util
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import time
import urllib.request

ROOT = Path(__file__).resolve().parent
implementation = None


class UpdateDeferred(Exception):
    """A scheduled check must wait without treating a healthy release as failed."""
    def __init__(self, message, retry_at=None):
        super().__init__(message)
        self.retry_at = retry_at


def network_environment():
    environment = dict(os.environ)
    proxies = urllib.request.getproxies_environment()
    # NO_PROXY alone makes getproxies() ignore Windows Internet Settings.
    if not any(proxies.get(name) for name in ('http', 'https', 'all')):
        registry = getattr(urllib.request, 'getproxies_registry', lambda: {})()
        proxies = {**registry, **proxies}
    for name in ('http', 'https', 'all', 'no'):
        if proxies.get(name):
            environment[name + '_proxy'] = proxies[name]
    environment['GIT_TERMINAL_PROMPT'] = '0'
    environment['GCM_INTERACTIVE'] = 'never'
    return environment


def response_headers(path):
    headers = {}
    for line in path.read_text(encoding='utf-8', errors='replace').splitlines():
        if line.startswith('HTTP/'):
            headers = {':status': line.split()[1]}
        elif ':' in line:
            name, value = line.split(':', 1)
            headers[name.lower()] = value.strip()
    return headers


def github_credential(config):
    """Reuse an existing Git sign-in without prompting or persisting its secret."""
    if not config.get('git'):
        return None
    try:
        result = subprocess.run([config['git'], '-c', 'credential.interactive=never', '-c', 'core.askPass=',
                                 'credential', 'fill'],
                                input='protocol=https\nhost=github.com\npath='
                                      + config['repository'] + '.git\n\n',
                                env={**network_environment(), 'GIT_ASKPASS': '', 'SSH_ASKPASS': ''},
                                capture_output=True, text=True,
                                encoding='utf-8', errors='replace', timeout=10,
                                creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0)
    except (OSError, subprocess.TimeoutExpired):
        return None
    if result.returncode:
        return None
    fields = dict(line.split('=', 1) for line in result.stdout.splitlines() if '=' in line)
    secret = fields.get('password', '')
    # A credential must fit in a single HTTP header. Never log helper output.
    return secret if secret and all(32 < ord(char) < 127 for char in secret) else None


def install_transport(module):
    """Repair transport at the stable entry point; retain accepted deployment rules."""
    original = module.Deployment

    class NetworkDeployment(original):
        def network_state(self):
            state = module.read_json(self.root / 'github-network.json', {})
            identity = {name: self.config[name] for name in ('repository', 'branch')}
            return state if all(state.get(k) == v for k, v in identity.items()) else identity

        def save_network(self, state):
            module.write_json(self.root / 'github-network.json', state)

        def api_credential(self):
            if not hasattr(self, '_github_credential'):
                self._github_credential = github_credential(self.config)
            return self._github_credential

        def api_state(self):
            state = self.network_state()
            authentication = 'git-credential' if self.api_credential() else 'anonymous'
            # Only a proven anonymous primary quota has a separate budget.
            # Retry-After, secondary limits and legacy unknown deadlines still
            # apply when a sign-in becomes available or unavailable.
            if state.get('authentication', 'anonymous') == 'anonymous' \
                    and authentication == 'git-credential' and state.get('limitScope') == 'anonymous':
                state = {name: self.config[name] for name in ('repository', 'branch')}
            return {**state, 'authentication': authentication}

        def defer_until(self, timestamp):
            deadline = time.strftime('%Y-%m-%d %H:%M:%S UTC', time.gmtime(timestamp))
            raise UpdateDeferred('GitHub check deferred until ' + deadline, timestamp)

        def download(self, url, destination):
            api = url.startswith('https://api.github.com/')
            credential = self.api_credential() if api else None
            with tempfile.TemporaryDirectory(dir=self.root) as directory:
                headers_path = Path(directory) / 'headers.txt'
                for attempt in range(2):
                    arguments = [str(self.config['curl']), '--disable', '--fail', '--silent', '--show-error',
                                 '--retry', '0', '--connect-timeout', '10',
                                 '--max-time', '45', '--user-agent', 'AI-WQS-Windows-Deployer',
                                 '--dump-header', str(headers_path), '--output', str(destination)]
                    if not api:
                        arguments += ['--location']
                    if credential:
                        # stdin keeps the token out of process arguments and files.
                        # API redirects are refused so it cannot reach another host.
                        arguments += ['--header', '@-']
                    # Some Windows proxy paths fail TLS negotiation; keep certificate checks.
                    if attempt:
                        arguments += ['--tlsv1.2', '--tls-max', '1.2']
                    headers_path.write_text('', encoding='utf-8')
                    result = subprocess.run(arguments + [url], env=network_environment(),
                                            input='Authorization: Bearer ' + credential + '\n' if credential else None,
                                            capture_output=True, text=True, encoding='utf-8', errors='replace',
                                            creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0)
                    headers = response_headers(headers_path)
                    status = headers.get(':status')
                    if api and (
                            status == '429' or status == '403' and (
                                headers.get('x-ratelimit-remaining') == '0' or 'retry-after' in headers)):
                        deadline = time.time() + 60
                        for name in ('x-ratelimit-reset', 'retry-after'):
                            try:
                                value = float(headers[name])
                                deadline = max(deadline, value + 5 if name == 'x-ratelimit-reset'
                                               else time.time() + value + 5)
                            except (KeyError, ValueError):
                                pass
                        state = self.api_state()
                        state['retryAt'] = deadline
                        state['limitScope'] = 'shared'
                        try:
                            if status == '403' and headers.get('x-ratelimit-remaining') == '0' and 'retry-after' not in headers \
                                    and float(headers['x-ratelimit-reset']) > time.time():
                                state['limitScope'] = state['authentication']
                        except (KeyError, ValueError):
                            pass
                        self.save_network(state)
                        self.defer_until(deadline)
                    if result.returncode == 0:
                        if api and status and not 200 <= int(status) < 300:
                            raise RuntimeError('Unexpected GitHub API HTTP ' + status)
                        if api:
                            state = self.api_state()
                            state.pop('retryAt', None)
                            state.pop('limitScope', None)
                            self.save_network(state)
                        return
                    transient = result.returncode in (5, 6, 7, 18, 28, 35, 52, 55, 56) or status in ('500', '502', '503', '504')
                    if attempt or not transient:
                        raise RuntimeError('GitHub download failed (curl exit ' + str(result.returncode)
                                           + ', HTTP ' + str(status or 'unavailable') + ')')
                    time.sleep(1)

        def github(self, suffix):
            state = self.network_state()
            if state.get('retryAt', 0) > time.time():
                state = self.api_state()
                if state.get('retryAt', 0) > time.time():
                    self.defer_until(state['retryAt'])
            branch = 'git/ref/heads/'
            if self.config.get('git') and suffix.startswith(branch):
                reference = 'refs/heads/' + self.config['branch']
                try:
                    result = subprocess.run([self.config['git'], '-c', 'http.sslVersion=tlsv1.2',
                                             '-c', 'http.version=HTTP/1.1', 'ls-remote', '--exit-code',
                                             'https://github.com/' + self.config['repository'] + '.git', reference],
                                            env=network_environment(), capture_output=True, text=True,
                                            encoding='utf-8', errors='replace', timeout=60,
                                            creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0)
                except (OSError, subprocess.TimeoutExpired):
                    result = None
                if result is not None and result.returncode == 0:
                    fields = result.stdout.strip().split()
                    if len(fields) != 2 or not re.fullmatch('[0-9a-f]{40}', fields[0]) or fields[1] != reference:
                        raise RuntimeError('Git returned an invalid branch revision')
                    if state.get('authentication') == 'git-credential' and state != self.network_state():
                        self.save_network(state)
                    return {'object': {'sha': fields[0]}}
                print('Git branch check unavailable; trying the scheduled REST check.', flush=True)
            state = self.api_state()
            if state.get('retryAt', 0) > time.time():
                self.defer_until(state['retryAt'])
            if not getattr(self, '_api_poll_started', False):
                if state.get('nextPollAt', 0) > time.time():
                    self.defer_until(state['nextPollAt'])
                state['nextPollAt'] = time.time() + 300
                self.save_network(state)
                self._api_poll_started = True
            return super().github(suffix)

        def update(self):
            self._api_poll_started = False
            try:
                return super().update()
            except UpdateDeferred as error:
                print(error, flush=True)
                return {'status': 'deferred', 'retryAt': error.retry_at}

    module.Deployment = NetworkDeployment
    return module


def load_implementation(root=ROOT):
    current = json.loads((root / 'current.json').read_text(encoding='utf-8-sig'))
    sha = current.get('sha', '')
    if not re.fullmatch('[0-9a-f]{40}', sha):
        raise RuntimeError('Invalid deployed revision')
    release = root / 'releases' / sha
    candidate = release / 'ops/windows/update-windows.py'
    native = (release / 'ops/windows/release.json').is_file() and candidate.is_file()
    if not native:
        candidate = root / 'legacy-updater.py'
    spec = importlib.util.spec_from_file_location('accepted_windows_updater', candidate)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    # The installed entry is stable; transport fixes must follow the same
    # accepted release as the core updater instead of freezing at install time.
    transport = release / 'ops/windows/updater-bootstrap.py'
    if native and transport.is_file() and transport.resolve() != Path(__file__).resolve():
        spec = importlib.util.spec_from_file_location('accepted_windows_transport', transport)
        accepted = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(accepted)
        return accepted.install_transport(module)
    return install_transport(module)


def __getattr__(name):
    global implementation
    if implementation is None:
        implementation = load_implementation()
    return getattr(implementation, name)


if __name__ == '__main__':
    if '--root' not in sys.argv:
        sys.argv += ['--root', str(ROOT)]
    sys.exit(__getattr__('main')())
