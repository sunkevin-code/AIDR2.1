const fs = require("fs");
const path = require("path");
const { mergePolicy } = require("./utils/config");
const { PolicyStore } = require("./utils/policyStore");
const { Logger } = require("./utils/logger");
const { EventBus } = require("./utils/eventBus");
const { startApiServer } = require("./utils/apiServer");
const { ProcessSensor } = require("./sensors/processSensor");
const { FileSensor } = require("./sensors/fileSensor");
const { NetworkSensor } = require("./sensors/networkSensor");
const { MCPGateway } = require("./sensors/mcpGateway");
const { RegistrySensor } = require("./sensors/registrySensor");
const shellSensorModule = require("./sensors/shellSensor");
const ShellSensor = shellSensorModule.ShellSensor || shellSensorModule.default || shellSensorModule;
const { CodexSessionSensor } = require("./sensors/codexSessionSensor");
const { OpenCodeSessionSensor } = require("./sensors/openCodeSessionSensor");
const { HermesSessionSensor } = require("./sensors/hermesSessionSensor");
const { KimiSessionSensor } = require("./sensors/kimiSessionSensor");
const { CodexProxy } = require("./proxy/codexProxy");
const { RuleEngine } = require("./engine/ruleEngine");
const { LLMClassifier } = require("./engine/llmClassifier");
const { LocalSemanticClassifier } = require("./engine/localSemanticClassifier");
const { HybridSemanticClassifier } = require("./engine/hybridSemanticClassifier");
const { SessionPolicyEngine } = require("./engine/sessionPolicyEngine");
const { IdentityGraph } = require("./engine/identityGraph");
const { Enforcer } = require("./enforcement/enforcer");
const { TransportClient } = require("./transport/client");
const { createDefaultAdapterRegistry } = require("./adapters/agentAdapter");
const { EVENT_SCHEMA_VERSION, normalizeEvent } = require("./observability/eventSchema");
const { enrichEvent } = require("./engine/behaviorAtoms");
const { compilePolicyRules } = require("./engine/policyRules");
const { AuditLedger } = require("./observability/auditLedger");
const { SemanticFeedbackStore } = require("./observability/semanticFeedback");
const { AsyncTelemetryQueue } = require("./observability/asyncTelemetryQueue");

const BUNDLED_POLICY_PATH = path.join(__dirname, "..", "config", "policy.json");
const POLICY_PATH = process.env.AIDR_POLICY_PATH || (process.env.AIDR_ENDPOINT_HOME
  ? path.join(process.env.AIDR_ENDPOINT_HOME, "data", "policy.json")
  : BUNDLED_POLICY_PATH);
const LOG_DIR = path.join(__dirname, "..", "logs");
const SESSION_STATE_PATH = path.join(LOG_DIR, "session-policies.json");
const TRANSPORT_OUTBOX_PATH = path.join(LOG_DIR, "transport-outbox.json");
const MAX_EVENT_ROWS = 5000;
// The JSONL event log and audit ledger are synchronous durability paths. The
// sql.js snapshot is a query cache and must not monopolize the event loop.
const DB_SAVE_INTERVAL_MS = 30000;

