"""Deploy one CI-verified GitHub commit to Docker and the native admin."""
import argparse
import contextlib
import datetime as dt
import json
import importlib.util
import os
from pathlib import Path, PurePosixPath
import re
import subprocess
import sqlite3
import sys
import tempfile
import time
import urllib.parse
import urllib.request
import zipfile


def now():
    return dt.datetime.now(dt.timezone.utc).isoformat()


def read_json(path, default=None):
    return json.loads(path.read_text(encoding="utf-8-sig")) if path.exists() else default


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=path.parent, delete=False) as stream:
        json.dump(value, stream, ensure_ascii=False, indent=2)
        stream.write("\n")
        temporary = stream.name
    os.replace(temporary, path)


def run(arguments, capture=False, env=None):
    result = subprocess.run([str(item) for item in arguments], env=env, text=True,
                            encoding="utf-8", errors="replace", capture_output=True,
                            creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0)
    if result.stderr:
        print(result.stderr.rstrip(), flush=True)
    if result.stdout and (not capture or result.returncode):
        print(result.stdout.rstrip(), flush=True)
    result.check_returncode()
    return result.stdout


def checks_passed(data, sha):
    return any(item.get("head_sha") == sha and item.get("event") == "push"
               and item.get("path", "").split("@")[0] == ".github/workflows/ci.yml"
               and item.get("status") == "completed" and item.get("conclusion") == "success"
               for item in data.get("workflow_runs", []))


@contextlib.contextmanager
def deployment_lock(path):
    with path.open("a+b") as stream:
        if stream.tell() == 0:
            stream.write(b"0")
            stream.flush()
        stream.seek(0)
        if os.name == "nt":
            import msvcrt
            try:
                msvcrt.locking(stream.fileno(), msvcrt.LK_NBLCK, 1)
            except OSError as error:
                raise BlockingIOError("Another deployment is running") from error
        else:
            import fcntl
            fcntl.flock(stream, fcntl.LOCK_EX | fcntl.LOCK_NB)
        try:
            yield
        finally:
            if os.name == "nt":
                stream.seek(0)
                msvcrt.locking(stream.fileno(), msvcrt.LK_UNLCK, 1)


