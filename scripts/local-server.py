#!/usr/bin/env python3
"""Install and maintain a user-owned, CI-gated Docker deployment on Linux."""
import argparse
import datetime as dt
import fcntl
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
import urllib.parse
import urllib.request


def run(args, capture=False, env=None, check=True):
    return subprocess.run([str(x) for x in args], check=check, text=True,
                          stdout=subprocess.PIPE if capture else None,
                          stderr=subprocess.PIPE if capture else None,
                          env=env).stdout


def atomic_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    with tempfile.NamedTemporaryFile(mode="w", dir=path.parent, delete=False) as out:
        json.dump(value, out, ensure_ascii=False, indent=2)
        out.write("\n")
        temporary = out.name
    os.replace(temporary, path)


def atomic_copy(source, destination):
    with tempfile.NamedTemporaryFile(dir=destination.parent, delete=False) as out:
        out.write(source.read_bytes())
        temporary = out.name
    os.replace(temporary, destination)


def read_json(path, default=None):
    if not path.exists():
        return default
    return json.loads(path.read_text())


def repository_name(url):
    parsed = urllib.parse.urlparse(url)
    name = parsed.path.strip("/").removesuffix(".git")
    if parsed.scheme != "https" or parsed.netloc != "github.com" or parsed.query or parsed.fragment or not re.fullmatch(r"[\w.-]+/[\w.-]+", name):
        raise ValueError("请使用不含凭据的 GitHub HTTPS 仓库地址。")
    return name


def checks_passed(data, sha):
    return any(run.get("head_sha") == sha and run.get("event") == "push"
               and (run.get("path", "").split("@")[0] == ".github/workflows/ci.yml" or run.get("name") == "验收工作台")
               and run.get("status") == "completed" and run.get("conclusion") == "success"
               for run in data.get("workflow_runs", []))


def successful_ci(repository, sha):
    url = f"https://api.github.com/repos/{repository}/actions/runs?head_sha={sha}&event=push&per_page=30"
    request = urllib.request.Request(url, headers={"Accept": "application/vnd.github+json", "User-Agent": "AI-WQS-local-server"})
    with urllib.request.urlopen(request, timeout=20) as response:
        return checks_passed(json.load(response), sha)


def systemd_quote(value):
    if "\n" in str(value) or "\r" in str(value):
        raise ValueError("路径不能包含换行。")
    return '"' + str(value).replace("\\", "\\\\").replace('"', '\\"').replace("%", "%%").replace("$", "$$") + '"'


