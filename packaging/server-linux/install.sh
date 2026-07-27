#!/usr/bin/env bash
set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "AIDR server installation requires root." >&2
  exit 1
fi
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js 20 or newer is required." >&2
  exit 1
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENROLLMENT_TOKEN="${AIDR_ENROLLMENT_TOKEN:-$(openssl rand -hex 24)}"
id -u aidr >/dev/null 2>&1 || useradd --system --home /var/lib/aidr-server --shell /usr/sbin/nologin aidr
install -d -o aidr -g aidr -m 0750 /opt/aidr-server /var/lib/aidr-server /etc/aidr
rm -rf /opt/aidr-server/src /opt/aidr-server/public /opt/aidr-server/node_modules
cp -a "${ROOT}/server/." /opt/aidr-server/
install -d -o aidr -g aidr -m 0750 /opt/aidr-server/aidr-endpoint/ui
cp -a "${ROOT}/aidr-endpoint/ui/." /opt/aidr-server/aidr-endpoint/ui/
cd /opt/aidr-server
npm install --omit=dev --ignore-scripts
chown -R aidr:aidr /opt/aidr-server /var/lib/aidr-server
cat > /etc/aidr/server.env <<EOF
AIDR_SERVER_HOST=0.0.0.0
PORT=8888
AIDR_SERVER_DATA_DIR=/var/lib/aidr-server
AIDR_CONSOLE_UI_DIR=/opt/aidr-server/aidr-endpoint/ui
AIDR_ENROLLMENT_TOKEN=${ENROLLMENT_TOKEN}
EOF
chmod 0600 /etc/aidr/server.env
install -m 0644 "${ROOT}/aidr-server.service" /etc/systemd/system/aidr-server.service
systemctl daemon-reload
systemctl enable --now aidr-server.service
echo "AIDR unified control plane installed on port 8888."
echo "Enrollment token: ${ENROLLMENT_TOKEN}"
echo "Store this token securely, enroll endpoints, then rotate it in /etc/aidr/server.env."
