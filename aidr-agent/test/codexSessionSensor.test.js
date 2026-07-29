const assert = require("assert");
const { CodexSessionSensor } = require("../src/sensors/codexSessionSensor");

const sensor = new CodexSessionSensor({}, () => {}, null);
const payload = {
  model: "deepseek-v4-pro",
  instructions: "developer instructions",
  input: [
    {
      type: "message",
      role: "developer",
      content: [{ type: "input_text", text: "<environment_context><cwd>C:\\Users\\OseasyVM</cwd></environment_context>" }]
    },
    {
      type: "message",
      role: "user",
      content: [{ type: "input_text", text: "我来测试一下，这条消息是否能显示在AIDR上" }]
    }
  ]
};

const body = "POST to http://127.0.0.1:15721/v1/responses: " + JSON.stringify(payload);
const extracted = sensor._extractUserMessage(body);

assert.strictEqual(extracted, "我来测试一下，这条消息是否能显示在AIDR上");
assert.strictEqual(sensor._cleanPrompt(extracted), "我来测试一下，这条消息是否能显示在AIDR上");

const mixed = '<environment_context>ignored</environment_context>\n## My request for Codex:\n真实用户消息';
assert.strictEqual(sensor._cleanPrompt(mixed), "真实用户消息");

const rolloutRecord = {
  type: "response_item",
  payload: {
    type: "message",
    role: "user",
    content: [{ type: "input_text", text: "**我再测试一下**\n" }]
  }
};
assert.strictEqual(sensor._extractRolloutPrompt(rolloutRecord), null);
assert.strictEqual(sensor._extractRolloutPrompt({
  type: "event_msg",
  payload: { type: "user_message", message: "**我再测试一下**\n" }
}), "**我再测试一下**\n");

let capturedEvent = null;
const liveSensor = new CodexSessionSensor(
  { workspaceRoot: "C:\\workspace" },
  (category, severity, verdict, summary, detail) => { capturedEvent = { category, severity, verdict, summary, detail }; },
  { publish() {} }
);
liveSensor._processRolloutLine(
  "rollout-2026-07-29T10-00-00-019e6ef9-4c1f-76a2-abf8-401ecd5595bf.jsonl",
  JSON.stringify({ type: "event_msg", timestamp: "2026-07-29T10:01:00.000Z", payload: { type: "user_message", message: "检查当前策略" } })
);
assert.strictEqual(capturedEvent.detail.sessionId, "019e6ef9-4c1f-76a2-abf8-401ecd5595bf");
assert.strictEqual(capturedEvent.detail.agentId, "openai-codex");
assert.strictEqual(capturedEvent.detail.source, "codex_rollout");

console.log("codexSessionSensor.test.js passed");
