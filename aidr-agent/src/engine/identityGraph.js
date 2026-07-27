const crypto = require("crypto");

// ============================================================
// Identity Graph — maps Agent → Identity → User → Resource
// Provides trust-chain resolution and impersonation detection
// ============================================================

const NODE_TYPES = ["user", "identity", "agent", "session", "resource"];
const EDGE_TYPES = ["owns", "accesses", "invokes", "targets"];
const MAX_NODES = 500;
const MAX_EDGES = 2000;

class IdentityGraph {
  constructor(policy = {}) {
    this.policy = policy;
    this.nodes = [];   // { id, type, label, trust (0-1), risk (0-100), metadata }
    this.edges = [];   // { source, target, relation, weight (0-1), timestamp }
    this.stats = { nodes: 0, edges: 0, queries: 0, impersonationChecks: 0, impersonationDetected: 0 };
    this._nodeIndex = new Map();
  }

  // ─── Node management ───

  addNode(id, type, label, trust = 0.5, metadata = {}) {
    if (this._nodeIndex.has(id)) return this._nodeIndex.get(id);
    if (!NODE_TYPES.includes(type)) throw new Error(`Unknown node type: ${type}`);
    if (this.nodes.length >= MAX_NODES) this._pruneNodes(100);

    const node = {
      id: String(id), type, label: String(label),
      trust: Math.max(0, Math.min(1, Number.isFinite(Number(trust)) ? Number(trust) : 0.5)),
      risk: metadata.risk || 0,
      createdAt: metadata.createdAt || new Date().toISOString(),
      owner: metadata.owner || null,
      source: metadata.source || "aidr-runtime"
    };
    this.nodes.push(node);
    this._nodeIndex.set(node.id, node);
    this.stats.nodes++;
    return node;
  }

  addEdge(source, target, relation, weight = 1.0) {
    if (!EDGE_TYPES.includes(relation)) throw new Error(`Unknown edge type: ${relation}`);
    if (!this._nodeIndex.has(source) || !this._nodeIndex.has(target)) {
      return null; // silently skip if nodes don't exist
    }
    if (this.edges.length >= MAX_EDGES) this._pruneEdges(200);

    const edge = {
      source: String(source), target: String(target),
      relation, weight: Math.max(0, Math.min(1, Number.isFinite(Number(weight)) ? Number(weight) : 1)),
      timestamp: new Date().toISOString()
    };
    this.edges.push(edge);
    this.stats.edges++;
    return edge;
  }

  // ─── Identity Resolution ───

  resolveIdentity(agentId) {
    this.stats.queries++;
    const node = this._nodeIndex.get(String(agentId));
    if (!node || node.type !== "agent") return { resolved: false, reason: "agent_not_found" };

    // Walk up: agent → identity → user
    const chain = this._walkUp(agentId, ["agent", "identity", "user"]);
    if (!chain.length) return { resolved: false, reason: "no_identity_chain" };

    const identity = chain.find(n => n.type === "identity");
    const user = chain.find(n => n.type === "user");

    // Compute trust along the actual parent -> child edges. The resolved chain
    // is agent -> identity -> user, while the graph is stored user -> agent.
    let trust = 1.0;
    for (let i = 0; i < chain.length - 1; i++) {
      const child = chain[i];
      const parent = chain[i + 1];
      const edge = this.edges.find(e =>
        (e.source === parent.id && e.target === child.id) ||
        (e.source === child.id && e.target === parent.id)
      );
      if (!edge) {
        trust = 0;
        break;
      }
      trust *= edge.weight;
    }

    return {
      resolved: true,
      agent: node,
      identity: identity || null,
      user: user || null,
      chain: chain.map(n => ({ id: n.id, type: n.type, label: n.label })),
      trust: Math.round(trust * 100) / 100,
      source: node.source
    };
  }

  getIdentityPaths(agentId, resourceId) {
    this.stats.queries++;
    const agent = String(agentId);
    const resource = String(resourceId);

    if (!this._nodeIndex.has(agent)) return [];

    // BFS from agent to resource through all edges
    const visited = new Set();
    const queue = [[agent, [{ id: agent, type: this._nodeIndex.get(agent)?.type || "agent", trust: 1.0 }]]];
    const paths = [];

    while (queue.length && paths.length < 10) {
      const [current, path] = queue.shift();
      if (visited.has(current)) continue;
      visited.add(current);

      if (current === resource) {
        paths.push({
          path: path.map(n => ({ id: n.id, type: n.type })),
          trust: path[path.length - 1].trust,
          length: path.length - 1
        });
        continue;
      }

      const outgoing = this.edges.filter(e => e.source === current);
      for (const edge of outgoing) {
        const targetNode = this._nodeIndex.get(edge.target);
        if (!targetNode || visited.has(edge.target)) continue;

        queue.push([
          edge.target,
          [...path, { id: edge.target, type: targetNode.type, trust: path[path.length - 1].trust * edge.weight }]
        ]);
      }
    }

    return paths.sort((a, b) => b.trust - a.trust);
  }

