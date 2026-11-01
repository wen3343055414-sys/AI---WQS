import importlib.util
from pathlib import Path
import unittest
import tempfile
import datetime as dt

spec = importlib.util.spec_from_file_location("deployer", Path(__file__).parents[1] / "scripts/local-server.py")
deployer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(deployer)


class DeploymentRules(unittest.TestCase):
    def test_only_successful_push_checks_for_exact_commit_are_accepted(self):
        sha = "a" * 40
        passed = {"head_sha": sha, "event": "push", "path": ".github/workflows/ci.yml", "status": "completed", "conclusion": "success"}
        self.assertTrue(deployer.checks_passed({"workflow_runs": [passed]}, sha))
        for change in [{"head_sha": "b" * 40}, {"event": "pull_request"}, {"status": "in_progress"}, {"conclusion": "failure"}, {"path": ".github/workflows/other.yml"}]:
            self.assertFalse(deployer.checks_passed({"workflow_runs": [{**passed, **change}]}, sha))
        self.assertFalse(deployer.checks_passed({"workflow_runs": []}, sha))

    def test_repository_urls_cannot_include_credentials_or_other_hosts(self):
        self.assertEqual(deployer.repository_name("https://github.com/example/workbench.git"), "example/workbench")
        for value in ["https://token@github.com/example/workbench.git", "https://github.com.evil.invalid/example/workbench", "http://github.com/example/workbench", "https://github.com/example/workbench?token=secret", "https://github.com/example/workbench/extra"]:
            with self.assertRaises(ValueError):
                deployer.repository_name(value)

    def test_systemd_arguments_preserve_spaces_and_literal_percent(self):
        self.assertEqual(deployer.systemd_quote("/home/a b/50%/server.py"), '"/home/a b/50%%/server.py"')
        self.assertEqual(deployer.systemd_quote("/tmp/$literal/server.py"), '"/tmp/$$literal/server.py"')
        with self.assertRaises(ValueError):
            deployer.systemd_quote("/tmp/name\nExecStart=bad")

    def test_running_release_is_backed_up_independently_of_new_code(self):
        with tempfile.TemporaryDirectory() as directory:
            service = deployer.LocalServer(directory)
            calls = []
            service.health = lambda sha: calls.append(("health", sha))
            service.backup = lambda sha: calls.append(("backup", sha))
            old = (dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=2)).isoformat()
            current = {"sha": "a" * 40, "updatedAt": old}
            service.maintain(current)
            self.assertEqual([call[0] for call in calls], ["health", "backup"])
            self.assertIn("lastBackup", deployer.read_json(service.current_path))


if __name__ == "__main__":
    unittest.main()