function ensureAgentPolicySchema(policy) {
  const next = policy || {};
  let changed = false;
  if (!next.agentPolicies || typeof next.agentPolicies !== "object" || Array.isArray(next.agentPolicies)) next.agentPolicies = {};
  if (!next.agentPolicies.default || typeof next.agentPolicies.default !== "object") {
    next.agentPolicies.default = {
      mode: "inherit",
      capabilities: { fileRead: true, fileWrite: true, shell: true, network: true, mcpRead: true, mcpWrite: true },
      allowedReadPaths: [],
      allowedWritePaths: [],
      allowedDomains: [],
      allowedMcpTools: [],
      requireApproval: { externalNetwork: true, sensitiveData: true, destructiveAction: true }
    };
    changed = true;
  }
  if (!next.organizationBoundary || typeof next.organizationBoundary !== "object") {
    next.organizationBoundary = {
      version: "org-boundary-v1",
      maxLevel: 3,
      allowedDomains: ["localhost", "127.0.0.1"],
      deniedAtoms: ["AUTH.CREDENTIAL_DISCOVER", "DATA.DATA_TRANSFER", "TOOL.CONFIGURE", "EXEC.SYSTEM_CONFIGURE"]
    };
    changed = true;
  }
  if (!next.behaviorAtoms || typeof next.behaviorAtoms !== "object") {
    next.behaviorAtoms = { version: "aidr-behavior-atom-v1", custom: {}, disabled: [] };
    changed = true;
  }
  if (!Array.isArray(next.policyRules)) {
    next.policyRules = [
      { id: "secret-read-deny", name: "Sensitive credential read protection", description: "Block access to credentials, private keys and environment secrets.", enabled: true, priority: 10, action: "block", agentScope: ["*"], atomIds: ["AUTH.CREDENTIAL_DISCOVER", "DATA.CREDENTIAL_READ"], source: "baseline" },
      { id: "external-network-review", name: "External network approval", description: "Require approval before an Agent connects to an external destination.", enabled: true, priority: 20, action: "require_approval", agentScope: ["*"], atomIds: ["EXEC.HTTP_CONNECT", "EXEC.REMOTE_ACCESS_CONNECT", "DATA.DATA_TRANSFER"], source: "baseline" },
      { id: "workspace-read", name: "Workspace read", description: "Allow source code and document reads inside the active workspace.", enabled: true, priority: 30, action: "allow", agentScope: ["*"], atomIds: ["DATA.SOURCE_CODE_READ", "DATA.DOCUMENT_READ", "DATA.FILE_READ"], source: "baseline" },
      { id: "system-change-deny", name: "System change protection", description: "Block service, registry and privileged system changes.", enabled: true, priority: 40, action: "block", agentScope: ["*"], atomIds: ["EXEC.SERVICE_CONTROL", "EXEC.REGISTRY_MODIFY", "EXEC.SYSTEM_PRIVILEGE_CHANGE"], source: "baseline" }
    ];
    changed = true;
  }
  return { policy: next, changed };
}

class AIDRAgent {
  constructor() {
    this.policyStore = new PolicyStore(POLICY_PATH, BUNDLED_POLICY_PATH, { dataDir: path.dirname(POLICY_PATH) });
    const loadedPolicy = this.policyStore.load();
    this.policy = loadedPolicy.policy;
    this.policyVerification = loadedPolicy.verification;
    if (!String(this.policy.agentId || "").trim()) {
      const hostname = require("os").hostname().replace(/[^A-Za-z0-9_-]/g, "-").toLowerCase();
      try {
        this.policy = this.policyStore.save({ ...this.policy, agentId: "aidr-" + hostname }, { signer: "aidr-agent-id-bootstrap" });
        this.policyVerification = this.policyStore.verifyActive();
      } catch (error) {
        this.policyVerification = { ...this.policyVerification, agentIdBootstrapError: error.message };
      }
    }
    if (["bundled_baseline", "unsigned_legacy"].includes(this.policyVerification.status)) {
      try {
        this.policy.version = this.policy.version || "2.2.5";
        this.policy = this.policyStore.save(this.policy, { signer: "aidr-local-migration" });
        this.policyVerification = this.policyStore.verifyActive();
      } catch (error) {
        this.policyVerification = { ...this.policyVerification, migrationError: error.message };
      }
    }
    const agentPolicySchema = ensureAgentPolicySchema(this.policy);
    if (agentPolicySchema.changed) {
      try {
        this.policy = this.policyStore.save({ ...agentPolicySchema.policy, ...compilePolicyRules(agentPolicySchema.policy) }, { signer: "aidr-agent-policy-schema-v1" });
        this.policyVerification = this.policyStore.verifyActive();
      } catch (error) {
        this.policyVerification = { ...this.policyVerification, agentPolicyMigrationError: error.message };
      }
    }
    this.logger = new Logger(LOG_DIR, this.policy.agentId || "agent-" + Date.now().toString(36));
    this.auditLedger = new AuditLedger(LOG_DIR);
    this.semanticFeedback = new SemanticFeedbackStore(LOG_DIR);
    this.telemetryQueue = new AsyncTelemetryQueue(event => this._persistTelemetry(event), {
      walPath: path.join(LOG_DIR, "aidr-telemetry-wal.json"),
      deadLetterPath: path.join(LOG_DIR, "aidr-telemetry-dead-letter.jsonl")
    });
    this.eventBus = new EventBus();
    this.adapterRegistry = createDefaultAdapterRegistry();
    this.events = [];
    this.eventIds = new Set();
    this.sessions = [];
    this.sensors = {};
    this.ruleEngine = new RuleEngine(this.policy);
    this.llmClassifier = new LLMClassifier(this.policy.llmConfig || {});
    this.localSemanticClassifier = new LocalSemanticClassifier(this.policy.localSemanticModel || {});
    this.semanticClassifier = new HybridSemanticClassifier(this.localSemanticClassifier, this.llmClassifier, this.policy.semanticRuntime || {});
    this.identityGraph = new IdentityGraph(this.policy.identityGraph || {});
    this.enforcer = new Enforcer(this.policy, this._addEvent.bind(this));
    this.transport = new TransportClient(this.policy, this._addEvent.bind(this), TRANSPORT_OUTBOX_PATH);
    this.sessionPolicyEngine = new SessionPolicyEngine(this.policy, this._addEvent.bind(this), SESSION_STATE_PATH, this.semanticClassifier, this.identityGraph);
    this.db = null;
    this.dbSaveTimer = null;
    this.dbDirty = false;
    this.dbEventCount = 0;
    this.dbPrunePending = false;
    this.apiPort = Number(process.env.AIDR_AGENT_PORT || this.policy.port || 8788);
    this.sessionId = null;
  }

