import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest
from unittest.mock import Mock, patch


WINDOWS = Path(__file__).parents[1] / 'ops/windows'
spec = importlib.util.spec_from_file_location('updater_bootstrap', WINDOWS / 'updater-bootstrap.py')
bootstrap = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bootstrap)
A, B = 'a' * 40, 'b' * 40


class UpdaterNetworkTests(unittest.TestCase):
    def setUp(self):
        credential = patch.object(bootstrap, 'github_credential', return_value=None)
        self.credential = credential.start()
        self.addCleanup(credential.stop)
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        spec = importlib.util.spec_from_file_location('network_test_updater', WINDOWS / 'update-windows.py')
        self.module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.module)
        self.module.write_json(self.root / 'config.json', {
            'repository': 'example/workbench', 'branch': 'main', 'curl': 'curl.exe', 'git': 'git.exe'})
        self.module.write_json(self.root / 'current.json', {'sha': A})
        bootstrap.install_transport(self.module)
        self.service = self.module.Deployment(self.root)

    def curl_response(self, status=200, headers='', payload=None, code=0):
        def respond(arguments, **kwargs):
            Path(arguments[arguments.index('--dump-header') + 1]).write_text(
                'HTTP/1.1 200 Connection established\n\nHTTP/2 ' + str(status) + '\n' + headers,
                encoding='utf-8')
            if code == 0:
                Path(arguments[arguments.index('--output') + 1]).write_text(
                    json.dumps(payload or {'object': {'sha': B}}), encoding='utf-8')
            return subprocess.CompletedProcess(arguments, code, '', '')
        return respond

    def test_no_proxy_alone_does_not_hide_the_windows_proxy(self):
        with patch.dict(os.environ, {'NO_PROXY': 'localhost,127.0.0.1'}, clear=True), \
                patch.object(bootstrap.urllib.request, 'getproxies_registry',
                             return_value={'https': 'http://proxy.example:8080'}, create=True):
            environment = bootstrap.network_environment()
        self.assertEqual(environment['https_proxy'], 'http://proxy.example:8080')
        self.assertEqual(environment['no_proxy'], 'localhost,127.0.0.1')
        self.assertEqual(environment['GIT_TERMINAL_PROMPT'], '0')

    def test_explicit_proxy_takes_precedence_over_windows_settings(self):
        with patch.dict(os.environ, {'HTTPS_PROXY': 'http://chosen.example:8080'}, clear=True), \
                patch.object(bootstrap.urllib.request, 'getproxies_registry', create=True) as registry:
            environment = bootstrap.network_environment()
        self.assertEqual(environment['https_proxy'], 'http://chosen.example:8080')
        registry.assert_not_called()

    def test_unchanged_git_revision_never_consumes_the_rest_budget(self):
        self.service.docker = Mock()
        self.service.maintain = Mock()
        with patch.object(bootstrap.subprocess, 'run', return_value=
                          subprocess.CompletedProcess([], 0, A + '\trefs/heads/main\n', '')) as run:
            self.assertEqual(self.service.update(), {'status': 'current', 'currentSha': A})
        self.assertEqual(run.call_count, 1)
        self.assertIn('ls-remote', run.call_args.args[0])
        self.assertFalse((self.root / 'github-network.json').exists())
        self.service.maintain.assert_called_once()

    def test_git_response_must_match_the_exact_configured_branch(self):
        for output in (B + '\trefs/heads/other\n', 'not-a-sha\trefs/heads/main\n',
                       B + '\trefs/heads/main\n' + A + '\trefs/heads/main\n'):
            with self.subTest(output=output), patch.object(bootstrap.subprocess, 'run', return_value=
                    subprocess.CompletedProcess([], 0, output, '')):
                with self.assertRaisesRegex(RuntimeError, 'invalid branch'):
                    self.service.github('git/ref/heads/main')

    def test_missing_or_timed_out_git_uses_the_rate_limited_rest_fallback(self):
        for error in (FileNotFoundError('Git was moved'), subprocess.TimeoutExpired('git', 60)):
            with self.subTest(error=error):
                service = self.module.Deployment(self.root)
                respond = self.curl_response()
                def command(arguments, **kwargs):
                    if 'ls-remote' in arguments:
                        raise error
                    return respond(arguments, **kwargs)
                with patch.object(bootstrap.time, 'time', return_value=1000), \
                        patch.object(bootstrap.subprocess, 'run', side_effect=command) as run:
                    self.assertEqual(service.github('git/ref/heads/main')['object']['sha'], B)
                self.assertEqual(run.call_count, 2)
                (self.root / 'github-network.json').unlink()

    def test_hard_cooldown_skips_git_and_rest_before_taking_time_from_management(self):
        self.service.save_network(self.service.network_state() | {'retryAt': 5000})
        with patch.object(bootstrap.time, 'time', return_value=1000), \
                patch.object(bootstrap.subprocess, 'run') as run:
            with self.assertRaises(bootstrap.UpdateDeferred) as deferred:
                self.service.github('git/ref/heads/main')
        self.assertEqual(deferred.exception.retry_at, 5000)
        run.assert_not_called()

    def test_existing_sign_in_uses_its_own_budget_and_keeps_the_secret_out_of_arguments(self):
        self.service.save_network(self.service.network_state() | {
            'retryAt': 5000, 'nextPollAt': 4000, 'limitScope': 'anonymous'})
        self.credential.return_value = 'fixture-token'
        with patch.object(bootstrap.time, 'time', return_value=1000), \
                patch.object(bootstrap.subprocess, 'run', side_effect=self.curl_response()) as run:
            self.assertEqual(self.service.github('actions/runs')['object']['sha'], B)
        arguments = run.call_args.args[0]
        self.assertNotIn('fixture-token', ' '.join(arguments))
        self.assertEqual(run.call_args.kwargs['input'], 'Authorization: Bearer fixture-token\n')
        self.assertIn('@-', arguments)
        self.assertNotIn('--location', arguments)
        self.assertEqual(arguments[1], '--disable')
        state = self.module.read_json(self.root / 'github-network.json')
        self.assertEqual(state['authentication'], 'git-credential')
        self.assertNotIn('retryAt', state)
        self.assertNotIn('fixture-token', (self.root / 'github-network.json').read_text())
        self.assertEqual(state['nextPollAt'], 1300)
        self.credential.assert_called_once_with(self.service.config)

    def test_authenticated_rate_limit_survives_restarts_and_is_not_retried_anonymously(self):
        self.credential.return_value = 'fixture-token'
        with patch.object(bootstrap.time, 'time', return_value=1000), \
                patch.object(bootstrap.subprocess, 'run', side_effect=self.curl_response(
                    403, 'X-RateLimit-Remaining: 0\nX-RateLimit-Reset: 5000\n', code=22)) as run:
            with self.assertRaises(bootstrap.UpdateDeferred):
                self.service.github('actions/runs')
            second = self.module.Deployment(self.root)
            with self.assertRaises(bootstrap.UpdateDeferred):
                second.github('git/ref/heads/main')
        self.assertEqual(run.call_count, 1)
        self.assertEqual(second.network_state()['authentication'], 'git-credential')

    def test_successful_git_check_clears_a_stale_anonymous_wait_for_an_existing_sign_in(self):
        self.service.save_network(self.service.network_state() | {'retryAt': 5000, 'limitScope': 'anonymous'})
        self.credential.return_value = 'fixture-token'
        self.service.docker = Mock()
        self.service.maintain = Mock()
        with patch.object(bootstrap.time, 'time', return_value=1000), \
                patch.object(bootstrap.subprocess, 'run', return_value=
                             subprocess.CompletedProcess([], 0, A + '\trefs/heads/main\n', '')) as run:
            self.assertEqual(self.service.update(), {'status': 'current', 'currentSha': A})
        self.assertEqual(run.call_count, 1)
        self.assertEqual(self.service.network_state()['authentication'], 'git-credential')
        self.assertNotIn('retryAt', self.service.network_state())

    def test_api_redirects_are_refused_and_other_hosts_never_receive_credentials(self):
        self.credential.return_value = 'fixture-token'
        with patch.object(bootstrap.subprocess, 'run', side_effect=self.curl_response(302)) as run:
            with self.assertRaisesRegex(RuntimeError, 'HTTP 302'):
                self.service.github('actions/runs')
        self.assertNotIn('--location', run.call_args.args[0])
        with patch.object(bootstrap.subprocess, 'run', side_effect=self.curl_response()) as run:
            self.service.download('https://codeload.github.com/example/workbench/zip/' + B, self.root / 'zip')
        self.assertNotIn('--header', run.call_args.args[0])
        self.assertIsNone(run.call_args.kwargs['input'])
        self.assertIn('--location', run.call_args.args[0])

    def test_secondary_and_unknown_cooldowns_survive_changes_in_authentication(self):
        for state in ({'retryAt': 5000}, {'retryAt': 5000, 'limitScope': 'shared'},
                      {'retryAt': 5000, 'limitScope': 'git-credential', 'authentication': 'git-credential'}):
            with self.subTest(state=state):
                self.service.save_network(self.service.network_state() | state)
                self.credential.return_value = 'fixture-token' if 'authentication' not in state else None
                service = self.module.Deployment(self.root)
                with patch.object(bootstrap.time, 'time', return_value=1000), \
                        patch.object(bootstrap.subprocess, 'run') as run:
                    with self.assertRaises(bootstrap.UpdateDeferred):
                        service.github('git/ref/heads/main')
                run.assert_not_called()

    def test_retry_after_remains_shared_even_when_remaining_is_zero(self):
        with patch.object(bootstrap.time, 'time', return_value=1000), \
                patch.object(bootstrap.subprocess, 'run', side_effect=self.curl_response(
                    429, 'Retry-After: 120\nX-RateLimit-Remaining: 0\nX-RateLimit-Reset: 5000\n', code=22)):
            with self.assertRaises(bootstrap.UpdateDeferred):
                self.service.github('actions/runs')
        self.assertEqual(self.service.network_state()['limitScope'], 'shared')
        self.credential.return_value = 'fixture-token'
        with patch.object(bootstrap.time, 'time', return_value=1000), \
                patch.object(bootstrap.subprocess, 'run') as run:
            with self.assertRaises(bootstrap.UpdateDeferred):
                self.module.Deployment(self.root).github('actions/runs')
        run.assert_not_called()

    def test_429_without_retry_after_is_also_treated_as_a_shared_wait(self):
        with patch.object(bootstrap.time, 'time', return_value=1000), \
                patch.object(bootstrap.subprocess, 'run', side_effect=self.curl_response(
                    429, 'X-RateLimit-Remaining: 0\nX-RateLimit-Reset: 5000\n', code=22)):
            with self.assertRaises(bootstrap.UpdateDeferred):
                self.service.github('actions/runs')
        self.assertEqual(self.service.network_state()['limitScope'], 'shared')

    def test_rejected_sign_in_is_reported_without_exposing_or_deleting_it(self):
        self.credential.return_value = 'fixture-token'
        with patch.object(bootstrap.subprocess, 'run', side_effect=self.curl_response(401, code=22)) as run:
            with self.assertRaisesRegex(RuntimeError, 'HTTP 401') as error:
                self.service.github('actions/runs')
        self.assertNotIn('fixture-token', str(error.exception))
        self.assertEqual(run.call_count, 1)

    def test_rate_limit_stops_immediately_and_persists_until_reset(self):
        self.service.config.pop('git')
        with patch.object(bootstrap.time, 'time', return_value=1000), \
                patch.object(bootstrap.subprocess, 'run', side_effect=self.curl_response(
                    403, 'X-RateLimit-Remaining: 0\nX-RateLimit-Reset: 5000\n', code=22)) as run:
            with self.assertRaises(bootstrap.UpdateDeferred):
                self.service.github('git/ref/heads/main')
            self.assertEqual(run.call_count, 1)
            state = self.module.read_json(self.root / 'github-network.json')
            self.assertGreaterEqual(state['retryAt'], 5000)
            second = self.module.Deployment(self.root)
            second.config.pop('git')
            with self.assertRaises(bootstrap.UpdateDeferred):
                second.github('git/ref/heads/main')
            self.assertEqual(run.call_count, 1)

    def test_retry_after_is_honored_without_sleeping_in_the_task(self):
        with patch.object(bootstrap.time, 'time', return_value=1000), \
                patch.object(bootstrap.subprocess, 'run', side_effect=self.curl_response(
                    429, 'Retry-After: 120\n', code=22)) as run, \
                patch.object(bootstrap.time, 'sleep') as sleep:
            with self.assertRaises(bootstrap.UpdateDeferred):
                self.service.download('https://api.github.com/repos/example/workbench/actions/runs', self.root / 'out')
        self.assertEqual(run.call_count, 1)
        self.assertGreaterEqual(self.module.read_json(self.root / 'github-network.json')['retryAt'], 1120)
        sleep.assert_not_called()

    def test_permission_error_is_reported_and_never_retried_as_rate_limiting(self):
        with patch.object(bootstrap.subprocess, 'run', side_effect=self.curl_response(403, code=22)) as run:
            with self.assertRaisesRegex(RuntimeError, 'HTTP 403'):
                self.service.download('https://api.github.com/repos/example/workbench', self.root / 'out')
        self.assertEqual(run.call_count, 1)
        self.assertFalse((self.root / 'github-network.json').exists())

    def test_rest_poll_interval_survives_process_restarts(self):
        self.service.config.pop('git')
        with patch.object(bootstrap.time, 'time', return_value=1000), \
                patch.object(bootstrap.subprocess, 'run', side_effect=self.curl_response()) as run:
            self.assertEqual(self.service.github('git/ref/heads/main')['object']['sha'], B)
            # Other proof requests in this same update remain possible.
            self.service.github('compare/' + A + '...' + B)
            second = self.module.Deployment(self.root)
            second.config.pop('git')
            with self.assertRaises(bootstrap.UpdateDeferred):
                second.github('git/ref/heads/main')
        self.assertEqual(run.call_count, 2)

    def test_deferred_update_still_maintains_the_running_release(self):
        self.service.docker = Mock()
        self.service.maintain = Mock()
        self.service.save_network(self.service.network_state() | {'retryAt': 5000})
        with patch.object(bootstrap.time, 'time', return_value=1000), \
                patch.object(bootstrap.subprocess, 'run') as run:
            self.assertEqual(self.service.update(), {'status': 'deferred', 'retryAt': 5000})
        self.service.maintain.assert_called_once()
        run.assert_not_called()
        self.assertEqual(self.module.read_json(self.root / 'current.json')['sha'], A)

    def test_tls_fallback_keeps_certificate_verification(self):
        responses = [self.curl_response(code=35), self.curl_response()]
        with patch.object(bootstrap.subprocess, 'run', side_effect=lambda *a, **k: responses.pop(0)(*a, **k)) as run, \
                patch.object(bootstrap.time, 'sleep'):
            self.service.download('https://codeload.github.com/example/workbench/zip/' + B, self.root / 'out')
        self.assertEqual(run.call_count, 2)
        fallback = run.call_args.args[0]
        self.assertIn('--tls-max', fallback)
        self.assertNotIn('--insecure', fallback)
        self.assertNotIn('--retry-all-errors', fallback)

    def test_certificate_failure_is_not_retried_or_ignored(self):
        with patch.object(bootstrap.subprocess, 'run', side_effect=self.curl_response(code=60)) as run:
            with self.assertRaisesRegex(RuntimeError, 'curl exit 60'):
                self.service.download('https://codeload.github.com/example/workbench/zip/' + B, self.root / 'out')
        self.assertEqual(run.call_count, 1)

    def test_changing_repository_does_not_reuse_another_repositories_deadline(self):
        self.service.save_network({'repository': 'other/project', 'branch': 'main', 'retryAt': 99999})
        self.assertNotIn('retryAt', self.service.network_state())

    def test_loader_follows_only_the_accepted_release_without_modifying_it(self):
        release = self.root / 'releases' / A / 'ops/windows'
        release.mkdir(parents=True)
        shutil.copy2(WINDOWS / 'update-windows.py', release / 'update-windows.py')
        (release / 'release.json').write_text('{}', encoding='utf-8')
        before = (release / 'update-windows.py').read_bytes()
        loaded = bootstrap.load_implementation(self.root)
        self.assertEqual(loaded.Deployment(self.root).current_path, (self.root / 'current.json').resolve())
        self.assertEqual((release / 'update-windows.py').read_bytes(), before)
        self.module.write_json(self.root / 'current.json', {'sha': '../../outside'})
        with self.assertRaisesRegex(RuntimeError, 'Invalid deployed'):
            bootstrap.load_implementation(self.root)

    def test_loader_follows_the_accepted_transports_updates(self):
        for sha, version in ((A, 'first'), (B, 'second')):
            release = self.root / 'releases' / sha / 'ops/windows'
            release.mkdir(parents=True)
            shutil.copy2(WINDOWS / 'update-windows.py', release / 'update-windows.py')
            (release / 'release.json').write_text('{}', encoding='utf-8')
            transport = release / 'updater-bootstrap.py'
            transport.write_text('def install_transport(module):\n    module.transport_version = '
                                 + repr(version) + '\n    return module\n', encoding='utf-8')
            before = transport.read_bytes()
            self.module.write_json(self.root / 'current.json', {'sha': sha})
            loaded = bootstrap.load_implementation(self.root)
            self.assertEqual(loaded.transport_version, version)
            self.assertEqual(transport.read_bytes(), before)

    def test_partial_release_never_loads_transport_without_the_native_marker(self):
        release = self.root / 'releases' / A / 'ops/windows'
        release.mkdir(parents=True)
        shutil.copy2(WINDOWS / 'update-windows.py', release / 'update-windows.py')
        shutil.copy2(WINDOWS / 'update-windows.py', self.root / 'legacy-updater.py')
        (release / 'updater-bootstrap.py').write_text('raise AssertionError("Unaccepted transport")', encoding='utf-8')
        loaded = bootstrap.load_implementation(self.root)
        self.assertEqual(Path(loaded.__file__), self.root / 'legacy-updater.py')


