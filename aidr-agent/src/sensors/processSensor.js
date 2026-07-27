const { exec, execSync } = require("child_process");
const { promisify } = require("util");
const execAsync = promisify(exec);
const { AgentIdentityEngine } = require("../engine/agentIdentityEngine");
const { readJsonWithBackup, writeJsonAtomic } = require("../utils/atomicJson");

class ProcessSensor {
  constructor(policy, addEvent, enforcer, options = {}) {
    this.policy = policy;
    this.addEvent = addEvent;
    this.enforcer = enforcer;
    this.active = false;
    this.interval = null;
    this.polling = false;
    this.seenProcesses = new Set();
    this.pidAttributions = new Map();
    this.pidAttributionTtlMs = Math.max(60000, Number(policy.sensors?.process?.pidAttributionTtlMs) || 24 * 60 * 60 * 1000);
    this.discoveryStatePath = options.statePath || null;
    this.discoveryPersistence = { source: "none", recovered: false, lastSaveAt: null, lastSaveError: null, saveFailures: 0, lastScanAt: null, lastScanError: null };
    this.stats = { totalDetected: 0, blocked: 0, agentDetections: 0 };
    this.agentIdentity = new AgentIdentityEngine(policy);
    this._loadDiscoveryState();
  }

  _loadDiscoveryState() {
    if (!this.discoveryStatePath) return;
    const loaded = readJsonWithBackup(this.discoveryStatePath, null);
    this.discoveryPersistence.source = loaded.source;
    this.discoveryPersistence.recovered = loaded.recovered;
    if (Array.isArray(loaded.value?.agents)) this.agentIdentity.restore(loaded.value.agents);
    for (const item of (Array.isArray(loaded.value?.pidAttributions) ? loaded.value.pidAttributions : [])) {
      if (Number(item.pid) > 0 && item.agentId && Date.now() - new Date(item.lastSeenAt || 0).getTime() <= this.pidAttributionTtlMs) {
        this.pidAttributions.set(Number(item.pid), item);
      }
    }
  }

  _saveDiscoveryState() {
    if (!this.discoveryStatePath) return;
    try {
      writeJsonAtomic(this.discoveryStatePath, {
        version: 2,
        savedAt: new Date().toISOString(),
        agents: this.agentIdentity.getSnapshot(),
        pidAttributions: Array.from(this.pidAttributions.values())
      });
      this.discoveryPersistence.source = "primary";
      this.discoveryPersistence.lastSaveAt = new Date().toISOString();
      this.discoveryPersistence.lastSaveError = null;
    } catch (error) {
      this.discoveryPersistence.saveFailures++;
      this.discoveryPersistence.lastSaveError = error.message;
    }
  }