  async _initDB() {
    try {
      const initSql = require("sql.js");
      const SQL = await initSql();
      const DB_PATH = path.join(LOG_DIR, "aidr-events.db");
       const dbStat = fs.existsSync(DB_PATH) ? fs.statSync(DB_PATH) : null;
       if (dbStat && dbStat.size > 32 * 1024 * 1024) {
         const archivePath = DB_PATH + ".archive-" + new Date().toISOString().replace(/[:.]/g, "-");
         try { fs.renameSync(DB_PATH, archivePath); this.logger.warn("Large event DB archived: " + archivePath); } catch (error) { this.logger.warn("Large event DB archive failed: " + error.message); }
       }
      if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
      let recovered = false;
      let candidate = null;
      if (fs.existsSync(DB_PATH)) {
        try {
          candidate = new SQL.Database(fs.readFileSync(DB_PATH));
          candidate.run("SELECT name FROM sqlite_master LIMIT 1");
          this.db = candidate;
        } catch (error) {
          try { candidate?.close?.(); } catch (_) {}
          recovered = true;
          const quarantinePath = DB_PATH + ".corrupt-" + new Date().toISOString().replace(/[:.]/g, "-");
          try { fs.renameSync(DB_PATH, quarantinePath); } catch (renameError) { this.logger.warn("Event DB quarantine rename failed: " + renameError.message); }
          this.logger.warn("Event DB quarantined: " + error.message);
          this.db = new SQL.Database();
        }
      } else {
        this.db = new SQL.Database();
      }
      this.db.run("CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY AUTOINCREMENT, event_id TEXT, schema_version INTEGER DEFAULT 1, timestamp TEXT NOT NULL, category TEXT NOT NULL, event_type TEXT, source TEXT, severity TEXT DEFAULT 'info', verdict TEXT DEFAULT 'allow', summary TEXT NOT NULL, detail TEXT DEFAULT '{}', mitre_tactic TEXT, mitre_technique TEXT, session_id TEXT, agent_id TEXT, trace_id TEXT, parent_event_id TEXT, subject TEXT, object TEXT, policy_version TEXT, evidence TEXT DEFAULT '[]', matched_rule TEXT, atom_id TEXT, atom_domain TEXT, atom_confidence REAL, atom_base_level INTEGER, mapping_rule TEXT, boundary_scope TEXT, required_level INTEGER, allowed_level INTEGER, organization_boundary_version TEXT, enforcement_color TEXT)");
      const columns = new Set((this.db.exec("PRAGMA table_info(events)")[0]?.values || []).map(row => String(row[1])));
      for (const [name, type] of [["event_id", "TEXT"], ["schema_version", "INTEGER DEFAULT 1"], ["event_type", "TEXT"], ["source", "TEXT"], ["agent_id", "TEXT"], ["trace_id", "TEXT"], ["parent_event_id", "TEXT"], ["subject", "TEXT"], ["object", "TEXT"], ["policy_version", "TEXT"], ["evidence", "TEXT DEFAULT '[]'"], ["atom_id", "TEXT"], ["atom_domain", "TEXT"], ["atom_confidence", "REAL"], ["atom_base_level", "INTEGER"], ["mapping_rule", "TEXT"], ["boundary_scope", "TEXT"], ["required_level", "INTEGER"], ["allowed_level", "INTEGER"], ["organization_boundary_version", "TEXT"], ["enforcement_color", "TEXT"]]) { if (!columns.has(name)) this.db.run(`ALTER TABLE events ADD COLUMN ${name} ${type}`); }
      this.db.run("CREATE UNIQUE INDEX IF NOT EXISTS idx_events_event_id ON events(event_id)");
      this.db.run("CREATE INDEX IF NOT EXISTS idx_events_time ON events(timestamp)");
      this.db.run("CREATE INDEX IF NOT EXISTS idx_events_verdict ON events(verdict)");
      this.db.run("CREATE INDEX IF NOT EXISTS idx_events_category ON events(category)");
      this.db.run("CREATE INDEX IF NOT EXISTS idx_events_atom_id ON events(atom_id)");
      this.db.run("CREATE INDEX IF NOT EXISTS idx_events_boundary_scope ON events(boundary_scope)");
      this.dbEventCount = Number(this.db.exec("SELECT COUNT(*) FROM events")[0]?.values?.[0]?.[0] || 0);
      this._pruneDB(true);
      if (recovered) {
        this._recoverEventsFromLog(MAX_EVENT_ROWS);
        this.dbEventCount = Number(this.db.exec("SELECT COUNT(*) FROM events")[0]?.values?.[0]?.[0] || 0);
        this._pruneDB(true);
      }
      this._saveDB();
    } catch (e) { this.logger.warn("DB init failed: " + e.message); }
  }


