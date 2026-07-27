"use strict";

const atomId = value => String(value || "").trim().toUpperCase();
const uniqueAtoms = values => Array.from(new Set((values || []).map(atomId).filter(Boolean)));

function legacyAuthorization(rule = {}) {
  const atoms = uniqueAtoms(rule.atomIds || rule.atoms);
  const action = String(rule.action || "block").trim().toLowerCase();
  if (action === "allow") return { allow: atoms, conditional: [], deny: [] };
  if (action === "hold" || action === "require_approval") return { allow: [], conditional: atoms, deny: [] };
  return { allow: [], conditional: [], deny: atoms };
}

function normalizeAuthorization(rule = {}) {
  const source = rule.authorization && typeof rule.authorization === "object"
    ? rule.authorization
    : legacyAuthorization(rule);
  return {
    allow: uniqueAtoms(source.allow || source.allowedAtoms),
    conditional: uniqueAtoms(source.conditional || source.approval || source.requireApproval),
    deny: uniqueAtoms(source.deny || source.deniedAtoms)
  };
}

function normalizeRule(rule = {}, index = 0) {
  const authorization = normalizeAuthorization(rule);
  const atomIds = uniqueAtoms([
    ...authorization.allow,
    ...authorization.conditional,
    ...authorization.deny
  ]);
  const populated = [
    authorization.allow.length ? "allow" : "",
    authorization.conditional.length ? "require_approval" : "",
    authorization.deny.length ? "block" : ""
  ].filter(Boolean);
  return {
    id: String(rule.id || `policy-rule-${index + 1}`).trim(),
    name: String(rule.name || rule.id || `Policy rule ${index + 1}`).trim(),
    description: String(rule.description || "").trim(),
    enabled: rule.enabled !== false,
    priority: Number.isFinite(Number(rule.priority)) ? Number(rule.priority) : (index + 1) * 100,
    action: populated.length === 1 ? populated[0] : "mixed",
    agentScope: Array.isArray(rule.agentScope) ? rule.agentScope.map(String) : [String(rule.agentScope || "*")],
    authorization,
    atomIds,
    source: String(rule.source || "administrator")
  };
}

function normalizePolicyRules(rules) {
  return (Array.isArray(rules) ? rules : []).map(normalizeRule).sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id));
}

function baselineMetadata(policy = {}) {
  const configured = policy.policyBaseline || {};
  return {
    id: String(configured.id || "default-baseline"),
    name: String(configured.name || "AIDR Organization Baseline"),
    version: String(configured.version || policy.version || "1.0.0"),
    revision: Number(configured.revision ?? policy.policyMeta?.revision ?? 0),
    status: String(configured.status || "active"),
    scope: String(configured.scope || "all-agents")
  };
}

