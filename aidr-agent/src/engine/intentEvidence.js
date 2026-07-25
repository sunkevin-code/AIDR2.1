"use strict";

const crypto = require("crypto");

const INTENT_EVIDENCE_VERSION = "aidr-intent-evidence-v1";
const CAPABILITY_KEYS = ["fileRead", "fileWrite", "shell", "network", "mcpRead", "mcpWrite"];

function hashText(value) {
  return crypto.createHash("sha256").update(String(value || ""), "utf8").digest("hex");
}

function unique(values) {
  return Array.from(new Set((Array.isArray(values) ? values : []).filter(value => value !== null && value !== undefined && value !== "")));
}

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function maxFindingConfidence(findings) {
  return (Array.isArray(findings) ? findings : []).reduce((max, finding) => Math.max(max, finiteNumber(finding?.confidence, 0)), 0);
}

function summarizeFinding(finding = {}) {
  return {
    category: finding.category || "unknown",
    severity: finding.severity || finding.risk || "info",
    confidence: finiteNumber(finding.confidence, 0),
    rule: finding.rule || finding.detector || null,
    message: finding.message || finding.explanation || null
  };
}

function buildIntentEvidence({ prompt = "", input = {}, localIntent = {}, semantic = null, finalIntent = null } = {}) {
  const intent = finalIntent || localIntent || {};
  const policy = intent.policy || {};
  const semanticUsed = Boolean(semantic && ["semantic_model", "local_model", "hybrid_model"].includes(String(semantic.source)));
  const localFindings = Array.isArray(localIntent?.threatFindings) ? localIntent.threatFindings : [];
  const semanticFindings = Array.isArray(semantic?.findings) ? semantic.findings : [];
  const categories = unique([...(localIntent?.risks || []), ...(semantic?.categories || [])]);
  const requestedCapabilities = {};
  const grantedCapabilities = {};
  for (const key of CAPABILITY_KEYS) {
    requestedCapabilities[key] = Boolean(localIntent?.capabilities?.[key] || semantic?.capabilities?.[key]);
    grantedCapabilities[key] = Boolean(intent?.capabilities?.[key]);
  }
  const semanticCandidate = policy.semanticCandidate || {};
  const readPaths = unique(policy.allowedReadPaths || semanticCandidate.allowedPaths);
  const writePaths = unique(policy.allowedWritePaths);
  const domains = unique(policy.allowedDomains || semanticCandidate.allowedDomains);
  const mcpTools = unique(policy.allowedMcpTools || semanticCandidate.allowedMcpTools);
  const promptSha256 = prompt ? hashText(prompt) : (localIntent?.intentEvidence?.promptSha256 || null);
  const localConfidence = Math.max(maxFindingConfidence(localFindings), categories.length ? 0.68 : 0.58);
  const semanticConfidence = semanticUsed ? finiteNumber(semantic.confidence, 0) : 0;
  const source = semanticUsed ? (localIntent && Object.keys(localIntent).length ? "hybrid" : "semantic_model") : "local_rules";
  const evidence = [...localFindings, ...semanticFindings].slice(0, 32).map(summarizeFinding);
  const fingerprintInput = {
    goal: intent.summary || null,
    requestedCapabilities,
    grantedCapabilities,
    resources: { readPaths, writePaths, domains, mcpTools },
    risks: categories,
    riskLevel: intent.riskLevel || null,
    policyVersion: policy.version || policy.policyVersion || null
  };
  return {
    schemaVersion: INTENT_EVIDENCE_VERSION,
    source,
    analyzers: ["local_rules", ...(semanticUsed ? [semantic.source || "semantic_model"] : [])],
    promptSha256,
    intentFingerprint: hashText(JSON.stringify(fingerprintInput)),
    goal: intent.summary || null,
    requestedCapabilities,
    grantedCapabilities,
    resources: {
      workspaceRoot: policy.workspaceRoot || input.cwd || null,
      readPaths,
      writePaths,
      allowedDomains: domains,
      allowedMcpTools: mcpTools
    },
    risk: {
      level: intent.riskLevel || "unknown",
      score: intent.riskScore ?? null,
      categories,
      localConfidence,
      semanticConfidence
    },
    evidence,
    analysisChain: ["prompt_normalization", "local_rules", ...(semanticUsed ? ["semantic_model"] : []), "policy_resolution", "least_privilege", "final_enforcement"],
    policyBoundary: {
      mode: policy.mode || "monitor",
      resolutionVersion: policy.resolution?.version || null,
      requireApproval: policy.requireApproval || {}
    },
    generatedAt: new Date().toISOString()
  };
}

module.exports = { INTENT_EVIDENCE_VERSION, buildIntentEvidence, hashText };