  _recoverEventsFromLog(limit = 5000) {
    try {
      const logPath = path.join(LOG_DIR, "aidr-events.jsonl");
      if (!fs.existsSync(logPath)) return;
      const lines = fs.readFileSync(logPath, "utf8").split(/\r?\n/).filter(Boolean).slice(-limit);
      for (const line of lines) {
        let record;
        try { record = JSON.parse(line); } catch (_) { continue; }
        const normalized = normalizeEvent(record, { source: "recovered_log" });
        const event = enrichEvent(normalized, this.policy, normalized.sessionId ? this.sessionPolicyEngine?.getSession?.(normalized.sessionId) : null);
        if (this.eventIds.has(event.eventId)) continue;
        this.eventIds.add(event.eventId);
        this.events.push(event);
        this._persistEvent(event, false);
      }
      if (this.events.length > 5000) this.events = this.events.slice(-5000);
      this.logger.log("allow", "info", "system", "Recovered recent events after database repair", { count: lines.length });
    } catch (error) {
      this.logger.warn("Event recovery failed: " + error.message);
    }
  }

  _saveDB() {
    if (this.dbSaveTimer) {
      clearTimeout(this.dbSaveTimer);
      this.dbSaveTimer = null;
    }
    if (!this.db) return;
    try {
      fs.writeFileSync(path.join(LOG_DIR, "aidr-events.db"), Buffer.from(this.db.export()));
      this.dbDirty = false;
    } catch (_) {}
  }

  _pruneDB(force = false) {
    if (!this.db || this.dbPrunePending) return;
    if (!force && this.dbEventCount <= MAX_EVENT_ROWS) return;
    this.dbPrunePending = true;
    try {
      this.db.run("DELETE FROM events WHERE id NOT IN (SELECT id FROM events ORDER BY id DESC LIMIT ?)", [MAX_EVENT_ROWS]);
      this.dbEventCount = Math.min(this.dbEventCount, MAX_EVENT_ROWS);
    } catch (_) {
      // Retention is best effort; never take the live agent down.
    } finally {
      this.dbPrunePending = false;
    }
  }

  _scheduleDBSave(delayMs = DB_SAVE_INTERVAL_MS) {
    if (!this.db || this.dbSaveTimer) {
      if (this.db) this.dbDirty = true;
      return;
    }
    this.dbDirty = true;
    this.dbSaveTimer = setTimeout(() => {
      this.dbSaveTimer = null;
      if (this.dbDirty) this._saveDB();
    }, delayMs);
    this.dbSaveTimer.unref?.();
  }

  _persistEvent(event, schedule = true) {
    if (!this.db) return;
    try {
      this.db.run("INSERT OR IGNORE INTO events (event_id,schema_version,timestamp,category,event_type,source,severity,verdict,summary,detail,mitre_tactic,mitre_technique,session_id,agent_id,trace_id,parent_event_id,subject,object,policy_version,evidence,matched_rule,atom_id,atom_domain,atom_confidence,atom_base_level,mapping_rule,boundary_scope,required_level,allowed_level,organization_boundary_version,enforcement_color) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", [
        event.eventId, event.schemaVersion, event.timestamp, event.category, event.eventType, event.source, event.severity, event.verdict,
        event.summary, JSON.stringify(event.detail || {}), event.mitreTactic, event.mitreTechnique, event.sessionId, event.agentId,
        event.traceId, event.parentEventId, event.subject, event.object, event.policyVersion, JSON.stringify(event.evidence || []), event.matchedRule,
        event.atomId, event.atomDomain, event.atomConfidence, event.atomBaseLevel, event.mappingRule, event.boundaryScope,
        event.requiredLevel, event.allowedLevel, event.organizationBoundaryVersion, event.enforcementColor
      ]);
      this.dbEventCount += 1;
      this._pruneDB();
      if (schedule) this._scheduleDBSave();
    } catch (error) {
      this.logger.warn("Event persistence failed: " + error.message);
    }
  }

