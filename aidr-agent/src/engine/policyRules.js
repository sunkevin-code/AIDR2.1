"use strict";

const AUTHORIZING_ACTIONS = new Set(["allow"]);
const RESTRICTING_ACTIONS = new Set(["block", "deny", "hold", "require_approval"]);
const atomId = value => String(value || "").trim().toUpperCase();

function normalizeRule(rule = {}, index = 0) {
  return {
    id: String(rule.id || `policy-rule-${index + 1}`).trim(),
    name: String(rule.name || rule.id || `Policy rule ${index + 1}`).trim(),
    description: String(rule.description || "").trim(),
    enabled: rule.enabled !== false,
    priority: Number.isFinite(Number(rule.priority)) ? Number(rule.priority) : (index + 1) * 100,
    action: String(rule.action || "block").trim().toLowerCase(),
    agentScope: Array.isArray(rule.agentScope) ? rule.agentScope.map(String) : [String(rule.agentScope || "*")],
    atomIds: Array.from(new Set((rule.atomIds || rule.atoms || []).map(atomId).filter(Boolean))),
    source: String(rule.source || "administrator")
  };
}

function normalizePolicyRules(rules) {
  return (Array.isArray(rules) ? rules : []).map(normalizeRule).sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id));
}

function compilePolicyRules(policy = {}, rules = policy.policyRules) {
  const normalized = normalizePolicyRules(rules);
  const organization = policy.organizationBoundary || {};
  const previouslyCompiled = new Set((organization.compiledAtoms || []).map(atomId));
  const allowed = new Set((organization.allowedAtoms || []).map(atomId).filter(id => !previouslyCompiled.has(id)));
  const denied = new Set((organization.deniedAtoms || []).map(atomId).filter(id => !previouslyCompiled.has(id)));
  const compiledAtoms = new Set();
  // Lower numeric priority wins, so compile lower-priority rules last.
  for (const rule of normalized.slice().reverse()) {
    if (!rule.enabled) continue;
    for (const id of rule.atomIds) {
      compiledAtoms.add(id);
      if (AUTHORIZING_ACTIONS.has(rule.action)) {
        allowed.add(id);
        denied.delete(id);
      } else if (RESTRICTING_ACTIONS.has(rule.action)) {
        denied.add(id);
        allowed.delete(id);
      }
    }
  }
  return {
    policyRules: normalized,
    organizationBoundary: {
      ...organization,
      allowedAtoms: Array.from(allowed).sort(),
      deniedAtoms: Array.from(denied).sort(),
      compiledAtoms: Array.from(compiledAtoms).sort(),
      source: "policy.policyRules.compiler"
    }
  };
}

function upsertAtomAuthorizationRule(policy = {}, id, enabled) {
  const canonical = atomId(id);
  const rules = normalizePolicyRules(policy.policyRules);
  const ruleId = `atom-authorization:${canonical}`;
  const nextRule = normalizeRule({
    id: ruleId,
    name: `${canonical} authorization`,
    description: enabled ? "Administrator allows this behavior atom." : "Administrator denies this behavior atom.",
    enabled: true,
    priority: 10,
    action: enabled ? "allow" : "block",
    agentScope: ["*"],
    atomIds: [canonical],
    source: "behavior-atom-grid"
  }, rules.length);
  const index = rules.findIndex(rule => rule.id === ruleId);
  if (index >= 0) rules[index] = nextRule;
  else rules.push(nextRule);
  return compilePolicyRules(policy, rules);
}

module.exports = { normalizeRule, normalizePolicyRules, compilePolicyRules, upsertAtomAuthorizationRule };