  detectImpersonation(agentId, claimedUser) {
    this.stats.impersonationChecks++;
    const resolved = this.resolveIdentity(agentId);

    if (!resolved.resolved) {
      this.stats.impersonationDetected++;
      return {
        match: false,
        severity: "high",
        confidence: 0.95,
        reason: `Agent ${agentId} has no identity chain; claiming user ${claimedUser}`,
        actual: null,
        claimed: claimedUser
      };
    }

    const actualUser = resolved.user?.id || resolved.identity?.id || resolved.agent?.id;
    const match = String(actualUser) === String(claimedUser);

    if (!match) this.stats.impersonationDetected++;

    return {
      match,
      severity: match ? "none" : (resolved.trust < 0.3 ? "critical" : "high"),
      confidence: match ? (resolved.trust < 0.5 ? 0.7 : 0.95) : 0.92,
      reason: match
        ? `Identity chain verified (trust=${resolved.trust})`
        : `Agent ${agentId} claims user ${claimedUser} but resolves to ${actualUser}`,
      actual: actualUser,
      claimed: claimedUser,
      trustChain: resolved.trust
    };
  }

  // ─── Graph Analytics ───

  getAgentSummary(agentId) {
    const resolution = this.resolveIdentity(String(agentId));
    const sessions = this.nodes.filter(n => n.type === "session" && n.owner === String(agentId));

    return {
      agent: resolution.agent?.label || agentId,
      identity: resolution.identity?.label || null,
      user: resolution.user?.label || null,
      trust: resolution.trust,
      resolved: resolution.resolved,
      sessionCount: sessions.length,
      activeSessions: sessions.filter(s => s.risk < 50).length,
      risk: Math.round(sessions.reduce((sum, s) => sum + (s.risk || 0), 0) / Math.max(1, sessions.length))
    };
  }

  getStats() {
    return {
      ...this.stats,
      nodeTypeCounts: NODE_TYPES.reduce((acc, type) => {
        acc[type] = this.nodes.filter(n => n.type === type).length;
        return acc;
      }, {}),
      edgeTypeCounts: EDGE_TYPES.reduce((acc, type) => {
        acc[type] = this.edges.filter(e => e.relation === type).length;
        return acc;
      }, {})
    };
  }

  // ─── Serialization ───

  export() {
    return {
      version: "aidr-identity-graph-v1",
      exportedAt: new Date().toISOString(),
      nodes: this.nodes.map(n => ({ ...n })),
      edges: this.edges.map(e => ({ ...e })),
      stats: this.getStats()
    };
  }

  import(data) {
    if (!data || !Array.isArray(data.nodes) || !Array.isArray(data.edges)) return false;
    this.nodes = data.nodes.slice(-MAX_NODES);
    this.edges = data.edges.slice(-MAX_EDGES);
    this._nodeIndex.clear();
    for (const node of this.nodes) this._nodeIndex.set(node.id, node);
    this.stats.nodes = this.nodes.length;
    this.stats.edges = this.edges.length;
    return true;
  }

  // ─── Private Helpers ───

  _walkUp(startId, typePreference) {
    const chain = [];
    let current = String(startId);
    const visited = new Set();

    while (current && !visited.has(current) && chain.length < 10) {
      visited.add(current);
      const node = this._nodeIndex.get(current);
      if (!node) break;
      chain.push(node);

      // Find parent: edge where target = current, source has next preferred type
      const currentIdx = typePreference.indexOf(node.type);
      let next = null;
      for (let i = currentIdx + 1; i < typePreference.length; i++) {
        const edge = this.edges.find(e => e.target === current &&
          this._nodeIndex.get(e.source)?.type === typePreference[i]);
        if (edge) { next = edge.source; break; }
      }
      // Fallback: any edge targeting current
      if (!next) {
        const edge = this.edges.find(e => e.target === current);
        if (edge) next = edge.source;
      }
      current = next;
    }

    return chain;
  }

  _pruneNodes(count) {
    // Remove oldest nodes (by trust, keeping high-trust nodes)
    const toRemove = this.nodes
      .sort((a, b) => a.trust - b.trust)
      .slice(0, count);
    for (const node of toRemove) {
      this._nodeIndex.delete(node.id);
      this.nodes = this.nodes.filter(n => n.id !== node.id);
      this.edges = this.edges.filter(e => e.source !== node.id && e.target !== node.id);
    }
    this.stats.nodes = this.nodes.length;
    this.stats.edges = this.edges.length;
  }

  _pruneEdges(count) {
    this.edges = this.edges.sort((a, b) =>
      new Date(b.timestamp) - new Date(a.timestamp)
    ).slice(0, this.edges.length - count);
    this.stats.edges = this.edges.length;
  }
}

module.exports = { IdentityGraph };