  _persistTelemetry(event) {
    this.logger.log(event.verdict, event.severity, event.category, event.summary, event.detail, { eventId: event.eventId, schemaVersion: event.schemaVersion, timestamp: event.timestamp, sessionId: event.sessionId, agentId: event.agentId, matchedRule: event.matchedRule });
    const ledgerResult = this.auditLedger.append(event);
    if (!ledgerResult.ok && ledgerResult.status !== "tampered") this.logger.warn("Audit ledger append failed: " + (ledgerResult.error || ledgerResult.status));
    this._persistEvent(event);
    this.transport.sendEvent(event);
  }

  _addEvent(category, severity, verdict, summary, detail = {}, tags = {}) {
    const now = new Date().toISOString();
    const eventPid = Number(detail?.pid || detail?.processId || detail?.process_id || detail?.owningProcess || detail?.owning_process || 0);
    const pidAttribution = eventPid > 0 ? this.sensors.process?.resolveAgentByPid?.(eventPid) : null;
    const inferredAgentId = tags.agentId || detail?.agent || detail?.agentId || pidAttribution?.agentId || null;
    let inferredSession = null;
    if (!tags.sessionId && !detail?.sessionId && inferredAgentId) {
      const normalizeAgent = value => String(value || "").toLowerCase().replace(/^openai-/, "").replace(/[^a-z0-9]/g, "");
      const agentKey = normalizeAgent(inferredAgentId);
      const recent = (this.sessionPolicyEngine?.getSessions?.(false) || []).filter(session => {
        const sessionAgent = normalizeAgent(session.agent);
        const updatedAt = new Date(session.updatedAt || 0).getTime();
        return sessionAgent && (sessionAgent === agentKey || sessionAgent.includes(agentKey) || agentKey.includes(sessionAgent))
          && Date.now() - updatedAt <= 15 * 60 * 1000
          && !session.endedAt;
      });
      if (recent.length === 1) inferredSession = recent[0];
    }
    const enrichedDetail = pidAttribution ? {
      ...(detail || {}),
      agentId: inferredAgentId,
      attribution: detail?.attribution || pidAttribution
    } : (detail || {});
    let event = normalizeEvent({
      category, severity, verdict, summary, detail: enrichedDetail, timestamp: now, time: now,
      source: tags.source || detail?.source || "agent",
      sessionId: tags.sessionId || detail?.sessionId || inferredSession?.id || this.sessionId,
      agentId: inferredAgentId,
      traceId: tags.traceId || detail?.traceId || inferredSession?.decisionTrace?.traceId || null,
      parentEventId: tags.parentEventId || detail?.parentEventId || null,
      policyVersion: tags.policyVersion || detail?.policyVersion || this.policy?.policyMeta?.revision || this.policy?.version || null,
      subject: tags.subject || detail?.subject || summary,
      object: tags.object || detail?.object || detail?.target || detail?.toolName || null,
      evidence: tags.evidence || detail?.evidence || [],
      mitreTactic: tags.mitreTactic || null,
      mitreTechnique: tags.mitreTechnique || null,
      matchedRule: tags.matchedRule || detail?.matchedRule || null
    });
    const session = event.sessionId ? this.sessionPolicyEngine?.getSession?.(event.sessionId) : null;
    event = enrichEvent(event, this.policy, session || { effectivePolicy: detail?.taskBoundary || {} });
    // A post-observation sensor event must never be stored as an allowed event
    // after it crosses a configured boundary. The sensor cannot retroactively
    // claim prevention, so record an alert with an explicit observation proof.
    if (event.boundaryScope && event.boundaryScope !== "within" && event.verdict === "allow") {
      const boundaryRule = event.boundaryScope === "organization" ? "boundary.organization" : "boundary.task";
      event.verdict = "alert";
      event.severity = event.severity === "info" ? "medium" : event.severity;
      event.matchedRule = event.matchedRule || boundaryRule;
      event.detail = {
        ...(event.detail || {}),
        boundaryViolation: true,
        enforcement: "post_observation_alert",
        effectProof: { source: "sensor-post-observation", enforcementPoint: "Agent._addEvent", stage: "observed_after_execution", attempted: true, executed: true, prevented: false, boundaryScope: event.boundaryScope }
      };
      event = enrichEvent(event, this.policy, session || { effectivePolicy: detail?.taskBoundary || {} });
    }
    if (this.eventIds.has(event.eventId)) return event;
    this.eventIds.add(event.eventId);
    this.events.push(event);
    if (this.events.length > 5000) {
      const removed = this.events.shift();
      if (removed?.eventId) this.eventIds.delete(removed.eventId);
    }
    this.telemetryQueue.enqueue(event);
    this.eventBus.publish("event", event);
    return event;
  }

