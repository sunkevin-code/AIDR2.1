const fs = require("fs");
const path = require("path");

class FileSensor {
  constructor(policy, addEvent, enforcer) {
    this.policy = policy;
    this.addEvent = addEvent;
    this.enforcer = enforcer;
    this.active = false;
    this.watchers = [];
    this.stats = { totalDetected: 0, alerts: 0, blocked: 0 };
  }

  async start() {
    if (this.policy.sensors?.file?.enabled === false) return;
    this.active = true;
    const watchPaths = this.policy.sensors?.file?.watchPaths || [this.policy.workspaceRoot || process.cwd()].filter(p => fs.existsSync(p));

    for (const watchPath of watchPaths) {
      try {
        const watcher = fs.watch(watchPath, { recursive: false }, (eventType, filename) => {
          if (!filename) return;
          if (this._isIgnored(filename)) return;
          const fullPath = path.join(watchPath, filename);
          this.handleFileEvent(eventType, fullPath);
        });
        this.watchers.push(watcher);
      } catch (e) {
        this.addEvent("system", "medium", "alert", `文件监控启动失败: ${watchPath}`, { error: e.message });
      }
    }
    this.addEvent("system", "info", "allow", `文件传感器已启动 (${watchPaths.length} 路径)`);
  }

  _isIgnored(filename) {
    const ignoredPatterns = [
      /^\.aidr/, /^aidr-events/, /^logs[/\\]/, /\.db$/, /\.jsonl$/,
      /node_modules/, /\.git[/\\]/, /^\.git$/, /\.tmp$/, /~$/
    ];
    return ignoredPatterns.some(r => r.test(filename));
  }

  async stop() {
    this.active = false;
    for (const w of this.watchers) {
      try { w.close(); } catch (_) {}
    }
    this.watchers = [];
  }

  handleFileEvent(eventType, fullPath) {
    this.stats.totalDetected++;
    const deniedPaths = this.policy.sessionPolicy?.deniedPaths || [];
    const normalized = fullPath.replace(/\//g, "\\");

    const denied = deniedPaths.some(pattern => {
      const regex = new RegExp(
        "^" + pattern.replace(/\./g, "\\.").replace(/\*\*/g, ".*").replace(/\*/g, "[^\\\\]*") + "$",
        "i"
      );
      return regex.test(normalized);
    });

    if (denied) {
      this.stats.alerts++;
      this.addEvent("file", "high", "alert",
        `敏感文件触碰: ${eventType} ${fullPath}`,
        { changeType: eventType, path: fullPath, normalized },
        { mitreTactic: "Collection", mitreTechnique: "T1005" }
      );

      const protectedPaths = this.policy.sessionPolicy?.protectedPaths || [];
      const protectedFile = protectedPaths.some(pattern => this._matchesPattern(normalized, pattern));
      const shouldQuarantine = this.policy.mode === "enforce" &&
        protectedFile && this.policy.enforcement?.fileAction === "quarantine" &&
        ["rename", "change"].includes(String(eventType).toLowerCase());
      if (shouldQuarantine && this.enforcer) {
        this.stats.blocked++;
        this.enforcer.enforce({
          type: "file",
          action: "quarantine",
          params: { path: fullPath, quarantineDir: this.policy.enforcement?.quarantineDir }
        }).then(result => {
          if (!result.success) this.addEvent("file", "high", "alert", `文件隔离失败: ${fullPath}`, { path: fullPath, reason: result.reason });
        }).catch(error => {
          this.addEvent("file", "high", "alert", `文件隔离异常: ${fullPath}`, { path: fullPath, error: error.message });
        });
      }
    }
  }

  _matchesPattern(target, pattern) {
    try {
      const regex = new RegExp("^" + String(pattern).replace(/\./g, "\\.").replace(/\*\*/g, ".*").replace(/\*/g, "[^\\\\]*") + "$", "i");
      return regex.test(target);
    } catch (_) { return false; }
  }

  getStats() { return this.stats; }
}

module.exports = { FileSensor };
