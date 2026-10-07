#!/usr/bin/env bash
# Genera los ejecutables en dist/  (requiere Bun instalado SOLO para compilar)
set -e
cd "$(dirname "$0")"
command -v bun >/dev/null || { echo "Bun no está instalado: https://bun.sh"; exit 1; }
bun install
bun run build
