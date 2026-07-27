#!/usr/bin/env bash
set -euo pipefail
if [[ "${EUID}" -ne 0 ]]; then echo "Run as root." >&2; exit 1; fi
systemctl disable --now aidr-server.service 2>/dev/null || true
rm -f /etc/systemd/system/aidr-server.service
systemctl daemon-reload
echo "Service removed. Data remains in /var/lib/aidr-server and configuration in /etc/aidr."
