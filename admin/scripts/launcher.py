"""Follow the verified release, retaining local configuration and DPAPI data."""
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile
import time
import urllib.request


def read_json(file, default=None):
    return json.loads(file.read_text(encoding='utf-8-sig')) if file.exists() else default


def write_json(file, value):
    file.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(mode='w', encoding='utf-8', dir=file.parent, delete=False) as stream:
        json.dump(value, stream, ensure_ascii=False, indent=2)
        temporary = stream.name
    os.replace(temporary, file)


def target(home, config):
    deployment = (home / config.get('deploymentRoot', '../AI-WQS-local')).resolve()
    sha = read_json(deployment / 'current.json', {}).get('sha')
    if not re.fullmatch('[0-9a-f]{40}', sha or ''):
        raise ValueError('Invalid deployed revision; admin code was not switched')
    release = deployment / 'releases' / sha
    marker = read_json(release / 'ops/windows/release.json')
    if marker is None:
        return home, sha
    if marker.get('schemaVersion') != 1 or marker.get('nativeAdmin') is not True:
        raise ValueError('Unsupported native admin release manifest')
    code = (release / 'admin').resolve()
    if not code.is_relative_to(release.resolve()) or not all((code / name).is_file() for name in ('src/server.js', 'public/index.html', 'scripts/control.py', 'scripts/secret_store.py')):
        raise ValueError('Incomplete native admin release')
    return code, sha


def health(config, revision):
    try:
        with urllib.request.urlopen(f"http://127.0.0.1:{config['port']}/api/health", timeout=2) as response:
            data = json.load(response)
        return data.get('status') == 'ok' and data.get('revision') == revision and not data.get('draining')
    except Exception:
        return False


def internal(home, config, drain=False):
    token = (home / 'data/model-bridge-token').read_text(encoding='utf-8').strip()
    request = urllib.request.Request(
        f"http://127.0.0.1:{config['port']}/internal/model/" + ('drain' if drain else 'runtime'),
        method='POST' if drain else 'GET', headers={'X-Model-Bridge': token}, data=b'' if drain else None)
    with urllib.request.urlopen(request, timeout=3) as response:
        return json.load(response)


def stop(child):
    if child and child.poll() is None:
        child.terminate()
        try:
            child.wait(timeout=8)
        except subprocess.TimeoutExpired:
            child.kill()
            child.wait(timeout=5)


def start(home, config, selected, output):
    code, revision = selected
    child = subprocess.Popen([config['node'], str(code / 'src/server.js')], cwd=code,
                             env={**os.environ, 'AI_WQS_ADMIN_HOME': str(home), 'APP_VERSION': revision},
                             stdout=output, stderr=output,
                             creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0)
    deadline = time.monotonic() + 30
    while child.poll() is None and time.monotonic() < deadline:
        if health(config, revision):
            return child
        time.sleep(.3)
    stop(child)
    raise RuntimeError('Native admin failed its revision health check')


def main():
    home = Path(os.environ.get('AI_WQS_ADMIN_HOME', Path(__file__).resolve().parents[1])).resolve()
    config = read_json(home / 'config.json')
    log = home / 'server.log'
    if log.exists() and log.stat().st_size > 5_000_000:
        os.replace(log, home / 'server.log.1')
    state = home / 'data/runtime.json'
    selected, child, failed = target(home, config), None, None
    with log.open('a', encoding='utf-8', buffering=1) as output:
        try:
            child = start(home, config, selected, output)
            write_json(state, {'revision': selected[1], 'status': 'ready', 'pid': child.pid})
            while True:
                time.sleep(2)
                if child.poll() is not None:
                    raise RuntimeError('Native admin exited; Task Scheduler will restart its launcher')
                try:
                    wanted = target(home, config)
                except (OSError, ValueError):
                    write_json(state, {'revision': selected[1], 'status': 'failed', 'message': 'Invalid release; retained running admin.', 'pid': child.pid})
                    continue
                if wanted == selected or wanted == failed:
                    continue
                # Finish the update job before draining writes and model calls.
                try:
                    active = internal(home, config)
                    if active.get('activeJobs') or active.get('activeCalls'):
                        continue
                    active = internal(home, config, drain=True)
                except (OSError, ValueError):
                    # A transient bridge error must not terminate the healthy child.
                    continue
                if not active.get('draining') or active.get('activeJobs') or active.get('activeCalls'):
                    continue
                previous = selected
                stop(child)
                try:
                    child = start(home, config, wanted, output)
                    selected = wanted
                    failed = None
                    write_json(state, {'revision': selected[1], 'status': 'ready', 'pid': child.pid})
                except Exception:
                    child = start(home, config, previous, output)
                    failed = wanted
                    write_json(state, {'revision': previous[1], 'desiredRevision': wanted[1], 'status': 'failed',
                                       'message': 'New admin failed health checks; restored previous code.', 'pid': child.pid})
        finally:
            stop(child)


if __name__ == '__main__':
    main()