class Deployment:
    def __init__(self, root):
        self.root = Path(root).resolve()
        self.config = read_json(self.root / "config.json")
        if not self.config:
            raise RuntimeError("Missing config.json")
        if not re.fullmatch(r"[\w.-]+/[\w.-]+", self.config["repository"]):
            raise ValueError("Invalid GitHub repository")
        self.current_path = self.root / "current.json"
        self.failed_path = self.root / "failed.json"

    def download(self, url, destination):
        run([self.config["curl"], "--fail", "--silent", "--show-error", "--location",
             "--retry", "2", "--retry-all-errors", "--retry-delay", "2",
             "--connect-timeout", "10", "--max-time", "45",
             "--user-agent", "AI-WQS-Windows-Deployer", "--output", destination, url])

    def github(self, suffix):
        with tempfile.TemporaryDirectory(dir=self.root) as directory:
            target = Path(directory) / "response.json"
            self.download(f"https://api.github.com/repos/{self.config['repository']}/{suffix}", target)
            return read_json(target)

    def docker(self, arguments, capture=False, sha=None):
        environment = {**os.environ, "APP_VERSION": sha or "local",
                       "WORKBENCH_PORT": str(self.config["port"]), "WORKBENCH_BIND": "127.0.0.1",
                       "MODEL_BRIDGE_TOKEN_PATH": str(self.root.parent / 'AI-WQS-admin/data/model-bridge-token')}
        return run([self.config["docker"], "--context", self.config["context"], *arguments],
                   capture=capture, env=environment)

    def release(self, sha):
        if not re.fullmatch(r"[0-9a-f]{40}", sha):
            raise ValueError("Invalid release SHA")
        return self.root / "releases" / sha

    def compose(self, sha, arguments, capture=False):
        release = self.release(sha)
        extra = []
        if self.config.get('modelIntegration'):
            if self.native_release(sha):
                extra = ['-f', release / 'ops/windows/compose.models.yaml']
            else:
                spec = importlib.util.spec_from_file_location('local_model_integration', self.root / 'integration/prepare.py')
                module = importlib.util.module_from_spec(spec)
                spec.loader.exec_module(module)
                release = module.prepare(self.root, release, sha)
                extra = ['-f', self.root / 'integration/compose.models.yaml']
        return self.docker(["compose", "--project-name", self.config["project"],
                            "--project-directory", release, "-f", release / "compose.yaml", *extra, *arguments],
                           capture=capture, sha=sha)

    def native_release(self, sha):
        marker = read_json(self.release(sha) / 'ops/windows/release.json')
        if marker is None:
            return False
        if marker != {"schemaVersion": 1, "nativeAdmin": True, "modelBridge": True}:
            raise RuntimeError('Unsupported Windows release manifest')
        return True

    def verify_admin(self, sha):
        if not self.config.get('adminAutoUpdate'):
            return
        deadline = time.monotonic() + 70
        admin = self.root.parent / 'AI-WQS-admin'
        while time.monotonic() < deadline:
            runtime = read_json(admin / 'data/runtime.json', {})
            if runtime.get('status') == 'failed' and runtime.get('desiredRevision') == sha:
                raise RuntimeError('Native admin rejected the new release')
            try:
                with urllib.request.urlopen(f"http://127.0.0.1:{self.config.get('adminPort', 3100)}/api/health", timeout=3) as response:
                    value = json.load(response)
                if value.get('status') == 'ok' and value.get('revision') == sha and not value.get('draining'):
                    return
            except (OSError, ValueError):
                pass
            time.sleep(1)
        raise RuntimeError('Native admin revision health check timed out')

    def backup_admin(self):
        database = self.root.parent / 'AI-WQS-admin/data/admin.sqlite'
        if not database.is_file():
            return
        directory = database.parent / 'backups'
        directory.mkdir(exist_ok=True)
        name = 'admin-' + dt.datetime.now(dt.timezone.utc).strftime('%Y%m%dT%H%M%S%fZ') + '.sqlite'
        with contextlib.closing(sqlite3.connect(database.as_uri() + '?mode=ro', uri=True)) as source:
            with contextlib.closing(sqlite3.connect(directory / name)) as destination:
                source.backup(destination)
        print('Admin database backup:', name, flush=True)

    def complete_activation(self, candidate):
        try:
            self.verify_admin(candidate['sha'])
        except Exception:
            old = candidate.get('rollbackState')
            if old and old.get('sha'):
                write_json(self.current_path, old)
                self.start(old['sha'])
            write_json(self.failed_path, {'sha': candidate['sha'], 'at': now(), 'phase': 'admin'})
            raise
        candidate.pop('rollbackState', None)
        candidate['verification'] = 'verified'
        write_json(self.current_path, candidate)

    def activate(self, sha, old):
        timestamp = now()
        candidate = {'sha': sha, 'previous': old.get('sha'), 'updatedAt': timestamp,
                     'lastBackup': timestamp, 'verification': 'pending-admin',
                     'rollbackState': {key: value for key, value in old.items() if key != 'rollbackState'}}
        write_json(self.current_path, candidate)
        if not self.config.get('deferAdminVerification'):
            self.complete_activation(candidate)
        return candidate

    def health(self, sha):
        request = urllib.request.Request(f"http://127.0.0.1:{self.config['port']}/api/status",
                                         headers={"Cache-Control": "no-cache"})
        with urllib.request.urlopen(request, timeout=10) as response:
            status = json.load(response)
        expected = sha + ('-models-v1' if self.config.get('modelIntegration') else '')
        if status.get("version") != expected or status.get("mode") != "server":
            raise RuntimeError("Running server version does not match the release")

    def backup(self, sha):
        result = self.compose(sha, ["exec", "-T", "backend", "node", "src/backup.mjs"], capture=True)
        print("Database backup:", result.strip(), flush=True)

    def start(self, sha):
        self.compose(sha, ["up", "--no-build", "--detach", "--wait", "--wait-timeout", "90", "--remove-orphans"])
        self.health(sha)

    def maintain(self, current):
        if not current.get("sha"):
            return
        if current.get('verification') == 'pending-admin':
            self.complete_activation(current)
        try:
            self.health(current["sha"])
        except Exception:
            self.start(current["sha"])
        previous_backup = dt.datetime.fromisoformat(current.get("lastBackup", current["updatedAt"]))
        if (dt.datetime.now(dt.timezone.utc) - previous_backup).total_seconds() >= 86400:
            self.backup(current["sha"])
            current["lastBackup"] = now()
            write_json(self.current_path, current)

    def prepare_release(self, sha):
        target = self.release(sha)
        if target.exists():
            self.validate_release(target)
            return
        target.parent.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(dir=target.parent) as temporary:
            directory = Path(temporary)
            archive = directory / "source.zip"
            self.download(f"https://codeload.github.com/{self.config['repository']}/zip/{sha}", archive)
            unpacked = directory / "unpacked"
            with zipfile.ZipFile(archive) as source:
                entries = source.infolist()
                if len(entries) > 5000 or sum(entry.file_size for entry in entries) > 50_000_000:
                    raise ValueError("Unexpectedly large source archive")
                for entry in entries:
                    parts = PurePosixPath(entry.filename).parts
                    if not parts or ".." in parts or "\\" in entry.filename or ":" in entry.filename or entry.filename.startswith("/"):
                        raise ValueError("Unsafe source archive path")
                    if (entry.external_attr >> 16) & 0o170000 == 0o120000:
                        raise ValueError("Source archive contains a symlink")
                source.extractall(unpacked)
            children = list(unpacked.iterdir())
            if len(children) != 1 or not children[0].is_dir():
                raise ValueError("Unexpected source archive structure")
            self.validate_release(children[0])
            os.replace(children[0], target)

    @staticmethod
    def validate_release(directory):
        required = ["compose.yaml", "Dockerfile", "src/server.js", "src/backup.mjs"]
        marker = read_json(directory / 'ops/windows/release.json')
        if marker is not None:
            if marker != {"schemaVersion": 1, "nativeAdmin": True, "modelBridge": True}:
                raise ValueError('Unsupported Windows release manifest')
            required.extend(['admin/src/server.js', 'admin/public/index.html', 'admin/scripts/control.py',
                             'admin/scripts/secret_store.py', 'ops/windows/update-windows.py',
                             'ops/windows/compose.models.yaml'])
        for name in required:
            if not (directory / name).is_file():
                raise ValueError(f"Missing release file: {name}")

    def update(self):
        self.docker(["info", "--format", "{{.ID}}"], capture=True)
        current = read_json(self.current_path, {})
        self.maintain(current)
        branch = urllib.parse.quote(self.config["branch"], safe="/")
        sha = self.github(f"git/ref/heads/{branch}")["object"]["sha"]
        self.release(sha)
        if read_json(self.failed_path, {}).get("sha") == sha:
            print("Release previously failed or was rolled back; waiting for a new commit.")
            return
        if current.get("sha") == sha:
            print("Already current:", sha)
            return
        if current.get("sha"):
            comparison = self.github(f"compare/{current['sha']}...{sha}")
            if comparison.get("status") != "ahead":
                raise RuntimeError("Branch was rewound or diverged; keeping the running version")
        checks = self.github(f"actions/runs?head_sha={sha}&event=push&per_page=30")
        if not checks_passed(checks, sha):
            print("Waiting for successful push CI:", sha)
            return
        self.prepare_release(sha)
        self.compose(sha, ["config", "--quiet"])
        self.compose(sha, ["build"])
        if current.get("sha"):
            self.backup(current["sha"])
            self.backup_admin()
        try:
            self.start(sha)
        except Exception:
            write_json(self.failed_path, {"sha": sha, "at": now()})
            if current.get("sha"):
                print("New release failed; restoring:", current["sha"])
                self.start(current["sha"])
            raise
        candidate = self.activate(sha, current)
        self.failed_path.unlink(missing_ok=True)
        print('Deployed:' if candidate['verification'] == 'verified' else 'Containers ready; admin verification queued:', sha, flush=True)

    def rollback(self):
        current = read_json(self.current_path, {})
        if not current.get("previous"):
            raise RuntimeError("No previous verified release is available")
        self.backup(current["sha"])
        self.backup_admin()
        self.start(current["previous"])
        self.activate(current['previous'], current)
        write_json(self.failed_path, {"sha": current["sha"], "at": now()})
        print("Rolled back to:", current["previous"])


