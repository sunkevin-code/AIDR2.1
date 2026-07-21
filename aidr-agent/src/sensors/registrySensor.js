const { exec } = require("child_process");
const { promisify } = require("util");
const execAsync = promisify(exec);

class RegistrySensor {
  constructor(policy, addEvent, ruleEngine) {
    this.policy = policy;
    this.addEvent = addEvent;
    this.ruleEngine = ruleEngine;
    this.active = false;
    this.interval = null;
    this.polling = false;
    this.stats = { checks: 0, alerts: 0 };
  }

  async start() {
    if (!this.policy.sensors?.registry?.enabled) return;
    this.active = true;
    this.addEvent("system", "info", "allow", "Registry sensor started");
    this.interval = setInterval(() => { this.poll().catch(() => {}); }, 10000);
  }

  async stop() {
    this.active = false;
    if (this.interval) clearInterval(this.interval);
  }

  async poll() {
    if (this.polling) return;
    this.polling = true;
    try {
      const sensitiveKeys = [
        { key: "HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run", label: "Run (Machine)" },
        { key: "HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\RunOnce", label: "RunOnce (Machine)" },
        { key: "HKLM\\SYSTEM\\CurrentControlSet\\Services", label: "Services" },
        { key: "HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Winlogon", label: "Winlogon" },
        { key: "HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Policies\\System", label: "System Policies" }
      ];
      for (const item of sensitiveKeys) {
        try {
          const regPath = item.key.replace("HKLM\\", "HKLM:");
          const command = "powershell -NoProfile -Command \"try { Get-ItemProperty -Path '" + regPath + "' -ErrorAction Stop | ConvertTo-Json -Compress -Depth 1 } catch { '' }\"";
          const result = await execAsync(command, { encoding: "utf8", timeout: 5000, windowsHide: true, maxBuffer: 1024 * 1024 });
          const output = result.stdout || "";
          if (!output.trim()) continue;
          this.stats.checks++;
          const event = { category: "registry", summary: "Registry scan: " + item.label, detail: { key: item.key, values: output.slice(0, 500) } };
          const ruleResult = this.ruleEngine?.evaluate(event) || { verdict: "allow" };
          if (ruleResult.verdict !== "allow") {
            this.stats.alerts++;
            this.addEvent("registry", ruleResult.severity || "medium", ruleResult.verdict, "Sensitive registry item: " + item.label, { key: item.key, values: output.slice(0, 200) }, { mitreTactic: "Persistence", mitreTechnique: "T1547" });
          }
        } catch (_) {}
      }
    } finally {
      this.polling = false;
    }
  }

  getStats() { return { ...this.stats, polling: this.polling }; }
}

module.exports = { RegistrySensor };
