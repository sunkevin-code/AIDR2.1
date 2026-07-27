const { IdentityGraph } = require("../src/engine/identityGraph");

// ─── Node & Edge Creation ───

function test_addNode_creates_valid_node() {
  const graph = new IdentityGraph();
  const node = graph.addNode("agent-1", "agent", "codex-vm-01", 0.8, { risk: 12 });
  if (node.id !== "agent-1") throw new Error("Expected agent-1, got " + node.id);
  if (node.type !== "agent") throw new Error("Expected agent type");
  if (node.trust !== 0.8) throw new Error("Expected trust=0.8");
  if (graph.nodes.length !== 1) throw new Error("Expected 1 node");
  console.log("PASS addNode_creates_valid_node");
}

function test_addNode_deduplicates_by_id() {
  const graph = new IdentityGraph();
  graph.addNode("agent-1", "agent", "first");
  graph.addNode("agent-1", "agent", "second");
  if (graph.nodes.length !== 1) throw new Error("Expected dedup: " + graph.nodes.length);
  console.log("PASS addNode_deduplicates_by_id");
}

function test_addNode_preserves_zero_trust() {
  const graph = new IdentityGraph();
  const node = graph.addNode("agent-zero", "agent", "untrusted", 0);
  if (node.trust !== 0) throw new Error("Expected trust=0, got " + node.trust);
  console.log("PASS addNode_preserves_zero_trust");
}

function test_addNode_rejects_unknown_type() {
  const graph = new IdentityGraph();
  try {
    graph.addNode("x", "bogus", "bad");
    throw new Error("Should have thrown");
  } catch (err) {
    if (!err.message.includes("Unknown node type")) throw err;
  }
  console.log("PASS addNode_rejects_unknown_type");
}

function test_addEdge_creates_valid_edge() {
  const graph = new IdentityGraph();
  graph.addNode("user-1", "user", "alice");
  graph.addNode("identity-1", "identity", "alice@corp");
  const edge = graph.addEdge("user-1", "identity-1", "owns", 1.0);
  if (edge.source !== "user-1") throw new Error("Bad source");
  if (edge.relation !== "owns") throw new Error("Bad relation");
  if (graph.edges.length !== 1) throw new Error("Expected 1 edge");
  console.log("PASS addEdge_creates_valid_edge");
}

function test_addEdge_skips_missing_nodes() {
  const graph = new IdentityGraph();
  graph.addNode("a", "agent", "a");
  const edge = graph.addEdge("a", "missing", "invokes");
  if (edge !== null) throw new Error("Should return null for missing target");
  console.log("PASS addEdge_skips_missing_nodes");
}

function test_addEdge_preserves_zero_weight() {
  const graph = new IdentityGraph();
  graph.addNode("user-zero", "user", "zero");
  graph.addNode("agent-zero", "agent", "zero");
  const edge = graph.addEdge("user-zero", "agent-zero", "owns", 0);
  if (edge.weight !== 0) throw new Error("Expected weight=0, got " + edge.weight);
  console.log("PASS addEdge_preserves_zero_weight");
}

// ─── Identity Resolution ───

function test_resolveIdentity_full_chain() {
  const graph = new IdentityGraph();
  graph.addNode("user-alice", "user", "Alice", 1.0);
  graph.addNode("identity-alice", "identity", "alice@corp", 0.95);
  graph.addNode("agent-codex", "agent", "codex-vm", 0.9);
  graph.addEdge("user-alice", "identity-alice", "owns", 1.0);
  graph.addEdge("identity-alice", "agent-codex", "accesses", 0.9);

  const result = graph.resolveIdentity("agent-codex");
  if (!result.resolved) throw new Error("Should be resolved");
  if (result.user.id !== "user-alice") throw new Error("Expected user-alice, got " + result.user?.id);
  if (result.trust < 0.8) throw new Error("Trust too low: " + result.trust);
  console.log("PASS resolveIdentity_full_chain");
}

function test_resolveIdentity_unresolved() {
  const graph = new IdentityGraph();
  const result = graph.resolveIdentity("missing-agent");
  if (result.resolved) throw new Error("Should not resolve");
  console.log("PASS resolveIdentity_unresolved");
}

// ─── Identity Paths ───

