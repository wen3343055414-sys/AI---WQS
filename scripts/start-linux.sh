#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$project_root"

if ! command -v docker >/dev/null 2>&1; then
  echo '未找到 Docker。请先安装并打开 Docker Desktop for Linux。' >&2
  exit 1
fi

docker_command=(docker)
if docker context inspect desktop-linux >/dev/null 2>&1; then
  docker_command+=(--context desktop-linux)
  echo '使用 Docker Desktop 的 desktop-linux context。'
else
  echo '未发现 desktop-linux，使用当前 Docker context。'
fi

if ! "${docker_command[@]}" info >/dev/null 2>&1; then
  echo 'Docker 尚未就绪。请打开 Docker Desktop，等待引擎启动后重试。' >&2
  echo '已安装 Docker Desktop 时，也可运行：systemctl --user start docker-desktop' >&2
  exit 1
fi

"${docker_command[@]}" compose version >/dev/null
"${docker_command[@]}" compose up --build --detach --wait --wait-timeout 90
printf '\n智作台已启动：http://127.0.0.1:%s\n' "${WORKBENCH_PORT:-3000}"
echo 'Docker Desktop → Containers → ai-wqs，可查看容器与日志。'
