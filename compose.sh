#!/bin/sh
set -eu

# Docker 容器无法可靠读取 macOS/Linux 宿主机名，因此在宿主机上获取后传入 Compose。
if [ -z "${NAPCAT_DEVICE_NAME:-}" ]; then
  if command -v scutil >/dev/null 2>&1; then
    NAPCAT_DEVICE_NAME="$(scutil --get LocalHostName 2>/dev/null || hostname -s 2>/dev/null || hostname)"
  else
    NAPCAT_DEVICE_NAME="$(hostname -s 2>/dev/null || hostname)"
  fi
  export NAPCAT_DEVICE_NAME
fi

exec docker compose "$@"