def main():
    parser = argparse.ArgumentParser(description="AI-WQS Windows local deployment")
    parser.add_argument("command", choices=("update", "backup", "rollback", "status"))
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parent)
    arguments = parser.parse_args()
    deployment = Deployment(arguments.root)
    if arguments.command == "status":
        print(json.dumps({"configuration": deployment.config,
                          "deployment": read_json(deployment.current_path)}, ensure_ascii=False, indent=2))
        return 0
    log_path = deployment.root / "update.log"
    if log_path.exists() and log_path.stat().st_size > 2_000_000:
        os.replace(log_path, deployment.root / "update.previous.log")
    with log_path.open("a", encoding="utf-8", buffering=1) as log:
        with contextlib.redirect_stdout(log), contextlib.redirect_stderr(log):
            print("\n" + now(), arguments.command, flush=True)
            try:
                with deployment_lock(deployment.root / "update.lock"):
                    if arguments.command == "update":
                        deployment.update()
                    elif arguments.command == "rollback":
                        deployment.rollback()
                    else:
                        current = read_json(deployment.current_path, {})
                        if not current.get("sha"):
                            raise RuntimeError("No deployed release")
                        deployment.backup(current["sha"])
                        current["lastBackup"] = now()
                        write_json(deployment.current_path, current)
                return 0
            except BlockingIOError:
                print("Another deployment is running; skipped.")
                return 0
            except Exception as error:
                print("Operation failed:", error, flush=True)
                return 1


if __name__ == "__main__":
    sys.exit(main())
