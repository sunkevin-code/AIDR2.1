const crypto = require("crypto");
const http = require("http");
const { normalizeEvent, validateEvent } = require("../observability/eventSchema");
const { validateDecisionContract } = require("../engine/decisionContract");
const { buildIntentEvidence } = require("../engine/intentEvidence");
const { buildCatalog, enrichEvent, aggregateEvents, getOrganizationBoundary, classifyOrganizationAtom, deriveTaskLevels, constrainTaskBoundary } = require("../engine/behaviorAtoms");
const { buildOrbitGraph } = require("../engine/behaviorAtomSchema");
const { compilePolicyRules, upsertAtomAuthorizationRule } = require("../engine/policyRules");

function startApiServer({
  policy, events, db, addEvent, sensors, transport, apiPort, handleEvent,
  ruleEngine, llmClassifier, localSemanticClassifier, semanticClassifier, enforcer, policyStore, getPolicyVerification,
  sessionPolicyEngine, adapterRegistry, auditLedger, semanticFeedback, getRuntimeHealth, onPolicyUpdate, onPolicyRollback
}) {
  const localToken = process.env.AIDR_LOCAL_TOKEN || "";
  const apiAuth = loadApiAuth(localToken);
  const behaviorViewCache = new Map();
  const behaviorCacheTtlMs = 15000;
  const behaviorMetrics = {
    cacheHits: 0,
    cacheMisses: 0,
    lastDurationMs: 0,
    lastSourceCount: 0,
    lastGeneratedAt: null,
    lastWindowHours: null,
    lastAgentId: null
  };

  function behaviorDataSignature() {
    if (db) {
      try {
        const row = queryOne("SELECT COUNT(*) AS count, MAX(timestamp) AS latest FROM events") || {};
        return String(row.count || 0) + ":" + String(row.latest || "");
      } catch (_) {}
    }
    const latest = events[events.length - 1];
    return String(events.length) + ":" + String(latest?.timestamp || latest?.time || "");
  }

  function trimBehaviorAgents(agents, pathLimit) {
    return (agents || []).map(agent => ({
      ...agent,
      pathTotal: Array.isArray(agent.path) ? agent.path.length : 0,
      path: Array.isArray(agent.path) && agent.path.length > pathLimit ? agent.path.slice(-pathLimit) : (agent.path || [])
    }));
  }

  function trimOccurrences(occurrences, limit) {
    return Array.isArray(occurrences) && occurrences.length > limit ? occurrences.slice(-limit) : (occurrences || []);
  }

  function buildPredictedPath(session) {
    const intent = session?.intent || {};
    const capabilities = intent.requiredCapabilities || intent.capabilities || {};
    const path = [];
    const push = (atomId, reason) => path.push({ atomId, state: "predicted", source: "intent", reason, sequence: path.length + 1 });
    if (session?.prompt || intent.summary) push("INTENT.INTERPRET", "任务目标与约束解析");
    if (session?.prompt || intent.summary) push("PLAN.CREATE", "根据意图生成最小执行计划");
    const capabilityAtoms = {
      fileRead: ["DATA.DATA_READ", "读取任务所需工作区数据"],
      fileWrite: ["DATA.DATA_WRITE", "写入任务明确要求的输出"],
      shell: ["EXEC.CODE_EXECUTE", "执行任务声明的代码或命令"],
      network: ["EXEC.SYSTEM_CALL", "访问任务允许的网络资源"],
      mcpRead: ["TOOL.INVOKE", "调用只读工具或 MCP"],
      mcpWrite: ["TOOL.INVOKE", "调用具有写入副作用的工具或 MCP"]
    };
    Object.keys(capabilityAtoms).forEach(name => {
      if (capabilities[name] === true) push(capabilityAtoms[name][0], capabilityAtoms[name][1]);
    });
    if (path.length) push("PLAN.COMPLETE", "任务达到完成条件后结束");
    return path;
  }

  function behaviorEvents(cutoffIso = null, limit = 100) {
    const boundedLimit = clampInt(limit, 25, 5000, 100);
    if (db) {
      try {
        const rows = cutoffIso
          ? queryAll("SELECT * FROM events WHERE timestamp >= ? ORDER BY timestamp DESC LIMIT ?", [cutoffIso, boundedLimit])
          : queryAll("SELECT * FROM events ORDER BY timestamp DESC LIMIT ?", [boundedLimit]);
        if (rows.length) return rows.map(parseEventRow);
      } catch (_) {}
    }
    return events.slice(-boundedLimit);
  }

  function behaviorView(agentId = "", windowHours = 24, sourceLimit = 100, includeHost = false) {
    const normalizedWindow = Math.max(1, Number(windowHours || 24));
    const normalizedLimit = clampInt(sourceLimit, 25, 5000, 100);
    const cacheKey = String(agentId || "") + ":" + normalizedWindow + ":" + normalizedLimit + ":" + String(Boolean(includeHost)) + ":" + String(policy.version || policy.revision || "") + ":" + behaviorDataSignature();
    const cached = behaviorViewCache.get(cacheKey);
    if (cached && Date.now() - cached.createdAt < behaviorCacheTtlMs) {
      behaviorMetrics.cacheHits++;
      return cached.value;
    }
    behaviorMetrics.cacheMisses++;
    const startedAt = Date.now();
    const cutoff = Date.now() - normalizedWindow * 3600000;
    const discovery = sensors.process?.getAgentDiscoveryStatus?.() || {};
    const agentByPid = new Map();
    for (const discoveredAgent of (discovery.agents || [])) {
      for (const pid of (discoveredAgent.pids || [])) {
        if (Number(pid) > 0) agentByPid.set(Number(pid), discoveredAgent);
      }
    }
    const sessionMap = new Map((sessionPolicyEngine?.getSessions?.(false) || []).map(session => [String(session.id), session]));
    const rawSource = behaviorEvents(new Date(cutoff).toISOString(), normalizedLimit);
    const attributedSource = rawSource.map(event => {
      const detail = event.detail || {};
      const pid = Number(detail.pid || detail.processId || detail.process_id || detail.owningProcess || detail.owning_process || event.pid || 0);
      const discoveredAgent = pid > 0 ? (agentByPid.get(pid) || sensors.process?.resolveAgentByPid?.(pid)) : null;
      if (!discoveredAgent || event.agentId || event.agent || detail.agentId) return event;
      return {
        ...event,
        agentId: discoveredAgent.id,
        detail: {
          ...detail,
          agentId: discoveredAgent.id,
          agentLabel: discoveredAgent.label,
          attribution: { source: "process_discovery.pid", pid, confidence: discoveredAgent.confidence || 0 }
        }
      };
    });
    const inWindowSource = attributedSource.filter(event => {
      const timestamp = new Date(event.timestamp || event.time || 0).getTime();
      return !timestamp || timestamp >= cutoff;
    });
    const source = inWindowSource.filter(event => {
      const eventAgentId = String(event.agentId || event.agent || event.detail?.agentId || "");
      const sessionId = event.sessionId || event.session_id || event.detail?.sessionId;
      return (includeHost || Boolean(eventAgentId || sessionId))
        && (!agentId || eventAgentId === String(agentId));
    }).map(event => enrichEvent(event, policy, sessionMap.get(String(event.sessionId || "")) || event.session || {}));
    const value = { source, aggregate: aggregateEvents(source, policy, event => sessionMap.get(String(event.sessionId || "")) || event.session || {}), discovery, generatedAt: new Date().toISOString(), sourceLimit: normalizedLimit, sourceTruncated: rawSource.length >= normalizedLimit, excludedHostEvents: includeHost ? 0 : Math.max(0, inWindowSource.length - source.length) };
    behaviorMetrics.lastDurationMs = Date.now() - startedAt;
    behaviorMetrics.lastSourceCount = source.length;
    behaviorMetrics.lastGeneratedAt = value.generatedAt;
    behaviorMetrics.lastWindowHours = normalizedWindow;
    behaviorMetrics.lastAgentId = agentId || null;
    behaviorViewCache.set(cacheKey, { createdAt: Date.now(), value });
    if (behaviorViewCache.size > 12) {
      const oldest = behaviorViewCache.keys().next().value;
      if (oldest) behaviorViewCache.delete(oldest);
    }
    return value;
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://127.0.0.1:${apiPort}`);
    setSecurityHeaders(res);

    const authError = authorizeRequest(req, url.pathname, apiAuth);
    if (authError) {
      if (authError.status === 401) res.setHeader("WWW-Authenticate", "Bearer realm=AIDR");
      return sendJson(res, authError.status, { error: authError.error, authentication: apiAuth.enabled ? "token-rbac" : "development-open" });
    }

    try {
      const result = await route(req, url);
      if (!result) return sendJson(res, 404, { error: "not_found", path: url.pathname });
      return sendJson(res, result.status || 200, result.body === undefined ? result : result.body);
    } catch (error) {
      return sendJson(res, error.status || 500, { error: error.message || "internal_error" });
    }
  });

  async function route(req, url) {
    const rawPathname = url.pathname;
    const pathname = rawPathname.replace(/^\/v1(?=\/|$)/, "/api");

    if (pathname === "/api/ui/contract" && req.method === "GET") {
      return ok({
        authentication: apiAuth.enabled ? "token-rbac" : "development-open",
        schemaVersion: "aidr-ui-contract-v1",
        renderer: "canonical-view-registry",
        activeShell: "aidr-control-plane",
        views: [
          { id: "overview", label: "安全概述", owner: "posture", primaryData: ["agents", "events", "risk", "decisions"] },
          { id: "sessions", label: "意图分析", owner: "session-intent", primaryData: ["prompts", "decisionTrace", "policy", "drift"] },
          { id: "agents", label: "Agent发现", owner: "discovery", primaryData: ["identity", "process", "tools", "coverage"] },
          { id: "policy", label: "策略中心", owner: "policy", primaryData: ["rules", "signedVersions", "simulation", "approval"] },
          { id: "events", label: "行为监控", owner: "behavior", primaryData: ["eventWindow", "matrix", "patterns", "enforcement"] },
          { id: "semantic", label: "语义模型", owner: "semantic", primaryData: ["local", "external", "runtime", "template", "feedback"] },
          { id: "system", label: "系统", owner: "endpoint", primaryData: ["service", "hooks", "enforcement", "health"] }
        ],
        invariants: [
          "one_renderer_per_view",
          "one_page_title_per_view",
          "all_mutations_require_ui_token",
          "decision_trace_must_include_contract",
          "empty_state_must_include_data_status"
        ]
      });
    }

    if (pathname === "/api/status" && req.method === "GET") {
      const stats = { allow: 0, alert: 0, block: 0 };
      events.forEach(event => { if (stats[event.verdict] !== undefined) stats[event.verdict]++; });
      const sensorList = {};
      for (const [name, sensor] of Object.entries(sensors)) {
        sensorList[name] = { active: sensor.active, stats: sensor.getStats?.() || {} };
      }
      return ok({
        agentId: policy.agentId,
        version: policy.version,
        mode: policy.mode,
        sensors: sensorList,
        agentDiscovery: sensors.process?.getAgentDiscoveryStatus?.() || { agents: [], catalog: [], activeCount: 0, configuredCount: 0 },
        serverConnected: Boolean(transport.connected || transport.httpHealthy),
        transport: transport?.getStats?.() || { connected: Boolean(transport?.connected) },
        runtimeHealth: getRuntimeHealth?.() || {},
        uptime: process.uptime(),
        stats,
        ruleEngine: ruleEngine?.getStats() || {},
        intentEngine: sessionPolicyEngine?.getStats() || {},
        llm: llmClassifier?.getStats() || {},
        localSemantic: localSemanticClassifier?.getStats?.() || {},
        semanticRuntime: semanticClassifier?.getStats?.() || {},
        enforcer: enforcer?.getStats() || {},
        policyVerification: getPolicyVerification?.() || policyStore?.verifyActive?.() || { status: "unknown" },
        events: events.slice(-30).reverse()
      });
    }

    if (pathname === "/api/diagnostics/performance" && req.method === "GET") {
      const total = behaviorMetrics.cacheHits + behaviorMetrics.cacheMisses;
      return ok({
        schemaVersion: "aidr-performance-v1",
        behaviorView: {
          ...behaviorMetrics,
          cacheEntries: behaviorViewCache.size,
          cacheTtlMs: behaviorCacheTtlMs,
          cacheHitRate: total ? Number((behaviorMetrics.cacheHits / total).toFixed(4)) : 0
        },
        process: {
          uptimeSeconds: Math.round(process.uptime()),
          rssBytes: process.memoryUsage().rss,
          heapUsedBytes: process.memoryUsage().heapUsed
        },
        generatedAt: new Date().toISOString()
      });
    }

    if (pathname === "/api/enforcement/status" && req.method === "GET") {
      return ok({ capabilities: enforcer?.getCapabilities?.() || {}, stats: enforcer?.getStats?.() || {} });
    }

    if (pathname === "/api/semantic/config" && req.method === "GET") {
      return ok({ config: llmClassifier?.getPublicConfig?.() || {} });
    }

    if (pathname === "/api/semantic/local-config" && req.method === "GET") {
      return ok({ config: localSemanticClassifier?.getPublicConfig?.() || {}, stats: localSemanticClassifier?.getStats?.() || {} });
    }

    if (pathname === "/api/semantic/local-config" && req.method === "PUT") {
      const body = await readBody(req);
      const candidate = {
        enabled: body.enabled !== false,
        mode: ["local_only", "local_first", "remote_first"].includes(body.mode) ? body.mode : "local_first",
        confidenceThreshold: Math.max(0.5, Math.min(0.99, Number(body.confidenceThreshold) || 0.72)),
        maxChars: Math.max(500, Math.min(12000, Number(body.maxChars) || 6000))
      };
      onPolicyUpdate?.({ localSemanticModel: candidate });
      return ok({ ok: true, config: localSemanticClassifier?.getPublicConfig?.() || candidate });
    }

    if (pathname === "/api/semantic/runtime" && req.method === "GET") {
      return ok({ config: semanticClassifier?.getPublicConfig?.() || {}, stats: semanticClassifier?.getStats?.() || {} });
    }

    if (pathname === "/api/semantic/runtime" && req.method === "PUT") {
      const body = await readBody(req);
      const candidate = {
        enabled: body.enabled !== false,
        mode: ["local_only", "local_first", "remote_first"].includes(body.mode) ? body.mode : "local_first",
        confidenceThreshold: Math.max(0.5, Math.min(0.99, Number(body.confidenceThreshold) || 0.72)),
        remoteFallback: body.remoteFallback !== false
      };
      onPolicyUpdate?.({ semanticRuntime: candidate });
      return ok({ ok: true, config: semanticClassifier?.getPublicConfig?.() || candidate });
    }
    if (pathname === "/api/semantic/providers" && req.method === "GET") {
      return ok({ providers: llmClassifier?.getProviderCatalog?.() || [] });
    }

    if (pathname === "/api/semantic/feedback/stats" && req.method === "GET") {
      return ok({ stats: semanticFeedback?.getStats?.() || { status: "unavailable" } });
    }

    if (pathname === "/api/semantic/feedback" && req.method === "GET") {
      const limit = clampInt(url.searchParams.get("limit"), 1, 500, 100);
      return ok({ stats: semanticFeedback?.getStats?.() || { status: "unavailable" }, feedback: semanticFeedback?.getRecent?.(limit) || [] });
    }

    if (pathname === "/api/semantic/feedback" && req.method === "POST") {
      if (!semanticFeedback) return serviceUnavailable("semantic_feedback_unavailable");
      const body = await readBody(req);
      try {
        const feedback = semanticFeedback.record(body || {});
        addEvent("semantic_feedback", "info", "allow", "Semantic analysis feedback recorded", {
          feedbackId: feedback.feedbackId,
          sessionId: feedback.sessionId,
          agentId: feedback.agentId,
          source: feedback.prediction.source,
          correct: feedback.label.correct
        }, { sessionId: feedback.sessionId, agentId: feedback.agentId });
        return ok({ ok: true, feedback, stats: semanticFeedback.getStats() });
      } catch (error) {
        return badRequest(error.message || "invalid_semantic_feedback");
      }
    }

    if (pathname === "/api/semantic/key" && req.method === "PUT") {
      const body = await readBody(req);
      if (!body.apiKey) return badRequest("api_key_required");
      const result = llmClassifier?.setApiKey?.(body.apiKey);
      if (!result) return serviceUnavailable("semantic_classifier_unavailable");
      return ok({ ok: true, ...result, config: llmClassifier.getPublicConfig() });
    }

    if (pathname === "/api/semantic/key" && req.method === "DELETE") {
      const result = llmClassifier?.clearApiKey?.();
      if (!result) return serviceUnavailable("semantic_classifier_unavailable");
      return ok({ ok: true, ...result, config: llmClassifier.getPublicConfig() });
    }

    if (pathname === "/api/semantic/config" && req.method === "PUT") {
      const body = await readBody(req);
      if (Object.prototype.hasOwnProperty.call(body, "apiKey")) return badRequest("api_key_must_use_environment_variable");
      const candidate = llmClassifier?.prepareUpdate?.(body);
      if (!candidate) return serviceUnavailable("semantic_classifier_unavailable");
      const errors = llmClassifier.validate(candidate);
      if (errors.length) return { status: 400, body: { error: "invalid_semantic_config", fields: errors } };
      onPolicyUpdate?.({ llmConfig: candidate });
      return ok({ ok: true, config: llmClassifier.getPublicConfig(), policyVerification: getPolicyVerification?.() || {} });
    }

    if (pathname === "/api/semantic/test" && req.method === "POST") {
      if (!llmClassifier) return serviceUnavailable("semantic_classifier_unavailable");
      const body = await readBody(req);
      if (body && (body.config || body.apiKey)) {
        let candidate = null;
        if (body.config) {
          candidate = llmClassifier.prepareUpdate(body.config);
          const errors = llmClassifier.validate(candidate);
          if (errors.length) return { status: 400, body: { error: "invalid_semantic_config", fields: errors } };
        }
        return ok(await llmClassifier.testConnection({ config: candidate, apiKey: body.apiKey }));
      }
      return ok(await llmClassifier.testConnection());
    }
    if (pathname === "/api/events" && req.method === "GET") {
      const limit = clampInt(url.searchParams.get("limit"), 1, 500, 100);
      const offset = clampInt(url.searchParams.get("offset"), 0, 100000, 0);
      const verdict = url.searchParams.get("verdict");
      const category = url.searchParams.get("category");
      if (db) {
        try {
          const conditions = [];
          conditions.push("(category <> 'opencode_session' OR detail NOT LIKE '%opencode_workspace_store%')");
          const params = [];
          if (verdict) { conditions.push("verdict = ?"); params.push(verdict); }
          if (category) { conditions.push("category = ?"); params.push(category); }
          const where = conditions.length ? " WHERE " + conditions.join(" AND ") : "";
          const rows = queryAll("SELECT * FROM events" + where + " ORDER BY timestamp DESC LIMIT ? OFFSET ?", [...params, limit, offset]);
          const total = queryOne("SELECT COUNT(*) as c FROM events" + where, params)?.c || 0;
          if (rows.length || total || events.length === 0) return ok({ events: rows.map(parseEventRow), total });
        } catch (_) {}
      }
      const filtered = events.slice().reverse().filter(event => (!verdict || event.verdict === verdict) && (!category || event.category === category));
      return ok({ events: filtered.slice(offset, offset + limit), total: filtered.length });
    }

    if (pathname === "/api/events/stats" && req.method === "GET") {
      if (!db) return ok({ total: events.length });
      return ok({
        total: queryOne("SELECT COUNT(*) as c FROM events")?.c || 0,
        byVerdict: queryAll("SELECT verdict, COUNT(*) as c FROM events GROUP BY verdict"),
        byCategory: queryAll("SELECT category, COUNT(*) as c FROM events GROUP BY category ORDER BY c DESC"),
        byHour: queryAll("SELECT strftime('%Y-%m-%dT%H:00:00', timestamp) as hour, COUNT(*) as c FROM events WHERE timestamp > datetime('now', '-24 hours') GROUP BY hour ORDER BY hour")
      });
    }

    if (pathname === "/api/behavior-atoms" && req.method === "GET") {
      const pathLimit = clampInt(url.searchParams.get("pathLimit"), 1, 1000, 160);
      const occurrenceLimit = clampInt(url.searchParams.get("occurrenceLimit"), 1, 1000, 200);
      const sourceLimit = clampInt(url.searchParams.get("sourceLimit"), 25, 5000, 100);
      const view = behaviorView(url.searchParams.get("agentId") || "", clampInt(url.searchParams.get("windowHours"), 1, 720, 24), sourceLimit, url.searchParams.get("includeHost") === "true");
      const statsById = new Map(view.aggregate.atoms.map(item => [item.atomId, item]));
      const boundary = getOrganizationBoundary(policy);
      const catalog = buildCatalog(policy).map(atom => {
        const organizationBoundary = classifyOrganizationAtom(atom, boundary);
        return {
          ...atom,
          enabled: organizationBoundary.scope !== "organization",
          policyAllowed: organizationBoundary.scope === "within",
          authorizationState: organizationBoundary.scope === "within" ? "allow" : organizationBoundary.scope === "conditional" ? "conditional" : "deny",
          stats: statsById.get(atom.id) || { atomId: atom.id, hits: 0, allow: 0, alert: 0, block: 0, agents: [], sessions: [], outOfOrganization: 0, outOfTask: 0 },
          organizationBoundary
        };
      });
      const agents = trimBehaviorAgents(view.aggregate.agents, pathLimit);
      return ok({
        catalog,
        stats: view.aggregate.atoms,
        agents,
        occurrences: trimOccurrences(view.aggregate.occurrences, occurrenceLimit),
        totalOccurrences: view.aggregate.occurrences.length,
        sourceLimit: view.sourceLimit,
        sourceTruncated: view.sourceTruncated,
        excludedHostEvents: view.excludedHostEvents,
        scope: url.searchParams.get("includeHost") === "true" ? "agent_and_host" : "agent_only",
        mappingQuality: view.aggregate.mappingQuality,
        unattributed: agents.filter(item => item.agentId === "unknown"),
        boundary,
        windowHours: clampInt(url.searchParams.get("windowHours"), 1, 720, 24),
        generatedAt: view.generatedAt,
        schemaVersion: "aidr-behavior-atom-v1",
        contractVersion: "2026-07"
      });
    }

    if (pathname === "/api/behavior-atoms" && req.method === "POST") {
      const body = await readBody(req);
      const id = String(body.id || "").trim().toUpperCase();
      if (!/^[A-Z][A-Z0-9_-]*\.[A-Z][A-Z0-9_-]*$/.test(id)) return badRequest("behavior_atom_id_invalid");
      const existing = buildCatalog(policy).find(item => item.id === id);
      if (existing?.system) return { status: 409, body: { error: "system_atom_exists" } };
      const current = policy.behaviorAtoms || {};
      const next = { ...current, custom: { ...(current.custom || {}), [id]: { description: body.description || "自定义行为原子", baseLevel: Math.max(0, Math.min(5, Number(body.baseLevel ?? 2))), enabled: body.enabled !== false, system: false } } };
      const updated = onPolicyUpdate ? onPolicyUpdate({ behaviorAtoms: next }) : Object.assign(policy, { behaviorAtoms: next });
      return ok({ ok: true, atom: buildCatalog(updated).find(item => item.id === id) || null });
    }

    if (pathname === "/api/behavior-atoms/stats" && req.method === "GET") {
      const sourceLimit = clampInt(url.searchParams.get("sourceLimit"), 25, 5000, 100);
      const view = behaviorView(url.searchParams.get("agentId") || "", clampInt(url.searchParams.get("windowHours"), 1, 720, 24), sourceLimit, url.searchParams.get("includeHost") === "true");
      const pathLimit = clampInt(url.searchParams.get("pathLimit"), 1, 200, 40);
      return ok({ stats: view.aggregate.atoms, agents: trimBehaviorAgents(view.aggregate.agents, pathLimit), mappingQuality: view.aggregate.mappingQuality, total: view.source.length, sourceLimit: view.sourceLimit, sourceTruncated: view.sourceTruncated, generatedAt: view.generatedAt });
    }

    const behaviorAtomMatch = pathname.match(/^\/api\/behavior-atoms\/([^/]+)$/);
    if (behaviorAtomMatch && req.method === "PUT") {
      const id = decodeURIComponent(behaviorAtomMatch[1]).toUpperCase();
      const body = await readBody(req);
      const catalogItem = buildCatalog(policy).find(item => item.id === id);
      if (!catalogItem) return { status: 404, body: { error: "behavior_atom_not_found" } };
      const current = policy.behaviorAtoms || {};
      const custom = { ...(current.custom || {}) };
      const enabled = body.enabled !== false;
      const organization = policy.organizationBoundary || {};
      const currentBoundary = getOrganizationBoundary(policy);
      const currentCatalog = buildCatalog(policy);
      const allowedAtoms = new Set();
      const deniedAtoms = new Set();
      currentCatalog.forEach(atom => {
        const atomId = String(atom.id).toUpperCase();
        if (classifyOrganizationAtom(atom, currentBoundary).scope === "within") allowedAtoms.add(atomId);
        else deniedAtoms.add(atomId);
      });
      if (enabled) {
        allowedAtoms.add(id);
        deniedAtoms.delete(id);
      } else {
        allowedAtoms.delete(id);
        deniedAtoms.add(id);
      }
      const disabled = new Set(deniedAtoms);
      if (catalogItem.system) {
        if (custom[id]) custom[id] = { ...custom[id], enabled };
      } else {
        custom[id] = { ...(custom[id] || {}), ...(body || {}), enabled, system: false };
      }
      const next = { ...current, custom, disabled: Array.from(disabled) };
      const authorization = upsertAtomAuthorizationRule({ ...policy, behaviorAtoms: next }, id, enabled, currentCatalog.map(atom => atom.id));
      const patch = { behaviorAtoms: next, ...authorization };
      const updated = onPolicyUpdate ? onPolicyUpdate(patch) : Object.assign(policy, patch);
      const updatedBoundary = getOrganizationBoundary(updated);
      const updatedCatalog = buildCatalog(updated).map(atom => {
        const organizationBoundary = classifyOrganizationAtom(atom, updatedBoundary);
        return { ...atom, enabled: organizationBoundary.scope === "within", policyAllowed: organizationBoundary.scope === "within", organizationBoundary };
      });
      return ok({
        ok: true,
        atom: updatedCatalog.find(item => item.id === id) || null,
        authorization: {
          boundary: updatedBoundary,
          catalog: updatedCatalog.map(atom => ({
            id: atom.id,
            enabled: atom.enabled,
            policyAllowed: atom.policyAllowed,
            organizationBoundary: atom.organizationBoundary
          }))
        },
        policy: redactPolicy(updated)
      });
    }

    if (behaviorAtomMatch && req.method === "DELETE") {
      const id = decodeURIComponent(behaviorAtomMatch[1]).toUpperCase();
      const catalogItem = buildCatalog(policy).find(item => item.id === id);
      const stat = behaviorView().aggregate.atoms.find(item => item.atomId === id);
      if (catalogItem?.system && Number(stat?.hits || 0) > 0) return { status: 409, body: { error: "system_atom_with_history_must_be_archived" } };
      const current = policy.behaviorAtoms || {};
      const custom = { ...(current.custom || {}) };
      delete custom[id];
      const disabled = Array.from(new Set([...(current.disabled || []), ...(catalogItem?.system ? [id] : [])]));
      const next = { ...current, custom, disabled };
      const updated = onPolicyUpdate ? onPolicyUpdate({ behaviorAtoms: next }) : Object.assign(policy, { behaviorAtoms: next });
      return ok({ ok: true, atomId: id, policy: redactPolicy(updated) });
    }

    const agentOrbitMatch = pathname.match(/^\/api\/agents\/([^/]+)\/behavior-orbit$/);
    if (agentOrbitMatch && req.method === "GET") {
      const agentId = decodeURIComponent(agentOrbitMatch[1]);
      const pathLimit = clampInt(url.searchParams.get("pathLimit"), 1, 1000, 160);
      const eventLimit = clampInt(url.searchParams.get("eventLimit"), 1, 1000, 200);
      const view = behaviorView(agentId, clampInt(url.searchParams.get("windowHours"), 1, 720, 24), clampInt(url.searchParams.get("sourceLimit"), 25, 5000, 100));
      const fullAgent = view.aggregate.agents.find(item => item.agentId === agentId) || { agentId, total: 0, path: [], atoms: {}, outOfOrganization: 0, outOfTask: 0 };
      const agent = trimBehaviorAgents([fullAgent], pathLimit)[0];
      const requestPath = (agent.path || []).filter(item => item.boundaryScope && item.boundaryScope !== "within");
      const orbit = buildOrbitGraph({
        agentId,
        organizationBoundary: getOrganizationBoundary(policy),
        actualPath: agent.path || [],
        requestPath,
        events: view.source.slice(0, eventLimit)
      });
      return ok({ agentId, windowHours: clampInt(url.searchParams.get("windowHours"), 1, 720, 24), boundary: getOrganizationBoundary(policy), ...agent, requestPath, events: view.source.slice(0, eventLimit), totalEvents: view.source.length, orbit, schemaVersion: "aidr-orbit-v1", contractVersion: "2026-07" });
    }

    if (pathname === "/api/orbits" && req.method === "GET") {
      const scope = String(url.searchParams.get("scope") || "behavior").toLowerCase();
      const agentId = url.searchParams.get("agentId") || "";
      const windowHours = clampInt(url.searchParams.get("windowHours"), 1, 720, 24);
      const pathLimit = clampInt(url.searchParams.get("pathLimit"), 1, 1000, 160);
      const occurrenceLimit = clampInt(url.searchParams.get("occurrenceLimit"), 1, 1000, 200);
      const eventLimit = clampInt(url.searchParams.get("eventLimit"), 1, 1000, 200);
      const view = behaviorView(agentId, windowHours, clampInt(url.searchParams.get("sourceLimit"), 25, 5000, 100));
      const fullActualPath = agentId
        ? (view.aggregate.agents.find(item => String(item.agentId) === String(agentId))?.path || [])
        : view.aggregate.agents.flatMap(item => item.path || []).sort((a, b) => Number(a.sequence || 0) - Number(b.sequence || 0));
      const actualPath = fullActualPath.length > pathLimit ? fullActualPath.slice(-pathLimit) : fullActualPath;
      const requestPath = actualPath.filter(item => item.boundaryScope && item.boundaryScope !== "within");
      const orbit = buildOrbitGraph({
        agentId: agentId || null,
        organizationBoundary: getOrganizationBoundary(policy),
        actualPath,
        requestPath,
        events: view.source.slice(0, eventLimit)
      });
      return ok({ scope, agentId: agentId || null, windowHours, boundary: getOrganizationBoundary(policy), agents: trimBehaviorAgents(view.aggregate.agents, pathLimit), occurrences: trimOccurrences(view.aggregate.occurrences, occurrenceLimit), totalOccurrences: view.aggregate.occurrences.length, requestPath, events: view.source.slice(0, eventLimit), totalEvents: view.source.length, orbit, schemaVersion: "aidr-orbit-v1", contractVersion: "2026-07" });
    }

  if (pathname === "/api/events/validate" && req.method === "POST") {
      const body = await readBody(req);
      const event = normalizeEvent(body || {}, { source: "api_validation" });
      const validation = validateEvent(event);
      return ok({ event, validation, valid: validation.valid, errors: validation.errors });
    }

    if (pathname === "/api/audit/status" && req.method === "GET") {
      return ok(auditLedger?.getStatus?.() || { valid: false, status: "unavailable" });
    }

    if (pathname === "/api/audit/verify" && req.method === "GET") {
      return ok(auditLedger?.verify?.() || { valid: false, status: "unavailable" });
    }

    if (pathname === "/api/audit/export" && req.method === "GET") {
      const limit = clampInt(url.searchParams.get("limit"), 1, 500, 100);
      return ok({ ledger: auditLedger?.getStatus?.() || { valid: false, status: "unavailable" }, records: auditLedger?.export?.(limit) || [] });
    }

    if (pathname === "/api/decision/validate" && req.method === "POST") {
      const body = await readBody(req);
      const validation = validateDecisionContract(body?.contract || body || {});
      return ok({ validation, valid: validation.valid, errors: validation.errors });
    }

    if (pathname === "/api/sensors" && req.method === "GET") {
      const info = {};
      for (const [name, sensor] of Object.entries(sensors)) info[name] = { active: sensor.active, stats: sensor.getStats?.() || {} };
      return ok(info);
    }

    if (pathname === "/api/adapters" && req.method === "GET") {
      return ok({ adapters: adapterRegistry?.getManifests?.() || [] });
    }

    if (pathname === "/api/approvals" && req.method === "GET") {
      return ok({ approvals: sessionPolicyEngine?.getApprovals?.(url.searchParams.get("status") || "") || [] });
    }

    if (pathname === "/api/policy/resolution" && req.method === "GET") {
      return ok({ resolution: sessionPolicyEngine?.getPolicyResolution?.(url.searchParams.get("agent"), url.searchParams.get("cwd")) || {} });
    }

    if (pathname === "/api/approvals" && req.method === "POST") {
      const body = await readBody(req);
      const result = sessionPolicyEngine?.resolveApproval?.(body.id, body.decision || "approved", body.ttlMinutes);
      if (!result) return notFound("approval_not_found");
      addEvent("approval", result.decision === "approved" ? "info" : "medium", result.decision === "approved" ? "allow" : "alert", `Approval ${result.decision}`, { approvalId: result.id, sessionId: result.sessionId }, { sessionId: result.sessionId, agentId: result.agent });
      return ok({ ok: true, approval: result });
    }

    if (pathname === "/api/agents" && req.method === "GET") {
      const processSensor = sensors.process;
      const discovery = processSensor?.getAgentDiscoveryStatus?.() || {};
      const catalog = processSensor?.getAgentCatalog?.() || [];
      return ok({
        ...discovery,
        agents: processSensor?.getAgentIdentities?.() || [],
        catalog,
        contractVersion: "2026-07",
        recognition: {
          strategy: "multi-signal",
          evidence: ["process_name", "command_line", "extension_marker", "config_path"],
          supportedProfiles: catalog.length,
          redaction: "command_line_secrets_redacted"
        }
      });
    }

    if (pathname === "/api/sessions" && req.method === "GET") {
      const compact = url.searchParams.get("compact") === "1";
      const includeActions = !compact && url.searchParams.get("includeActions") === "1";
      const limit = clampInt(url.searchParams.get("limit"), 1, 100, 40);
      const offset = clampInt(url.searchParams.get("offset"), 0, 100000, 0);
      const allSessions = sessionPolicyEngine?.getSessions(includeActions, compact) || [];
      return ok({ sessions: allSessions.slice(offset, offset + limit), total: allSessions.length, limit, offset, compact });
    }

    const sessionMatch = pathname.match(/^\/api\/sessions\/([^/]+)$/);
    if (sessionMatch && req.method === "GET") {
      const session = sessionPolicyEngine?.getSession(decodeURIComponent(sessionMatch[1]));
      return session ? ok(session) : notFound("session_not_found");
    }

    const graphMatch = pathname.match(/^\/api\/sessions\/([^/]+)\/graph$/);
    if (graphMatch && req.method === "GET") {
      const sessionId = decodeURIComponent(graphMatch[1]);
      const graph = url.searchParams.get("view") === "context"
        ? sessionPolicyEngine?.getContextGraph?.(sessionId)
        : sessionPolicyEngine?.getGraph(sessionId);
      return graph ? ok(graph) : notFound("session_not_found");
    }

    const orbitMatch = pathname.match(/^\/api\/sessions\/([^/]+)\/orbit$/);
    if (orbitMatch && req.method === "GET") {
      const sessionId = decodeURIComponent(orbitMatch[1]);
      const pathLimit = clampInt(url.searchParams.get("pathLimit"), 1, 1000, 500);
      const eventLimit = clampInt(url.searchParams.get("eventLimit"), 1, 1000, 500);
      const session = sessionPolicyEngine?.getSession?.(sessionId);
      if (!session) return notFound("session_not_found");
      let sessionEvents = behaviorEvents().filter(event => String(event.sessionId || "") === sessionId);
      if (!sessionEvents.length) sessionEvents = (session.actions || []).map(action => ({ ...action, category: action.event || "system", summary: action.summary, detail: action.detail || {}, sessionId, agentId: session.agent, timestamp: action.timestamp, verdict: action.verdict }));
      sessionEvents = sessionEvents.sort((a, b) => String(a.timestamp || "").localeCompare(String(b.timestamp || ""))).map(event => enrichEvent(event, policy, session));
      const aggregate = aggregateEvents(sessionEvents, policy, () => session);
      const fullActualPath = aggregate.agents.find(item => String(item.agentId) === String(session.agent))?.path || aggregate.agents[0]?.path || [];
      const actualPath = fullActualPath.length > pathLimit ? fullActualPath.slice(-pathLimit) : fullActualPath;
      const predictedPath = buildPredictedPath(session);
      const requestPath = actualPath.filter(event => event.boundaryScope !== "within");
      const effectivePolicy = session.effectivePolicy || {};
      const organizationBoundary = getOrganizationBoundary(policy);
      const organizationAllowed = new Set(organizationBoundary.allowedAtoms || []);
      const organizationConditional = new Set(organizationBoundary.conditionalAtoms || []);
      const organizationDenied = new Set(organizationBoundary.deniedAtoms || []);
      const requestedAtoms = Array.from(new Set(predictedPath.map(item => String(item.atomId || "").toUpperCase()).filter(Boolean)));
      const taskAuthorization = {
        allowedAtoms: requestedAtoms.filter(id => organizationAllowed.has(id)),
        conditionalAtoms: requestedAtoms.filter(id => organizationConditional.has(id)),
        deniedAtoms: requestedAtoms.filter(id => organizationDenied.has(id) || (!organizationAllowed.has(id) && !organizationConditional.has(id)))
      };
      const taskBoundary = constrainTaskBoundary({
        ...effectivePolicy,
        maxLevel: Number.isFinite(Number(effectivePolicy.maxLevel)) ? Number(effectivePolicy.maxLevel) : 3,
        levels: effectivePolicy.levels || effectivePolicy.domainLevels || deriveTaskLevels(effectivePolicy, 3),
        ...taskAuthorization,
        source: "session.effectivePolicy"
      }, organizationBoundary);
      const orbit = buildOrbitGraph({
        sessionId,
        agentId: session.agent,
        organizationBoundary,
        taskBoundary,
        predictedPath,
        actualPath,
        requestPath,
        decisionTrace: session.decisionTrace || null,
        events: sessionEvents.slice(-eventLimit)
      });
      const intentEvidence = session.intent?.intentEvidence
        || session.decisionTrace?.decisionContract?.intent?.evidence
        || (session.intent ? buildIntentEvidence({
          prompt: session.prompt || session.rawPrompt || "",
          input: { cwd: session.cwd, agent: session.agent },
          localIntent: session.intent,
          semantic: session.semanticAnalysis || null,
          finalIntent: session.intent
        }) : null);
      return ok({
        sessionId,
        agentId: session.agent,
        organizationBoundary,
        taskBoundary,
        taskAuthorization,
        effectivePolicy,
        predictedPath,
        actualPath,
        actualPathTotal: fullActualPath.length,
        requestPath,
        events: sessionEvents.slice(-eventLimit),
        totalEvents: sessionEvents.length,
        intent: session.intent || null,
        intentEvidence,
        decisionTrace: session.decisionTrace || null,
        aggregate,
        orbit,
        schemaVersion: "aidr-orbit-v1",
        contractVersion: "2026-07"
      });
    }

    const sessionPolicyMatch = pathname.match(/^\/api\/sessions\/([^/]+)\/policy$/);
    if (sessionPolicyMatch && req.method === "PUT") {
      const body = await readBody(req);
      const session = sessionPolicyEngine?.updateSessionPolicy(decodeURIComponent(sessionPolicyMatch[1]), body);
      if (!session) return notFound("session_not_found");
      addEvent("policy", "info", "allow", "Session policy updated", {
        sessionId: session.id,
        fields: Object.keys(body || {})
      }, { sessionId: session.id });
      return ok({ ok: true, session });
    }

    if (pathname === "/api/hooks/codex" && req.method === "POST") {
      if (!sessionPolicyEngine) return serviceUnavailable("session_policy_engine_unavailable");
      const body = await readBody(req);
      const result = await sessionPolicyEngine.handleHook(body || {});
      return ok(result);
    }

    if (pathname === "/api/hooks/agent" && req.method === "POST") {
      if (!sessionPolicyEngine) return serviceUnavailable("session_policy_engine_unavailable");
      let body = await readBody(req);
      if (!body || !body.agent) return badRequest("agent_required");
      const validation = adapterRegistry?.validate?.(body);
      if (validation && !validation.valid) return { status: 400, body: { error: "invalid_agent_event", adapter: validation.adapter, fields: validation.errors } };
      body = validation?.normalized || adapterRegistry?.normalize?.(body) || body;
      body.hook_event_name = body.hook_event_name || body.event || "UserPromptSubmit";
      const result = await sessionPolicyEngine.handleHook(body);
      const decisionTrace = result.session?.decisionTrace || null;
      return ok({ ...result, decisionTrace, contract: decisionTrace?.decisionContract || null });
    }
    if (pathname === "/api/adapters/events" && req.method === "POST") {
      if (!adapterRegistry) return serviceUnavailable("adapter_registry_unavailable");
      const body = await readBody(req);
      if (!body || !body.agent) return badRequest("agent_required");
      const packet = adapterRegistry.dispatch(body);
      const normalized = packet.payload;
      if (normalized.hook_event_name === "AgentRegister") {
        const identityEvent = addEvent("agent_identity", "info", "allow", `Agent registered: ${normalized.agent}`, {
          agent: normalized.agent, adapter: packet.adapter, manifest: packet.manifest, source: normalized.source
        }, { agentId: normalized.agent, source: normalized.source });
        return ok({ ok: true, adapter: packet.adapter, manifest: packet.manifest, event: identityEvent, payload: normalized });
      }
      if (!sessionPolicyEngine) return serviceUnavailable("session_policy_engine_unavailable");
      const validation = adapterRegistry.validate(normalized);
      if (!validation.valid) return { status: 400, body: { error: "invalid_agent_event", adapter: validation.adapter, fields: validation.errors } };
      const result = await sessionPolicyEngine.handleHook(validation.normalized);
      const decisionTrace = result.session?.decisionTrace || null;
      return ok({ ...result, decisionTrace, contract: decisionTrace?.decisionContract || null, adapter: packet.adapter, manifest: packet.manifest });
    }
    if (pathname === "/api/rules" && req.method === "GET") {
      return ok({ rules: ruleEngine?.getRules() || [], stats: ruleEngine?.getStats() || {} });
    }
    if (pathname === "/api/rules" && req.method === "POST") {
      const body = await readBody(req);
      ruleEngine?.addRule(body);
      return ok({ ok: true, rule: body });
    }
    const ruleMatch = pathname.match(/^\/api\/rules\/([^/]+)$/);
    if (ruleMatch && req.method === "DELETE") {
      ruleEngine?.removeRule(decodeURIComponent(ruleMatch[1]));
      return ok({ ok: true });
    }

    if (pathname === "/api/intent/analyze" && req.method === "POST") {
      const body = await readBody(req);
      const prompt = body.prompt || body.text || "";
      if (!sessionPolicyEngine?.analyzePromptDecision) return serviceUnavailable("intent_engine_unavailable");
      const result = await sessionPolicyEngine.analyzePromptDecision(prompt, {
        cwd: body.cwd,
        agent: body.agent || body.agent_type,
        sessionId: body.sessionId || body.session_id,
        turnId: body.turnId || body.turn_id,
        source: "intent_api"
      });
      const contract = result.decisionTrace?.decisionContract || null;
      return ok({ ...result, contract, contractVersion: contract?.contractVersion || contract?.schemaVersion || null });
    }

    if (pathname === "/api/policy/templates" && req.method === "GET") {
      return ok({ templates: policyTemplates() });
    }

    if (pathname === "/api/policy/validate" && req.method === "POST") {
      const body = await readBody(req);
      return ok(sessionPolicyEngine?.validatePolicy?.(body.policy || policy) || { valid: false, errors: [{ code: 'policy_engine_unavailable' }], warnings: [] });
    }
    if (pathname === "/api/policy/simulate" && req.method === "POST") {
      const body = await readBody(req);
      if (!Array.isArray(body.actions)) return badRequest("actions_array_required");
      return ok({ results: sessionPolicyEngine?.simulate?.(body.actions, body.policy || {}) || [] });
    }

    if (pathname === "/api/threat/test" && req.method === "POST") {
      const body = await readBody(req);
      return ok({ result: sessionPolicyEngine?.inspectThreat?.(body.text || body.content || "", body.context || {}) || {} });
    }

    if (pathname === "/api/intent/simulate" && req.method === "POST") {
      const body = await readBody(req);
      if (!Array.isArray(body.actions)) return badRequest("actions_array_required");
      const results = [];
      for (const action of body.actions) {
        const event = { category: action.category || "unknown", summary: action.summary || "", detail: action.detail || {} };
        results.push({ action, ...(handleEvent ? await handleEvent(event) : { verdict: "allow" }) });
      }
      return ok({ results });
    }

    if (pathname === "/api/enforce" && req.method === "POST") {
      const body = await readBody(req);
      if (!enforcer) return serviceUnavailable("enforcer_unavailable");
      if (!body.type || !body.action) return badRequest("type_and_action_required");
      return ok(await enforcer.enforce(body));
    }

    if (pathname === "/api/connect" && req.method === "POST") {
      const body = await readBody(req);
      const next = {};
      if (body.serverUrl !== undefined) next.serverUrl = body.serverUrl;
      if (body.serverAuthToken !== undefined) next.serverAuthToken = body.serverAuthToken;
      onPolicyUpdate?.(next);
      await transport.connect();
      return ok({ ok: true, connected: transport.connected });
    }

    if (pathname === "/api/policy" && req.method === "GET") {
      return ok({ ...redactPolicy(policy), policyVerification: getPolicyVerification?.() || policyStore?.verifyActive?.() || { status: "unknown" } });
    }
    if (pathname === "/api/policy" && req.method === "PUT") {
      const body = await readBody(req);
      const patch = Object.prototype.hasOwnProperty.call(body, "policyRules")
        ? { ...body, ...compilePolicyRules({ ...policy, ...body, organizationBoundary: { ...(policy.organizationBoundary || {}), ...(body.organizationBoundary || {}) } }, body.policyRules, buildCatalog({ ...policy, ...body }).map(atom => atom.id)) }
        : body;
      const updated = onPolicyUpdate ? onPolicyUpdate(patch) : Object.assign(policy, patch);
      return ok({ ok: true, policy: redactPolicy(updated), policyVerification: getPolicyVerification?.() || { status: "unknown" } });
    }
    if (pathname === "/api/policy/history" && req.method === "GET") {
      return ok({ history: policyStore?.getHistory?.() || [] });
    }
    if (pathname === "/api/policy/verify" && req.method === "POST") {
      return ok({ verification: policyStore?.verifyActive?.() || { status: "unavailable" } });
    }
    if (pathname === "/api/policy/rollback" && req.method === "POST") {
      const body = await readBody(req);
      const revision = Number(body.revision);
      if (!Number.isInteger(revision) || revision < 1) return badRequest("valid_revision_required");
      if (!onPolicyRollback) return serviceUnavailable("policy_rollback_unavailable");
      const restored = onPolicyRollback(revision);
      return ok({ ok: true, policy: redactPolicy(restored), policyVerification: getPolicyVerification?.() || { status: "unknown" } });
    }

    return null;
  }

  function queryAll(sql, params = []) {
    if (!db) return [];
    try {
      const stmt = db.prepare(sql);
      if (params.length) stmt.bind(params);
      const rows = [];
      while (stmt.step()) rows.push(stmt.getAsObject());
      stmt.free();
      return rows;
    } catch (_) { return []; }
  }

  function queryOne(sql, params = []) {
    return queryAll(sql, params)[0] || null;
  }

  server.on("error", error => {
    try { addEvent("system", "high", "alert", "Agent API listener failed", { code: error.code || null, message: error.message, port: apiPort }); } catch (_) {}
    // Let the Endpoint supervisor restart a failed worker instead of leaving an unhandled error.
    process.exitCode = error.code === "EADDRINUSE" ? 73 : 74;
    setImmediate(() => process.exit(process.exitCode));
  });
  server.listen(apiPort, "127.0.0.1", () => {
    addEvent("system", "info", "allow", `Agent API: http://127.0.0.1:${apiPort}`,
      { authentication: apiAuth.enabled ? "token-rbac" : "development-open" });
  });
  return server;
}

