#!/usr/bin/env bash
set -euo pipefail
if ! command -v python3 >/dev/null 2>&1; then
  echo '请先安装 Python 3，再运行本机服务器安装程序。' >&2
  exit 1
fi
script_directory="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
exec python3 "$script_directory/local-server.py" install "$@"