class ExistingGitCredentialTests(unittest.TestCase):
    def test_noninteractive_helper_output_is_only_returned_in_memory(self):
        with patch.object(bootstrap.subprocess, 'run', return_value=subprocess.CompletedProcess(
                [], 0, 'protocol=https\nhost=github.com\nusername=example\npassword=fixture-token\n', '')) as run:
            self.assertEqual(bootstrap.github_credential({'git': 'git.exe', 'repository': 'example/workbench'}),
                             'fixture-token')
        self.assertIn('credential.interactive=never', run.call_args.args[0])
        self.assertIn('core.askPass=', run.call_args.args[0])
        self.assertEqual(run.call_args.kwargs['input'],
                         'protocol=https\nhost=github.com\npath=example/workbench.git\n\n')
        self.assertEqual(run.call_args.kwargs['env']['GCM_INTERACTIVE'], 'never')
        self.assertEqual(run.call_args.kwargs['env']['GIT_TERMINAL_PROMPT'], '0')
        self.assertEqual(run.call_args.kwargs['env']['GIT_ASKPASS'], '')
        self.assertEqual(run.call_args.kwargs['env']['SSH_ASKPASS'], '')
        self.assertEqual(run.call_args.kwargs['timeout'], 10)

    def test_missing_unavailable_and_unsafe_credentials_use_the_public_transport(self):
        config = {'git': 'git.exe', 'repository': 'example/workbench'}
        self.assertIsNone(bootstrap.github_credential({}))
        for result in (FileNotFoundError(), subprocess.TimeoutExpired('git', 10),
                       subprocess.CompletedProcess([], 1, 'password=fixture-token\n', ''),
                       subprocess.CompletedProcess([], 0, 'username=example\n', ''),
                       subprocess.CompletedProcess([], 0, 'password=bad\x01token\n', '')):
            with self.subTest(result=type(result).__name__), \
                    patch.object(bootstrap.subprocess, 'run', side_effect=[result]):
                self.assertIsNone(bootstrap.github_credential(config))


if __name__ == '__main__':
    unittest.main()
