# AIDR Endpoint for Linux

Supported targets: x86_64 and arm64 Linux distributions with systemd, Node.js
20+, `ps`, and `ss`.

Install:

```bash
tar -xzf aidr-endpoint-linux.tar.gz
cd aidr-endpoint-linux
sudo bash ./install.sh \
  --server https://aidr.example.com \
  --enrollment-token ONE_TIME_TOKEN
```

The service runs as `aidr-endpoint.service`. Runtime data is stored under
`/var/lib/aidr`; application files are installed under `/opt/aidr`.
After enrollment, the Endpoint appears in the shared console at
`https://aidr.example.com/console`. Supplying neither enrollment option keeps
the Endpoint in standalone mode.

This package supplies process, file, network, shell-history, agent discovery,
session analysis, policy and local API capabilities. Windows Registry and
Windows kernel enforcement are intentionally unavailable on Linux; Linux
kernel enforcement is the next eBPF/LSM delivery stage.