function compilePolicyRules(policy = {}, rules = policy.policyRules, catalogIds = []) {
  let normalized = normalizePolicyRules(rules);
  const organization = policy.organizationBoundary || {};
  const previouslyCompiled = new Set((organization.compiledAtoms || []).map(atomId));
  const imported = {
    allow: uniqueAtoms(organization.allowedAtoms).filter(id => !previouslyCompiled.has(id)),
    conditional: uniqueAtoms(organization.conditionalAtoms).filter(id => !previouslyCompiled.has(id)),
    deny: uniqueAtoms(organization.deniedAtoms).filter(id => !previouslyCompiled.has(id))
  };
  if (!normalized.some(rule => rule.id === "baseline-boundary-import") && (imported.allow.length || imported.conditional.length || imported.deny.length)) {
    normalized.push(normalizeRule({
      id: "baseline-boundary-import",
      name: "Baseline imported authorization",
      description: "Migrated organization authorization from the legacy boundary into the rule hierarchy.",
      enabled: true,
      priority: 900,
      authorization: imported,
      agentScope: ["*"],
      source: "baseline-migration"
    }, normalized.length));
  }
  const covered = new Set(normalized.flatMap(rule => rule.atomIds));
  const defaultDenied = uniqueAtoms(catalogIds).filter(id => !covered.has(id));
  if (defaultDenied.length) {
    const existing = normalized.find(rule => rule.id === "baseline-default-deny");
    const merged = uniqueAtoms([...(existing?.authorization?.deny || []), ...defaultDenied]);
    normalized = normalized.filter(rule => rule.id !== "baseline-default-deny");
    normalized.push(normalizeRule({
      id: "baseline-default-deny",
      name: "Baseline default deny",
      description: "Zero-trust fallback for behavior atoms not granted by another rule.",
      enabled: true,
      priority: 1000,
      authorization: { allow: [], conditional: [], deny: merged },
      agentScope: ["*"],
      source: "baseline"
    }, normalized.length));
  }
  normalized.sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id));
  const allowed = new Set((organization.allowedAtoms || []).map(atomId).filter(id => !previouslyCompiled.has(id)));
  const conditional = new Set((organization.conditionalAtoms || []).map(atomId).filter(id => !previouslyCompiled.has(id)));
  const denied = new Set((organization.deniedAtoms || []).map(atomId).filter(id => !previouslyCompiled.has(id)));
  const decisions = new Map();

  // Rules are sorted by priority; the first enabled decision for an atom wins.
  for (const rule of normalized) {
    if (!rule.enabled) continue;
    for (const state of ["allow", "conditional", "deny"]) {
      for (const id of rule.authorization[state]) {
        if (!decisions.has(id)) decisions.set(id, { state, ruleId: rule.id });
      }
    }
  }

  for (const [id, decision] of decisions) {
    allowed.delete(id);
    conditional.delete(id);
    denied.delete(id);
    if (decision.state === "allow") allowed.add(id);
    else if (decision.state === "conditional") conditional.add(id);
    else denied.add(id);
  }

  const domainStats = {};
  for (const [id, decision] of decisions) {
    const domain = id.split(".")[0] || "OTHER";
    domainStats[domain] ||= { domain, allow: 0, conditional: 0, deny: 0, total: 0 };
    domainStats[domain][decision.state] += 1;
    domainStats[domain].total += 1;
  }
  const ruleContributions = normalized.map(rule => ({
    ruleId: rule.id,
    name: rule.name,
    priority: rule.priority,
    enabled: rule.enabled,
    allow: rule.authorization.allow.length,
    conditional: rule.authorization.conditional.length,
    deny: rule.authorization.deny.length,
    atoms: rule.authorization
  }));
  const compiledAtoms = Array.from(decisions.keys()).sort();
  const baseline = baselineMetadata(policy);
  const effectivePolicy = {
    baseline,
    authorization: {
      allowedAtoms: Array.from(allowed).sort(),
      conditionalAtoms: Array.from(conditional).sort(),
      deniedAtoms: Array.from(denied).sort()
    },
    domainStats: Object.values(domainStats).sort((a, b) => a.domain.localeCompare(b.domain)),
    ruleContributions,
    source: "policy.policyRules.compiler"
  };
  return {
    policyBaseline: baseline,
    policyRules: normalized,
    effectivePolicy,
    organizationBoundary: {
      ...organization,
      allowedAtoms: effectivePolicy.authorization.allowedAtoms,
      conditionalAtoms: effectivePolicy.authorization.conditionalAtoms,
      deniedAtoms: effectivePolicy.authorization.deniedAtoms,
      compiledAtoms,
      source: effectivePolicy.source
    }
  };
}

function upsertAtomAuthorizationRule(policy = {}, id, enabled, catalogIds = []) {
  const canonical = atomId(id);
  const rules = normalizePolicyRules(policy.policyRules);
  const ruleId = `atom-authorization:${canonical}`;
  const nextRule = normalizeRule({
    id: ruleId,
    name: `${canonical} authorization`,
    description: enabled ? "Administrator allows this behavior atom." : "Administrator denies this behavior atom.",
    enabled: true,
    priority: 10,
    authorization: {
      allow: enabled ? [canonical] : [],
      conditional: [],
      deny: enabled ? [] : [canonical]
    },
    agentScope: ["*"],
    source: "behavior-atom-grid"
  }, rules.length);
  const index = rules.findIndex(rule => rule.id === ruleId);
  if (index >= 0) rules[index] = nextRule;
  else rules.push(nextRule);
  return compilePolicyRules(policy, rules, catalogIds);
}

module.exports = {
  normalizeAuthorization,
  normalizeRule,
  normalizePolicyRules,
  compilePolicyRules,
  upsertAtomAuthorizationRule
};
