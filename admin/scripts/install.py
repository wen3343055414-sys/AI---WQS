"""Register this independent server in the current user's Windows session."""
import json
from pathlib import Path
import shutil
import subprocess
import sys
import xml.etree.ElementTree as ET

root = Path(__file__).resolve().parents[1]
config_path = root / "config.json"
deployment = json.loads((root.parent / "AI-WQS-local/config.json").read_text(encoding="utf-8-sig"))
if not config_path.exists():
    config = {"port": 3100, "deploymentRoot": "../AI-WQS-local", "node": shutil.which("node"),
              "pythonw": deployment["pythonw"], "schtasks": shutil.which("schtasks.exe")}
    config_path.write_text(json.dumps(config, indent=2) + "\n", encoding="utf-8")
else:
    config = json.loads(config_path.read_text(encoding="utf-8-sig"))
if not all(config.get(key) and Path(config[key]).is_file() for key in ("node", "pythonw", "schtasks")):
    raise RuntimeError("Node.js, Python or the Task Scheduler CLI is missing.")

task_name = "AI-WQS Server Admin"
launcher = root / "scripts/launcher.py"
flags = subprocess.CREATE_NO_WINDOW
existing = subprocess.run([config["schtasks"], "/Query", "/TN", task_name, "/XML"], capture_output=True, creationflags=flags)
if existing.returncode == 0:
    original = existing.stdout.replace(b"\x00", b"").decode("utf-8", errors="replace")
    if str(launcher) not in original:
        raise RuntimeError("The task name belongs to another installation.")
    print("Admin task already exists; starting the registered task.")
else:
    namespace = "http://schemas.microsoft.com/windows/2004/02/mit/task"
    ET.register_namespace("", namespace)
    def element(parent, name, text=None, **attributes):
        value = ET.SubElement(parent, "{" + namespace + "}" + name, attributes)
        value.text = text
        return value
    task = ET.Element("{" + namespace + "}Task", {"version": "1.4"})
    registration = element(task, "RegistrationInfo")
    element(registration, "Description", "Independent localhost-only AI-WQS service management server")
    user = subprocess.run(["whoami.exe"], capture_output=True, text=True, creationflags=flags, check=True).stdout.strip()
    trigger = element(element(task, "Triggers"), "LogonTrigger")
    element(trigger, "Enabled", "true")
    element(trigger, "UserId", user)
    principal = element(element(task, "Principals"), "Principal", id="Author")
    element(principal, "UserId", user)
    element(principal, "LogonType", "InteractiveToken")
    element(principal, "RunLevel", "LeastPrivilege")
    settings = element(task, "Settings")
    for key, value in {"MultipleInstancesPolicy": "IgnoreNew", "DisallowStartIfOnBatteries": "false",
                       "StopIfGoingOnBatteries": "false", "StartWhenAvailable": "true", "Enabled": "true",
                       "Hidden": "true", "ExecutionTimeLimit": "PT0S"}.items():
        element(settings, key, value)
    restart = element(settings, "RestartOnFailure")
    element(restart, "Interval", "PT1M")
    element(restart, "Count", "3")
    executable = element(element(task, "Actions", Context="Author"), "Exec")
    element(executable, "Command", config["pythonw"])
    element(executable, "Arguments", '"' + str(launcher) + '"')
    element(executable, "WorkingDirectory", str(root))
    task_xml = root / "scheduled-task.xml"
    ET.ElementTree(task).write(task_xml, encoding="utf-16", xml_declaration=True)
    subprocess.run([config["schtasks"], "/Create", "/TN", task_name, "/XML", str(task_xml)], check=True, creationflags=flags)
subprocess.run([config["schtasks"], "/Run", "/TN", task_name], check=True, creationflags=flags)
print(f"Admin server: http://127.0.0.1:{config['port']}")
