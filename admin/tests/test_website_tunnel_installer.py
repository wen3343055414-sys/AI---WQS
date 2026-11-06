"""Verify release provenance and atomic installation using local fake downloads."""
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch


SOURCE = Path(__file__).resolve().parents[1] / "scripts/install-website-tunnel.py"
SPEC = importlib.util.spec_from_file_location("website_tunnel_installer", SOURCE)
installer = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(installer)


class WebsiteTunnelInstallerTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="website-installer-")
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        (self.root / "config.json").write_text('{"port":3100}', encoding="utf-8")
        self.content = b"fixture binary, never executed"
        self.asset = installer.target_asset()[0]
        self.executable = self.root / "tools" / installer.target_asset()[1]

    def release(self, **overrides):
        digest = hashlib.sha256(self.content).hexdigest()
        release = {"tag_name": "2026.10.7", "draft": False, "prerelease": False,
                   "assets": [{"name": self.asset, "size": len(self.content), "digest": "sha256:" + digest,
                               "browser_download_url": installer.DOWNLOAD + "2026.10.7/" + self.asset}],
                   "body": "### SHA256 Checksums\n```\n" + self.asset + ": " + digest + "\n```"}
        release.update(overrides)
        return release

    def open_fake(self, url):
        if url.startswith(installer.API):
            return io.BytesIO(json.dumps(self.release()).encode())
        if url == installer.DOWNLOAD + "2026.10.7/" + self.asset:
            return io.BytesIO(self.content)
        self.fail("An unexpected URL was requested.")

    def test_platform_selects_official_standalone_binaries(self):
        self.assertEqual(installer.target_asset("Windows", "AMD64"), ("cloudflared-windows-amd64.exe", "cloudflared.exe"))
        self.assertEqual(installer.target_asset("Linux", "aarch64"), ("cloudflared-linux-arm64", "cloudflared"))
        with self.assertRaises(installer.InstallError):
            installer.target_asset("Windows", "ARM64")

    def test_install_verifies_binary_then_replaces_atomically_and_records_digest(self):
        with patch.object(installer, "official_open", self.open_fake):
            result = installer.install(str(self.root), "2026.10.7")
            self.assertEqual(result["status"], "installed")
            self.assertEqual(self.executable.read_bytes(), self.content)
            manifest = json.loads((self.root / "tools/cloudflared-install.json").read_text())
            self.assertEqual(manifest["sha256"], hashlib.sha256(self.content).hexdigest())
            self.assertEqual(installer.install(str(self.root), "2026.10.7")["status"], "already-installed")
        self.assertEqual(sorted(file.name for file in (self.root / "tools").iterdir()), sorted([self.executable.name, "cloudflared-install.json"]))

    def test_failed_download_keeps_existing_binary_and_cleans_temporary_bytes(self):
        self.executable.parent.mkdir()
        self.executable.write_bytes(b"existing verified binary")
        def altered(url):
            return io.BytesIO(json.dumps(self.release()).encode()) if url.startswith(installer.API) else io.BytesIO(b"wrong binary")
        with patch.object(installer, "official_open", altered):
            with self.assertRaisesRegex(installer.InstallError, "verification failed"):
                installer.install(str(self.root), "2026.10.7")
        self.assertEqual(self.executable.read_bytes(), b"existing verified binary")
        self.assertEqual(list(self.executable.parent.iterdir()), [self.executable])

    def test_checksum_from_release_notes_is_accepted_but_absence_or_mismatch_is_refused(self):
        release = self.release()
        release["assets"][0]["digest"] = None
        self.assertEqual(installer.release_asset(release, self.asset)["sha256"], hashlib.sha256(self.content).hexdigest())
        release["body"] = "No checksum published"
        with self.assertRaisesRegex(installer.InstallError, "no SHA256 checksum"):
            installer.release_asset(release, self.asset)
        release = self.release()
        release["assets"][0]["digest"] = "sha256:" + "0" * 64
        with self.assertRaisesRegex(installer.InstallError, "disagree"):
            installer.release_asset(release, self.asset)

    def test_foreign_download_hosts_and_unbounded_asset_sizes_are_refused(self):
        release = self.release()
        release["assets"][0]["browser_download_url"] = "https://attacker.invalid/cloudflared.exe"
        with self.assertRaisesRegex(installer.InstallError, "official release"):
            installer.release_asset(release, self.asset)
        release = self.release()
        release["assets"][0]["size"] = installer.MAX_DOWNLOAD + 1
        with self.assertRaisesRegex(installer.InstallError, "excessive size"):
            installer.release_asset(release, self.asset)
        release = self.release(prerelease=True)
        with self.assertRaisesRegex(installer.InstallError, "stable"):
            installer.release_asset(release, self.asset)

    def test_install_refuses_checkout_release_dirs_and_relative_targets(self):
        with self.assertRaisesRegex(installer.InstallError, "absolute"):
            installer.stable_home("relative-home")
        (self.root / ".git").write_text("fixture worktree marker")
        with self.assertRaisesRegex(installer.InstallError, "Git checkout"):
            installer.stable_home(str(self.root))
        (self.root / ".git").unlink()
        release = self.root / "releases/revision/admin"
        release.mkdir(parents=True)
        with self.assertRaisesRegex(installer.InstallError, "immutable"):
            installer.stable_home(str(release))

    def test_version_is_validated_before_network_and_must_match_the_response(self):
        with patch.object(installer, "official_open", self.open_fake) as opener:
            with self.assertRaisesRegex(installer.InstallError, "release format"):
                installer.install(str(self.root), "../../arbitrary")
            with self.assertRaisesRegex(installer.InstallError, "requested version"):
                installer.install(str(self.root), "2026.10.6")


if __name__ == "__main__":
    unittest.main()