function test_getIdentityPaths_single_path() {
  const graph = new IdentityGraph();
  graph.addNode("user-1", "user", "bob");
  graph.addNode("identity-1", "identity", "bob@corp");
  graph.addNode("agent-1", "agent", "codex");
  graph.addNode("resource-1", "resource", "workspace");
  graph.addEdge("user-1", "identity-1", "owns", 0.95);
  graph.addEdge("identity-1", "agent-1", "accesses", 0.90);
  graph.addEdge("agent-1", "resource-1", "targets", 0.85);

  const paths = graph.getIdentityPaths("user-1", "resource-1");
  if (paths.length !== 1) throw new Error("Expected 1 path, got " + paths.length);
  if (paths[0].length !== 3) throw new Error("Expected 3 hops");
  console.log("PASS getIdentityPaths_single_path");
}

// ─── Impersonation Detection ───

function test_detectImpersonation_match() {
  const graph = new IdentityGraph();
  graph.addNode("user-charlie", "user", "charlie", 1.0);
  graph.addNode("agent-c", "agent", "codex", 0.8);
  graph.addEdge("user-charlie", "agent-c", "owns", 0.95);

  const result = graph.detectImpersonation("agent-c", "user-charlie");
  if (!result.match) throw new Error("Should match");
  if (result.severity !== "none") throw new Error("No severity expected");
  console.log("PASS detectImpersonation_match");
}

function test_detectImpersonation_mismatch() {
  const graph = new IdentityGraph();
  graph.addNode("user-alice", "user", "alice", 1.0);
  graph.addNode("agent-a", "agent", "codex", 0.8);
  graph.addEdge("user-alice", "agent-a", "owns", 0.95);

  const result = graph.detectImpersonation("agent-a", "eve");
  if (result.match) throw new Error("Should NOT match");
  if (!result.severity || result.severity === "none") throw new Error("Expected severity > none");
  console.log("PASS detectImpersonation_mismatch");
}

// ─── Serialization ───

function test_export_import_roundtrip() {
  const g1 = new IdentityGraph();
  g1.addNode("user-1", "user", "Alice");
  g1.addNode("agent-1", "agent", "Codex");
  g1.addEdge("user-1", "agent-1", "owns");
  const exported = g1.export();

  const g2 = new IdentityGraph();
  const ok = g2.import(exported);
  if (!ok) throw new Error("Import failed");
  if (g2.nodes.length !== 2) throw new Error("Expected 2 nodes, got " + g2.nodes.length);
  if (g2.edges.length !== 1) throw new Error("Expected 1 edge, got " + g2.edges.length);
  console.log("PASS export_import_roundtrip");
}

// ─── Stats ───

function test_getStats_aggregates_correctly() {
  const graph = new IdentityGraph();
  graph.addNode("u1", "user", "alice");
  graph.addNode("a1", "agent", "codex");
  graph.addNode("a2", "agent", "opencode");
  graph.addEdge("u1", "a1", "owns");
  graph.addEdge("u1", "a2", "owns");

  const stats = graph.getStats();
  if (stats.nodes !== 3) throw new Error("Expected 3 nodes, got " + stats.nodes);
  if (stats.edges !== 2) throw new Error("Expected 2 edges, got " + stats.edges);
  if (stats.nodeTypeCounts.user !== 1) throw new Error("Expected 1 user node");
  if (stats.nodeTypeCounts.agent !== 2) throw new Error("Expected 2 agent nodes");
  console.log("PASS getStats_aggregates_correctly");
}

// ─── Run All ───

const tests = [
  test_addNode_creates_valid_node,
  test_addNode_deduplicates_by_id,
  test_addNode_preserves_zero_trust,
  test_addNode_rejects_unknown_type,
  test_addEdge_creates_valid_edge,
  test_addEdge_skips_missing_nodes,
  test_addEdge_preserves_zero_weight,
  test_resolveIdentity_full_chain,
  test_resolveIdentity_unresolved,
  test_getIdentityPaths_single_path,
  test_detectImpersonation_match,
  test_detectImpersonation_mismatch,
  test_export_import_roundtrip,
  test_getStats_aggregates_correctly,
];

let passed = 0;
let failed = 0;

for (const test of tests) {
  try {
    test();
    passed++;
  } catch (err) {
    failed++;
    console.error("FAIL", test.name || "(anon)", "-", err.message);
  }
}

console.log(`\n${passed}/${tests.length} passed${failed ? `, ${failed} failed` : ""}`);
process.exit(failed > 0 ? 1 : 0);
