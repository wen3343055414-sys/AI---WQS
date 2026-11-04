import importlib.util
from contextlib import closing
import json
import os
from pathlib import Path
import shutil
import socket
import sqlite3
import subprocess
import sys
import tempfile
import time
import unittest
import urllib.request

spec = importlib.util.spec_from_file_location('admin_launcher', Path(__file__).parents[1] / 'admin/scripts/launcher.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
A = 'a' * 40
B, C = 'b' * 40, 'c' * 40
SOURCE = Path(__file__).parents[1] / 'admin'


class LauncherTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.home = self.root / 'AI-WQS-admin'
        self.home.mkdir()
        self.deployment = self.root / 'AI-WQS-local'
        self.deployment.mkdir()
        module.write_json(self.deployment / 'current.json', {'sha': A})

    def tearDown(self):
        self.temp.cleanup()

    def test_legacy_release_preserves_installed_admin_and_data(self):
        self.assertEqual(module.target(self.home, {}), (self.home, A))

    def test_selects_only_the_immutable_accepted_release(self):
        release = self.deployment / 'releases' / A
        module.write_json(release / 'ops/windows/release.json', {'schemaVersion': 1, 'nativeAdmin': True, 'modelBridge': True})
        for name in ('src/server.js', 'public/index.html', 'scripts/control.py', 'scripts/secret_store.py'):
            file = release / 'admin' / name
            file.parent.mkdir(parents=True, exist_ok=True)
            file.write_text('fixture', encoding='utf-8')
        self.assertEqual(module.target(self.home, {}), (release / 'admin', A))
        self.assertFalse((release / 'admin/data').exists())

    def test_incomplete_new_release_does_not_select_partial_code(self):
        module.write_json(self.deployment / 'releases' / A / 'ops/windows/release.json', {'schemaVersion': 1, 'nativeAdmin': True})
        with self.assertRaisesRegex(ValueError, 'Incomplete'):
            module.target(self.home, {})

    def test_untrusted_path_is_not_a_revision(self):
        module.write_json(self.deployment / 'current.json', {'sha': '../../outside'})
        with self.assertRaisesRegex(ValueError, 'Invalid deployed revision'):
            module.target(self.home, {})

    def test_running_admin_switches_source_preserves_login_and_recovers_failed_code(self):
        node = os.environ.get('AI_WQS_TEST_NODE') or shutil.which('node')
        self.assertTrue(node, 'Node.js 24 is required for the native launcher integration test')
        with socket.socket() as probe:
            probe.bind(('127.0.0.1', 0))
            port = probe.getsockname()[1]
        config = {'port': port, 'node': node, 'deploymentRoot': '../AI-WQS-local'}
        module.write_json(self.home / 'config.json', config)

        def copy_code(target):
            for name in ('src', 'public', 'scripts'):
                shutil.copytree(SOURCE / name, target / name, ignore=shutil.ignore_patterns('__pycache__'))
            shutil.copy2(SOURCE / 'package.json', target / 'package.json')

        copy_code(self.home)
        for revision in (B, C):
            release = self.deployment / 'releases' / revision
            copy_code(release / 'admin')
            module.write_json(release / 'ops/windows/release.json', {'schemaVersion': 1, 'nativeAdmin': True, 'modelBridge': True})
        good = self.deployment / 'releases' / B / 'admin'
        with (good / 'public/index.html').open('a', encoding='utf-8') as stream:
            stream.write('<!-- native-release-fixture -->')
        (self.deployment / 'releases' / C / 'admin/src/server.js').write_text('process.exit(12);', encoding='utf-8')
        child = subprocess.Popen([sys.executable, str(self.home / 'scripts/launcher.py')],
                                 env={**os.environ, 'AI_WQS_ADMIN_HOME': str(self.home)},
                                 stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        base = f'http://127.0.0.1:{port}'

        def wait_for(predicate, message):
            deadline = time.monotonic() + 20
            while time.monotonic() < deadline:
                if predicate():
                    return
                time.sleep(.15)
            self.fail(message)

        def session(cookie):
            request = urllib.request.Request(base + '/api/session', headers={'Cookie': cookie})
            with urllib.request.urlopen(request, timeout=2) as response:
                return json.load(response)

        try:
            wait_for(lambda: module.health(config, A), 'Initial installed admin did not start')
            request = urllib.request.Request(base + '/api/setup', method='POST',
                       headers={'Content-Type': 'application/json', 'Origin': base},
                       data=json.dumps({'password': 'fixture-launcher-password'}).encode())
            with urllib.request.urlopen(request, timeout=5) as response:
                self.assertEqual(response.status, 200)
                cookie = response.headers['Set-Cookie'].split(';')[0]
            database = self.home / 'data/admin.sqlite'
            with closing(sqlite3.connect(database)) as connection:
                connection.execute("INSERT INTO jobs VALUES ('fixture-update','update','running','2026-01-01T00:00:00Z',NULL,'fixture','')")
                connection.commit()
            token = (self.home / 'data/model-bridge-token').read_bytes()
            module.write_json(self.deployment / 'current.json', {'sha': B})
            time.sleep(2.5)
            self.assertTrue(module.health(config, A), 'Launcher interrupted an active admin update job')
            with closing(sqlite3.connect(database)) as connection:
                connection.execute("UPDATE jobs SET status='success' WHERE id='fixture-update'")
                connection.commit()
            wait_for(lambda: module.health(config, B), 'Accepted native source was not activated')
            self.assertTrue(session(cookie)['authenticated'])
            self.assertEqual((self.home / 'data/model-bridge-token').read_bytes(), token)
            self.assertEqual(module.read_json(self.home / 'config.json'), config)
            self.assertFalse((good / 'data').exists())
            with urllib.request.urlopen(base, timeout=2) as response:
                self.assertIn(b'native-release-fixture', response.read())

            module.write_json(self.deployment / 'current.json', {'sha': C})
            wait_for(lambda: module.read_json(self.home / 'data/runtime.json', {}).get('desiredRevision') == C,
                     'Bad native source was not rejected')
            self.assertTrue(module.health(config, B), 'Previous admin did not recover')
            self.assertTrue(session(cookie)['authenticated'])
        finally:
            state = module.read_json(self.home / 'data/runtime.json', {})
            child.terminate()
            child.wait(timeout=10)
            # Windows terminating a Python launcher does not signal its Node child.
            if state.get('pid'):
                if os.name == 'nt':
                    subprocess.run(['taskkill.exe', '/PID', str(state['pid']), '/F'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                else:
                    try:
                        os.kill(state['pid'], 15)
                    except ProcessLookupError:
                        pass


if __name__ == '__main__':
    unittest.main()
