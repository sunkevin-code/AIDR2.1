const { spawn, exec } = require("child_process");
const { promisify } = require("util");
const execAsync = promisify(exec);
const path = require("path");
const fs = require("fs");

class ShellSensor {
  constructor(policy, addEvent, ruleEngine) {
    this.policy = policy;
    this.addEvent = addEvent;
    this.ruleEngine = ruleEngine;
    this.active = false;
    this.stats = { commands: 0, blocked: 0, alerted: 0 };
    this.shellHistory = [];
    this.polling = false;
  }

  async start() {
    if (!this.policy.sensors?.shell?.enabled) return;
    this.active = true;
    this.addEvent("system", "info", "allow", "Shell 命令拦截器已启动 (日志分析模式)");

    this.interval = setInterval(() => { this._scanShellLogs().catch(() => {}); }, 5000);
  }

  async stop() {
    this.active = false;
    if (this.interval) clearInterval(this.interval);
  }

  async _scanShellLogs() {
    if (this.polling) return;
    this.polling = true;
    try {
      let psHistory = "";
      try {
        const result = await execAsync(
          `powershell -NoProfile -Command "(Get-PSReadLineOption).HistorySavePath"`,
          { encoding: "utf8", timeout: 3000, windowsHide: true }
        );
        psHistory = (result.stdout || "").trim();
      } catch (_) {}

      if (psHistory && fs.existsSync(psHistory)) {
        const lines = fs.readFileSync(psHistory, "utf8").split("\n").filter(Boolean);
        const newLines = lines.slice(this.shellHistory.length);
        for (const line of newLines) {
          this._analyzeCommand(line.trim(), "powershell");
        }
        this.shellHistory = lines;
      }
    } catch (_) {}

    try {
      const profilePath = path.join(process.env.USERPROFILE || "~", "AppData", "Roaming", "Code", "User", "History");
      if (fs.existsSync(profilePath)) {
        const files = fs.readdirSync(profilePath)
          .filter(f => f.endsWith(".jsonl"))
          .sort()
          .slice(-3);

        for (const file of files) {
          try {
            const content = fs.readFileSync(path.join(profilePath, file), "utf8");
            const lines = content.split("\n").filter(Boolean);
            for (const line of lines) {
              try {
                const entry = JSON.parse(line);
                if (entry.command) {
                  this._analyzeCommand(entry.command, "vscode-terminal");
                }
              } catch (_) {}
            }
          } catch (_) {}
        }
      }
    } catch (_) {} finally { this.polling = false; }
  }

  _analyzeCommand(command, source) {
    if (!command || command.length < 2) return;
    this.stats.commands++;

    const event = {
      category: "shell",
      summary: `Shell命令: ${command.slice(0, 100)}`,
      detail: { command, source, length: command.length }
    };

    const ruleResult = this.ruleEngine ? this.ruleEngine.evaluate(event) : { verdict: "allow" };

    if (ruleResult.verdict === "block") {
      this.stats.blocked++;
      this.addEvent("shell", "high", "block",
        `危险命令拦截: ${command.slice(0, 80)}`,
        { command, source },
        { mitreTactic: "Execution", mitreTechnique: "T1059" }
      );
    } else if (ruleResult.verdict === "alert") {
      this.stats.alerted++;
      this.addEvent("shell", "medium", "alert",
        `可疑命令: ${command.slice(0, 80)}`,
        { command, source });
    }
  }

  getStats() { return { ...this.stats, polling: this.polling }; }
}


module.exports = { ShellSensor };

