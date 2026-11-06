"""Manage only the existing AI-WQS update task using the native Windows CLI."""
import json
import subprocess
import sys
import xml.etree.ElementTree as ET

TASK_NAME = "AI-WQS Local Server Update"
NS = {"t": "http://schemas.microsoft.com/windows/2004/02/mit/task"}


def native(executable, arguments):
    return subprocess.run([executable, *arguments], capture_output=True, timeout=30,
                          creationflags=subprocess.CREATE_NO_WINDOW)


def control_task(action, executable):
    if action not in {"status", "enable", "disable"}:
        raise ValueError("Unsupported task action")
    if action != "status":
        changed = native(executable, ["/Change", "/TN", TASK_NAME, "/ENABLE" if action == "enable" else "/DISABLE"])
        if changed.returncode:
            raise RuntimeError("无法修改工作台自动更新任务。请检查当前 Windows 用户权限。")
    result = native(executable, ["/Query", "/TN", TASK_NAME, "/XML"])
    if result.returncode:
        return {"exists": False, "enabled": False, "error": "无法读取工作台自动更新任务。"}
    data = result.stdout
    if data.startswith((b"\xff\xfe", b"\xfe\xff")):
        text = data.decode("utf-16")
    else:
        text = data.decode("utf-16-le" if data.count(b"\x00") > len(data) // 5 else "utf-8", errors="replace")
    text = text.lstrip("\ufeff\r\n ")
    # Some Windows versions declare UTF-16 while emitting the active code page.
    text = text[text.find("<Task"):]
    document = ET.fromstring(text)
    enabled = document.findtext("t:Settings/t:Enabled", default="true", namespaces=NS) == "true"
    return {"exists": True, "enabled": enabled, "state": "Enabled" if enabled else "Disabled", "taskName": TASK_NAME}


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    try:
        print(json.dumps(control_task(sys.argv[1], sys.argv[2]), ensure_ascii=False))
    except Exception as error:
        print(json.dumps({"error": str(error)}, ensure_ascii=False))
        sys.exit(1)
