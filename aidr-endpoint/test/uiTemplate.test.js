const assert = require("assert");
const vm = require("vm");
const { renderUi } = require("../endpoint");

const html = renderUi();
const match = html.match(/<script>([\s\S]*?)<\/script>/i);
assert(match, "UI script was not rendered");
new vm.Script(match[1], { filename: "aidr-endpoint-ui.js" });
assert(html.includes("AIDR Endpoint"));
assert(!html.includes('data-view="intent"'));
assert(!html.includes("intent-input"));
assert(html.includes("intent-scan"));
assert(html.includes("intent-pipeline"));
assert(html.includes("source-badge"));
assert(html.includes("decision-trace"));
assert(html.includes("renderSemanticRuntimeStats"));
assert(html.includes("semantic-model"));
assert(html.includes("providerSelect.innerHTML"));
assert(html.includes("semantic-api-key-env"));
assert(html.includes("Codex"));

console.log("endpoint UI template tests passed");

assert(html.includes("semanticDirty"));
assert(html.includes("semanticDraft"));
