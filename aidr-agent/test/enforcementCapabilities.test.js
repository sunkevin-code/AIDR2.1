const assert = require("assert");
const { WindowsEnforcementBridge } = require("../src/enforcement/windowsEnforcementBridge");

const bridge = new WindowsEnforcementBridge({ mode: "enforce", enforcement: {} }, () => {});
bridge._isElevated = () => true;
const capabilities = bridge.getCapabilities();

assert.equal(capabilities.enforcementMode, "enforce");
assert.equal(capabilities.failClosed.preflight, true);
assert.equal(capabilities.failClosed.kernelPreOperation, false);
assert.equal(capabilities.failClosed.unsupportedActions, "blocked_and_reported");
assert.equal(capabilities.process.enforced, true);
assert.equal(capabilities.network.enforced, true);
assert.equal(capabilities.file.enforced, true);
assert.equal(capabilities.kernelDriver.status, "not_installed");
assert.equal(capabilities.kernelDriver.enforced, false);
console.log("enforcement capability tests passed");
