#!/usr/bin/env bash
set -euo pipefail
if [[ "${EUID}" -ne 0 ]]; then echo "Root is required." >&2; exit 1; fi
systemctl disable --now aidr-endpoint.service 2>/dev/null || true
rm -f /etc/systemd/system/aidr-endpoint.service
systemctl daemon-reload
rm -rf /opt/aidr
echo "AIDR Endpoint removed. Telemetry and policy remain in /var/lib/aidr."
