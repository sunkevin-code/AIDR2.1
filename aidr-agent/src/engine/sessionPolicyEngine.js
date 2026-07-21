const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { sanitizePrompt } = require("../utils/promptSanitizer");
const { BehaviorDriftEngine } = require("./behaviorDriftEngine");
const { ThreatDetectionEngine } = require("./threatDetectionEngine");
const { buildBehaviorTraceGraph } = require("./behaviorTraceGraph");
const { buildSessionContextGraph } = require("./sessionContextGraph");
const { readJsonWithBackup, writeJsonAtomic } = require("../utils/atomicJson");

const WRITE_INTENT = /(修改|编辑|创建|生成|实现|修复|优化|重构|构建|打包|安装|部署|删除|写入|update|edit|modify|change|create|generate|implement|fix|optimi[sz]e|refactor|build|package|install|deploy|delete|write)/i;
const SHELL_INTENT = /(运行|启动|测试|构建|编译|安装|执行|命令|run|start|test|build|compile|install|execute|command|shell|powershell|npm|git|dotnet|cargo)/i;
const NETWORK_INTENT = /(联网|下载|搜索|浏览|请求接口|调用接口|最新|download|fetch|browse|search|request|api|latest|http:\/\/|https:\/\/)/i;
const SENSITIVE_INTENT = /(凭据|密码|密钥|令牌|私钥|credentials?|password|secret|token|private key|\.ssh|\.aws|\.env|id_rsa)/i;
const EXFIL_INTENT = /(上传|外传|发送到|窃取|泄露|upload|exfiltrat|send to|steal|leak)/i;
const DESTRUCTIVE_INTENT = /(清空磁盘|格式化|删除系统|禁用安全|关闭防火墙|format disk|delete system|disable security|turn off firewall)/i;
const NEGATED_CLAUSE = /(?:do not|don't|must not|should not|never|without)\b[^.;\n]{0,100}|(?:不要|无需|不需要|禁止|不可|不得|避免)[^。；;\n]{0,60}/gi;
const PROMPT_INJECTION = /(?:ignore\s+(?:all\s+|any\s+|the\s+|your\s+)?(?:previous|prior|system)(?:\s+system)?\s+instructions|忽略(以上|之前|系统)指令|system prompt|developer message)[\s\S]{0,180}(secret|token|password|\.env|credential|密钥|凭据)/i;
const SECRET_OUTPUT = /(-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----|AKIA[0-9A-Z]{16}|(?:api[_-]?key|secret|token|password)\s*[:=]\s*["']?[A-Za-z0-9_\-\/+=]{18,})/i;

class SessionPolicyEngine {
  constructor(policy, addEvent, statePath, semanticClassifier = null) {
    this.policy = policy;
    this.addEvent = addEvent;
    this.statePath = statePath;
    this.semanticClassifier = semanticClassifier;
    this.sessions = new Map();
    this.migrationVersion = 0;
    this.stats = { sessions: 0, analyzed: 0, allowed: 0, alerted: 0, blocked: 0, approvalCreated: 0, approvalResolved: 0, approvalExpired: 0 };
    this.behaviorDriftEngine = new BehaviorDriftEngine(policy.behaviorDrift || {});
    this.threatDetector = new ThreatDetectionEngine(policy.threatDetection || {});
    this.approvals = new Map();
    this.approvalStatePath = statePath ? require("path").join(require("path").dirname(statePath), "approvals.json") : null;
    this.persistence = {
      statePath: statePath || null,
      approvalStatePath: this.approvalStatePath,
      stateSource: "none",
      approvalStateSource: "none",
      recoveredState: false,
      recoveredApprovals: false,
      lastSaveAt: null,
      lastApprovalSaveAt: null,
      lastSaveError: null,
      lastApprovalSaveError: null,
      saveFailures: 0,
      approvalSaveFailures: 0
    };
    this.traceSequence = 0;
    this._load();
    this._loadApprovals();
  }

  updatePolicy(policy) {
    this.policy = policy;
    this.threatDetector.updatePolicy(policy.threatDetection || {});
  }

  _loadApprovals() {
    try {
      if (!this.approvalStatePath) return;
      const loaded = readJsonWithBackup(this.approvalStatePath, null);
      if (!loaded.value) return;
      this.persistence.approvalStateSource = loaded.source;
      this.persistence.recoveredApprovals = loaded.recovered;
      const state = loaded.value;
      const approvals = Array.isArray(state) ? state : state.approvals;
      for (const item of approvals || []) {
        if (!item || !item.id || !item.sessionId || !item.actionKey) continue;
        this.approvals.set(String(item.id), {
          id: String(item.id), sessionId: String(item.sessionId), agent: String(item.agent || "unknown"),
          toolName: String(item.toolName || "unknown"), reason: String(item.reason || "Approval required"),
          actionKey: String(item.actionKey), status: String(item.status || "pending"),
          decision: item.decision || null, createdAt: item.createdAt || new Date().toISOString(),
          expiresAt: item.expiresAt || new Date().toISOString(), resolvedAt: item.resolvedAt || null
        });
      }
      this.stats = { ...this.stats, ...(state.stats || {}) };
      this._expireApprovals();
    } catch (error) {
      this.persistence.lastApprovalSaveError = error.message;
    }
  }

  _saveApprovals() {
    try {
      if (!this.approvalStatePath) return;
      const approvals = [...this.approvals.values()]
        .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
        .slice(0, 500);
      writeJsonAtomic(this.approvalStatePath, { version: 1, approvals, stats: {
        approvalCreated: this.stats.approvalCreated || 0, approvalResolved: this.stats.approvalResolved || 0, approvalExpired: this.stats.approvalExpired || 0
      } });
      this.persistence.approvalStateSource = "primary";
      this.persistence.lastApprovalSaveAt = new Date().toISOString();
      this.persistence.lastApprovalSaveError = null;
    } catch (error) {
      this.persistence.approvalSaveFailures++;
      this.persistence.lastApprovalSaveError = error.message;
    }
  }

  _expireApprovals() {
    const now = Date.now();
    let changed = false;
    for (const item of this.approvals.values()) {
      if (item.status === "pending" && new Date(item.expiresAt).getTime() <= now) {
        item.status = "expired";
        item.decision = "expired";
        item.resolvedAt = new Date().toISOString();
        this.stats.approvalExpired = (this.stats.approvalExpired || 0) + 1;
        changed = true;
      }
    }
    if (changed) this._saveApprovals();
    return changed;
  }

  _getWorkspacePolicy(cwd) {
    const policies = this.policy.workspacePolicies || {};
    const resolved = path.resolve(cwd || this.policy.workspaceRoot || process.cwd());
    let winner = null;
    for (const [root, value] of Object.entries(policies)) {
      if (root === "default" || !value || typeof value !== "object") continue;
      const normalized = path.resolve(root);
      if (resolved === normalized || resolved.startsWith(normalized + path.sep)) {
        if (!winner || normalized.length > winner.root.length) winner = { root: normalized, policy: value };
      }
    }
    if (winner) return { policy: winner.policy, source: "workspacePolicies:" + winner.root, matched: true };
    return { policy: policies.default && typeof policies.default === "object" ? policies.default : {}, source: policies.default ? "workspacePolicies:default" : "none", matched: Boolean(policies.default) };
  }

  _policyResolution(agentId, cwd, workspacePolicy, agentPolicy) {
    const knownAgent = Object.prototype.hasOwnProperty.call(this.policy.agentPolicies || {}, agentId);
    return {
      version: "aidr-policy-resolution-v1",
      precedence: ["explicit_deny", "approval_required", "agent_boundary", "workspace_boundary", "global_boundary"],
      denyOverridesAllow: true,
      approvalOverridesAllow: true,
      layers: [
        { name: "global", source: "sessionPolicy", priority: 1, matched: true },
        { name: "workspace", source: workspacePolicy.source, priority: 2, matched: workspacePolicy.matched },
        { name: "agent", source: "agentPolicies." + (knownAgent ? agentId : "default"), priority: 3, matched: true }
      ],
      scope: { agent: agentId, workspaceRoot: path.resolve(cwd || this.policy.workspaceRoot || process.cwd()) }
    };
  }

  _getAgentPolicy(agent) {
    const policies = this.policy.agentPolicies || {};
    const id = String(agent || this.policy.agentType || "codex");
    return policies[id] || policies.default || {};
  }

  analyzePrompt(prompt, context = {}) {
    const text = String(prompt || "").trim();
    const positiveText = text.replace(NEGATED_CLAUSE, " ");
    const cwd = path.resolve(context.cwd || this.policy.workspaceRoot || process.cwd());
    const write = WRITE_INTENT.test(positiveText);
    const shell = SHELL_INTENT.test(positiveText);
    const network = NETWORK_INTENT.test(positiveText);
    const sensitive = SENSITIVE_INTENT.test(positiveText);
    const exfiltration = EXFIL_INTENT.test(positiveText);
    const destructive = DESTRUCTIVE_INTENT.test(positiveText);
    const threatAnalysis = this.threatDetector.inspect(positiveText, { source: "prompt", agent: context.agent || context.agent_type });
    const explicitDomains = this._extractDomains(positiveText);
    const explicitMcpTools = Array.from(new Set(positiveText.match(/mcp__[A-Za-z0-9_-]+__[A-Za-z0-9_-]+/g) || []));

    let score = 5;
    const risks = [];
    if (write) score += 10;
    if (shell) score += 15;
    if (network) score += 15;
    if (sensitive) { score += 25; risks.push("sensitive_data"); }
    if (exfiltration) { score += 30; risks.push("data_exfiltration"); }
    if (destructive) { score += 45; risks.push("destructive_action"); }
    if (PROMPT_INJECTION.test(positiveText)) { score += 50; risks.push("prompt_injection"); }
    for (const category of threatAnalysis.categories) { if (!risks.includes(category)) risks.push(category); }
    score = Math.min(100, score + threatAnalysis.findings.reduce((total, finding) => total + (finding.severity === "critical" ? 35 : finding.severity === "high" ? 25 : 10), 0));
    score = Math.min(100, score);

    const agentId = String(context.agent || context.agent_type || context.agentType || this.policy.agentType || "codex");
    const agentPolicy = this._getAgentPolicy(agentId);
    const workspaceResolution = this._getWorkspacePolicy(cwd);
    const workspacePolicy = workspaceResolution.policy || {};
    const globalPolicy = this.policy.sessionPolicy || {};
    const boundaryLayers = [globalPolicy, workspacePolicy, agentPolicy];
    const base = {
      ...globalPolicy,
      ttlMinutes: workspacePolicy.ttlMinutes || globalPolicy.ttlMinutes || 120,
      mode: [globalPolicy, workspacePolicy, agentPolicy].find(layer => layer.mode === "disabled") ? "disabled" : (agentPolicy.mode === "monitor" || workspacePolicy.mode === "monitor" ? "monitor" : this.policy.mode),
      deniedPaths: Array.from(new Set(boundaryLayers.flatMap(layer => Array.isArray(layer.deniedPaths) ? layer.deniedPaths : []))),
      deniedCommandPatterns: Array.from(new Set(boundaryLayers.flatMap(layer => Array.isArray(layer.deniedCommandPatterns) ? layer.deniedCommandPatterns : [])))
    };
    const policyResolution = this._policyResolution(agentId, cwd, workspaceResolution, agentPolicy);
    const baselineDomains = Array.from(new Set(base.allowedDomains || []));
    const configuredAgentDomains = Array.from(new Set(agentPolicy.allowedDomains || []));
    let effectiveBaselineDomains = baselineDomains;
    const workspaceDomains = Array.from(new Set(workspacePolicy.allowedDomains || []));
    if (workspaceDomains.length) effectiveBaselineDomains = effectiveBaselineDomains.filter(domain => workspaceDomains.some(pattern => pattern === "*" || domain === pattern || domain.endsWith("." + pattern)));
    const effectiveAgentDomains = configuredAgentDomains.filter(domain =>
      effectiveBaselineDomains.some(pattern => pattern === "*" || domain === pattern || domain.endsWith("." + pattern)));
    const requestedExternalDomains = explicitDomains.filter(domain => !effectiveBaselineDomains.some(pattern => pattern === "*" || domain === pattern || domain.endsWith("." + pattern)));
    const ttlMinutes = Math.max(5, Math.min(1440, Number(base.ttlMinutes || 120)));
    const capabilities = {
      fileRead: boundaryLayers.some(layer => layer.capabilities?.fileRead === false) ? false : true,
      fileWrite: boundaryLayers.some(layer => layer.capabilities?.fileWrite === false) ? false : write,
      shell: boundaryLayers.some(layer => layer.capabilities?.shell === false) ? false : shell,
      network: boundaryLayers.some(layer => layer.capabilities?.network === false) ? false : network,
      mcpRead: boundaryLayers.some(layer => layer.capabilities?.mcpRead === false) ? false : true,
      mcpWrite: boundaryLayers.some(layer => layer.capabilities?.mcpWrite === false) ? false : write
    };
    if (agentPolicy.mode === "disabled") {
      for (const key of Object.keys(capabilities)) capabilities[key] = false;
    }
    const workspaceMcpTools = Array.from(new Set(workspacePolicy.allowedMcpTools || []));
    const configuredAgentMcpTools = Array.from(new Set(agentPolicy.allowedMcpTools || []));
    const agentAllowedMcpTools = workspaceMcpTools.length && configuredAgentMcpTools.length
      ? configuredAgentMcpTools.filter(tool => workspaceMcpTools.includes(tool))
      : (workspaceMcpTools.length ? workspaceMcpTools : configuredAgentMcpTools);
    const allowedMcpTools = agentAllowedMcpTools.length
      ? explicitMcpTools.filter(tool => agentAllowedMcpTools.includes(tool))
      : explicitMcpTools;
    const workspaceWritePaths = Array.isArray(workspacePolicy.allowedWritePaths) ? workspacePolicy.allowedWritePaths.filter(Boolean) : [];
    const workspaceReadPaths = Array.isArray(workspacePolicy.allowedReadPaths) ? workspacePolicy.allowedReadPaths.filter(Boolean) : [];
    const agentWritePaths = Array.isArray(agentPolicy.allowedWritePaths) ? agentPolicy.allowedWritePaths.filter(Boolean) : [];
    const agentReadPaths = Array.isArray(agentPolicy.allowedReadPaths) ? agentPolicy.allowedReadPaths.filter(Boolean) : [];
    const effectiveWritePaths = workspaceWritePaths.length ? (agentWritePaths.length ? agentWritePaths.filter(value => workspaceWritePaths.includes(value)) : workspaceWritePaths) : agentWritePaths;
    const effectiveReadPaths = workspaceReadPaths.length ? (agentReadPaths.length ? agentReadPaths.filter(value => workspaceReadPaths.includes(value)) : workspaceReadPaths) : agentReadPaths;
    const agentDeniedPaths = Array.isArray(agentPolicy.deniedPaths) ? agentPolicy.deniedPaths.filter(Boolean) : [];
    const agentDeniedCommands = Array.isArray(agentPolicy.deniedCommandPatterns) ? agentPolicy.deniedCommandPatterns.filter(Boolean) : [];
    const requireApproval = {
      externalNetwork: network && (explicitDomains.length === 0 || requestedExternalDomains.length > 0),
      sensitiveData: sensitive,
      destructiveAction: destructive
    };
    for (const layer of boundaryLayers) {
      for (const [key, value] of Object.entries(layer.requireApproval || {})) {
        if (value === true) requireApproval[key] = true;
      }
    }

    return {
      analyzer: "aidr-local-intent-v1",
      summary: this._summarize(text),
      riskScore: score,
      riskLevel: score >= 80 ? "critical" : score >= 55 ? "high" : score >= 30 ? "medium" : "low",
      risks: Array.from(new Set(risks)),
      threatFindings: threatAnalysis.findings,
      capabilities,
      policy: {
        mode: base.mode || this.policy.mode || "monitor",
        generatedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + ttlMinutes * 60000).toISOString(),
        ttlMinutes,
        agent: agentId,
        agentPolicyMode: agentPolicy.mode || "inherit",
        workspaceRoot: cwd,
        allowedReadPaths: effectiveReadPaths.length ? effectiveReadPaths : [path.join(cwd, "**")],
        allowedWritePaths: write ? (effectiveWritePaths.length ? effectiveWritePaths : [path.join(cwd, "**")]) : [],
        deniedPaths: Array.from(new Set([...(base.deniedPaths || []), ...agentDeniedPaths])),
        deniedCommandPatterns: Array.from(new Set([...(base.deniedCommandPatterns || []), ...agentDeniedCommands])),
        allowedDomains: effectiveAgentDomains.length ? effectiveAgentDomains : effectiveBaselineDomains,
        agentAllowedDomains: effectiveAgentDomains,
        requestedDomains: explicitDomains,
        allowedMcpTools,
        agentAllowedMcpTools,
        capabilities,
        resolution: policyResolution,
        agentPolicy: {
          mode: agentPolicy.mode || "inherit",
          capabilities: agentPolicy.capabilities || {},
          requireApproval: agentPolicy.requireApproval || {},
          allowedReadPaths: effectiveReadPaths,
          allowedWritePaths: effectiveWritePaths,
          allowedDomains: effectiveAgentDomains,
          allowedMcpTools: agentAllowedMcpTools
        },
        workspacePolicy: { source: workspaceResolution.source, matched: workspaceResolution.matched, allowedReadPaths: workspaceReadPaths, allowedWritePaths: workspaceWritePaths, allowedDomains: workspaceDomains, allowedMcpTools: workspaceMcpTools },
        requireApproval
      }
    };
  }

  observePrompt(data, options = {}) {
    const input = {
      hook_event_name: "UserPromptSubmit",
      session_id: data.conversationId || data.sessionId,
      turn_id: data.submissionId,
      cwd: data.cwd || this.policy.workspaceRoot,
      model: data.model || "unknown",
      agent: data.agent || data.agentType || "codex",
      prompt: data.prompt || data.fullPrompt || "",
      fullPrompt: data.fullPrompt || data.prompt || "",
      source: "compat_sensor"
    };
    return this.handleHook(input, { compatibility: true, semantic: options.semantic === true });
  }

  handleHook(input, options = {}) {
    if (options.semantic === false || !this.semanticClassifier?.isAvailable?.()) return this._handleHookSync(input, options);
    return this._handleHookAsync(input, options);
  }

  _isSemanticResult(value) {
    return Boolean(value && ["semantic_model", "local_model", "hybrid_model"].includes(String(value.source)));
  }

  async _handleHookAsync(input, options = {}) {
    const hookName = String(input.hook_event_name || input.event || "Unknown");
    if (hookName === "UserPromptSubmit") {
      const prompt = sanitizePrompt(input.prompt || input.fullPrompt || "");
      if (!prompt) return this._handleHookSync(input, options);
      const semantic = await this.semanticClassifier.analyzePrompt(prompt, { cwd: input.cwd, model: input.model, turnId: input.turn_id });
      return this._handleHookSync(input, { ...options, semanticResult: semantic });
    }
    if (hookName === "PreToolUse" || hookName === "PermissionRequest") {
      const semantic = await this.semanticClassifier.analyzeIntent(this._semanticToolEvent(input));
      return this._handleHookSync(input, { ...options, semanticResult: semantic });
    }
    return this._handleHookSync(input, options);
  }
  _handleHookSync(input, options = {}) {
    const hookName = String(input.hook_event_name || input.event || "Unknown");
    const sessionId = String(input.session_id || input.conversation_id || "session-" + Date.now());
    const session = this._ensureSession(sessionId, input);
    let output = {};
    let decision = { verdict: "allow", reason: "Policy allowed" };

    if (hookName === "UserPromptSubmit") {
      const prompt = sanitizePrompt(input.prompt || input.fullPrompt || "");
      const rawPrompt = sanitizePrompt(input.full_prompt || input.fullPrompt || prompt) || prompt;
      if (!prompt) {
        if (!session.prompt && session.actions.length === 0) this.sessions.delete(sessionId);
        this._save();
        return { output, decision, session: this._publicSession(session) };
      }
      const localIntent = this.analyzePrompt(prompt, input);
      const semantic = this._isSemanticResult(options.semanticResult) ? options.semanticResult : null;
      const intent = this._mergeSemanticIntent(localIntent, semantic);
      const semanticDecision = this._semanticPromptDecision(semantic);
      const localDecision = this._localPromptDecision(localIntent);
      if (semanticDecision?.verdict === "block") decision = semanticDecision;
      else if (localDecision?.verdict === "block") decision = localDecision;
      else if (semanticDecision) decision = semanticDecision;
      else if (localDecision) decision = localDecision;
      session.decisionTrace = this._buildDecisionTrace({ session, input, hookName, localIntent, localDecision, semantic, intent, decision });
      session.prompt = prompt;
      session.rawPrompt = rawPrompt;
      session.promptPreview = this._summarize(prompt, 220);
      if (!Array.isArray(session.promptHistory)) session.promptHistory = [];
      session.promptHistory.push({
        id: crypto.randomUUID(),
        timestamp: new Date().toISOString(),
        turnId: input.turn_id || null,
        prompt,
        rawPrompt
      });
      if (session.promptHistory.length > 100) session.promptHistory.shift();
      session.intent = intent;
      session.semanticAnalysis = semantic;
      session.effectivePolicy = intent.policy;
      const promptDrift = this.behaviorDriftEngine.observePrompt(session, intent, input);
      session.turnId = input.turn_id || session.turnId;
      session.status = "active";
      this.stats.analyzed++;
      this._record(session, hookName, "intent", decision.verdict, `Intent: ${intent.summary}`, {
        riskLevel: intent.riskLevel,
        riskScore: intent.riskScore,
        capabilities: intent.capabilities,
        semanticAnalysis: semantic || null,
        behaviorDrift: promptDrift,
        decisionTrace: session.decisionTrace
      });
      if (promptDrift.shouldAlert) {
        this._emit("behavior_drift", promptDrift.level === "critical" ? "high" : "medium", "alert",
          `Prompt behavior drift: ${promptDrift.summary}`, {
            sessionId, turnId: input.turn_id || null, drift: promptDrift
          }, sessionId);
      }
      if (decision.verdict === "block") {
        output = this._decisionOutput(hookName, decision);
      } else if (!options.compatibility) {
        output = {
          hookSpecificOutput: {
            hookEventName: "UserPromptSubmit",
            additionalContext: `AIDR session policy active. Risk=${intent.riskLevel}; fileWrite=${intent.capabilities.fileWrite}; shell=${intent.capabilities.shell}; network=${intent.capabilities.network}.`
          }
        };
      }
      this._emit("intent", decision.verdict === "block" ? "high" : (intent.riskLevel === "critical" ? "high" : "info"), decision.verdict,
        `Codex intent analyzed: ${intent.summary}`, {
          sessionId, turnId: input.turn_id || null, riskLevel: intent.riskLevel,
          riskScore: intent.riskScore, capabilities: intent.capabilities, semanticAnalysis: semantic || null
        }, sessionId);
    } else if (hookName === "PreToolUse" || hookName === "PermissionRequest") {
      decision = this._evaluateTool(session, input, options.semanticResult);
      output = this._decisionOutput(hookName, decision);
      const actionDetail = this._safeToolDetail(input);
      if (decision.drift) actionDetail.behaviorDrift = decision.drift;
      if (decision.semantic) actionDetail.semanticAnalysis = decision.semantic;
      session.decisionTrace = this._buildDecisionTrace({ session, input, hookName, localIntent: null, localDecision: null, semantic: options.semanticResult, intent: { policy: session.effectivePolicy || {}, capabilities: session.effectivePolicy?.capabilities || {}, riskLevel: session.intent?.riskLevel || "unknown", riskScore: session.intent?.riskScore || null }, decision });
      actionDetail.decisionTrace = session.decisionTrace;
      this._record(session, hookName, input.tool_name || "unknown", decision.verdict,
        `${input.tool_name || "tool"}: ${decision.reason}`, actionDetail);
      this._emit("policy_decision", decision.verdict === "block" ? "high" : "info", decision.verdict,
        `${hookName} ${decision.verdict}: ${input.tool_name || "unknown"}`, {
          sessionId, turnId: input.turn_id || null, toolName: input.tool_name || "unknown",
          reason: decision.reason, rule: decision.rule || null, inputPreview: this._toolPreview(input),
          behaviorDrift: decision.drift || null, semanticAnalysis: decision.semantic || null
        }, sessionId);
      if (decision.drift?.shouldAlert) {
        this._emit("behavior_drift", decision.drift.level === "critical" ? "high" : "medium",
          decision.drift.shouldBlock ? "block" : "alert",
          `Behavior drift ${decision.drift.level}: ${decision.drift.summary}`, {
            sessionId, turnId: input.turn_id || null, toolName: input.tool_name || "unknown",
            drift: decision.drift
          }, sessionId);
      }
    } else if (hookName === "PostToolUse") {
      decision = this._evaluateToolResponse(input);
      output = decision.verdict === "block" ? {
        decision: "block",
        reason: decision.reason,
        hookSpecificOutput: {
          hookEventName: "PostToolUse",
          additionalContext: decision.reason
        }
      } : {};
      this._record(session, hookName, input.tool_name || "unknown", decision.verdict,
        `${input.tool_name || "tool"} response: ${decision.reason}`, this._safeToolDetail(input));
      this._emit("tool_response", decision.verdict === "block" ? "high" : "info", decision.verdict,
        `PostToolUse ${decision.verdict}: ${input.tool_name || "unknown"}`, {
          sessionId, turnId: input.turn_id || null, toolName: input.tool_name || "unknown",
          reason: decision.reason, responseSize: this._jsonSize(input.tool_response)
        }, sessionId);
    } else if (hookName === "Stop") {
      session.status = "completed";
      session.endedAt = new Date().toISOString();
      this._record(session, hookName, "session", "allow", "Codex turn completed", {});
    } else if (hookName === "SessionStart") {
      session.status = "active";
      this._record(session, hookName, "session", "allow", `Codex session ${input.source || "started"}`, {});
    }

    if (decision.verdict === "block") this.stats.blocked++;
    else if (decision.verdict === "alert") this.stats.alerted++;
    else this.stats.allowed++;
    this._save();
    return { output, decision, session: this._publicSession(session) };
  }

  _evaluateTool(session, input, semanticResult = null) {
    const toolName = String(input.tool_name || "unknown");
    const toolInput = input.tool_input || {};
    const effective = session.effectivePolicy || this.analyzePrompt("", input).policy;
    const mode = effective.mode || this.policy.mode || "monitor";
    let block = null;
    const semanticDecision = this._semanticToolDecision(semanticResult, input);
    const threatAnalysis = this.threatDetector.inspect(JSON.stringify(toolInput), { source: "tool_input", agent: session.agent, tool: toolName });
    const threatDecision = this._threatDecision(threatAnalysis);
    let threatAlert = threatDecision?.verdict === "alert" ? threatDecision : null;
    if (threatDecision?.verdict === "block") block = threatDecision;
    const toolLower = toolName.toLowerCase();
    const readOnlyTool = /^(read|cat|view|list|glob|search|grep|find|inspect)/i.test(toolLower) || /file.*read|read.*file/i.test(toolLower);
    const networkTool = /(browser|web|http|fetch|request|search|browse|url)/i.test(toolLower);
    if (readOnlyTool) {
      if (!effective.capabilities.fileRead) block = { reason: "File reads were not granted for this Agent", rule: "agent.file_read_not_granted" };
      const target = toolInput.file_path || toolInput.path || toolInput.file || "";
      if (!block && target && !this._isAllowedPolicyPath(target, effective.allowedReadPaths, input.cwd)) {
        block = { reason: "File read is outside the Agent allowlist", rule: "agent.read_path_not_granted" };
      }
    } else if (networkTool) {
      if (!effective.capabilities.network) block = { reason: "Network access was not required or granted for this Agent task", rule: "session.network_not_granted" };
      const domains = this._extractDomains(JSON.stringify(toolInput));
      const allowedDomains = effective.agentAllowedDomains || [];
      if (!block && allowedDomains.length && domains.some(domain => !allowedDomains.some(pattern => pattern === "*" || domain === pattern || domain.endsWith("." + pattern)))) {
        block = { reason: "Network target is outside the Agent domain allowlist", rule: "agent.domain_not_granted" };
      }
    } else if (toolName === "Bash" || toolName.toLowerCase().includes("shell") || toolName.toLowerCase().includes("command")) {
      const command = String(toolInput.command || toolInput.cmd || "");
      block = this._checkCommand(command, effective);
      if (!block && !effective.capabilities.shell) block = { reason: "Shell execution was not required by the current task intent", rule: "session.shell_not_granted" };
    } else if (toolName === "apply_patch" || toolName === "Edit" || toolName === "Write") {
      const command = String(toolInput.command || "");
      block = this._checkPatch(command, effective, input.cwd);
      if (!block && !effective.capabilities.fileWrite) block = { reason: "File modification was not required by the current task intent", rule: "session.file_write_not_granted" };
    } else if (toolName.startsWith("mcp__")) {
      const readOnly = /(read|get|list|search|find|view|status|inspect|query)/i.test(toolName);
      const explicitlyAllowed = (effective.allowedMcpTools || []).includes(toolName);
      if (Array.isArray(effective.agentAllowedMcpTools) && effective.agentAllowedMcpTools.length && !effective.agentAllowedMcpTools.includes(toolName)) {
        block = { reason: "MCP tool is outside the Agent allowlist", rule: "agent.mcp_tool_not_granted" };
      } else if (readOnly && !effective.capabilities.mcpRead) {
        block = { reason: "Read-only MCP access was not granted for this Agent", rule: "agent.mcp_read_not_granted" };
      } else if (!readOnly && !explicitlyAllowed && !effective.capabilities.mcpWrite) {
        block = { reason: "Write-capable MCP tool was not granted for this session", rule: "session.mcp_write_not_granted" };
      }
      const serialized = JSON.stringify(toolInput);
      const sensitive = this._checkSensitiveText(serialized, effective);
      if (!block && sensitive) block = sensitive;
    }

    const approval = !block ? this._maybeRequireApproval(session, input, effective, threatAnalysis) : null;
    const drift = this.behaviorDriftEngine.observeTool(session, input, effective);
    if (!block && semanticDecision?.verdict === "block") block = { reason: semanticDecision.reason, rule: semanticDecision.rule };
    if (!block && approval) return approval;
    if (!block && threatAlert) return { ...threatAlert, drift, semantic: semanticResult || null, threatFindings: threatAnalysis.findings };
    if (!block && semanticDecision?.verdict === "alert") return { verdict: "alert", reason: semanticDecision.reason, rule: semanticDecision.rule, drift, semantic: semanticResult || null, threatFindings: threatAnalysis.findings };
    if (!block && drift.shouldBlock) block = { reason: `Behavior drift blocked: ${drift.summary}`, rule: "behavior.drift" };
    if (!block) return { verdict: "allow", reason: "Effective session policy allowed this action", rule: "session.allow", drift, semantic: semanticResult || null, threatFindings: threatAnalysis.findings };
    if (mode !== "enforce") return { verdict: "alert", reason: block.reason, rule: block.rule, drift, semantic: semanticResult || null };
    return { verdict: "block", reason: block.reason, rule: block.rule, drift, semantic: semanticResult || null };
  }

  _threatDecision(analysis) {
    if (!analysis?.detected) return null;
    return { verdict: analysis.verdict === "block" ? "block" : "alert", reason: `Threat detection: ${analysis.summary}`, rule: `threat.${analysis.categories[0] || "content"}`, threatFindings: analysis.findings };
  }

  _maybeRequireApproval(session, input, effective, threatAnalysis) {
    const required = effective.requireApproval || {};
    const tool = String(input.tool_name || "unknown");
    const serialized = JSON.stringify(input.tool_input || {});
    const network = /(browser|web|http|fetch|request|search|browse|url)/i.test(tool);
    const external = network && this._extractDomains(serialized).some(domain => !["localhost", "127.0.0.1"].includes(domain));
    const destructive = /(delete|remove|format|diskpart|bcdedit|shutdown|kill|drop|truncate|overwrite)/i.test(serialized) || /(Bash|Edit|Write)/i.test(tool) && /(delete|remove|format|disable|uninstall)/i.test(serialized);
    const sensitive = threatAnalysis?.categories?.some(category => ["secret_exposure", "sensitive_data_exfiltration"].includes(category)) || this._checkSensitiveText(serialized, effective);
    const reason = required.externalNetwork && external ? "External network action requires approval" : required.sensitiveData && sensitive ? "Sensitive data action requires approval" : required.destructiveAction && destructive ? "Destructive action requires approval" : null;
    if (!reason) return null;
    const actionKey = this._approvalActionKey(session.id, tool, input.tool_input || {});
    const existing = [...this.approvals.values()].find(item => item.actionKey === actionKey && item.status === "approved" && new Date(item.expiresAt).getTime() > Date.now());
    if (existing) return null;
    const pending = [...this.approvals.values()].find(item => item.actionKey === actionKey && item.status === "pending");
    const request = pending || { id: crypto.randomUUID(), sessionId: session.id, agent: session.agent, toolName: tool, reason, actionKey, status: "pending", createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 15 * 60000).toISOString() };
    this.approvals.set(request.id, request);
    if (!pending) {
      this.stats.approvalCreated = (this.stats.approvalCreated || 0) + 1;
      this._saveApprovals();
      this._emit("approval", "high", "alert", `Approval required: ${tool}`, { approvalId: request.id, sessionId: session.id, agent: session.agent, reason }, session.id);
    }
    return { verdict: "block", reason: `${reason} (approval ${request.id})`, rule: "approval.required", requiresApproval: true, approvalId: request.id };
  }

  _approvalActionKey(sessionId, toolName, toolInput) {
    return crypto.createHash("sha256").update(`${sessionId}|${toolName}|${this._boundedJson(toolInput, 2000)}`).digest("hex");
  }

  _semanticToolEvent(input) {
    const toolName = String(input.tool_name || "unknown");
    return {
      category: "agent_tool",
      summary: "AI Agent tool invocation: " + toolName,
      detail: { toolName, toolInput: input.tool_input || {}, cwd: input.cwd || this.policy.workspaceRoot },
      sessionId: input.session_id || input.conversation_id || null
    };
  }

  _buildDecisionTrace({ session, input, hookName, localIntent, localDecision, semantic, intent, decision }) {
    const semanticUsed = this._isSemanticResult(semantic);
    const sequence = Number(session?.traceSequence || 0) + 1;
    if (session) session.traceSequence = sequence;
    const parentTraceId = session?.decisionTrace?.traceId || null;
    const path = [];
    path.push({ stage: "local_rules", outcome: localDecision?.verdict || "allow", rule: localDecision?.rule || "rules.no_match", reason: localDecision?.reason || "No local blocking rule matched" });
    path.push({ stage: "semantic_model", outcome: semanticUsed ? (semantic.verdict || semantic.riskLevel || "analyzed") : "not_used", rule: semanticUsed ? (semantic.reason || null) : null, reason: semanticUsed ? "Semantic result included in final policy decision" : "Rules-only fallback or semantic analysis unavailable" });
    path.push({ stage: "least_privilege_policy", outcome: intent?.policy?.mode || "monitor", rule: "session_policy.resolve", reason: "Capabilities constrained by global, workspace, Agent and session boundaries" });
    path.push({ stage: "final_enforcement", outcome: decision?.verdict || "allow", rule: decision?.rule || "policy.default_allow", reason: decision?.reason || "Policy allowed" });
    return {
      schemaVersion: "aidr-decision-trace-v2",
      traceId: crypto.randomUUID(),
      parentTraceId,
      sequence,
      sessionId: session?.id || input?.session_id || input?.conversation_id || null,
      turnId: input?.turn_id || null,
      generatedAt: new Date().toISOString(),
      hookEvent: hookName,
      operation: input?.tool_name ? "tool" : hookName === "UserPromptSubmit" ? "prompt" : "session",
      sources: {
        localRules: Boolean(localIntent || localDecision),
        semanticModel: semanticUsed,
        policyResolution: Boolean(intent?.policy?.resolution),
        behaviorBaseline: Boolean(intent?.behaviorBaseline || intent?.behaviorDrift)
      },
      localRules: { source: "rules_engine", analyzer: localIntent?.analyzer || "aidr-local-rules", verdict: localDecision?.verdict || "allow", rule: localDecision?.rule || null, riskLevel: localIntent?.riskLevel || intent?.riskLevel || "unknown", riskScore: localIntent?.riskScore ?? intent?.riskScore ?? null },
      semanticModel: semanticUsed ? { source: semantic.source || "semantic_model", provider: semantic.provider || null, model: semantic.model || null, verdict: semantic.verdict || null, severity: semantic.severity || null, riskLevel: semantic.riskLevel || null, confidence: semantic.confidence ?? 0 } : { source: "rules_only", status: "not_used_or_unavailable" },
      sessionPolicy: { source: "least_privilege_policy", capabilities: intent?.capabilities || {}, requireApproval: intent?.policy?.requireApproval || {}, resolution: intent?.policy?.resolution || null },
      decisionPath: path,
      final: { verdict: decision?.verdict || "allow", rule: decision?.rule || "policy.default_allow", reason: decision?.reason || "Policy allowed" }
    };
  }

  _localPromptDecision(local) {
    if (!local) return null;
    const risks = new Set((local.risks || []).map(value => String(value).toLowerCase()));
    if (local.riskLevel === "critical" || ["prompt_injection", "indirect_prompt_injection", "rag_poisoning", "secret_exposure", "sensitive_data_exfiltration", "sensitive_data", "data_exfiltration", "destructive_action", "malicious_url"].some(value => risks.has(value))) {
      return { verdict: "block", reason: "Local AIDR rules blocked this high-risk task", rule: "rules.prompt_block" };
    }
    if (local.riskLevel === "high") {
      return { verdict: "alert", reason: "Local AIDR rules flagged this elevated-risk task", rule: "rules.prompt_alert" };
    }
    return null;
  }
  _semanticPromptDecision(semantic) {
    if (!this._isSemanticResult(semantic)) return null;
    const confidence = Number(semantic.confidence || 0);
    const categories = (semantic.categories || []).map(value => String(value).toLowerCase());
    if (semantic.verdict === "block" || (semantic.riskLevel === "critical" && confidence >= 0.65) || categories.some(value => ["destructive_action", "data_exfiltration", "prompt_injection"].includes(value) && confidence >= 0.65)) {
      return { verdict: "block", reason: "Semantic model blocked this task: " + (semantic.reason || semantic.explanation || "high-risk intent"), rule: "semantic.prompt_block", semantic };
    }
    if (semantic.verdict === "alert" || semantic.riskLevel === "high" || semantic.riskLevel === "critical") {
      return { verdict: "alert", reason: "Semantic model flagged this task: " + (semantic.reason || semantic.explanation || "elevated-risk intent"), rule: "semantic.prompt_alert", semantic };
    }
    return null;
  }

  _semanticToolDecision(semantic, input) {
    if (!this._isSemanticResult(semantic)) return null;
    const toolName = String(input.tool_name || "unknown");
    if (semantic.verdict === "block" || semantic.severity === "critical") return { verdict: "block", reason: "Semantic model blocked tool " + toolName + ": " + (semantic.reason || "high-risk action"), rule: "semantic.tool_block" };
    if (semantic.verdict === "alert" || semantic.severity === "high") return { verdict: "alert", reason: "Semantic model alerted on tool " + toolName + ": " + (semantic.reason || "elevated-risk action"), rule: "semantic.tool_alert" };
    return null;
  }

  _mergeSemanticIntent(local, semantic) {
    if (!this._isSemanticResult(semantic)) return local;
    const confidence = Number(semantic.confidence || 0);
    const capabilities = { ...(local.capabilities || {}) };
    const policy = { ...(local.policy || {}), capabilities };
    const proposedExpansion = [];
    const capabilityKeys = ["fileRead", "fileWrite", "shell", "network", "mcpRead", "mcpWrite"];
    if (confidence >= 0.65 && semantic.riskLevel !== "critical") {
      for (const key of capabilityKeys) {
        if (semantic.capabilities?.[key] === true && capabilities[key] !== true) proposedExpansion.push(key);
      }
    }
    const approval = { ...(policy.requireApproval || {}) };
    for (const [key, value] of Object.entries(semantic.requireApproval || {})) {
      if (value === true || approval[key] === undefined) approval[key] = value;
    }
    if (proposedExpansion.length) approval.semanticExpansion = proposedExpansion;
    if (confidence < 0.65) approval.semanticLowConfidence = true;
    policy.requireApproval = approval;
    policy.semanticCandidate = {
      capabilities: semantic.capabilities || {},
      allowedPaths: semantic.allowedPaths || [],
      allowedDomains: semantic.allowedDomains || [],
      allowedMcpTools: semantic.allowedMcpTools || [],
      allowedOperations: semantic.allowedOperations || [],
      deniedOperations: semantic.deniedOperations || []
    };
    const ranks = { low: 1, medium: 2, high: 3, critical: 4 };
    const localRank = ranks[local.riskLevel] || 0;
    const semanticRank = ranks[semantic.riskLevel] || 0;
    const riskLevel = semanticRank > localRank ? semantic.riskLevel : local.riskLevel;
    return { ...local, analyzer: "aidr-local-intent-v1+semantic", riskScore: Math.max(Number(local.riskScore || 0), Number(semantic.riskScore || 0)), riskLevel, risks: Array.from(new Set([...(local.risks || []), ...(semantic.categories || [])])), capabilities, policy, semanticAnalysis: semantic };
  }
  _checkCommand(command, effective) {
    const text = String(command || "");
    for (const pattern of effective.deniedCommandPatterns || []) {
      if (text.toLowerCase().includes(String(pattern).toLowerCase())) {
        return { reason: `Command matched denied pattern: ${pattern}`, rule: "baseline.denied_command" };
      }
    }
    const destructive = /(format\s+[a-z]:|diskpart|vssadmin\s+delete|bcdedit|Remove-Item\s+[^\r\n]*(?:-Recurse|-Force)|rmdir\s+\/s|del\s+\/f\s+\/s|sc(?:\.exe)?\s+delete|reg\s+save\s+HKLM\\(?:SAM|SYSTEM|SECURITY))/i;
    if (destructive.test(text)) return { reason: "Destructive or credential-access command blocked", rule: "baseline.destructive_command" };
    return this._checkSensitiveText(text, effective);
  }

  _checkPatch(patchText, effective, cwd) {
    const files = [];
    const re = /^\*\*\*\s+(?:Update|Add|Delete)\s+File:\s*(.+)$/gmi;
    let match;
    while ((match = re.exec(patchText))) files.push(match[1].trim());
    const root = path.resolve(effective.workspaceRoot || cwd || process.cwd());
    for (const file of files) {
      const full = path.resolve(cwd || root, file);
      if (!this._isWithin(full, root)) return { reason: "File write outside session workspace: " + file, rule: "session.workspace_boundary" };
      if (!this._isAllowedPolicyPath(full, effective.allowedWritePaths, cwd || root)) return { reason: "File write is outside the Agent allowlist: " + file, rule: "agent.write_path_not_granted" };
      const sensitive = this._checkSensitiveText(full, effective);
      if (sensitive) return sensitive;
    }
    return null;
  }

  _checkSensitiveText(text, effective) {
    const normalized = String(text || "").replace(/\//g, "\\").toLowerCase();
    const fragments = ["\\.ssh\\", "\\.aws\\", "\\.azure\\", "\\credentials\\", "\\id_rsa", "\\.env", ".pem", ".pfx"];
    if (fragments.some(part => normalized.includes(part))) {
      return { reason: "Sensitive credential path blocked by baseline policy", rule: "baseline.sensitive_path" };
    }
    for (const denied of effective.deniedPaths || []) {
      const token = String(denied).replace(/\*\*/g, "").replace(/\*/g, "").replace(/\//g, "\\").toLowerCase();
      if (token && normalized.includes(token)) return { reason: `Sensitive path matched policy: ${denied}`, rule: "baseline.denied_path" };
    }
    return null;
  }

  _evaluateToolResponse(input) {
    const response = this._boundedJson(input.tool_response, 40000);
    const analysis = this.threatDetector.inspect(response, { source: "tool_response", tool: input.tool_name });
    if (analysis.verdict === "block") return { verdict: "block", reason: analysis.summary, rule: `response.${analysis.categories[0] || "threat"}`, threatFindings: analysis.findings };
    if (analysis.detected) return { verdict: "alert", reason: analysis.summary, rule: `response.${analysis.categories[0] || "threat"}`, threatFindings: analysis.findings };
    if (SECRET_OUTPUT.test(response)) return { verdict: "block", reason: "Potential credential material removed from tool output", rule: "response.secret" };
    return { verdict: "allow", reason: "No high-confidence response threat detected", rule: "response.allow" };
  }

  _decisionOutput(hookName, decision) {
    if (decision.verdict !== "block") return {};
    if (hookName === "UserPromptSubmit") {
      return {
        decision: "block",
        reason: decision.reason,
        hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: decision.reason }
      };
    }
    if (hookName === "PermissionRequest") {
      return {
        hookSpecificOutput: {
          hookEventName: "PermissionRequest",
          decision: { behavior: "deny", message: decision.reason }
        }
      };
    }
    return {
      systemMessage: `AIDR blocked this action: ${decision.reason}`,
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: decision.reason
      }
    };
  }

  _ensureSession(id, input) {
    let session = this.sessions.get(id);
    if (!session) {
      const now = new Date().toISOString();
      session = {
        id, agent: input.agent || input.agent_type || "codex", model: input.model || "unknown", cwd: input.cwd || "",
        permissionMode: input.permission_mode || "default", status: "active",
        createdAt: now, updatedAt: now, endedAt: null, turnId: input.turn_id || null,
        prompt: "", rawPrompt: "", promptPreview: "", promptHistory: [], intent: null, semanticAnalysis: null, effectivePolicy: null,
        behaviorBaseline: null, behaviorDrift: null, decisionTrace: null, traceSequence: 0, actions: []
      };
      this.sessions.set(id, session);
      this.stats.sessions++;
    }
    session.updatedAt = new Date().toISOString();
    session.agent = input.agent || input.agent_type || session.agent;
    session.model = input.model || session.model;
    session.cwd = input.cwd || session.cwd;
    session.permissionMode = input.permission_mode || session.permissionMode;
    return session;
  }

  _record(session, event, subject, verdict, summary, detail) {
    session.actions.push({
      id: crypto.randomUUID(), timestamp: new Date().toISOString(), event,
      subject, verdict, summary, detail
    });
    if (session.actions.length > 200) session.actions.shift();
    session.updatedAt = new Date().toISOString();
  }

  _emit(category, severity, verdict, summary, detail, sessionId) {
    if (this.addEvent) this.addEvent(category, severity, verdict, summary, detail, { sessionId });
  }

  getApprovals(status = "") {
    this._expireApprovals();
    return [...this.approvals.values()]
      .filter(item => !status || item.status === status)
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  }

  getApprovalsForSession(sessionId) { return this.getApprovals().filter(item => item.sessionId === sessionId); }

  resolveApproval(id, decision = "approved", ttlMinutes = 30) {
    this._expireApprovals();
    const request = this.approvals.get(String(id));
    if (!request) return null;
    if (request.status !== "pending") return { ...request };
    request.status = decision === "approved" ? "approved" : "rejected";
    request.decision = request.status;
    request.resolvedAt = new Date().toISOString();
    request.expiresAt = new Date(Date.now() + Math.max(1, Math.min(1440, Number(ttlMinutes || 30))) * 60000).toISOString();
    this.approvals.set(request.id, request);
    this.stats.approvalResolved = (this.stats.approvalResolved || 0) + 1;
    this._saveApprovals();
    return { ...request };
  }

  getPolicyResolution(agent = this.policy.agentType || "codex", cwd = this.policy.workspaceRoot || process.cwd()) {
    const agentId = String(agent || this.policy.agentType || "codex");
    const workspace = this._getWorkspacePolicy(cwd);
    const agentPolicy = this._getAgentPolicy(agentId);
    return this._policyResolution(agentId, cwd, workspace, agentPolicy);
  }

  inspectThreat(text, context = {}) { return this.threatDetector.inspect(text, context); }

  validatePolicy(candidate = this.policy) {
    const policy = candidate || {};
    const errors = [];
    const warnings = [];
    const addOverlap = (scope, denied, allowed, kind) => {
      for (const deny of denied || []) for (const grant of allowed || []) {
        const a = String(deny).replace(/\*/g, '').toLowerCase();
        const b = String(grant).replace(/\*/g, '').toLowerCase();
        if (a && b && (a.includes(b) || b.includes(a))) errors.push({ code: 'grant_denied_overlap', scope, kind, denied: deny, allowed: grant });
      }
    };
    const session = policy.sessionPolicy || {};
    addOverlap('global', session.deniedPaths, [...(session.allowedReadPaths || []), ...(session.allowedWritePaths || [])], 'path');
    for (const [agentId, agent] of Object.entries(policy.agentPolicies || {})) {
      const capabilities = agent.capabilities || {};
      if (agent.mode === 'disabled' && Object.values(capabilities).some(Boolean)) warnings.push({ code: 'disabled_agent_has_capabilities', scope: agentId });
      if (capabilities.fileRead === false && (agent.allowedReadPaths || []).length) errors.push({ code: 'read_path_without_file_read', scope: agentId });
      if (capabilities.fileWrite === false && (agent.allowedWritePaths || []).length) errors.push({ code: 'write_path_without_file_write', scope: agentId });
      if (capabilities.network === false && (agent.allowedDomains || []).length) errors.push({ code: 'domain_without_network', scope: agentId });
      if (capabilities.mcpRead === false && (agent.allowedMcpTools || []).length) errors.push({ code: 'mcp_without_mcp_read', scope: agentId });
      addOverlap(agentId, session.deniedPaths, [...(agent.allowedReadPaths || []), ...(agent.allowedWritePaths || [])], 'path');
      if (session.allowedDomains?.length && (agent.allowedDomains || []).some(domain => !session.allowedDomains.includes(domain) && domain !== '*')) warnings.push({ code: 'agent_domain_outside_global_allowlist', scope: agentId });
    }
    for (const [workspace, workspacePolicy] of Object.entries(policy.workspacePolicies || {})) {
      addOverlap(workspace, session.deniedPaths, [...(workspacePolicy.allowedReadPaths || []), ...(workspacePolicy.allowedWritePaths || [])], 'path');
    }
    return { valid: errors.length === 0, errors, warnings, checkedAt: new Date().toISOString(), summary: { errors: errors.length, warnings: warnings.length, scopes: Object.keys(policy.agentPolicies || {}).length + Object.keys(policy.workspacePolicies || {}).length + 1 } };
  }
  simulate(actions, policyPatch = {}) {
    const candidate = this._merge(this.policy, policyPatch || {});
    const isolated = new SessionPolicyEngine(candidate, () => {}, null, null);
    return actions.map(action => {
      const input = { ...action, hook_event_name: action.hook_event_name || action.event || (action.prompt ? "UserPromptSubmit" : "PreToolUse"), agent: action.agent || "generic", session_id: action.session_id || "simulation-session", prompt: action.prompt || action.text, tool_name: action.tool_name || action.tool, tool_input: action.tool_input || action.args || {}, tool_response: action.tool_response || action.output };
      return { action, result: isolated.handleHook(input, { semantic: false }) };
    });
  }

  getSessions(includeActions = false) {
    return Array.from(this.sessions.values())
      .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
      .filter(session => sanitizePrompt(session.prompt || session.rawPrompt || ""))
      .map(session => this._publicSession(session, includeActions));
  }

  getSession(id) {
    const session = this.sessions.get(id);
    return session ? this._publicSession(session, true) : null;
  }

  updateSessionPolicy(id, patch) {
    const session = this.sessions.get(id);
    if (!session) return null;
    session.effectivePolicy = this._merge(session.effectivePolicy || {}, patch || {});
    session.updatedAt = new Date().toISOString();
    this._save();
    return this._publicSession(session, true);
  }

  getGraph(id) {
    const session = this.sessions.get(id);
    return session ? buildBehaviorTraceGraph(session) : null;
  }

  getContextGraph(id) {
    const session = this.sessions.get(id);
    return session ? buildSessionContextGraph(session) : null;
  }

  getStats() {
    return {
      ...this.stats,
      active: Array.from(this.sessions.values()).filter(s => s.status === "active").length,
      behaviorDrift: this.behaviorDriftEngine.getStats(),
      threatDetection: this.threatDetector.getStats(),
      approvals: this.getApprovals("pending").length,
      approvalHistory: this.getApprovals().length,
      approvalStats: { created: this.stats.approvalCreated || 0, resolved: this.stats.approvalResolved || 0, expired: this.stats.approvalExpired || 0 },
      semanticModel: this.semanticClassifier?.getStats?.() || { enabled: false },
      persistence: { ...this.persistence }
    };
  }

  _publicSession(session, includeActions = false) {
    const result = {
      id: session.id, agent: session.agent, model: session.model, cwd: session.cwd,
      permissionMode: session.permissionMode, status: session.status,
      createdAt: session.createdAt, updatedAt: session.updatedAt, endedAt: session.endedAt,
      turnId: session.turnId, traceSequence: Number(session.traceSequence || 0), promptPreview: session.promptPreview,
      prompt: session.prompt || "", rawPrompt: session.rawPrompt || session.prompt || "",
      promptHistory: (session.promptHistory || []).slice().reverse(),
      intent: session.intent, semanticAnalysis: session.semanticAnalysis || null, decisionTrace: session.decisionTrace || null, effectivePolicy: session.effectivePolicy,
      behaviorDrift: session.behaviorDrift || null, decisionTrace: session.decisionTrace || null, effectivePolicy: session.effectivePolicy, approvals: this.getApprovalsForSession(session.id),
      actionCount: session.actions.length,
      decisions: session.actions.reduce((acc, action) => {
        acc[action.verdict] = (acc[action.verdict] || 0) + 1;
        return acc;
      }, { allow: 0, alert: 0, block: 0 })
    };
    if (includeActions) result.actions = session.actions.slice().reverse();
    return result;
  }

  _safeToolDetail(input) {
    return {
      toolName: input.tool_name || "unknown",
      toolUseId: input.tool_use_id || null,
      inputPreview: this._toolPreview(input),
      responseSize: this._jsonSize(input.tool_response)
    };
  }

  _toolPreview(input) {
    const value = input.tool_input || {};
    return this.threatDetector.redact(this._boundedJson(value, 500).replace(SECRET_OUTPUT, "[REDACTED]"));
  }

  _extractDomains(text) {
    const domains = [];
    for (const match of String(text || "").matchAll(/https?:\/\/([^\s/"'<>]+)/gi)) domains.push(match[1].toLowerCase());
    return domains;
  }

  _summarize(text, limit = 140) {
    const clean = String(text || "").replace(/<environment_context>[\s\S]*?<\/environment_context>/gi, "").replace(/\s+/g, " ").trim();
    return clean.slice(0, limit) || "No user task text";
  }

  _jsonSize(value) {
    try { return Buffer.byteLength(JSON.stringify(value === undefined ? null : value)); } catch (_) { return 0; }
  }

  _boundedJson(value, limit) {
    try { return JSON.stringify(value === undefined ? null : value).slice(0, limit); } catch (_) { return ""; }
  }

  _isWithin(candidate, root) {
    const rel = path.relative(path.resolve(root), path.resolve(candidate));
    return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
  }

  _merge(base, patch) {
    const out = { ...base };
    for (const [key, value] of Object.entries(patch || {})) {
      out[key] = value && typeof value === "object" && !Array.isArray(value)
        ? this._merge(base?.[key] || {}, value)
        : value;
    }
    return out;
  }

  _normalizeStoredPrompt(value, agent) {
    if (agent !== "opencode") return sanitizePrompt(value);
    const extract = item => {
      if (typeof item === "string") {
        try {
          const parsed = JSON.parse(item);
          if (parsed && typeof parsed === "object") return extract(parsed.prompt ?? parsed.content ?? parsed.text ?? "");
        } catch (_) {}
        return item;
      }
      if (Array.isArray(item)) return item.map(extract).filter(Boolean).join("\n");
      if (!item || typeof item !== "object") return "";
      if (typeof item.content === "string") return item.content;
      if (item.prompt !== undefined) return extract(item.prompt);
      if (typeof item.text === "string") return item.text;
      return "";
    };
    return sanitizePrompt(extract(value));
  }
  _load() {
    try {
      if (!this.statePath) return;
      const loaded = readJsonWithBackup(this.statePath, null);
      this.persistence.stateSource = loaded.source;
      this.persistence.recoveredState = loaded.recovered;
      if (!loaded.value) return;
      if (loaded.recovered && fs.existsSync(this.statePath)) {
        const quarantinePath = `${this.statePath}.corrupt-${Date.now()}`;
        try { fs.renameSync(this.statePath, quarantinePath); } catch (_) {}
      }
      const state = loaded.value;
      const internalRolloutIds = this._internalRolloutIds();
      this.migrationVersion = Number(state.migrationVersion || 0);
      let dirty = false;
      for (const session of state.sessions || []) {
        if (this.migrationVersion < 1 && session.agent === "opencode" && session.id === "opencode-history" && Array.isArray(session.promptHistory) && session.promptHistory.length > 20) {
          dirty = true;
          continue;
        }
        if (internalRolloutIds.has(String(session.id))) {
          dirty = true;
          continue;
        }
        const normalize = value => this._normalizeStoredPrompt(value, session.agent);
        const history = (session.promptHistory || [])
          .map(item => ({ ...item, prompt: normalize(item.prompt), rawPrompt: normalize(item.rawPrompt || item.prompt) }))
          .filter(item => item.prompt);
        const prompt = normalize(session.prompt || session.rawPrompt || "") || history[history.length - 1]?.prompt || "";
        if (!prompt) {
          dirty = true;
          continue;
        }
        if (session.prompt !== prompt || session.rawPrompt !== prompt || session.promptPreview !== this._summarize(prompt, 220)) dirty = true;
        session.prompt = prompt;
        session.rawPrompt = prompt;
        session.promptPreview = this._summarize(prompt, 220);
        if (history.length !== (session.promptHistory || []).length) dirty = true;
        session.promptHistory = history;
        session.traceSequence = Number(session.traceSequence || session.actions?.length || 0);
        this.traceSequence = Math.max(this.traceSequence, session.traceSequence);
        this.sessions.set(session.id, session);
      }
      this.stats = { ...this.stats, ...(state.stats || {}) };
      if (this.migrationVersion < 1) { this.migrationVersion = 1; dirty = true; }
      if (dirty) this._save();
    } catch (_) {}
  }

  _internalRolloutIds() {
    const ids = new Set();
    const root = path.join(os.homedir(), ".codex", "sessions");
    const visit = (current) => {
      let entries;
      try { entries = fs.readdirSync(current, { withFileTypes: true }); } catch (_) { return; }
      for (const entry of entries) {
        const fullPath = path.join(current, entry.name);
        if (entry.isDirectory()) {
          visit(fullPath);
          continue;
        }
        if (!entry.isFile() || !entry.name.endsWith(".jsonl")) continue;
        const match = entry.name.match(/([0-9a-f]{8}-[0-9a-f-]{27,})\.jsonl$/i);
        if (!match) continue;
        try {
          const firstLine = fs.readFileSync(fullPath, "utf8").split(/\r?\n/, 1)[0];
          const record = JSON.parse(firstLine);
          const payload = record.payload || {};
          if (payload.thread_source === "subagent" || (payload.source && payload.source.subagent)) ids.add(match[1]);
        } catch (_) {}
      }
    };
    visit(root);
    return ids;
  }

  _save() {
    try {
      if (!this.statePath) return;
      const sessions = Array.from(this.sessions.values())
        .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
        .slice(0, 200);
      writeJsonAtomic(this.statePath, { version: 2, sessions, stats: this.stats, migrationVersion: this.migrationVersion });
      this.persistence.stateSource = "primary";
      this.persistence.lastSaveAt = new Date().toISOString();
      this.persistence.lastSaveError = null;
    } catch (error) {
      this.persistence.saveFailures++;
      this.persistence.lastSaveError = error.message;
    }
  }
}

module.exports = { SessionPolicyEngine };