function validToken(provided, expected) {
  const left = Buffer.from(String(provided || ""));
  const right = Buffer.from(String(expected || ""));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function loadApiAuth(localToken) {
  const tokens = new Map();
  if (localToken) tokens.set(localToken, { role: "admin", scopes: ["read", "write", "admin"] });
  if (process.env.AIDR_ADMIN_TOKEN) tokens.set(process.env.AIDR_ADMIN_TOKEN, { role: "admin", scopes: ["read", "write", "admin"] });
  if (process.env.AIDR_READ_TOKEN) tokens.set(process.env.AIDR_READ_TOKEN, { role: "viewer", scopes: ["read"] });
  if (process.env.AIDR_API_TOKENS) {
    try {
      const configured = JSON.parse(process.env.AIDR_API_TOKENS);
      for (const [token, value] of Object.entries(configured || {})) {
        if (!token) continue;
        const role = typeof value === "string" ? value : value?.role || "viewer";
        const scopes = Array.isArray(value?.scopes) ? value.scopes : (role === "admin" ? ["read", "write", "admin"] : ["read"]);
        tokens.set(token, { role, scopes });
      }
    } catch (_) {}
  }
  return { enabled: tokens.size > 0, tokens };
}

function authorizeRequest(req, pathname, auth) {
  if (!auth.enabled) return null;
  const supplied = req.headers["x-aidr-token"] || String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  const credential = Array.from(auth.tokens.keys()).find(token => validToken(supplied, token));
  if (!credential) return { status: 401, error: "unauthorized" };
  const principal = auth.tokens.get(credential);
  const mutating = !["GET", "HEAD", "OPTIONS"].includes(String(req.method || "GET").toUpperCase());
  if (mutating && !principal.scopes.includes("write") && !principal.scopes.includes("admin")) {
    return { status: 403, error: "forbidden_scope" };
  }
  if (pathname === "/api/audit/export" && !principal.scopes.includes("read") && !principal.scopes.includes("admin")) {
    return { status: 403, error: "forbidden_scope" };
  }
  return null;
}

function redactPolicy(policy) {
  const redacted = { ...policy };
  const llmConfig = { ...(policy.llmConfig || {}) };
  delete llmConfig.apiKey;
  llmConfig.apiKey = "";
  const apiKeyEnv = llmConfig.apiKeyEnv || (llmConfig.provider === "deepseek" ? "AIDR_DEEPSEEK_API_KEY" : "OPENAI_API_KEY");
  llmConfig.apiKeyEnv = apiKeyEnv;
  llmConfig.apiKeyConfigured = Boolean(process.env[apiKeyEnv]);
  redacted.serverAuthToken = policy.serverAuthToken ? "[configured]" : "";
  redacted.llmConfig = llmConfig;
  if (policy.signature) redacted.signature = { algorithm: policy.signature.algorithm, keyId: policy.signature.keyId, value: "[signed]" };
  return redacted;
}

function parseEventRow(row) {
  let detail = {};
  let evidence = [];
  try { detail = row.detail ? JSON.parse(row.detail) : {}; } catch (_) {}
  try { evidence = row.evidence ? JSON.parse(row.evidence) : (detail.evidence || []); } catch (_) { evidence = detail.evidence || []; }
  return {
    ...row,
    eventId: row.event_id || row.eventId,
    schemaVersion: Number(row.schema_version || row.schemaVersion || 1),
    time: row.timestamp,
    eventType: row.event_type || detail.eventType || row.category,
    source: row.source || detail.source || "agent",
    detail,
    traceId: row.trace_id || detail.traceId || null,
    parentEventId: row.parent_event_id || detail.parentEventId || null,
    subject: row.subject || detail.subject || row.summary,
    object: row.object || detail.object || null,
    policyVersion: row.policy_version || detail.policyVersion || null,
    evidence,
    sessionId: row.session_id || row.sessionId || detail.sessionId || null,
    agentId: row.agent_id || row.agentId || detail.agentId || detail.agent || null,
    matchedRule: row.matched_rule || row.matchedRule || detail.matchedRule || null
    ,atomId: row.atom_id || row.atomId || detail.atomId || null,
    atomDomain: row.atom_domain || row.atomDomain || detail.atomDomain || null,
    atomConfidence: row.atom_confidence ?? row.atomConfidence ?? detail.atomConfidence ?? null,
    atomBaseLevel: row.atom_base_level ?? row.atomBaseLevel ?? detail.atomBaseLevel ?? null,
    mappingRule: row.mapping_rule || row.mappingRule || detail.mappingRule || null,
    boundaryScope: row.boundary_scope || row.boundaryScope || detail.boundaryScope || null,
    requiredLevel: row.required_level ?? row.requiredLevel ?? detail.requiredLevel ?? null,
    allowedLevel: row.allowed_level ?? row.allowedLevel ?? detail.allowedLevel ?? null,
    organizationBoundaryVersion: row.organization_boundary_version || row.organizationBoundaryVersion || null,
    enforcementColor: row.enforcement_color || row.enforcementColor || null
  };
}

function clampInt(value, min, max, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, parsed)) : fallback;
}

