#!/usr/bin/env bash
set -euo pipefail
if [ -f /sys/fs/cgroup/cgroup.controllers ]; then
  echo 'Judge0 requiere cgroup v1 en esta distribucion.' >&2
  exit 1
fi
if [ ! -f /sys/fs/cgroup/memory/memory.limit_in_bytes ]; then
  echo 'Falta el controlador de memoria cgroup v1 requerido por Judge0.' >&2
  exit 1
fi
if ! docker info >/dev/null 2>&1; then
  service docker start
fi
cd /opt/pizarra-judge0
docker-compose up -d
# Systemd services alone do not keep a WSL distribution running.
exec sleep infinity
