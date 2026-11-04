import datetime as dt
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock
import zipfile


SCRIPT = Path(__file__).parents[1] / "ops/windows/update-windows.py"
spec = importlib.util.spec_from_file_location("windows_deployer", SCRIPT)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
A, B = "a" * 40, "b" * 40


def successful(sha):
    return {"workflow_runs": [{"head_sha": sha, "event": "push", "path": ".github/workflows/ci.yml",
                               "status": "completed", "conclusion": "success"}]}


class WindowsDeploymentTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        module.write_json(self.root / "config.json", {"repository": "example/workbench", "branch": "development"})
        self.deployment = module.Deployment(self.root)
        self.deployment.docker = Mock()
        self.deployment.maintain = Mock()
        self.deployment.prepare_release = Mock()
        self.deployment.compose = Mock()
        self.deployment.backup = Mock()
        self.deployment.start = Mock()
        self.deployment.backup_admin = Mock()

    def tearDown(self):
        self.temporary.cleanup()

    def current(self):
        value = {"sha": A, "previous": None, "updatedAt": module.now(), "lastBackup": module.now()}
        module.write_json(self.deployment.current_path, value)
        return value

    def test_only_exact_successful_push_ci_is_accepted(self):
        self.assertTrue(module.checks_passed(successful(A), A))
        for change in ({"head_sha": B}, {"event": "pull_request"}, {"conclusion": "failure"},
                       {"status": "in_progress"}, {"path": ".github/workflows/deploy-pages.yml"}):
            run = successful(A)["workflow_runs"][0] | change
            self.assertFalse(module.checks_passed({"workflow_runs": [run]}, A))

    def test_ci_failure_never_builds_or_replaces_current(self):
        original = self.current()
        self.deployment.github = Mock(side_effect=[{"object": {"sha": B}}, {"status": "ahead"}, {"workflow_runs": []}])
        self.deployment.update()
        self.deployment.compose.assert_not_called()
        self.deployment.start.assert_not_called()
        self.assertEqual(module.read_json(self.deployment.current_path), original)

    def test_branch_rewind_never_replaces_running_release(self):
        self.current()
        self.deployment.github = Mock(side_effect=[{"object": {"sha": B}}, {"status": "diverged"}])
        with self.assertRaisesRegex(RuntimeError, "rewound or diverged"):
            self.deployment.update()
        self.deployment.compose.assert_not_called()
        self.deployment.start.assert_not_called()

    def test_failed_start_restores_previous_release_and_blocks_retry(self):
        original = self.current()
        self.deployment.github = Mock(side_effect=[{"object": {"sha": B}}, {"status": "ahead"}, successful(B)])
        self.deployment.start.side_effect = [RuntimeError("unhealthy"), None]
        with self.assertRaisesRegex(RuntimeError, "unhealthy"):
            self.deployment.update()
        self.assertEqual([call.args[0] for call in self.deployment.start.call_args_list], [B, A])
        self.deployment.backup.assert_called_once_with(A)
        self.assertEqual(module.read_json(self.deployment.current_path), original)
        self.assertEqual(module.read_json(self.deployment.failed_path)["sha"], B)
        self.deployment.start.reset_mock()
        self.deployment.github = Mock(return_value={"object": {"sha": B}})
        self.deployment.update()
        self.deployment.start.assert_not_called()

    def test_success_records_version_only_after_health_checked_start(self):
        self.current()
        self.deployment.github = Mock(side_effect=[{"object": {"sha": B}}, {"status": "ahead"}, successful(B)])
        self.deployment.start.side_effect = lambda sha: self.assertEqual(module.read_json(self.deployment.current_path)["sha"], A)
        self.deployment.update()
        state = module.read_json(self.deployment.current_path)
        self.assertEqual((state["sha"], state["previous"]), (B, A))

    def test_daily_backup_runs_even_without_a_new_release(self):
        old = (dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=2)).isoformat()
        current = {"sha": A, "updatedAt": old, "lastBackup": old}
        self.deployment.health = Mock()
        module.Deployment.maintain(self.deployment, current)
        self.deployment.backup.assert_called_once_with(A)
        self.assertNotEqual(module.read_json(self.deployment.current_path)["lastBackup"], old)

    def test_archive_traversal_is_rejected_before_extraction(self):
        self.deployment.prepare_release = module.Deployment.prepare_release.__get__(self.deployment)
        def unsafe_archive(url, destination):
            with zipfile.ZipFile(destination, "w") as archive:
                archive.writestr("root/../../escaped.txt", "unsafe")
        self.deployment.download = unsafe_archive
        with self.assertRaisesRegex(ValueError, "Unsafe source archive"):
            self.deployment.prepare_release(A)
        self.assertFalse((self.root / "escaped.txt").exists())
        self.assertFalse(self.deployment.release(A).exists())

    def test_second_process_lock_is_rejected(self):
        with module.deployment_lock(self.root / "test.lock"):
            with self.assertRaises(BlockingIOError):
                with module.deployment_lock(self.root / "test.lock"):
                    self.fail("Concurrent deployment entered the lock")

    def test_native_source_is_used_without_reapplying_the_legacy_patch(self):
        release = self.deployment.release(B)
        (release / 'ops/windows').mkdir(parents=True)
        module.write_json(release / 'ops/windows/release.json', {'schemaVersion': 1, 'nativeAdmin': True, 'modelBridge': True})
        self.deployment.config.update(modelIntegration=True, project='test', port=3000)
        self.deployment.compose = module.Deployment.compose.__get__(self.deployment)
        self.deployment.compose(B, ['config', '--quiet'])
        arguments = self.deployment.docker.call_args.args[0]
        self.assertIn(release / 'ops/windows/compose.models.yaml', arguments)
        self.assertIn(release, arguments)
        self.assertFalse((self.root / 'integrated').exists())

    def test_admin_failure_restores_containers_and_the_previous_release_pointer(self):
        original = self.current()
        self.deployment.verify_admin = Mock(side_effect=RuntimeError('admin unhealthy'))
        with self.assertRaisesRegex(RuntimeError, 'admin unhealthy'):
            self.deployment.activate(B, original)
        self.assertEqual(module.read_json(self.deployment.current_path), original)
        self.deployment.start.assert_called_once_with(A)
        self.assertEqual(module.read_json(self.deployment.failed_path)['sha'], B)

    def test_admin_started_update_defers_restart_until_the_job_can_finish(self):
        original = self.current()
        self.deployment.config['deferAdminVerification'] = True
        self.deployment.verify_admin = Mock()
        self.deployment.activate(B, original)
        self.deployment.verify_admin.assert_not_called()
        pending = module.read_json(self.deployment.current_path)
        self.assertEqual(pending['verification'], 'pending-admin')
        self.deployment.complete_activation(pending)
        self.deployment.verify_admin.assert_called_once_with(B)
        complete = module.read_json(self.deployment.current_path)
        self.assertEqual(complete['verification'], 'verified')
        self.assertNotIn('rollbackState', complete)

    def test_unsupported_release_manifest_is_rejected(self):
        manifest = self.deployment.release(B) / 'ops/windows/release.json'
        module.write_json(manifest, {'schemaVersion': 99, 'nativeAdmin': True, 'modelBridge': True})
        with self.assertRaisesRegex(RuntimeError, 'Unsupported'):
            self.deployment.native_release(B)

    def test_rollback_records_the_rejected_revision_and_retains_newer_data(self):
        current = self.current()
        current['previous'] = B
        module.write_json(self.deployment.current_path, current)
        self.deployment.rollback()
        self.deployment.backup.assert_called_once_with(A)
        self.deployment.backup_admin.assert_called_once_with()
        self.deployment.start.assert_called_once_with(B)
        self.assertEqual(module.read_json(self.deployment.current_path)['sha'], B)
        self.assertEqual(module.read_json(self.deployment.failed_path)['sha'], A)

    def test_partial_native_archive_is_rejected_before_any_container_switch(self):
        release = self.deployment.release(B)
        for name in ('compose.yaml', 'Dockerfile', 'src/server.js', 'src/backup.mjs'):
            file = release / name
            file.parent.mkdir(parents=True, exist_ok=True)
            file.write_text('fixture', encoding='utf-8')
        module.write_json(release / 'ops/windows/release.json', {'schemaVersion': 1, 'nativeAdmin': True, 'modelBridge': True})
        with self.assertRaisesRegex(ValueError, 'Missing release file: admin/src/server.js'):
            self.deployment.validate_release(release)
        self.deployment.start.assert_not_called()


if __name__ == "__main__":
    unittest.main(verbosity=2)
