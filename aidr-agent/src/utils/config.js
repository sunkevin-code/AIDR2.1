const fs = require("fs");

function readPolicy(policyPath) {
  if (!policyPath || !fs.existsSync(policyPath)) return null;
  const raw = fs.readFileSync(policyPath, "utf8").replace(/^\uFEFF/, "");
  return JSON.parse(raw);
}

function mergePolicy(base, override) {
  if (!override || typeof override !== "object" || Array.isArray(override)) return override === undefined ? base : override;
  const result = { ...(base || {}) };
  for (const [key, value] of Object.entries(override)) {
    result[key] = value && typeof value === "object" && !Array.isArray(value)
      ? mergePolicy(result[key], value)
      : value;
  }
  return result;
}

function loadPolicy(policyPath, baselinePath) {
  try {
    const baseline = readPolicy(baselinePath) || getDefaultPolicy();
    const stored = readPolicy(policyPath);
    const merged = mergePolicy(baseline, stored || {});
    merged.version = baseline.version || getDefaultPolicy().version;
    return merged;
  } catch (e) {
    console.error("Failed to load policy:", e.message);
    return getDefaultPolicy();
  }
}

function savePolicy(policyPath, policy) {
  try {
    fs.writeFileSync(policyPath, JSON.stringify(policy, null, 2), "utf8");
  } catch (e) { console.error("Failed to save policy:", e.message); }
}

function getDefaultPolicy() {
  return {
    agentId: "", agentType: "codex", version: "2.2.4", mode: "enforce",
    workspaceRoot: process.cwd(), serverUrl: "", port: 8787,
    sensors: {
      process: { enabled: true }, file: { enabled: true },
      network: { enabled: true }, mcp_gateway: { enabled: true },
      registry: { enabled: true }, shell: { enabled: true }
    },
    sessionPolicy: {
      ttlMinutes: 120, defaultDenyUnrequestedTools: true, allowedWritePaths: [],
      deniedPaths: ["**\\.ssh\\**", "**\\.aws\\**", "**\\.env", "**\\id_rsa", "**\\*.pem"],
      deniedCommandPatterns: ["EncodedCommand", "mimikatz", "Invoke-WebRequest", "iwr ", "curl ", "wget "],
      allowedDomains: ["localhost", "127.0.0.1"],
      blockedProcessAction: "kill",
      protectedPaths: [],
      blockedNetworkPorts: [22, 3389, 5900, 5985, 5986],
      blockedNetworkIps: []
    },
    agentPolicies: {
      default: {
        mode: "inherit",
        capabilities: { fileRead: true, fileWrite: true, shell: true, network: true, mcpRead: true, mcpWrite: true },
        allowedReadPaths: [], allowedWritePaths: [], allowedDomains: [], allowedMcpTools: [],
        requireApproval: { externalNetwork: true, sensitiveData: true, destructiveAction: true }
      }
    },
    enforcement: {
      fileAction: "alert",
      quarantineDir: "",
      blockSuspiciousNetwork: true
    },
    privacy: { uploadRawPrompts: false, localPromptRetentionDays: 7 },
    localSemanticModel: { enabled: true, mode: "local_first", confidenceThreshold: 0.72, maxChars: 6000 },
    semanticRuntime: { enabled: true, mode: "local_first", confidenceThreshold: 0.72, remoteFallback: true },
    llmConfig: {
      provider: "deepseek", endpoint: "https://api.deepseek.com",
      model: "deepseek-v4-flash", apiKey: "", apiKeyEnv: "AIDR_DEEPSEEK_API_KEY", enabled: false,
      maxTokens: 512, temperature: 0.1, timeoutMs: 8000, jsonOutput: true, promptMaxChars: 6000, redactPrompts: true, failMode: "rules_only"
    }
  };
}

module.exports = { loadPolicy, savePolicy, mergePolicy };
