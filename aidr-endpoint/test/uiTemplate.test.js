const assert = require("assert");
const vm = require("vm");
const { renderUi } = require("../endpoint");

const html = renderUi();
const match = html.match(/<script>([\s\S]*?)<\/script>/i);
assert(match, "UI script was not rendered");
new vm.Script(match[1], { filename: "aidr-endpoint-ui.js" });
assert(html.includes("AIDR Endpoint"));
assert(html.includes('id="page-overview"'));
assert(html.includes('id="page-sessions"'));
assert(html.includes('id="page-agents"'));
assert(html.includes('id="page-policy"'));
assert(html.includes('id="page-behavior"'));
assert(html.includes('id="page-semantic"'));
assert(html.includes('id="page-system"'));
assert(html.includes('id="aidr-runtime-adapter"'));
assert(html.includes("abg-behavior-orbit"));
assert(html.includes("abg-session-orbit"));
assert(html.includes("/api/behavior-atoms"));
assert(html.includes("Policy Orbit"));
assert(html.includes("Codex"));

console.log("endpoint UI template tests passed");
