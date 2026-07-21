const assert = require("assert");
const { Enforcer } = require("../src/enforcement/enforcer");

const events = [];
const enforcer = new Enforcer({ mode: "enforce", enforcement: {} }, (...args) => events.push(args));
enforcer.bridge.getCapabilities = () => ({ failClosed: { unsupportedActions: "blocked_and_reported" } });

async function main() {
  const result = await enforcer.enforce({ type: "process", action: "deny_create", params: {} });
  assert.equal(result.success, false);
  assert.equal(result.blocked, true);
  assert.equal(result.failClosed, true);
  assert.equal(events.at(-1)[2], "block");
  assert.equal(events.at(-1)[3], "执行失败: process/deny_create");
  console.log("enforcer fail-closed tests passed");
}

main().catch(error => { console.error(error); process.exitCode = 1; });
