#!/usr/bin/env bash
set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "AIDR installation requires root." >&2
  exit 1
fi
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js 20 or newer is required." >&2
  exit 1
fi
NODE_MAJOR="$(node -p 'Number(process.versions.node.split(\".\")[0])')"
if [[ "${NODE_MAJOR}" -lt 20 ]]; then
  echo "Node.js 20 or newer is required; found $(node --version)." >&2
  exit 1
fi
if command -v ss >/dev/null 2>&1 && ss -Hltn "sport = :8788" | grep -q .; then
  echo "Port 8788 is already owned by another process." >&2
  exit 1
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
install -d -m 0750 /opt/aidr /var/lib/aidr /var/lib/aidr/data /opt/aidr/agent/logs
rm -rf /opt/aidr/agent
cp -a "${ROOT}/agent" /opt/aidr/agent
cd /opt/aidr/agent
npm install --omit=dev --ignore-scripts
install -m 0644 "${ROOT}/aidr-endpoint.service" /etc/systemd/system/aidr-endpoint.service
systemctl daemon-reload
systemctl enable --now aidr-endpoint.service
sleep 2
systemctl --no-pager --full status aidr-endpoint.service
echo "AIDR Endpoint installed. Local API: http://127.0.0.1:8788/health"
