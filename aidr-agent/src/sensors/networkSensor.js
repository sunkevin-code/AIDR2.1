const { exec } = require("child_process");
const { promisify } = require("util");
const execAsync = promisify(exec);

class NetworkSensor {
  constructor(policy, addEvent, enforcer, processSensor = null) {
    this.policy = policy;
    this.addEvent = addEvent;
    this.enforcer = enforcer;
    this.processSensor = processSensor;
    this.active = false;
    this.interval = null;
    this.polling = false;
    this.connectionStates = new Map();
    this.alertWindowStartedAt = 0;
    this.alertsInWindow = 0;
    this.stats = { connectionsDetected: 0, suspicious: 0, emitted: 0, suppressed: 0, completedLifecycles: 0 };
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
      let connections = [];
      try {
        if (process.platform === "win32") {
          const result = await execAsync(
            "powershell -NoProfile -Command \"Get-NetTCPConnection -State Established | Select-Object LocalAddress,LocalPort,RemoteAddress,RemotePort,OwningProcess | ConvertTo-Json -Compress\"",
            { encoding: "utf8", timeout: 5000, windowsHide: true, maxBuffer: 8 * 1024 * 1024 }
          );
          output = result.stdout || "";
          connections = JSON.parse(output);
        } else {
          const result = await execAsync("ss -Htnp state established", { encoding: "utf8", timeout: 5000, maxBuffer: 8 * 1024 * 1024 });
          connections = String(result.stdout || "").split(/\r?\n/).filter(Boolean).map(line => {
            const columns = line.trim().split(/\s+/);
            const local = columns[3] || "";
            const remote = columns[4] || "";
            const pid = Number((line.match(/pid=(\d+)/) || [])[1] || 0);
            const splitAddress = value => {
              const match = value.match(/^\[?(.+?)\]?:(\d+)$/);
              return match ? { address: match[1], port: Number(match[2]) } : { address: value, port: 0 };
            };
            const localPart = splitAddress(local);
            const remotePart = splitAddress(remote);
            return { LocalAddress: localPart.address, LocalPort: localPart.port, RemoteAddress: remotePart.address, RemotePort: remotePart.port, OwningProcess: pid };
          });
        }
      } catch (_) { return; }
      if (!Array.isArray(connections)) connections = [connections];
      const suspiciousPorts = [22, 3389, 5900, 5985, 5986];
      const allowedIps = new Set(["127.0.0.1", "::1", "0.0.0.0"]);
      const dedupWindowMs = Math.max(5000, Number(this.policy.sensors?.network?.dedupWindowMs) || 30000);
      // Windows connection enumeration can temporarily miss a live socket.
      // Keep the lifecycle identity long enough to avoid periodic re-alerting.
      const connectionIdleMs = Math.max(60000, Number(this.policy.sensors?.network?.connectionIdleMs) || 10 * 60 * 1000);
      const maxAlertsPerPoll = Math.max(1, Number(this.policy.sensors?.network?.maxAlertsPerPoll) || 20);
      const maxAlertsPerWindow = Math.max(maxAlertsPerPoll, Number(this.policy.sensors?.network?.maxAlertsPerWindow) || 20);
      const now = Date.now();
      let emittedThisPoll = 0;
      const activeFingerprints = new Set();
      if (now - this.alertWindowStartedAt >= dedupWindowMs) {
        this.alertWindowStartedAt = now;
        this.alertsInWindow = 0;
      }
      for (const conn of connections) {
        this.stats.connectionsDetected++;
        const remoteAddr = conn.RemoteAddress || "";
        if (allowedIps.has(remoteAddr)) continue;
        const port = conn.RemotePort;
        const isSuspicious = suspiciousPorts.includes(Number(port)) || (Number(port) > 1024 && this.isExternalAddress(remoteAddr));
        if (!isSuspicious) continue;
        this.stats.suspicious++;
        const attribution = this.processSensor?.resolveAgentByPid?.(conn.OwningProcess) || null;
        const detail = {
          localAddress: conn.LocalAddress,
          localPort: conn.LocalPort,
          remoteAddress: remoteAddr,
          remotePort: port,
          owningProcess: conn.OwningProcess,
          connectionLifecycle: true,
          firstObservedAt: new Date(now).toISOString(),
          attribution
        };
        const fingerprint = [remoteAddr, port, conn.OwningProcess || "unknown"].join(":");
        activeFingerprints.add(fingerprint);
        const existing = this.connectionStates.get(fingerprint);
        if (existing) {
          existing.lastSeenAt = now;
          existing.observations++;
          this.stats.suppressed++;
          continue;
        }
        if (emittedThisPoll >= maxAlertsPerPoll || this.alertsInWindow >= maxAlertsPerWindow) {
          this.stats.suppressed++;
          continue;
        }
        this.connectionStates.set(fingerprint, { fingerprint, firstSeenAt: now, lastSeenAt: now, observations: 1, detail });
        emittedThisPoll++;
        this.alertsInWindow++;
        this.stats.emitted++;
        const blockedPorts = this.policy.sessionPolicy?.blockedNetworkPorts || [22, 3389, 5900, 5985, 5986];
        const blockedIps = this.policy.sessionPolicy?.blockedNetworkIps || [];
        const shouldBlock = this.policy.mode === "enforce" && (blockedPorts.includes(Number(port)) || blockedIps.includes(remoteAddr));
        if (shouldBlock && this.enforcer) {
          this.enforcer.enforce({ type: "network", action: blockedIps.includes(remoteAddr) ? "block_ip" : "block_port", params: blockedIps.includes(remoteAddr) ? { ip: remoteAddr, pid: conn.OwningProcess } : { port: port, pid: conn.OwningProcess } }).then(result => {
            if (!result.success) this.addEvent("network", "high", "alert", "Network block failed: " + remoteAddr + ":" + port, { ...detail, reason: result.reason }, { agentId: attribution?.agentId || null });
          }).catch(error => this.addEvent("network", "high", "alert", "Network block error: " + remoteAddr + ":" + port, { ...detail, error: error.message }, { agentId: attribution?.agentId || null }));
        } else {
          this.addEvent("network", "medium", "alert", "Suspicious outbound connection: " + remoteAddr + ":" + port + " (PID " + conn.OwningProcess + ")", detail, {
            agentId: attribution?.agentId || null,
            mitreTactic: "Command and Control",
            mitreTechnique: "T1071"
          });
        }
      }
      for (const [fingerprint, state] of this.connectionStates) {
        if (!activeFingerprints.has(fingerprint) && now - state.lastSeenAt >= connectionIdleMs) {
          this.connectionStates.delete(fingerprint);
          this.stats.completedLifecycles++;
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

  getStats() { return { ...this.stats, activeLifecycles: this.connectionStates.size, polling: this.polling }; }
}

module.exports = { NetworkSensor };
