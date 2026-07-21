class HybridSemanticClassifier {
  constructor(localClassifier, remoteClassifier, config = {}) {
    this.local = localClassifier;
    this.remote = remoteClassifier;
    this.config = normalizeConfig(config);
    this.stats = { analyzed: 0, localUsed: 0, remoteUsed: 0, hybridUsed: 0, fallback: 0, lastSource: null };
  }

  configure(config = {}) {
    this.config = normalizeConfig({ ...this.config, ...config });
    this.local?.configure?.(this.config);
    return this.config;
  }

  isAvailable() {
    return Boolean((this.config.enabled !== false) && (this.local?.isAvailable?.() || this.remote?.isAvailable?.()));
  }

  getStats() {
    return {
      ...this.stats,
      enabled: this.isAvailable(),
      mode: this.config.mode,
      local: this.local?.getStats?.() || { enabled: false },
      remote: this.remote?.getStats?.() || { enabled: false }
    };
  }

  getPublicConfig() {
    return {
      ...this.config,
      local: this.local?.getPublicConfig?.() || {},
      remote: this.remote?.getPublicConfig?.() || {}
    };
  }

  async analyzePrompt(prompt, context = {}) {
    return this._analyze("analyzePrompt", prompt, context);
  }

  async analyzeIntent(event) {
    return this._analyze("analyzeIntent", event, undefined);
  }

  async _analyze(method, input, context) {
    this.stats.analyzed++;
    const localAvailable = this.config.enabled !== false && this.local?.isAvailable?.();
    const remoteAvailable = this.remote?.isAvailable?.();
    if (this.config.mode === "remote_first" && remoteAvailable) {
      const remote = await this.remote[method](input, context);
      this.stats.remoteUsed++;
      this.stats.lastSource = remote?.source || "semantic_model";
      return remote;
    }
    if (localAvailable) {
      const local = await this.local[method](input, context);
      this.stats.localUsed++;
      if (!remoteAvailable || this.config.mode === "local_only" || Number(local?.confidence || 0) >= this.config.confidenceThreshold || this.config.remoteFallback === false) {
        this.stats.lastSource = "local_model";
        return local;
      }
      try {
        const remote = await this.remote[method](input, context);
        this.stats.remoteUsed++;
        this.stats.hybridUsed++;
        this.stats.lastSource = "hybrid_model";
        return combine(local, remote);
      } catch (_) {
        this.stats.fallback++;
        this.stats.lastSource = "local_model";
        return local;
      }
    }
    if (remoteAvailable) {
      const remote = await this.remote[method](input, context);
      this.stats.remoteUsed++;
      this.stats.lastSource = remote?.source || "semantic_model";
      return remote;
    }
    return { source: "rules_only", verdict: "allow", severity: "info", riskLevel: "unknown", confidence: 0, categories: [] };
  }
}

function normalizeConfig(config) {
  return {
    enabled: config.enabled !== false,
    mode: ["local_only", "local_first", "remote_first"].includes(config.mode) ? config.mode : "local_first",
    confidenceThreshold: Math.max(0.5, Math.min(0.99, Number(config.confidenceThreshold) || 0.72)),
    remoteFallback: config.remoteFallback !== false
  };
}

function combine(local, remote) {
  const categories = Array.from(new Set([...(local.categories || []), ...(remote.categories || [])]));
  const riskRank = { low: 1, medium: 2, high: 3, critical: 4 };
  const localRisk = String(local.riskLevel || local.risk || "low");
  const remoteRisk = String(remote.riskLevel || remote.risk || "low");
  const riskLevel = (riskRank[remoteRisk] || 0) >= (riskRank[localRisk] || 0) ? remoteRisk : localRisk;
  return {
    ...remote,
    source: "hybrid_model",
    provider: remote.provider || "remote",
    model: remote.model || "remote-semantic-model",
    riskLevel,
    risk: riskLevel,
    riskScore: Math.max(Number(local.riskScore || 0), Number(remote.riskScore || 0)),
    confidence: Math.max(Number(local.confidence || 0), Number(remote.confidence || 0)),
    categories,
    capabilities: { ...(local.capabilities || {}), ...(remote.capabilities || {}) },
    allowedPaths: Array.from(new Set([...(local.allowedPaths || []), ...(remote.allowedPaths || [])])),
    allowedDomains: Array.from(new Set([...(local.allowedDomains || []), ...(remote.allowedDomains || [])])),
    allowedMcpTools: Array.from(new Set([...(local.allowedMcpTools || []), ...(remote.allowedMcpTools || [])])),
    localAnalysis: local,
    remoteAnalysis: remote,
    explanation: `Hybrid semantic analysis: local=${local.model || "local"}; remote=${remote.model || "remote"}`
  };
}

module.exports = { HybridSemanticClassifier };