  async _handleEvent(event) {
    const ruleResult = this.ruleEngine.evaluate(event);
    if (ruleResult.verdict === "block") {
      this._addEvent(event.category, ruleResult.severity, "block", "[BLOCKED] " + event.summary, { ...event.detail, matchedRule: ruleResult.matchedRule }, { matchedRule: ruleResult.matchedRule });
      return { ...event, verdict: "block" };
    }
    if (ruleResult.verdict === "alert" || ruleResult.severity === "high") {
      const llmResult = await this.llmClassifier.analyzeIntent(event);
      this._addEvent(event.category, llmResult.severity || ruleResult.severity, llmResult.verdict || ruleResult.verdict, "[ANALYZED] " + event.summary, { ...event.detail, llmAnalysis: llmResult });
      return { ...event, verdict: llmResult.verdict || ruleResult.verdict };
    }
    return { ...event, verdict: ruleResult.verdict };
  }

  async start() {
    console.log("AIDR Agent v" + this.policy.version + " (mode: " + this.policy.mode + ")");
    await this._initDB();
    if (this.policyVerification.status !== "verified") {
      this._addEvent("policy", "high", "alert", "当前策略未通过签名校验，已使用受控降级模式", {
        verification: this.policyVerification,
        policyPath: POLICY_PATH
      });
    }

    this.sensors.process = new ProcessSensor(this.policy, this._addEvent.bind(this), this.enforcer, { statePath: path.join(LOG_DIR, "agent-discovery.json") }); await this.sensors.process.start();
    this.sensors.file = new FileSensor(this.policy, this._addEvent.bind(this), this.enforcer); await this.sensors.file.start();
    this.sensors.network = new NetworkSensor(this.policy, this._addEvent.bind(this), this.enforcer, this.sensors.process); await this.sensors.network.start();
    this.sensors.registry = new RegistrySensor(this.policy, this._addEvent.bind(this), this.ruleEngine); await this.sensors.registry.start();
    if (typeof ShellSensor !== "function") throw new Error("shell_sensor_constructor_unavailable");
    this.sensors.shell = new ShellSensor(this.policy, this._addEvent.bind(this), this.ruleEngine); await this.sensors.shell.start();
    this.sensors.mcp = new MCPGateway(this.policy, this._addEvent.bind(this), this.ruleEngine); await this.sensors.mcp.start();

    this.sensors.codex = new CodexSessionSensor(this.policy, this._addEvent.bind(this), this.eventBus);
    await this.sensors.codex.start();

    this.sensors.openCode = new OpenCodeSessionSensor(this.policy, this._addEvent.bind(this), this.eventBus, this.sensors.process);
    await this.sensors.openCode.start();

    this.sensors.hermes = new HermesSessionSensor(this.policy, this._addEvent.bind(this), this.eventBus);
    await this.sensors.hermes.start();

    this.sensors.kimi = new KimiSessionSensor(this.policy, this._addEvent.bind(this), this.eventBus);
    await this.sensors.kimi.start();

    
    // Transparent proxy - retry until Codex releases port 15721
    (async () => {
      let retries = 0;
      const maxRetries = 30; // Retry for ~30 seconds
      
      while (retries < maxRetries) {
        try {
          this.codexProxy = new CodexProxy({
            listenPort: 15721,
            upstreamPort: 15722
          });
          await this.codexProxy.start();
          this.sensors.codexProxy = this.codexProxy;

          this.codexProxy.on("session", (session) => {
            this.sessions.push({
              id: session.id, agent: "openai-codex", type: session.type,
              prompt: session.prompt, model: session.model,
              timestamp: session.timestamp, status: "active"
            });
            if (this.sessions.length > 50) this.sessions.shift();
            this.transport.sendSessionStart({
              sessionId: session.id, agent: "openai-codex", type: session.type,
              prompt: session.prompt, model: session.model,
              timestamp: session.timestamp
            });
          });

          this._addEvent("system", "info", "allow", "Codex proxy started on :15721 -> :15722");
          break;
        } catch (e) {
          retries++;
          if (retries === 1) {
            this.logger.warn("Codex proxy waiting for port 15721 (retry " + retries + "/" + maxRetries + "): " + e.message);
          }
          if (retries >= maxRetries) {
            this.logger.warn("Codex proxy failed after " + maxRetries + " retries: " + e.message);
          }
          await new Promise(r => setTimeout(r, 1000));
        }
      }
    })();

    this._recordAgentPrompt = (data, options = {}) => {
      const result = this.sessionPolicyEngine.observePrompt(data, options);
      const persist = () => {
        this.sessions.push({ id: data.conversationId || data.sessionId, agent: data.agent || data.agentType || "codex", threadId: data.threadId, submissionId: data.submissionId, prompt: data.prompt, timestamp: data.timestamp, status: "active" });
        if (this.sessions.length > 50) this.sessions.shift();
        this.transport.sendSessionStart({ sessionId: data.conversationId || data.sessionId, agent: data.agent || data.agentType || "codex", threadId: data.threadId, submissionId: data.submissionId, prompt: data.prompt, timestamp: data.timestamp });
      };
      if (result && typeof result.then === "function") result.then(persist).catch(error => this.logger.warn("Agent prompt analysis failed: " + error.message));
      else persist();
    };

    this.eventBus.on("codex:user_prompt", (data) => this._recordAgentPrompt(data));
    this.eventBus.on("agent:user_prompt", (data) => this._recordAgentPrompt(data, { semantic: true }));

    this.server = startApiServer({
      policy: this.policy,
      policyPath: POLICY_PATH,
      events: this.events,
      sessions: this.sessions,
      db: this.db,
      addEvent: this._addEvent.bind(this),
      sensors: this.sensors,
      transport: this.transport,
      apiPort: this.apiPort,
      handleEvent: this._handleEvent.bind(this),
      ruleEngine: this.ruleEngine,
      llmClassifier: this.llmClassifier,
      localSemanticClassifier: this.localSemanticClassifier,
      semanticClassifier: this.semanticClassifier,
      enforcer: this.enforcer,
      policyStore: this.policyStore,
      getPolicyVerification: () => this.policyVerification,
      sessionPolicyEngine: this.sessionPolicyEngine,
      adapterRegistry: this.adapterRegistry,
      auditLedger: this.auditLedger,
      semanticFeedback: this.semanticFeedback,
      getRuntimeHealth: () => this._getRuntimeHealth(),
      onPolicyUpdate: (nextPolicy) => this._applyPolicy(nextPolicy),
      onPolicyRollback: (revision) => this._rollbackPolicy(revision)
    });

    if (this.policy.serverUrl) {
      this.transport.onPolicyUpdate = (np) => this._applyPolicy(np);
      this.transport.onCommand = (msg) => { this._addEvent("system", "info", "allow", "Server cmd: " + msg.command); };
      await this.transport.connect();
    }
    process.on("SIGINT", () => this.stop());
    process.on("SIGTERM", () => this.stop());
    this._addEvent("system", "info", "allow", "Agent started (" + Object.keys(this.sensors).length + " sensors)");
  }