function setSecurityHeaders(res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
}

function readBody(req, maxBytes = 2 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", chunk => {
      data += chunk;
      if (Buffer.byteLength(data) > maxBytes) {
        const error = new Error("request_too_large");
        error.status = 413;
        reject(error);
        req.destroy();
      }
    });
    req.on("end", () => {
      if (!data) return resolve({});
      try { resolve(JSON.parse(data)); }
      catch (_) {
        const error = new Error("invalid_json");
        error.status = 400;
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

function sendJson(res, status, body) {
  const payload = Buffer.from(JSON.stringify(body), "utf8");
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": payload.length,
    "Connection": "close"
  });
  res.end(payload);
}

function ok(body) { return { status: 200, body }; }
function badRequest(error) { return { status: 400, body: { error } }; }
function notFound(error) { return { status: 404, body: { error } }; }
function serviceUnavailable(error) { return { status: 503, body: { error } }; }

function policyTemplates() {
  return [
    { id: "coding-agent", label: "Coding Agent", mode: "enforce", capabilities: { fileRead: true, fileWrite: true, shell: true, network: true, mcpRead: true, mcpWrite: false }, requireApproval: { externalNetwork: true, sensitiveData: true, destructiveAction: true } },
    { id: "read-only-review", label: "Read-only Review", mode: "enforce", capabilities: { fileRead: true, fileWrite: false, shell: false, network: false, mcpRead: true, mcpWrite: false }, requireApproval: { externalNetwork: true, sensitiveData: true, destructiveAction: true } },
    { id: "restricted", label: "Restricted", mode: "enforce", capabilities: { fileRead: false, fileWrite: false, shell: false, network: false, mcpRead: false, mcpWrite: false }, requireApproval: { externalNetwork: true, sensitiveData: true, destructiveAction: true } }
  ];
}

module.exports = { startApiServer };