  async start() {
    if (this.policy.sensors?.process?.enabled === false) return;
    this.active = true;
    this.addEvent("system", "info", "allow", "Process sensor started (WMI polling mode)");
    this.poll().catch(() => {});
    this.interval = setInterval(() => { this.poll().catch(() => {}); }, 3000);
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
      let processes = [];
      try {
        if (process.platform === "win32") {
          const result = await execAsync(
            "powershell -NoProfile -Command \"Get-CimInstance Win32_Process | Select-Object ProcessId,Name,CommandLine | ConvertTo-Json -Compress\"",
            { encoding: "utf8", timeout: 5000, windowsHide: true, maxBuffer: 8 * 1024 * 1024 }
          );
          output = result.stdout || "";
          processes = JSON.parse(output);
        } else {
          const result = await execAsync("ps -eo pid=,comm=,args=", { encoding: "utf8", timeout: 5000, maxBuffer: 8 * 1024 * 1024 });
          processes = String(result.stdout || "").split(/\r?\n/).filter(Boolean).map(line => {
            const match = line.trim().match(/^(\d+)\s+(\S+)\s*(.*)$/);
            return match ? { ProcessId: Number(match[1]), Name: match[2], CommandLine: match[3] || match[2] } : null;
          }).filter(Boolean);
        }
      } catch (_) { return; }
      if (!Array.isArray(processes)) processes = [processes];

      const discovery = this.agentIdentity.update(processes);
      const seenAt = discovery.timestamp;
      for (const agent of discovery.agents || []) {
        for (const pid of agent.pids || []) {
          if (Number(pid) <= 0) continue;
          this.pidAttributions.set(Number(pid), {
            pid: Number(pid),
            agentId: agent.id,
            agentLabel: agent.label,
            confidence: agent.confidence || 0,
            source: "process_discovery.pid",
            lastSeenAt: seenAt
          });
        }
      }
      for (const [pid, attribution] of this.pidAttributions) {
        if (Date.now() - new Date(attribution.lastSeenAt || 0).getTime() > this.pidAttributionTtlMs) this.pidAttributions.delete(pid);
      }
      this.discoveryPersistence.lastScanAt = discovery.timestamp;
      this.discoveryPersistence.lastScanError = null;
      this._saveDiscoveryState();
      for (const agent of discovery.changes) {
        if (agent.status === "active") {
          this.stats.agentDetections++;
          this.addEvent("agent_discovery", "info", "allow", "AI Agent detected: " + agent.label, {
            agentId: agent.id, vendor: agent.vendor, category: agent.category, confidence: agent.confidence, signals: agent.signals, pids: agent.pids
          });
        }
      }

      const sensitiveNames = ["codex.exe", "codex", "cursor", "windsurf", "cline", "copilot"];
      const workspaceRoot = this.policy.workspaceRoot || process.cwd();
      for (const proc of processes) {
        const pid = proc.ProcessId;
        if (this.seenProcesses.has(pid)) continue;
        this.seenProcesses.add(pid);
        const name = (proc.Name || "").toLowerCase();
        const cmdLine = proc.CommandLine || "";
        const agentMatch = this.agentIdentity.matchProcess(proc);
        const isAgentRelated = Boolean(agentMatch) || sensitiveNames.some(n => name.includes(n)) || cmdLine.toLowerCase().includes("codex") || cmdLine.toLowerCase().includes("openai") || (workspaceRoot && cmdLine.includes(workspaceRoot));
        if (!isAgentRelated) continue;
        this.stats.totalDetected++;
        const deniedPatterns = this.policy.sessionPolicy?.deniedCommandPatterns || [];
        const denied = deniedPatterns.some(p => cmdLine.toLowerCase().includes(p.toLowerCase()));
        if (denied) {
          this.stats.blocked++;
          this.addEvent("process", "high", "block", "High-risk command blocked: " + name + " (PID " + pid + ")", { pid, name, commandLine: cmdLine, reason: "denied_command_pattern", agentId: agentMatch?.profile.id || null, agentLabel: agentMatch?.profile.label || null }, { mitreTactic: "Execution", mitreTechnique: "T1059" });
          if (this.policy.mode === "enforce" && this.policy.sessionPolicy?.blockedProcessAction === "kill" && pid > 0 && this.enforcer) {
            this.enforcer.enforce({ type: "process", action: "terminate", params: { pid } }).then(result => {
              if (!result.success) this.addEvent("process", "high", "alert", "Process termination failed: PID " + pid, { pid, reason: result.reason });
            }).catch(error => this.addEvent("process", "high", "alert", "Process termination error: PID " + pid, { pid, error: error.message }));
          }
        } else {
          this.addEvent("process", "info", "allow", "Agent process: " + name, { pid, name, commandLine: cmdLine, agentId: agentMatch?.profile.id || null, agentLabel: agentMatch?.profile.label || null, agentConfidence: agentMatch?.score || null, agentSignals: agentMatch?.signals || [] });
        }
      }
    } catch (error) {
      this.discoveryPersistence.lastScanError = error.message;
      throw error;
    } finally {
      this.polling = false;
    }
  }

  getStats() { return { ...this.stats, polling: this.polling, discovery: { ...this.discoveryPersistence } }; }
  getAgentIdentities() { return this.agentIdentity.getSnapshot(); }
  getAgentCatalog() { return this.agentIdentity.getCatalog(); }
  getAgentDiscoveryStatus() { return this.agentIdentity.getStatus(); }
  resolveAgentByPid(pid) {
    const value = this.pidAttributions.get(Number(pid));
    if (!value) return null;
    if (Date.now() - new Date(value.lastSeenAt || 0).getTime() > this.pidAttributionTtlMs) {
      this.pidAttributions.delete(Number(pid));
      return null;
    }
    return { ...value };
  }
}

module.exports = { ProcessSensor };
