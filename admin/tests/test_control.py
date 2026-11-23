import contextlib
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import types
import unittest
from unittest.mock import patch

SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"
sys.path.insert(0, str(SCRIPTS))
import control


class ControlTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.directory = Path(self.temp.name)
        (self.directory / "data").mkdir()
        self.current = {"sha": "a" * 40, "previous": None, "lastBackup": "old"}
        self.events = []
        self.task_enabled = True
        self.state_path = self.directory / "data/maintenance.json"
        test = self

        class Service:
            config = {}
            current_path = test.directory / "current.json"
            def release(self, sha): return test.directory / sha
            def validate_release(self, release): pass
            def compose(self, sha, arguments): test.events.append(("compose", arguments[0]))
            def start(self, sha): test.events.append(("start", sha))
            def backup(self, sha): test.events.append(("backup", sha))
            def update(self): test.events.append(("update",))
            def rollback(self): test.events.append(("rollback",))

        self.service = Service()
        @contextlib.contextmanager
        def lock(path):
            test.events.append(("lock",))
            yield
            test.events.append(("unlock",))
        def read(path, fallback=None):
            return json.loads(path.read_text()) if path.exists() else fallback
        def write(path, value): path.write_text(json.dumps(value))
        write(self.service.current_path, self.current)
        self.deployer = types.SimpleNamespace(Deployment=lambda root: self.service, read_json=read, write_json=write,
                                             deployment_lock=lock, now=lambda: "2026-11-02T01:00:00+00:00")
        self.spec = types.SimpleNamespace(loader=types.SimpleNamespace(exec_module=lambda module: None))
        def task(action, exe):
            self.events.append(("task", action))
            if action == "disable": self.task_enabled = False
            if action == "enable": self.task_enabled = True
            return {"enabled": self.task_enabled}
        self.task = task

    def tearDown(self): self.temp.cleanup()

    def execute(self, action):
        with patch.object(sys, "argv", ["control.py", action, str(self.directory), str(self.directory), "schtasks.exe"]), \
             patch.object(control.importlib.util, "spec_from_file_location", return_value=self.spec), \
             patch.object(control.importlib.util, "module_from_spec", return_value=self.deployer), \
             patch.object(control, "control_task", side_effect=self.task):
            return control.main()

    def test_stop_disables_updater_before_stopping_and_preserves_prior_setting(self):
        self.assertTrue(self.execute("stop")["ok"])
        self.assertLess(self.events.index(("task", "disable")), self.events.index(("compose", "stop")))
        self.assertEqual(self.events[0], ("lock",))
        state = json.loads(self.state_path.read_text())
        self.assertTrue(state["stoppedByAdmin"])
        self.assertTrue(state["previousUpdateEnabled"])
        self.assertFalse(self.task_enabled)

    def test_start_restores_updater_only_after_service_health_check(self):
        self.state_path.write_text(json.dumps({"stoppedByAdmin": True, "previousUpdateEnabled": True}))
        self.task_enabled = False
        self.execute("start")
        self.assertLess(self.events.index(("start", "a" * 40)), self.events.index(("task", "enable")))
        self.assertTrue(self.task_enabled)
        self.assertFalse(json.loads(self.state_path.read_text())["stoppedByAdmin"])

    def test_start_keeps_manual_update_pause(self):
        self.state_path.write_text(json.dumps({"stoppedByAdmin": True, "previousUpdateEnabled": False}))
        self.task_enabled = False
        self.execute("start")
        self.assertFalse(self.task_enabled)
        self.assertNotIn(("task", "enable"), self.events)

    def test_repeat_stop_does_not_lose_prior_update_setting(self):
        self.execute("stop")
        self.execute("stop")
        self.assertTrue(json.loads(self.state_path.read_text())["previousUpdateEnabled"])

    def test_updater_cannot_resume_while_service_intentionally_stopped(self):
        self.state_path.write_text(json.dumps({"stoppedByAdmin": True}))
        with self.assertRaisesRegex(RuntimeError, "先启动"):
            self.execute("resume")
        self.assertNotIn(("task", "enable"), self.events)

    def test_backup_updates_last_backup_timestamp(self):
        self.execute("backup")
        current = json.loads(self.service.current_path.read_text())
        self.assertEqual(current["lastBackup"], "2026-11-02T01:00:00+00:00")
        self.assertEqual(current["sha"], self.current["sha"])

    def test_update_reports_the_revision_that_actually_runs(self):
        self.assertEqual(self.execute("update")["message"], "检查完成，当前运行 aaaaaaaaaaaa。")
        self.service.update = lambda: self.service.current_path.write_text(
            json.dumps({"sha": "b" * 40, "verification": "pending-admin"})
        )
        self.assertEqual(
            self.execute("update")["message"],
            "工作台已更新至 bbbbbbbbbbbb。管理服务正在切换。",
        )

    def test_rollback_without_previous_version_does_not_modify_service(self):
        with self.assertRaisesRegex(RuntimeError, "上一运行版本"):
            self.execute("rollback")
        self.assertNotIn(("rollback",), self.events)

    def test_deferred_updates_never_claim_a_completed_remote_check(self):
        for deadline in (1795407836, None, float('inf'), 'invalid'):
            with self.subTest(deadline=deadline):
                self.service.update = lambda: {'status': 'deferred', 'retryAt': deadline}
                result = self.execute('update')
                self.assertEqual(result['status'], 'deferred')
                self.assertIn('本次尚未完成远端检查', result['message'])
                self.assertNotIn('检查完成', result['message'])
                self.assertNotIn('已更新', result['message'])
                self.assertEqual(json.loads(self.service.current_path.read_text()), self.current)
                self.assertEqual(self.events[-1], ('unlock',))

    def test_waiting_ci_and_blocked_releases_are_deferred_with_the_running_revision(self):
        for status, description in (('waiting-ci', '等待 GitHub CI'), ('blocked', '等待修复提交')):
            with self.subTest(status=status):
                self.service.update = lambda: {'status': status, 'candidateSha': 'b' * 40}
                result = self.execute('update')
                self.assertEqual(result['status'], 'deferred')
                self.assertIn(description, result['message'])
                self.assertIn('当前运行 aaaaaaaaaaaa', result['message'])
                self.assertNotIn('检查完成', result['message'])

    def test_legacy_entry_cooldown_is_reported_during_the_first_entry_upgrade(self):
        self.service.config = {'repository': 'example/workbench', 'branch': 'main'}
        network = {**self.service.config, 'retryAt': control.dt.datetime.now().timestamp() + 3600}
        file = self.directory / 'github-network.json'
        file.write_text(json.dumps(network))
        self.assertEqual(self.execute('update')['status'], 'deferred')
        file.write_text(json.dumps({**network, 'branch': 'other'}))
        self.assertEqual(self.execute('update')['status'], 'success')

    def test_unknown_action_never_acquires_lock_or_runs_commands(self):
        with self.assertRaisesRegex(ValueError, "不支持"):
            self.execute("delete-database")
        self.assertEqual(self.events, [])


if __name__ == "__main__": unittest.main(verbosity=2)
