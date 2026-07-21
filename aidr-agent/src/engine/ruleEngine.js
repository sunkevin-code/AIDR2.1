const path = require("path");

class RuleEngine {
  constructor(policy) {
    this.policy = policy;
    this.stats = { matched: 0, blocked: 0, alerted: 0 };
    this.rules = this._buildRules();
  }

  _buildRules() {
    const sp = this.policy.sessionPolicy || {};
    const rules = [];

    const deniedPatterns = sp.deniedCommandPatterns || [];
    for (const pattern of deniedPatterns) {
      rules.push({
        id: `cmd-` + Buffer.from(pattern).toString("base64").slice(0, 8),
        type: "keyword",
        category: "command",
        pattern: pattern.toLowerCase(),
        severity: "high",
        verdict: "block"
      });
    }

    const deniedPaths = sp.deniedPaths || [];
    for (const dp of deniedPaths) {
      rules.push({
        id: `path-` + Buffer.from(dp).toString("base64").slice(0, 8),
        type: "path_pattern",
        category: "file_access",
        pattern: this._globToRegex(dp),
        severity: "high",
        verdict: "alert"
      });
    }

    rules.push({
      id: "net-ext",
      type: "network",
      category: "network",
      name: "External IP connection",
      allowedIps: ["127.0.0.1", "::1", "0.0.0.0"],
      allowedDomains: sp.allowedDomains || ["localhost", "127.0.0.1"],
      suspiciousPorts: [22, 3389, 5900, 5985, 5986],
      severity: "medium",
      verdict: "alert"
    });

    rules.push({
      id: "reg-sensitive",
      type: "registry",
      category: "registry",
      name: "Sensitive registry paths",
      sensitivePaths: [
        "HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run",
        "HKLM\\SYSTEM\\CurrentControlSet\\Services",
        "HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Winlogon"
      ],
      severity: "high",
      verdict: "block"
    });

    rules.push({
      id: "shell-danger",
      type: "shell",
      category: "shell",
      name: "Dangerous shell patterns",
      patterns: [
        /rm\s+-rf\s+\//i, /del\s+\/f\s+\/s/i,
        /format\s+/i, /diskpart/i,
        /net\s+user\s+.*\/add/i, /net\s+localgroup/i,
        /sc\s+stop\s+/i, /sc\s+delete\s+/i,
        /schtasks\s+\/create/i, /reg\s+(add|delete|save)/i
      ],
      severity: "high",
      verdict: "block"
    });

    return rules;
  }

  _globToRegex(glob) {
    let p = glob.replace(/\./g, "\\.");
    p = p.replace(/\*\*/g, "<<GLOB>>");
    p = p.replace(/\*/g, "[^\\\\]*");
    p = p.replace(/<<GLOB>>/g, ".*");
    return new RegExp("^" + p + "$", "i");
  }

  evaluate(event) {
    const category = event.category || "unknown";
    const detail = event.detail || {};
    const summary = (event.summary || "").toLowerCase();

    const applicable = this.rules.filter(r => r.category === category || r.type === category);

    for (const rule of applicable) {
      let match = false;

      switch (rule.type) {
        case "keyword": {
          const cmdLine = (detail.commandLine || detail.cmd || summary || "").toLowerCase();
          if (cmdLine.includes(rule.pattern)) match = true;
          break;
        }
        case "path_pattern": {
          const filePath = (detail.path || detail.fullPath || "").replace(/\//g, "\\");
          if (rule.pattern.test(filePath)) match = true;
          break;
        }
        case "network": {
          const remote = detail.remoteAddress || "";
          const port = detail.remotePort;
          if (rule.allowedIps?.includes(remote)) break;
          if (rule.suspiciousPorts?.includes(port)) match = true;
          else if (port > 1024 && this._isExternal(remote)) match = true;
          break;
        }
        case "registry": {
          const key = (detail.key || "").toUpperCase();
          match = (rule.sensitivePaths || []).some(sp => key.includes(sp.toUpperCase()));
          break;
        }
        case "shell": {
          const cmd = (detail.command || detail.cmdLine || summary || "");
          match = (rule.patterns || []).some(re => re.test(cmd));
          break;
        }
      }

      if (match) {
        this.stats.matched++;
        if (rule.verdict === "block") this.stats.blocked++;
        else if (rule.verdict === "alert") this.stats.alerted++;
        return {
          verdict: rule.verdict,
          matchedRule: rule.id,
          severity: rule.severity,
          ruleName: rule.name || rule.pattern
        };
      }
    }

    return { verdict: "allow", matchedRule: null, severity: "info" };
  }

  _isExternal(ip) {
    if (!ip) return false;
    if (ip.startsWith("10.") || ip.startsWith("172.16.") || ip.startsWith("192.168.")) return false;
    if (ip === "127.0.0.1" || ip === "::1") return false;
    return true;
  }

  addRule(rule) {
    const idx = this.rules.findIndex(r => r.id === rule.id);
    if (idx >= 0) this.rules[idx] = rule;
    else this.rules.push(rule);
  }

  removeRule(ruleId) {
    this.rules = this.rules.filter(r => r.id !== ruleId);
  }

  updatePolicy(policy) {
    this.policy = policy;
    this.rules = this._buildRules();
  }

  getStats() { return this.stats; }
  getRules() { return this.rules.map(r => ({ id: r.id, type: r.type, category: r.category, verdict: r.verdict })); }
}

module.exports = { RuleEngine };
