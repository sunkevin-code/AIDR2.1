const crypto = require("crypto");

const DECISION_CONTRACT_VERSION = "aidr-decision-contract-v1";

function hashText(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex");
}

function createDecisionContract({ session, input = {}, hookName, localIntent, localDecision, semantic, intent, decision, traceId }) {
  const prompt = input.prompt || input.fullPrompt || "";
  const operation = input.tool_name ? "tool" : hookName === "UserPromptSubmit" ? "prompt" : "session";
  return {
    schemaVersion: DECISION_CONTRACT_VERSION,
    contractVersion: DECISION_CONTRACT_VERSION,
    decisionId: crypto.randomUUID(),
    traceId: traceId || null,
    sessionId: session?.id || input.session_id || input.conversation_id || null,
    agentId: session?.agent || input.agent || input.agent_type || null,
    turnId: input.turn_id || null,
    operation,
    request: {
      promptSha256: prompt ? hashText(prompt) : null,
      toolName: input.tool_name || null,
      cwd: input.cwd || null,
      source: input.source || "hook"
    },
    analyzers: {
      localRules: { used: Boolean(localIntent || localDecision), verdict: localDecision?.verdict || "allow", rule: localDecision?.rule || null },
      semanticModel: semantic ? {
        used: true,
        source: semantic.source || "semantic_model",
        provider: semantic.provider || null,
        model: semantic.model || null,
        verdict: semantic.verdict || null,
        riskLevel: semantic.riskLevel || semantic.risk || null,
        confidence: Number(semantic.confidence || 0)
      } : { used: false, source: "rules_only", provider: null, model: null, verdict: null, riskLevel: null, confidence: 0 },
      behaviorBaseline: Boolean(intent?.behaviorBaseline || intent?.behaviorDrift)
    },
    intent: {
      summary: intent?.summary || null,
      riskLevel: intent?.riskLevel || null,
      riskScore: intent?.riskScore ?? null,
      categories: Array.from(new Set([...(intent?.risks || []), ...(semantic?.categories || [])])),
      capabilities: intent?.capabilities || {},
      evidence: intent?.intentEvidence || null
    },
    leastPrivilegePolicy: {
      version: intent?.policy?.version || intent?.policy?.policyVersion || null,
      mode: intent?.policy?.mode || "monitor",
      workspaceRoot: intent?.policy?.workspaceRoot || input.cwd || null,
      allowedReadPaths: intent?.policy?.allowedReadPaths || [],
      allowedWritePaths: intent?.policy?.allowedWritePaths || [],
      allowedDomains: intent?.policy?.allowedDomains || [],
      allowedMcpTools: intent?.policy?.allowedMcpTools || [],
      capabilities: intent?.policy?.capabilities || intent?.capabilities || {},
      requireApproval: intent?.policy?.requireApproval || {}
    },
    outcome: {
      verdict: decision?.verdict || "allow",
      rule: decision?.rule || "policy.default_allow",
      reason: decision?.reason || "Policy allowed",
      enforcement: decision?.enforcement || null
    },
    evidence: [
      ...(localIntent?.threatFindings || []),
      ...(semantic?.findings || []),
      ...(intent?.threatFindings || [])
    ].slice(0, 50)
  };
}

function validateDecisionContract(contract) {
  const errors = [];
  if (!contract || typeof contract !== "object") return { valid: false, errors: ["contract_object_required"] };
  for (const field of ["schemaVersion", "decisionId", "operation", "leastPrivilegePolicy", "outcome"]) {
    if (!contract[field]) errors.push(`${field}_required`);
  }
  if (contract.schemaVersion !== DECISION_CONTRACT_VERSION && contract.contractVersion !== DECISION_CONTRACT_VERSION) errors.push("contract_version_unsupported");
  if (!contract.outcome?.verdict) errors.push("outcome_verdict_required");
  return { valid: errors.length === 0, errors };
}

module.exports = { DECISION_CONTRACT_VERSION, createDecisionContract, validateDecisionContract, hashText };
