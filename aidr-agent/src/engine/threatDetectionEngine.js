const URL_PATTERN = /\b(?:https?|ftp|file|javascript):\/\/[^\s<>"']+/gi;
const SECRET_PATTERNS = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/i,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\b(?:sk|rk)-[A-Za-z0-9]{20,}\b/,
  /\b(?:api[_-]?key|secret|token|password|passwd|private[_-]?key)\s*[:=]\s*["']?[A-Za-z0-9_./+=-]{12,}/i,
  /\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/
];

const DIRECT_INJECTION = [
  /ignore\s+(?:all\s+|any\s+|the\s+|your\s+)?(?:previous|prior|above|system|developer)\s+instructions?/i,
  /reveal\s+(?:the\s+)?(?:system|developer)\s+prompt/i,
  /you\s+are\s+now\s+(?:an?\s+)?(?:unrestricted|unfiltered|jailbroken)/i,
  /override\s+(?:the\s+)?(?:safety|security|policy|permission)/i,
  /(?:忽略|无视|绕过).{0,12}(?:之前|上面|系统|开发者).{0,20}(?:指令|规则|策略)/iu
];

const INSTRUCTION_LIKE = /(?:ignore|override|disregard|follow these instructions|system message|developer message|do not tell the user|execute this command|send the following|忽略|覆盖|系统消息|开发者消息|执行以下指令)/iu;
const EXFIL_VERBS = /(?:upload|exfiltrat|send\s+to|post\s+to|share|publish|leak|steal|transfer|curl\s+.*-d|invoke-webrequest|立刻上传|外传|发送到|泄露|窃取)/iu;
const RAG_TERMS = /(?:retriev(?:ed|al)|vector\s*(?:store|db)|embedding|knowledge\s*base|document|pdf|chunk|context|检索|向量|知识库|文档|上下文)/iu;

class ThreatDetectionEngine {
  constructor(policy = {}) {
    this.policy = policy;
    this.stats = { inspected: 0, findings: 0, blocked: 0, byCategory: {} };
  }

  updatePolicy(policy) { this.policy = policy || {}; }

  inspect(value, context = {}) {
    const text = String(value == null ? "" : value).slice(0, 120000);
    const findings = [];
    this.stats.inspected++;
    const add = (category, severity, confidence, message, evidence = "") => {
      const finding = { category, severity, confidence, message, evidence: this._evidence(evidence || text) };
      if (!findings.some(item => item.category === category && item.message === message)) findings.push(finding);
    };

    if (DIRECT_INJECTION.some(pattern => pattern.test(text))) {
      add("prompt_injection", "high", 0.95, "Instruction attempts to override the Agent policy or system context", text.match(DIRECT_INJECTION.find(pattern => pattern.test(text)))?.[0]);
    }
    const indirect = (context.source === "tool_response" || context.source === "document" || context.source === "retrieval" || RAG_TERMS.test(text)) && INSTRUCTION_LIKE.test(text);
    if (indirect) add("indirect_prompt_injection", "high", 0.9, "Untrusted retrieved or tool content contains executable instructions", text);
    if (RAG_TERMS.test(text) && (/(?:poison|backdoor|hidden instruction|inject|corrupt|malicious|污染|投毒|隐藏指令|后门)/iu.test(text) || indirect)) {
      add("rag_poisoning", "high", 0.86, "Retrieved context or knowledge content appears to contain poisoning instructions", text);
    }

    const secretMatch = SECRET_PATTERNS.find(pattern => pattern.test(text));
    if (secretMatch) {
      const exfil = EXFIL_VERBS.test(text) || URL_PATTERN.test(text);
      add(exfil ? "sensitive_data_exfiltration" : "secret_exposure", exfil ? "critical" : "high", exfil ? 0.96 : 0.9,
        exfil ? "Sensitive material is being moved toward an external destination" : "Credential or secret material detected", text.match(secretMatch)?.[0]);
    }
    if (EXFIL_VERBS.test(text) && URL_PATTERN.test(text)) {
      add("sensitive_data_exfiltration", "high", 0.88, "External transfer behavior detected in Agent input or tool arguments", text);
    }

    for (const rawUrl of text.match(URL_PATTERN) || []) {
      const urlFinding = this._inspectUrl(rawUrl);
      if (urlFinding) add("malicious_url", urlFinding.severity, urlFinding.confidence, urlFinding.message, rawUrl);
    }

    for (const finding of findings) {
      this.stats.findings++;
      this.stats.byCategory[finding.category] = (this.stats.byCategory[finding.category] || 0) + 1;
    }
    const highest = findings.reduce((max, item) => Math.max(max, severityRank(item.severity)), 0);
    const blockingCategories = new Set(["prompt_injection", "indirect_prompt_injection", "rag_poisoning", "sensitive_data_exfiltration", "secret_exposure"]);
    const blocking = findings.some(item => blockingCategories.has(item.category) && item.confidence >= 0.8) || highest >= 4;
    if (blocking) this.stats.blocked++;
    return {
      detected: findings.length > 0,
      findings,
      categories: [...new Set(findings.map(item => item.category))],
      highestSeverity: severityName(highest),
      verdict: blocking ? "block" : findings.length ? "alert" : "allow",
      summary: findings.length ? findings.map(item => item.message).join("; ") : "No high-confidence AI threat detected"
    };
  }

  redact(value) {
    let text = String(value == null ? "" : value);
    for (const pattern of SECRET_PATTERNS) text = text.replace(pattern, "[AIDR-REDACTED-SECRET]");
    return text;
  }

  getStats() { return { ...this.stats, byCategory: { ...this.stats.byCategory } }; }

  _inspectUrl(rawUrl) {
    try {
      const parsed = new URL(rawUrl);
      const host = parsed.hostname.toLowerCase();
      if (parsed.protocol === "javascript:" || parsed.protocol === "file:" || parsed.username || parsed.password) {
        return { severity: "high", confidence: 0.94, message: "URL uses a dangerous scheme or embedded credentials" };
      }
      if (host.startsWith("xn--") || /^(?:\d{1,3}\.){3}\d{1,3}$/.test(host) && !this._isPrivateIp(host)) {
        return { severity: "high", confidence: 0.86, message: "URL targets a raw or internationalized host that requires review" };
      }
      if (/(?:webhook\.site|requestbin|transfer\.sh|file\.io|0x0\.st|paste\.|ngrok\.)/i.test(host)) {
        return { severity: "high", confidence: 0.9, message: "URL matches a commonly abused transfer or tunneling service" };
      }
    } catch (_) {}
    return null;
  }

  _isPrivateIp(host) {
    const parts = host.split(".").map(Number);
    return parts[0] === 10 || parts[0] === 127 || parts[0] === 192 && parts[1] === 168 || parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31;
  }

  _evidence(value) {
    return this.redact(String(value || "").replace(/\s+/g, " ").slice(0, 240));
  }
}

function severityRank(value) { return { info: 1, low: 1, medium: 2, high: 3, critical: 4 }[value] || 0; }
function severityName(value) { return ["none", "low", "medium", "high", "critical"][value] || "none"; }

module.exports = { ThreatDetectionEngine, severityRank };