  _getRuntimeHealth() {
    const logPath = path.join(LOG_DIR, "aidr-events.jsonl");
    let auditLog = { path: logPath, exists: false, bytes: 0, eventCount: 0 };
    try {
      const stat = fs.statSync(logPath);
      auditLog = { ...auditLog, exists: true, bytes: stat.size, eventCount: this.events.length };
    } catch (_) {}
    const transport = this.transport.getStats?.() || {};
    const serverConfigured = Boolean(this.policy.serverUrl);
    const eventStore = { dbReady: Boolean(this.db), inMemoryCount: this.events.length, uniqueEventIds: this.eventIds.size, schemaVersion: EVENT_SCHEMA_VERSION, decisionContract: "aidr-decision-contract-v1" };
    const auditLedger = this.auditLedger?.getStatus?.() || { status: "unavailable", valid: false };
    const semanticFeedback = this.semanticFeedback?.getStatus?.() || { status: "unavailable" };
    const telemetryQueue = this.telemetryQueue?.getStatus?.() || { status: "unavailable" };
    const status = !eventStore.dbReady || auditLedger.valid === false || semanticFeedback.status === "degraded" || telemetryQueue.status === "degraded" || (serverConfigured && !transport.connected && !transport.httpHealthy) ? "degraded" : "healthy";
    return { status, serverConfigured, transportMode: serverConfigured ? (transport.transportMode || (transport.connected ? "connected" : "buffering")) : "standalone", auditLog, auditLedger, semanticFeedback, telemetryQueue, eventStore, transport };
  }

