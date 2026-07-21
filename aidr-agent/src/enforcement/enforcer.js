const path = require("path");
const { WindowsEnforcementBridge } = require("./windowsEnforcementBridge");

class Enforcer {
  constructor(policy, addEvent) {
    this.policy = policy;
    this.addEvent = addEvent;
    this.bridge = new WindowsEnforcementBridge(policy, addEvent);
    this.stats = { actions: 0, success: 0, failed: 0 };
  }

  updatePolicy(policy) {
    this.policy = policy;
    this.bridge.updatePolicy(policy);
  }

  async enforce(action) {
    if (!action || !action.type || !action.action) return { success: false, reason: "type_and_action_required" };
    if (this.policy.mode === "monitor") {
      this.addEvent("enforcement", "info", "allow",
        `监控模式: 跳过执行 ${action.type}/${action.action}`,
        { action, capabilities: this.bridge.getCapabilities() });
      return { success: true, skipped: true, reason: "monitor_mode" };
    }

    this.stats.actions++;
    try {
      let result;
      switch (action.type) {
        case "process": result = await this._enforceProcess(action); break;
        case "network": result = await this._enforceNetwork(action); break;
        case "file": result = await this._enforceFile(action); break;
        default: throw new Error(`unsupported_enforcement_type:${action.type}`);
      }

      this.stats.success++;
      this.addEvent("enforcement", "high", "block",
        `执行成功: ${action.type}/${action.action}`,
        { action, result });
      return { success: true, result };
    } catch (error) {
      this.stats.failed++;
      const failClosed = /(?:unsupported_|requires_kernel|global_host_isolation)/.test(String(error.message || ""));
      const verdict = failClosed ? "block" : "alert";
      this.addEvent("enforcement", "high", verdict,
        `执行失败: ${action.type}/${action.action}`,
        { action, error: error.message, blocked: failClosed, failClosed, capabilities: this.bridge.getCapabilities() });
      return { success: false, blocked: failClosed, failClosed, reason: error.message, capabilities: this.bridge.getCapabilities() };
    }
  }

  async _enforceProcess(action) {
    switch (action.action) {
      case "terminate":
      case "kill":
        return this.bridge.terminateProcess(action.params?.pid);
      case "suspend":
        throw new Error("process_suspend_not_supported_by_user_mode_bridge");
      case "deny_create":
        throw new Error("process_precreate_requires_kernel_driver");
      default:
        throw new Error(`unsupported_process_action:${action.action}`);
    }
  }

  async _enforceNetwork(action) {
    switch (action.action) {
      case "block_ip": return this.bridge.blockIp(action.params?.ip, { pid: action.params?.pid });
      case "block_domain": return this.bridge.blockDomain(action.params?.domain, { pid: action.params?.pid });
      case "block_port": return this.bridge.blockPort(action.params?.port, { pid: action.params?.pid });
      case "clear_rules": return this.bridge.clearNetworkRules();
      case "isolate_host":
        throw new Error("global_host_isolation_disabled_use_scoped_firewall_rules");
      default:
        throw new Error(`unsupported_network_action:${action.action}`);
    }
  }

  async _enforceFile(action) {
    switch (action.action) {
      case "quarantine":
        return this.bridge.quarantineFile(action.params?.path, action.params?.quarantineDir);
      case "deny_write":
      case "deny_create":
        throw new Error("file_preoperation_requires_signed_minifilter");
      case "rollback":
        return this.bridge.quarantineFile(action.params?.path, action.params?.restoreDir || path.join(this.policy.workspaceRoot || process.cwd(), ".aidr-quarantine"));
      default:
        throw new Error(`unsupported_file_action:${action.action}`);
    }
  }

  getCapabilities() { return this.bridge.getCapabilities(); }
  getStats() { return { ...this.stats, bridge: this.bridge.getStats() }; }
}

module.exports = { Enforcer };
