const { exec, execSync } = require("child_process");
const { promisify } = require("util");
const execAsync = promisify(exec);
const { AgentIdentityEngine } = require("../engine/agentIdentityEngine");

class ProcessSensor {
  constructor(policy, addEvent, enforcer) {
    this.policy = policy;
    this.addEvent = addEvent;
    this.enforcer = enforcer;
    this.active = false;
    this.interval = null;
    this.polling = false;
    this.seenProcesses = new Set();
    this.stats = { totalDetected: 0, blocked: 0, agentDetections: 0 };
    this.agentIdentity = new AgentIdentityEngine(policy);
  }

  async start() {
    if (this.policy.sensors?.process?.enabled === false) return;
    this.active = true;
    this.addEvent("system", "info", "allow", "Process sensor started (WMI polling mode)");
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
      try {
        const result = await execAsync(
          "powershell -NoProfile -Command \"Get-CimInstance Win32_Process | Select-Object ProcessId,Name,CommandLine | ConvertTo-Json -Compress\"",
          { encoding: "utf8", timeout: 5000, windowsHide: true, maxBuffer: 8 * 1024 * 1024 }
        );
        output = result.stdout || "";
      } catch (_) { return; }

      let processes = [];
      try { processes = JSON.parse(output); } catch (_) { return; }
      if (!Array.isArray(processes)) processes = [processes];

      const discovery = this.agentIdentity.update(processes);
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
    } finally {
      this.polling = false;
    }
  }

  getStats() { return { ...this.stats, polling: this.polling }; }
  getAgentIdentities() { return this.agentIdentity.getSnapshot(); }
  getAgentCatalog() { return this.agentIdentity.getCatalog(); }
  getAgentDiscoveryStatus() { return this.agentIdentity.getStatus(); }
}

module.exports = { ProcessSensor };
