const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { EventBus } = require("../src/utils/eventBus");
const { OpenCodeSessionSensor } = require("../src/sensors/openCodeSessionSensor");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "aidr-opencode-test-"));
const events = [];
const bus = new EventBus();
bus.on("agent:user_prompt", event => events.push(event));
const sensor = new OpenCodeSessionSensor({ workspaceRoot: root }, () => {}, bus);
const runtimeDir = path.join(root, "ai.opencode.desktop");
fs.mkdirSync(runtimeDir, { recursive: true });
sensor.processSensor = { getAgentIdentities: () => [{ id: "opencode", processes: [{ commandLine: "OpenCode.exe --user-data-dir=\"" + runtimeDir + "\"" }] }] };
assert.equal(sensor._resolveDataDirs(root).includes(runtimeDir), true);
const entries = sensor._extractPromptEntries({
  "session:ses_test:prompt": "Read the README.md file",
  "session:ses_test:model": "test-model",
  "session:ses_test:comments": "not a prompt",
  "workspace:prompt": "draft text"
});
assert.equal(entries.length, 1);
assert.equal(entries[0].sessionId, "ses_test");
assert.equal(entries[0].prompt, "Read the README.md file");
assert.equal(entries[0].model, "test-model");
const structured = sensor._extractPromptEntries({ "session:ses_structured:prompt": JSON.stringify({ prompt: [{ type: "text", content: "real submitted prompt" }], cursor: 21, context: { items: [] } }) });
assert.equal(structured[0].prompt, "real submitted prompt");
assert.equal(sensor._extractPromptEntries({ "session:ses_empty:prompt": JSON.stringify({ prompt: [{ type: "text", content: "" }], cursor: 0 }) }).length, 0);

const file = path.join(root, "opencode.workspace.test.dat");
fs.writeFileSync(file, JSON.stringify({ "session:ses_test:prompt": "Read the README.md file", "session:ses_test:model": "test-model" }));
const stat = fs.statSync(file);
sensor._observeEntry(file, stat, entries[0]);
sensor._observeEntry(file, stat, entries[0]);
assert.equal(events.length, 1);
assert.equal(events[0].agent, "opencode");
assert.equal(events[0].agentLabel, "OpenCode");
assert.equal(events[0].conversationId, "ses_test");
assert.equal(events[0].prompt, "Read the README.md file");
assert.equal(sensor.getStats().sessions, 1);
assert.equal(sensor.getStats().prompts, 1);
fs.rmSync(root, { recursive: true, force: true });
console.log("openCodeSessionSensor tests passed");