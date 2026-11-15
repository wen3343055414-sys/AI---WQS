"""Fixed management operations, sharing the original deployment lock and updater."""
import contextlib
import importlib.util
import json
from pathlib import Path
import sys
from task_control import control_task

ACTIONS = {"start", "stop", "restart", "update", "backup", "rollback", "pause", "resume"}


def main():
    action, deployment_directory, admin_directory, schtasks = sys.argv[1:]
    if action not in ACTIONS:
        raise ValueError("不支持此操作。")
    deployment_root = Path(deployment_directory).resolve()
    admin_root = Path(admin_directory).resolve()
    spec = importlib.util.spec_from_file_location("existing_deployer", deployment_root / "update-windows.py")
    deployer = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(deployer)
    service = deployer.Deployment(deployment_root)
    # The launcher waits for this job to finish before restarting its parent.
    # The next scheduled check verifies the admin and rolls back on failure.
    service.config['deferAdminVerification'] = True
    maintenance_path = admin_root / "data/maintenance.json"

    def task(operation):
        return control_task(operation, schtasks)

    with deployer.deployment_lock(deployment_root / "update.lock"):
        current = deployer.read_json(service.current_path, {})
        maintenance = deployer.read_json(maintenance_path, {})
        sha = current.get("sha")
        if not sha:
            raise RuntimeError("尚无可管理的已部署版本。")
        service.validate_release(service.release(sha))
        if action == "stop":
            previous_enabled = maintenance.get("previousUpdateEnabled") if maintenance.get("stoppedByAdmin") else task("status").get("enabled", False)
            task("disable")
            deployer.write_json(maintenance_path, {"stoppedByAdmin": True, "previousUpdateEnabled": previous_enabled, "since": deployer.now()})
            service.compose(sha, ["stop", "--timeout", "30"])
            message = "工作台已停止，自动更新已暂停；数据库和备份已保留。"
        elif action == "start":
            service.start(sha)
            if maintenance.get("stoppedByAdmin") and maintenance.get("previousUpdateEnabled"):
                task("enable")
            deployer.write_json(maintenance_path, {"stoppedByAdmin": False})
            message = "工作台已启动并通过健康检查。"
        elif action == "restart":
            service.compose(sha, ["restart", "--timeout", "30"])
            service.start(sha)
            if maintenance.get("stoppedByAdmin") and maintenance.get("previousUpdateEnabled"):
                task("enable")
            deployer.write_json(maintenance_path, {"stoppedByAdmin": False})
            message = "工作台已重启并通过健康检查。"
        elif action in {"update", "rollback"}:
            if maintenance.get("stoppedByAdmin"):
                raise RuntimeError("工作台已主动停止，请先启动服务再更新版本。")
            if action == "rollback" and not current.get("previous"):
                raise RuntimeError("还没有可回退的上一运行版本。")
            getattr(service, action)()
            message = "版本更新检查完成；只有通过同一提交 CI 验收的版本才会部署。" if action == "update" else "已回退到上一运行版本，业务数据库已保留。"
        elif action == "backup":
            service.backup(sha)
            current["lastBackup"] = deployer.now()
            deployer.write_json(service.current_path, current)
            message = "数据库备份已创建。"
        elif action == "pause":
            task("disable")
            if maintenance.get("stoppedByAdmin"):
                maintenance["previousUpdateEnabled"] = False
                deployer.write_json(maintenance_path, maintenance)
            message = "自动更新已暂停。"
        else:
            if maintenance.get("stoppedByAdmin"):
                raise RuntimeError("请先启动工作台，再恢复自动更新。")
            task("enable")
            message = "每分钟自动更新已恢复。"
    return {"ok": True, "message": message}


if __name__ == "__main__":
    if sys.stdout:
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    try:
        with contextlib.redirect_stdout(sys.stderr):
            response = main()
        print(json.dumps(response, ensure_ascii=False))
    except BlockingIOError:
        print(json.dumps({"ok": False, "message": "另一个更新或管理操作正在执行，请稍后重试。"}, ensure_ascii=False))
        sys.exit(1)
    except Exception as error:
        print(json.dumps({"ok": False, "message": str(error)}, ensure_ascii=False))
        sys.exit(1)
