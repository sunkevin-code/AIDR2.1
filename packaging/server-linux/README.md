# AIDR Unified Control Plane

Install on a Linux server with Node.js 20+ and systemd:

```bash
tar -xzf aidr-server-linux.tar.gz
cd aidr-server-linux
sudo bash ./install.sh
```

Open `http://SERVER_ADDRESS:8888/console`. The installer prints a bootstrap
enrollment token. Protect the service with TLS and a host firewall before
exposing it outside a trusted management network.

Verify the installed API and UI contracts:

```bash
cd /opt/aidr-server
npm run health-check -- http://127.0.0.1:8888
```
