#!/usr/bin/env bash
set -euo pipefail

SERVER_URL=""
ENROLLMENT_TOKEN=""
while [[ "$#" -gt 0 ]]; do
  case "$1" in
    --server) SERVER_URL="${2:-}"; shift 2 ;;
    --enrollment-token) ENROLLMENT_TOKEN="${2:-}"; shift 2 ;;
    *) echo "Unknown argument: $1" >&2; exit 1 ;;
  esac
done

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
if [[ ! -f /var/lib/aidr/data/policy.json ]]; then
  install -m 0600 /opt/aidr/agent/config/policy.json /var/lib/aidr/data/policy.json
fi
if [[ -n "${SERVER_URL}" || -n "${ENROLLMENT_TOKEN}" ]]; then
  if [[ -z "${SERVER_URL}" || -z "${ENROLLMENT_TOKEN}" ]]; then
    echo "--server and --enrollment-token must be supplied together." >&2
    exit 1
  fi
  node "${ROOT}/enroll.js" "${SERVER_URL}" "${ENROLLMENT_TOKEN}" /var/lib/aidr/data/policy.json
fi
install -m 0644 "${ROOT}/aidr-endpoint.service" /etc/systemd/system/aidr-endpoint.service
systemctl daemon-reload
systemctl enable --now aidr-endpoint.service
sleep 2
systemctl --no-pager --full status aidr-endpoint.service
echo "AIDR Endpoint installed. Local API: http://127.0.0.1:8788/health"
if [[ -n "${SERVER_URL}" ]]; then echo "Unified console: ${SERVER_URL}/console"; fi