  _applyPolicy(nextPolicy) {
    const patch = nextPolicy && typeof nextPolicy === "object" ? { ...nextPolicy } : nextPolicy;
    // Atom catalogs are set-like collections. A delete must replace the
    // collection instead of being resurrected by the generic deep merge.
    if (patch && patch.behaviorAtoms && typeof patch.behaviorAtoms === "object") {
      patch.behaviorAtoms = { ...patch.behaviorAtoms };
      if (Object.prototype.hasOwnProperty.call(patch.behaviorAtoms, "custom")) {
        patch.behaviorAtoms.custom = { ...(patch.behaviorAtoms.custom || {}) };
      }
      if (Object.prototype.hasOwnProperty.call(patch.behaviorAtoms, "disabled")) {
        patch.behaviorAtoms.disabled = Array.isArray(patch.behaviorAtoms.disabled)
          ? patch.behaviorAtoms.disabled.slice()
          : [];
      }
    }
    const candidate = mergePolicy(this.policy, patch || {});
    if (patch && patch.behaviorAtoms && typeof patch.behaviorAtoms === "object") {
      if (Object.prototype.hasOwnProperty.call(patch.behaviorAtoms, "custom")) {
        candidate.behaviorAtoms.custom = patch.behaviorAtoms.custom;
      }
      if (Object.prototype.hasOwnProperty.call(patch.behaviorAtoms, "disabled")) {
        candidate.behaviorAtoms.disabled = patch.behaviorAtoms.disabled;
      }
    }
    const signed = this.policyStore.save(candidate);
    Object.keys(this.policy).forEach(key => delete this.policy[key]);
    Object.assign(this.policy, signed);
    this.policyVerification = this.policyStore.verifyActive();
    this.ruleEngine.updatePolicy(this.policy);
    this.enforcer.updatePolicy(this.policy);
    this.sessionPolicyEngine.updatePolicy(this.policy);
    this.llmClassifier.configure(this.policy.llmConfig || {});
    this.localSemanticClassifier.configure(this.policy.localSemanticModel || {});
    this.semanticClassifier.configure(this.policy.semanticRuntime || {});
    this._reconcileSensors();
    this._addEvent("system", "info", "allow", "Policy updated and activated", {
      mode: this.policy.mode,
      version: this.policy.version
    });
    return this.policy;
  }

  _rollbackPolicy(revision) {
    const restored = this.policyStore.rollback(revision);
    Object.keys(this.policy).forEach(key => delete this.policy[key]);
    Object.assign(this.policy, restored);
    this.policyVerification = this.policyStore.verifyActive();
    this.ruleEngine.updatePolicy(this.policy);
    this.enforcer.updatePolicy(this.policy);
    this.sessionPolicyEngine.updatePolicy(this.policy);
    this.llmClassifier.configure(this.policy.llmConfig || {});
    this.localSemanticClassifier.configure(this.policy.localSemanticModel || {});
    this.semanticClassifier.configure(this.policy.semanticRuntime || {});
    this._reconcileSensors();
    this._addEvent("policy", "high", "block", `Policy rolled back to revision ${revision}`, {
      revision, activeRevision: this.policy.policyMeta?.revision, verification: this.policyVerification
    });
    return this.policy;
  }

  async _reconcileSensors() {
    const sensorPolicyNames = {
      process: "process", file: "file", network: "network", registry: "registry",
      shell: "shell", mcp: "mcp_gateway"
    };
    for (const [name, policyName] of Object.entries(sensorPolicyNames)) {
      const sensor = this.sensors[name];
      if (!sensor) continue;
      const enabled = this.policy.sensors?.[policyName]?.enabled !== false;
      try {
        if (enabled && !sensor.active) await sensor.start();
        if (!enabled && sensor.active) await sensor.stop();
      } catch (error) {
        this._addEvent("system", "medium", "alert", `传感器策略切换失败: ${name}`, { error: error.message });
      }
    }
  }

  async stop() {
    for (const [name, sensor] of Object.entries(this.sensors)) { try { await sensor.stop(); } catch (_) {} }
    if (this.server) try { this.server.close(); } catch (_) {}
    this._addEvent("system", "info", "allow", "Agent stopped");
    try { await this.telemetryQueue.stop({ drain: true, timeoutMs: 5000 }); } catch (_) {}
    try { await this.transport.stop(); } catch (_) {}
    this._saveDB();
    process.exit(0);
  }
}

if (require.main === module) { new AIDRAgent().start(); }
module.exports = { AIDRAgent };
