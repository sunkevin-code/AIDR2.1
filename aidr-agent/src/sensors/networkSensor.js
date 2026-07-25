const { exec } = require("child_process");
const { promisify } = require("util");
const execAsync = promisify(exec);

class NetworkSensor {
  constructor(policy, addEvent, enforcer) {
    this.policy = policy;
    this.addEvent = addEvent;
    this.enforcer = enforcer;
    this.active = false;
    this.interval = null;
    this.polling = false;
    this.alertCache = new Map();
    this.alertWindowStartedAt = 0;
    this.alertsInWindow = 0;
    this.stats = { connectionsDetected: 0, suspicious: 0, suppressed: 0 };
  }

  async start() {
    if (this.policy.sensors?.network?.enabled === false) return;
    this.active = true;
    this.addEvent("system", "info", "allow", "Network sensor started");
    this.interval = setInterval(() => { this.poll().catch(() => {}); }, 5000);
  }

  async stop() {
    this.active = false;
    if (this.interval) clearInterval(this.interval);
  }

  async poll() {
    if (this.polling) return;
    this.polling = true;
    try {
      let output = "";
      try {
        const result = await execAsync(
          "powershell -NoProfile -Command \"Get-NetTCPConnection -State Established | Select-Object LocalAddress,LocalPort,RemoteAddress,RemotePort,OwningProcess | ConvertTo-Json -Compress\"",
          { encoding: "utf8", timeout: 5000, windowsHide: true, maxBuffer: 8 * 1024 * 1024 }
        );
        output = result.stdout || "";
      } catch (_) { return; }
      let connections = [];
      try { connections = JSON.parse(output); } catch (_) { return; }
      if (!Array.isArray(connections)) connections = [connections];
      const suspiciousPorts = [22, 3389, 5900, 5985, 5986];
      const allowedIps = new Set(["127.0.0.1", "::1", "0.0.0.0"]);
      const dedupWindowMs = Math.max(5000, Number(this.policy.sensors?.network?.dedupWindowMs) || 30000);
      const maxAlertsPerPoll = Math.max(1, Number(this.policy.sensors?.network?.maxAlertsPerPoll) || 20);
      const maxAlertsPerWindow = Math.max(maxAlertsPerPoll, Number(this.policy.sensors?.network?.maxAlertsPerWindow) || 20);
      const now = Date.now();
      let emittedThisPoll = 0;
      if (now - this.alertWindowStartedAt >= dedupWindowMs) {
        this.alertWindowStartedAt = now;
        this.alertsInWindow = 0;
      }
      for (const [key, timestamp] of this.alertCache) {
        if (now - timestamp > dedupWindowMs) this.alertCache.delete(key);
      }
      for (const conn of connections) {
        this.stats.connectionsDetected++;
        const remoteAddr = conn.RemoteAddress || "";
        if (allowedIps.has(remoteAddr)) continue;
        const port = conn.RemotePort;
        const isSuspicious = suspiciousPorts.includes(Number(port)) || (Number(port) > 1024 && this.isExternalAddress(remoteAddr));
        if (!isSuspicious) continue;
        this.stats.suspicious++;
        const detail = { localAddress: conn.LocalAddress, remoteAddress: remoteAddr, remotePort: port, owningProcess: conn.OwningProcess };
        const fingerprint = [remoteAddr, port, conn.OwningProcess || "unknown"].join(":");
        const lastAlertAt = this.alertCache.get(fingerprint) || 0;
        if (now - lastAlertAt < dedupWindowMs || emittedThisPoll >= maxAlertsPerPoll || this.alertsInWindow >= maxAlertsPerWindow) {
          this.stats.suppressed++;
          continue;
        }
        this.alertCache.set(fingerprint, now);
        emittedThisPoll++;
        this.alertsInWindow++;
        const blockedPorts = this.policy.sessionPolicy?.blockedNetworkPorts || [22, 3389, 5900, 5985, 5986];
        const blockedIps = this.policy.sessionPolicy?.blockedNetworkIps || [];
        const shouldBlock = this.policy.mode === "enforce" && (blockedPorts.includes(Number(port)) || blockedIps.includes(remoteAddr));
        if (shouldBlock && this.enforcer) {
          this.enforcer.enforce({ type: "network", action: blockedIps.includes(remoteAddr) ? "block_ip" : "block_port", params: blockedIps.includes(remoteAddr) ? { ip: remoteAddr, pid: conn.OwningProcess } : { port: port, pid: conn.OwningProcess } }).then(result => {
            if (!result.success) this.addEvent("network", "high", "alert", "Network block failed: " + remoteAddr + ":" + port, { ...detail, reason: result.reason });
          }).catch(error => this.addEvent("network", "high", "alert", "Network block error: " + remoteAddr + ":" + port, { ...detail, error: error.message }));
        } else {
          this.addEvent("network", "medium", "alert", "Suspicious outbound connection: " + remoteAddr + ":" + port + " (PID " + conn.OwningProcess + ")", detail, { mitreTactic: "Command and Control", mitreTechnique: "T1071" });
        }
      }
    } finally {
      this.polling = false;
    }
  }

  isExternalAddress(ip) {
    if (!ip || ip.startsWith("10.") || ip.startsWith("172.16.") || ip.startsWith("192.168.")) return false;
    if (ip === "127.0.0.1" || ip === "::1") return false;
    return true;
  }

  getStats() { return { ...this.stats, polling: this.polling }; }
}

module.exports = { NetworkSensor };