class LocalServer:
    def __init__(self, root):
        self.root = Path(root).expanduser().resolve()
        self.config_path = self.root / "config.json"
        self.current_path = self.root / "current.json"
        self.cache = self.root / "source.git"
        self.config = read_json(self.config_path)

    def docker(self):
        command = [self.config["docker"]]
        if self.config.get("context"):
            command.extend(["--context", self.config["context"]])
        return command

    def environment(self, sha):
        return {**os.environ, "APP_VERSION": sha, "WORKBENCH_PORT": str(self.config["port"]),
                "WORKBENCH_BIND": self.config["bind"], "GIT_TERMINAL_PROMPT": "0"}

    def release(self, sha):
        if not re.fullmatch(r"[0-9a-f]{40}", sha):
            raise ValueError("部署版本无效。")
        return self.root / "releases" / sha

    def compose(self, sha, arguments, capture=False):
        return run(self.docker() + ["compose", "--project-name", self.config["project"],
                    "--project-directory", self.release(sha), "-f", self.release(sha) / "compose.yaml"] + arguments,
                   capture=capture, env=self.environment(sha))

    def backup(self, sha):
        filename = self.compose(sha, ["exec", "-T", "backend", "node", "src/backup.mjs"], capture=True).strip()
        print("数据库备份完成：", filename)

    def health(self, sha):
        request = urllib.request.Request(f"http://127.0.0.1:{self.config['port']}/api/status", headers={"Cache-Control": "no-cache"})
        with urllib.request.urlopen(request, timeout=10) as response:
            status = json.load(response)
        if status.get("version") != sha or status.get("mode") != "server":
            raise RuntimeError("服务版本校验失败。")

    def maintain(self, current):
        if not current.get("sha"):
            return
        sha = current["sha"]
        try:
            self.health(sha)
        except Exception:
            self.compose(sha, ["up", "--no-build", "--detach", "--wait", "--wait-timeout", "90", "--remove-orphans"])
            self.health(sha)
        last = dt.datetime.fromisoformat(current.get("lastBackup", current["updatedAt"]))
        if (dt.datetime.now(dt.timezone.utc) - last).total_seconds() >= 86400:
            self.backup(sha)
            current["lastBackup"] = dt.datetime.now(dt.timezone.utc).isoformat()
            atomic_json(self.current_path, current)

    def prepare_release(self, sha):
        destination = self.release(sha)
        if not destination.exists():
            destination.parent.mkdir(parents=True, exist_ok=True)
            run([self.config["git"], "--git-dir", self.cache, "worktree", "add", "--detach", destination, sha])
        for filename in ["compose.yaml", "Dockerfile", "scripts/local-server.py"]:
            if not (destination / filename).is_file():
                raise RuntimeError(f"该版本缺少本地服务器配置：{filename}")

    def install(self, args):
        if sys.platform != "linux":
            raise RuntimeError("这个安装入口用于 Linux。")
        if not shutil.which("docker") or not shutil.which("git"):
            raise RuntimeError("请先安装 Git 和 Docker Desktop for Linux，并打开 Docker Desktop。")
        repository_name(args.repo)
        run(["git", "check-ref-format", "--branch", args.branch], capture=True)
        if args.bind not in ["127.0.0.1", "0.0.0.0"] or not 1024 <= args.port <= 65535:
            raise ValueError("访问地址或端口无效。")
        self.root.mkdir(parents=True, exist_ok=True, mode=0o700)
        context = args.docker_context
        if not context:
            result = subprocess.run(["docker", "context", "inspect", "desktop-linux"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            if result.returncode == 0:
                context = "desktop-linux"
        existing = self.config
        if not re.fullmatch(r"[a-z0-9][a-z0-9_-]{1,62}", args.project):
            raise ValueError("Docker 项目名称无效。")
        config = {"version": 1, "repo": args.repo, "branch": args.branch, "bind": args.bind, "port": args.port,
                  "project": args.project, "context": context or "", "docker": shutil.which("docker"), "git": shutil.which("git")}
        if existing and any(existing.get(key) != config.get(key) for key in ["repo", "project", "context"]):
            raise RuntimeError("已有安装使用不同仓库或 Docker 引擎，请使用独立安装目录。")
        self.config = config
        run(self.docker() + ["info"], capture=True)
        run(self.docker() + ["compose", "version"], capture=True)
        atomic_json(self.config_path, config)
        if Path(__file__).resolve() != self.root / "deployer.py":
            atomic_copy(Path(__file__), self.root / "deployer.py")
        if not args.no_systemd:
            self.install_timer()
        self.update()
        if read_json(self.current_path, {}).get("sha"):
            print(f"\n服务器入口：http://127.0.0.1:{args.port}")
            print("首次访问请在网页中设置密码。")
        else:
            print("当前尚未部署，等待 GitHub 检查通过后再次更新。")
        if not args.no_systemd:
            print("自动同步已配置：每分钟检查 GitHub，验证通过后更新；每天及升级前备份数据库。")

    def install_timer(self):
        directory = Path(os.environ.get("XDG_CONFIG_HOME", str(Path.home() / ".config"))) / "systemd/user"
        directory.mkdir(parents=True, exist_ok=True)
        command = " ".join(systemd_quote(x) for x in [sys.executable, self.root / "deployer.py", "update", "--root", self.root])
        (directory / "ai-wqs-update.service").write_text(f"[Unit]\nDescription=AI WQS local server update and backup\n\n[Service]\nType=oneshot\nExecStart={command}\nTimeoutStartSec=1200\nUMask=0077\n")
        (directory / "ai-wqs-update.timer").write_text("[Unit]\nDescription=Check AI WQS GitHub updates every minute\n\n[Timer]\nOnStartupSec=45s\nOnUnitInactiveSec=60s\nAccuracySec=10s\n\n[Install]\nWantedBy=timers.target\n")
        run(["systemctl", "--user", "daemon-reload"])
        run(["systemctl", "--user", "enable", "--now", "ai-wqs-update.timer"])

    def update(self):
        if not self.config:
            raise RuntimeError("尚未安装，请先运行 install。")
        with (self.root / "update.lock").open("w") as lock:
            try:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                print("已有更新正在执行。")
                return
            run(self.docker() + ["info"], capture=True)
            current = read_json(self.current_path, {})
            self.maintain(current)
            environment = {**os.environ, "GIT_TERMINAL_PROMPT": "0"}
            if not self.cache.exists():
                run([self.config["git"], "clone", "--bare", self.config["repo"], self.cache], env=environment)
            actual_origin = run([self.config["git"], "--git-dir", self.cache, "remote", "get-url", "origin"], capture=True).strip()
            if actual_origin != self.config["repo"]:
                raise RuntimeError("源代码缓存的仓库地址不匹配，更新已停止。")
            run([self.config["git"], "--git-dir", self.cache, "fetch", "origin", f"refs/heads/{self.config['branch']}"], env=environment)
            sha = run([self.config["git"], "--git-dir", self.cache, "rev-parse", "FETCH_HEAD"], capture=True).strip()
            if read_json(self.root / "failed.json", {}).get("sha") == sha:
                print("该版本曾启动失败，保留当前版本；新提交后自动重试。")
                return
            if current.get("sha") == sha:
                print("当前已是最新版本：", sha[:12])
                return
            if current.get("sha"):
                ancestor = subprocess.run([self.config["git"], "--git-dir", self.cache, "merge-base", "--is-ancestor", current["sha"], sha])
                if ancestor.returncode:
                    raise RuntimeError("远端分支发生回退或分叉，请明确选择版本后再更新。")
            if not successful_ci(repository_name(self.config["repo"]), sha):
                print("等待该提交的 GitHub 自动验收成功：", sha[:12])
                return
            self.prepare_release(sha)
            self.compose(sha, ["build"])
            if current.get("sha"):
                self.backup(current["sha"])
            try:
                self.compose(sha, ["up", "--no-build", "--detach", "--wait", "--wait-timeout", "90", "--remove-orphans"])
                self.health(sha)
            except Exception:
                atomic_json(self.root / "failed.json", {"sha": sha, "at": dt.datetime.now(dt.timezone.utc).isoformat()})
                if current.get("sha"):
                    print("新版本启动失败，恢复上一个运行版本。")
                    self.compose(current["sha"], ["up", "--no-build", "--detach", "--wait", "--wait-timeout", "90", "--remove-orphans"])
                    self.health(current["sha"])
                raise
            now = dt.datetime.now(dt.timezone.utc).isoformat()
            atomic_json(self.current_path, {"sha": sha, "previous": current.get("sha"), "updatedAt": now, "lastBackup": now})
            (self.root / "failed.json").unlink(missing_ok=True)
            atomic_copy(self.release(sha) / "scripts/local-server.py", self.root / "deployer.py")
            print("部署成功：", sha)

    def rollback(self):
        current = read_json(self.current_path, {})
        previous = current.get("previous")
        if not previous:
            raise RuntimeError("没有可回退的已验证版本。")
        with (self.root / "update.lock").open("w") as lock:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            self.backup(current["sha"])
            self.compose(previous, ["up", "--no-build", "--detach", "--wait", "--wait-timeout", "90", "--remove-orphans"])
            self.health(previous)
            now = dt.datetime.now(dt.timezone.utc).isoformat()
            atomic_json(self.current_path, {"sha": previous, "previous": current["sha"], "updatedAt": now, "lastBackup": now})
            atomic_json(self.root / "failed.json", {"sha": current["sha"], "at": now})
            print("已回退到：", previous)
            print("已暂停再次部署被回退的提交，新提交后自动更新。")


def main():
    default_root = str(Path(os.environ.get("XDG_DATA_HOME", str(Path.home() / ".local/share"))) / "ai-wqs-server")
    parser = argparse.ArgumentParser(description="智作台 Linux 本地服务器安装与更新")
    parser.add_argument("command", choices=["install", "update", "status", "backup", "rollback"])
    parser.add_argument("--root", default=default_root)
    parser.add_argument("--repo", default="https://github.com/wen3343055414-sys/AI---WQS.git")
    parser.add_argument("--branch", default="main")
    parser.add_argument("--bind", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=3000)
    parser.add_argument("--docker-context", default="")
    parser.add_argument("--project", default="ai-wqs-server")
    parser.add_argument("--no-systemd", action="store_true", help="仅手动模式，不安装后台定时器")
    args = parser.parse_args()
    os.umask(0o077)
    service = LocalServer(args.root)
    if args.command == "install":
        service.install(args)
    elif args.command == "update":
        service.update()
    elif args.command == "status":
        print(json.dumps({"configuration": service.config, "deployment": read_json(service.current_path)}, ensure_ascii=False, indent=2))
    elif args.command == "rollback":
        service.rollback()
    else:
        current = read_json(service.current_path, {})
        if not current.get("sha"):
            raise RuntimeError("尚无已部署版本。")
        service.backup(current["sha"])


if __name__ == "__main__":
    try:
        main()
    except (Exception, KeyboardInterrupt) as error:
        print(f"操作未完成：{error}", file=sys.stderr)
        sys.exit(1)
