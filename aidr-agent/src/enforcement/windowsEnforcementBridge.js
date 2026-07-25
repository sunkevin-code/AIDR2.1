const crypto = require("crypto");
const dns = require("dns").promises;
const fs = require("fs");
const os = require("os");
const path = require("path");
const childProcess = require("child_process");

class WindowsEnforcementBridge {
  constructor(policy, addEvent) {
    this.policy = policy;
    this.addEvent = addEvent;
    this.ruleFile = path.join(process.env.AIDR_ENDPOINT_HOME || process.cwd(), "data", "enforcement-rules.json");
    this.ruleNames = new Set(this._readRuleNames());
    this.stats = { processTerminated: 0, networkRules: 0, filesQuarantined: 0, failures: 0 };
  }

  updatePolicy(policy) { this.policy = policy; }

  getCapabilities() {
    const elevated = this._isElevated();
    return {
      platform: process.platform,
      elevated,
      enforcementMode: this.policy.mode || "monitor",
      failClosed: {
        preflight: true,
        kernelPreOperation: false,
        unsupportedActions: "blocked_and_reported"
      },
      process: { status: "user_mode_terminate", enforced: elevated, detail: "Denied processes are terminated after detection; process-create prevention requires a signed kernel callback." },
      network: { status: elevated ? "windows_firewall_rules" : "requires_elevation", enforced: elevated, scope: "host_or_program", managedRuleCount: this.ruleNames.size, detail: "AIDR-managed outbound IP/port rules are persisted and can be cleared for rollback." },
      file: { status: "policy_preflight_quarantine", enforced: true, detail: "Agent tool writes are denied preflight; detected files can be quarantined after the operation." },
      kernelDriver: { status: "not_installed", enforced: false, requiredFor: ["process_create", "file_pre_operation", "network_pre_connect"], detail: "A signed minifilter/WFP driver is required for OS-wide pre-operation enforcement." },
      runtime: { preflight: true, userModePostDetection: elevated, windowsFirewall: elevated, kernelPreOperation: false, failClosedOnUnsupported: true }
    };
  }

  terminateProcess(pid) {
    const numericPid = Number(pid);
    if (!Number.isInteger(numericPid) || numericPid <= 0 || numericPid === process.pid) {
      throw new Error("invalid_process_id");
    }
    childProcess.execFileSync("taskkill.exe", ["/PID", String(numericPid), "/F", "/T"], {
      windowsHide: true, timeout: 5000, stdio: "ignore"
    });
    this.stats.processTerminated++;
    return { terminated: numericPid, tree: true };
  }

  blockIp(ip, context = {}) {
    if (!isIp(ip)) throw new Error("invalid_ip");
    const name = this._ruleName(`ip-${ip}`);
    const args = ["advfirewall", "firewall", "add", "rule", `name=${name}`, "dir=out", "action=block", "profile=any", `remoteip=${ip}`];
    if (context.program) args.push(`program=${path.resolve(String(context.program))}`);
    args.push("description=AIDR managed rule");
    this._netsh(args);
    this.ruleNames.add(name);
    this._persistRuleNames();
    this.stats.networkRules++;
    return { blockedIp: ip, ruleName: name, scope: context.program ? "program" : "host", ...context };
  }

  blockPort(port, context = {}) {
    const numericPort = Number(port);
    if (!Number.isInteger(numericPort) || numericPort < 1 || numericPort > 65535) throw new Error("invalid_port");
    const name = this._ruleName(`port-${numericPort}`);
    const args = ["advfirewall", "firewall", "add", "rule", `name=${name}`, "dir=out", "action=block", "profile=any", "protocol=TCP", `remoteport=${numericPort}`];
    if (context.program) args.push(`program=${path.resolve(String(context.program))}`);
    args.push("description=AIDR managed rule");
    this._netsh(args);
    this.ruleNames.add(name);
    this._persistRuleNames();
    this.stats.networkRules++;
    return { blockedPort: numericPort, ruleName: name, scope: context.program ? "program" : "host", ...context };
  }

  async blockDomain(domain, context = {}) {
    const normalized = String(domain || "").trim().toLowerCase();
    if (!/^[a-z0-9.-]+$/.test(normalized) || normalized.length > 253) throw new Error("invalid_domain");
    const addresses = await dns.lookup(normalized, { all: true });
    if (!addresses.length) throw new Error("domain_not_resolved");
    const rules = addresses.map(entry => this.blockIp(entry.address, { ...context, domain: normalized }));
    return { blockedDomain: normalized, addresses: rules.map(rule => rule.blockedIp), ...context };
  }

  quarantineFile(sourcePath, quarantineDir) {
    const source = path.resolve(String(sourcePath || ""));
    if (!source || !fs.existsSync(source)) return { skipped: true, reason: "file_not_found" };
    if (fs.statSync(source).isDirectory()) throw new Error("directory_quarantine_not_supported");
    const destinationDir = path.resolve(
      quarantineDir || this.policy.enforcement?.quarantineDir || path.join(os.tmpdir(), "AIDR", "quarantine")
    );
    fs.mkdirSync(destinationDir, { recursive: true });
    const destination = path.join(destinationDir, `${path.basename(source)}.aidr-${Date.now()}`);
    fs.renameSync(source, destination);
    this.stats.filesQuarantined++;
    return { quarantined: destination, source };
  }

  clearNetworkRules() {
    const deleted = [];
    for (const name of this.ruleNames) {
      try {
        this._netsh(["advfirewall", "firewall", "delete", "rule", `name=${name}`]);
        deleted.push(name);
      } catch (_) {}
    }
    this.ruleNames.clear();
    this._persistRuleNames();
    return { cleared: true, rules: deleted };
  }

  _ruleName(suffix) {
    const digest = crypto.createHash("sha256").update(String(suffix)).digest("hex").slice(0, 12);
    return `AIDR-${digest}`;
  }

  _netsh(args) {
    try {
      return childProcess.execFileSync("netsh.exe", args, { windowsHide: true, timeout: 8000, encoding: "utf8" });
    } catch (error) {
      this.stats.failures++;
      const detail = String(error.stderr || error.message || "netsh_failed").trim();
      throw new Error(`windows_firewall_failed:${detail.slice(0, 240)}`);
    }
  }

  _readRuleNames() {
    try {
      const value = JSON.parse(fs.readFileSync(this.ruleFile, "utf8"));
      return Array.isArray(value) ? value.filter(name => /^AIDR-[a-f0-9-]+$/i.test(name)) : [];
    } catch (_) { return []; }
  }

  _persistRuleNames() {
    try {
      fs.mkdirSync(path.dirname(this.ruleFile), { recursive: true });
      fs.writeFileSync(this.ruleFile, JSON.stringify([...this.ruleNames], null, 2));
    } catch (_) {}
  }

  _isElevated() {
    if (process.platform !== "win32") return false;
    try {
      const output = childProcess.execFileSync("powershell.exe", [
        "-NoProfile", "-NonInteractive", "-Command",
        "([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)"
      ], { windowsHide: true, timeout: 3000, encoding: "utf8" });
      return /^true/i.test(output.trim());
    } catch (_) { return false; }
  }

  getStats() { return { ...this.stats }; }
}

function isIp(value) {
  const text = String(value || "").trim();
  return /^(?:\d{1,3}\.){3}\d{1,3}$/.test(text) || /^[0-9a-f:]+$/i.test(text);
}

module.exports = { WindowsEnforcementBridge };
