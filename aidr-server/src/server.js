const fs = require("fs");
const path = require("path");
const http = require("http");
const crypto = require("crypto");
const { WebSocketServer } = require("ws");
const { v4: uuidv4 } = require("uuid");

const PORT = parseInt(process.env.PORT || "8888");
const HOST = process.env.AIDR_SERVER_HOST || "127.0.0.1";
const DATA_DIR = process.env.AIDR_SERVER_DATA_DIR || path.join(__dirname, "..", "data");
const DB_PATH = path.join(DATA_DIR, "aidr-server.db");
const PUBLIC_DIR = path.join(__dirname, "..", "public");
const ENDPOINT_UI_DIR = process.env.AIDR_CONSOLE_UI_DIR || path.join(__dirname, "..", "..", "aidr-endpoint", "ui");
const ENROLLMENT_TOKEN = process.env.AIDR_ENROLLMENT_TOKEN || "";

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

let db;

async function initDB() {
  const initSql = require("sql.js");
  const SQL = await initSql();
  try {
    const buffer = fs.existsSync(DB_PATH) ? fs.readFileSync(DB_PATH) : null;
    db = new SQL.Database(buffer);
  } catch {
    db = new SQL.Database();
  }
  db.run("PRAGMA journal_mode = WAL");
  db.run(`
    CREATE TABLE IF NOT EXISTS agents (
      id TEXT PRIMARY KEY,
      agent_type TEXT DEFAULT 'codex',
      hostname TEXT,
      platform TEXT,
      arch TEXT,
      version TEXT,
      last_seen TEXT,
      status TEXT DEFAULT 'online',
      sensors TEXT DEFAULT '[]',
      metadata TEXT DEFAULT '{}',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id TEXT UNIQUE,
      agent_id TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      category TEXT NOT NULL,
      severity TEXT DEFAULT 'info',
      verdict TEXT DEFAULT 'allow',
      summary TEXT NOT NULL,
      detail TEXT DEFAULT '{}',
      mitre_tactic TEXT,
      mitre_technique TEXT,
      session_id TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);
  db.run("CREATE INDEX IF NOT EXISTS idx_events_agent ON events(agent_id, timestamp)");
  db.run("CREATE INDEX IF NOT EXISTS idx_events_time ON events(timestamp)");
  db.run("CREATE INDEX IF NOT EXISTS idx_events_verdict ON events(verdict)");
  db.run(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      prompt TEXT,
      task_image TEXT DEFAULT '{}',
      status TEXT DEFAULT 'active',
      start_time TEXT NOT NULL,
      end_time TEXT,
      metadata TEXT DEFAULT '{}',
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS policies (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      config TEXT NOT NULL DEFAULT '{}',
      scope TEXT DEFAULT 'global',
      enabled INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS alerts (
      id TEXT PRIMARY KEY,
      agent_id TEXT,
      event_id TEXT,
      title TEXT NOT NULL,
      description TEXT,
      severity TEXT DEFAULT 'medium',
      status TEXT DEFAULT 'open',
      created_at TEXT DEFAULT (datetime('now')),
      resolved_at TEXT
    )
  `);
  db.run("CREATE INDEX IF NOT EXISTS idx_alerts_status ON alerts(status)");
  db.run(`CREATE TABLE IF NOT EXISTS endpoint_credentials (
    agent_id TEXT PRIMARY KEY,
    token_hash TEXT NOT NULL,
    issued_at TEXT NOT NULL,
    revoked_at TEXT
  )`);
  _saveDB();
}

function _saveDB() {
  try {
    const data = db.export();
    const buffer = Buffer.from(data);
    fs.writeFileSync(DB_PATH, buffer);
  } catch (_) {}
}

// Periodic DB save
setInterval(_saveDB, 30000);

// Agents state
const agents = new Map();

function loadAgents() {
  try {
    const rows = db.exec("SELECT * FROM agents");
    if (rows[0]) {
      for (const row of rows[0].values) {
        const id = row[0];
        agents.set(id, {
          id, agent_type: row[1], hostname: row[2], platform: row[3],
          arch: row[4], version: row[5], last_seen: row[6], status: row[7],
          sensors: JSON.parse(row[8] || "[]"), metadata: JSON.parse(row[9] || "{}"), ws: null
        });
      }
    }
  } catch (_) {}
}

initDB().then(() => {
  loadAgents();

  // HTTP server
  const server = http.createServer((req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      return res.end();
    }

    const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
    const pathname = url.pathname;

    if (pathname === "/" || pathname === "" || pathname === "/console" || pathname === "/console/") return serveUnifiedConsole(res);
    if (pathname === "/console/runtime-adapter.js") return serveEndpointUiAsset(res, "runtime-adapter.js");
    if (pathname === "/console/abgc.js") return serveEndpointUiAsset(res, "abgc.js");
    if (pathname.startsWith("/app.js") || pathname.startsWith("/styles.css")) {
      return serveStatic(res, pathname.slice(1));
    }

    handleAPI(req, res, url);
  });

  function serveStatic(res, filename) {
    const filePath = path.join(PUBLIC_DIR, filename);
    try {
      if (!fs.existsSync(filePath)) {
        res.writeHead(404, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ error: "Not found" }));
      }
      const content = fs.readFileSync(filePath);
      const ext = path.extname(filename);
      const mime = { ".html": "text/html", ".js": "application/javascript", ".css": "text/css" };
      res.writeHead(200, { "Content-Type": mime[ext] || "text/plain" });
      res.end(content);
    } catch (e) {
      res.writeHead(500);
      res.end("Error");
    }
  }

  function serveEndpointUiAsset(res, filename) {
    const filePath = path.join(ENDPOINT_UI_DIR, filename);
    if (!fs.existsSync(filePath)) {
      res.writeHead(404, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ error: "ui_asset_not_found" }));
    }
    res.writeHead(200, { "Content-Type": "application/javascript; charset=utf-8", "Cache-Control": "no-store" });
    res.end(fs.readFileSync(filePath));
  }

  function serveUnifiedConsole(res) {
    const sourcePath = path.join(ENDPOINT_UI_DIR, "index.html");
    if (!fs.existsSync(sourcePath)) return serveStatic(res, "index.html");
    let html = fs.readFileSync(sourcePath, "utf8");
    html = html.replace("<head>", '<head><meta name="aidr-data-mode" content="central"><meta name="aidr-api-base" content="">');
    html = html.replace("</body>", '<script src="/console/abgc.js"></script><script src="/console/runtime-adapter.js"></script></body>');
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
    res.end(html);
  }

  function queryAll(sql, params = []) {
    try {
      const stmt = db.prepare(sql);
      if (params.length) stmt.bind(params);
      const rows = [];
      while (stmt.step()) rows.push(stmt.getAsObject());
      stmt.free();
      return rows;
    } catch (e) { console.error("SQL error:", e.message); return []; }
  }

  function queryOne(sql, params = []) {
    const rows = queryAll(sql, params);
    return rows[0] || null;
  }

  function execSQL(sql, params = []) {
    try {
      db.run(sql, params);
      _saveDB();
    } catch (e) { console.error("SQL exec error:", e.message); }
  }

  function endpointTokenValid(agentId, suppliedToken) {
    const credential = queryOne("SELECT token_hash, revoked_at FROM endpoint_credentials WHERE agent_id = ?", [agentId]);
    if (!credential) return process.env.AIDR_ALLOW_LEGACY_INGEST === "1";
    if (credential.revoked_at || !suppliedToken) return false;
    const actual = crypto.createHash("sha256").update(String(suppliedToken), "utf8").digest("hex");
    const expected = String(credential.token_hash);
    return actual.length === expected.length && crypto.timingSafeEqual(Buffer.from(actual), Buffer.from(expected));
  }

  function defaultCentralPolicy() {
    return {
      version: "central-policy-v1",
      mode: "enforce",
      policyBaseline: { id: "central-baseline", name: "AIDR Organization Baseline", version: "1.0.0", revision: 1, status: "active", scope: "all-agents" },
      policyRules: [
        { id: "secret-read-deny", name: "Sensitive credential read protection", description: "Block access to credentials and secrets.", enabled: true, priority: 10, action: "block", agentScope: ["*"], atomIds: ["AUTH.CREDENTIAL_DISCOVER", "DATA.CREDENTIAL_READ"], source: "baseline" },
        { id: "external-network-review", name: "External network approval", description: "Require approval for external connections and transfers.", enabled: true, priority: 20, action: "require_approval", agentScope: ["*"], atomIds: ["EXEC.HTTP_CONNECT", "EXEC.REMOTE_ACCESS_CONNECT", "DATA.DATA_TRANSFER"], source: "baseline" },
        { id: "workspace-read", name: "Workspace read", description: "Allow source code and document reads.", enabled: true, priority: 30, action: "allow", agentScope: ["*"], atomIds: ["DATA.SOURCE_CODE_READ", "DATA.DOCUMENT_READ", "DATA.FILE_READ"], source: "baseline" }
      ],
      organizationBoundary: { maxLevel: 3, levels: {}, allowedAtoms: [], conditionalAtoms: [], deniedAtoms: [], compiledAtoms: [] }
    };
  }

  function compileCentralPolicy(input = {}) {
    const policy = { ...defaultCentralPolicy(), ...input, organizationBoundary: { ...defaultCentralPolicy().organizationBoundary, ...(input.organizationBoundary || {}) } };
    const previous = new Set(policy.organizationBoundary.compiledAtoms || []);
    const allowed = new Set((policy.organizationBoundary.allowedAtoms || []).filter(id => !previous.has(id)));
    const conditional = new Set((policy.organizationBoundary.conditionalAtoms || []).filter(id => !previous.has(id)));
    const denied = new Set((policy.organizationBoundary.deniedAtoms || []).filter(id => !previous.has(id)));
    const normalizeAtoms = values => Array.from(new Set((values || []).map(id => String(id).trim().toUpperCase()).filter(Boolean)));
    policy.policyRules = (Array.isArray(policy.policyRules) ? policy.policyRules : []).map((rule, index) => ({
      ...rule,
      id: String(rule.id || `policy-${index + 1}`),
      enabled: rule.enabled !== false,
      priority: Number(rule.priority || (index + 1) * 100),
      agentScope: Array.isArray(rule.agentScope) ? rule.agentScope : ["*"],
      authorization: (() => {
        if (rule.authorization) return {
          allow: normalizeAtoms(rule.authorization.allow || rule.authorization.allowedAtoms),
          conditional: normalizeAtoms(rule.authorization.conditional || rule.authorization.approval || rule.authorization.requireApproval),
          deny: normalizeAtoms(rule.authorization.deny || rule.authorization.deniedAtoms)
        };
        const atoms = normalizeAtoms(rule.atomIds);
        const action = String(rule.action || "block").toLowerCase();
        return action === "allow" ? { allow: atoms, conditional: [], deny: [] }
          : action === "hold" || action === "require_approval" ? { allow: [], conditional: atoms, deny: [] }
          : { allow: [], conditional: [], deny: atoms };
      })()
    })).sort((a, b) => a.priority - b.priority);
    const decisions = new Map();
    for (const rule of policy.policyRules) {
      if (!rule.enabled) continue;
      for (const state of ["allow", "conditional", "deny"]) {
        for (const id of rule.authorization[state]) {
          if (!decisions.has(id)) decisions.set(id, { state, ruleId: rule.id });
        }
      }
    }
    policy.policyRules = policy.policyRules.map(rule => {
      const atomIds = normalizeAtoms([...rule.authorization.allow, ...rule.authorization.conditional, ...rule.authorization.deny]);
      const groups = ["allow", "conditional", "deny"].filter(state => rule.authorization[state].length);
      return { ...rule, action: groups.length === 1 ? (groups[0] === "conditional" ? "require_approval" : groups[0] === "deny" ? "block" : "allow") : "mixed", atomIds };
    });
    for (const [id, decision] of decisions) {
      allowed.delete(id); conditional.delete(id); denied.delete(id);
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
    const authorization = { allowedAtoms: Array.from(allowed).sort(), conditionalAtoms: Array.from(conditional).sort(), deniedAtoms: Array.from(denied).sort() };
    policy.effectivePolicy = {
      baseline: policy.policyBaseline,
      authorization,
      domainStats: Object.values(domainStats).sort((a, b) => a.domain.localeCompare(b.domain)),
      ruleContributions: policy.policyRules.map(rule => ({ ruleId: rule.id, name: rule.name, priority: rule.priority, enabled: rule.enabled, allow: rule.authorization.allow.length, conditional: rule.authorization.conditional.length, deny: rule.authorization.deny.length, atoms: rule.authorization })),
      source: "policy.policyRules.compiler"
    };
    policy.organizationBoundary = { ...policy.organizationBoundary, ...authorization, compiledAtoms: Array.from(decisions.keys()).sort(), source: "policy.policyRules.compiler" };
    return policy;
  }

  function activeCentralPolicy() {
    const row = queryOne("SELECT * FROM policies WHERE enabled=1 ORDER BY updated_at DESC LIMIT 1");
    if (!row) return compileCentralPolicy(defaultCentralPolicy());
    try { return compileCentralPolicy(JSON.parse(row.config || "{}")); } catch (_) { return compileCentralPolicy(defaultCentralPolicy()); }
  }

  function saveCentralPolicy(policy) {
    const compiled = compileCentralPolicy(policy);
    execSQL("INSERT OR REPLACE INTO policies (id, name, description, config, scope, enabled, created_at, updated_at) VALUES ('central-active', 'Central active policy', 'Unified policy source', ?, 'global', 1, COALESCE((SELECT created_at FROM policies WHERE id='central-active'), datetime('now')), datetime('now'))", [JSON.stringify(compiled)]);
    return compiled;
  }

  function ensureAgent(agentId, metadata = {}) {
    const id = String(agentId || "").trim();
    if (!id) return null;
    const now = new Date().toISOString();
    const current = agents.get(id) || {};
    const agent = { ...current, id,
      agent_type: metadata.agentType || current.agent_type || "codex",
      hostname: metadata.hostname || current.hostname || "unknown",
      platform: metadata.platform || current.platform || process.platform,
      arch: metadata.arch || current.arch || process.arch,
      version: metadata.version || current.version || "unknown",
      last_seen: now, status: "online",
      sensors: metadata.sensors || current.sensors || [],
      metadata: metadata.metadata || current.metadata || {},
      ws: current.ws || null
    };
    agents.set(id, agent);
    execSQL("INSERT OR REPLACE INTO agents (id, agent_type, hostname, platform, arch, version, last_seen, status, sensors, metadata, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'online', ?, ?, datetime('now'))",
      [agent.id, agent.agent_type, agent.hostname, agent.platform, agent.arch, agent.version, agent.last_seen, JSON.stringify(agent.sensors || []), JSON.stringify(agent.metadata || {})]);
    return agent;
  }

  function ingestEvent(agentId, evt) {
    const eventId = String(evt?.eventId || uuidv4());
    execSQL("INSERT OR IGNORE INTO events (event_id, agent_id, timestamp, category, severity, verdict, summary, detail, mitre_tactic, mitre_technique, session_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [eventId, agentId, evt.timestamp || new Date().toISOString(), evt.category || "system", evt.severity || "info", evt.verdict || "allow", evt.summary || "", JSON.stringify(evt.detail || {}), evt.mitreTactic || null, evt.mitreTechnique || null, evt.sessionId || null]);
    if (evt.verdict === "block") execSQL("INSERT OR IGNORE INTO alerts (id, agent_id, event_id, title, description, severity) VALUES (?, ?, ?, ?, ?, ?)",
      [eventId + ":alert", agentId, eventId, "Blocked: " + (evt.summary || "").slice(0, 100), evt.summary || "", "high"]);
    return eventId;
  }

  function ingestSession(agentId, msg) {
    const now = new Date().toISOString();
    execSQL("INSERT OR REPLACE INTO sessions (id, agent_id, prompt, start_time, metadata) VALUES (?, ?, ?, ?, ?)",
      [msg.sessionId, agentId, (msg.prompt || "").slice(0, 500), msg.timestamp || now, JSON.stringify({ threadId: msg.threadId, submissionId: msg.submissionId, promptHash: msg.promptHash, promptLength: msg.promptLength })]);
    return "session:" + msg.sessionId + ":" + (msg.timestamp || "");
  }

  function ingestTransportMessage(body) {
    const message = body?.message || body || {};
    const agentId = String(body?.agentId || message.agentId || "").trim();
    if (!agentId) return { statusCode: 400, result: { error: "agentId_required" } };
    ensureAgent(agentId, body?.agent || {});
    if (message.type === "event" && message.event) {
      const eventId = ingestEvent(agentId, message.event);
      return { statusCode: 200, result: { ok: true, type: "ack", ackType: "event", eventId } };
    }
    if (message.type === "batch_events" && Array.isArray(message.events)) {
      const eventIds = message.events.map(evt => ingestEvent(agentId, evt));
      return { statusCode: 200, result: { ok: true, type: "ack", ackType: "batch_events", eventIds } };
    }
    if (message.type === "session_start" && message.sessionId) {
      const messageId = ingestSession(agentId, message);
      return { statusCode: 200, result: { ok: true, type: "ack", ackType: "session_start", messageId } };
    }
    if (message.type === "heartbeat") {
      execSQL("UPDATE agents SET last_seen = ?, status = 'online', updated_at = datetime('now') WHERE id = ?", [new Date().toISOString(), agentId]);
      return { statusCode: 200, result: { ok: true, type: "ack", ackType: "heartbeat" } };
    }
    if (message.type === "register") {
      ensureAgent(agentId, message);
      return { statusCode: 200, result: { ok: true, type: "ack", agentId, message: "registered" } };
    }
    return { statusCode: 400, result: { error: "unsupported_transport_message" } };
  }

  async function handleAPI(req, res, url) {
    const pathname = url.pathname;
    let body = null;

    if (req.method === "POST" || req.method === "PUT") {
      body = await readBody(req);
    }

    try {
      let result;

      if (pathname === "/api/v1/enroll" && req.method === "POST") {
        if (!ENROLLMENT_TOKEN) {
          res.writeHead(503, { "Content-Type": "application/json" });
          return res.end(JSON.stringify({ error: "enrollment_not_configured" }));
        }
        if (!body || body.enrollmentToken !== ENROLLMENT_TOKEN) {
          res.writeHead(401, { "Content-Type": "application/json" });
          return res.end(JSON.stringify({ error: "invalid_enrollment_token" }));
        }
        const endpointId = String(body.endpointId || `aidr-${body.hostname || "endpoint"}-${uuidv4().slice(0, 8)}`).replace(/[^A-Za-z0-9_.-]/g, "-");
        const endpointToken = crypto.randomBytes(32).toString("base64url");
        const tokenHash = crypto.createHash("sha256").update(endpointToken, "utf8").digest("hex");
        execSQL("INSERT OR REPLACE INTO endpoint_credentials (agent_id, token_hash, issued_at, revoked_at) VALUES (?, ?, ?, NULL)",
          [endpointId, tokenHash, new Date().toISOString()]);
        ensureAgent(endpointId, body);
        result = { ok: true, endpointId, endpointToken, serverUrl: `http://${req.headers.host}`, issuedAt: new Date().toISOString() };
      }
      else if (pathname === "/console/api/endpoints" && req.method === "GET") {
        result = { endpoints: Array.from(agents.values()).map(agent => ({
          id: agent.id, hostname: agent.hostname, platform: agent.platform, arch: agent.arch,
          version: agent.version, status: agent.status, lastSeen: agent.last_seen
        })) };
      }
      else if (pathname === "/console/api/status" && req.method === "GET") {
        const endpointId = url.searchParams.get("endpoint_id");
        const selected = endpointId ? agents.get(endpointId) : null;
        result = {
          status: selected ? selected.status : "central",
          mode: "central-control-plane",
          endpointId: selected?.id || null,
          endpointCount: agents.size,
          onlineEndpoints: Array.from(agents.values()).filter(agent => agent.status === "online").length,
          platform: selected?.platform || "multi-platform",
          version: selected?.version || "2.4.0"
        };
      }
      else if (pathname === "/console/api/agents" && req.method === "GET") {
        const endpointId = url.searchParams.get("endpoint_id");
        const selected = endpointId ? [agents.get(endpointId)].filter(Boolean) : Array.from(agents.values());
        result = { agents: selected.map(agent => ({
          id: agent.id, label: agent.hostname || agent.id, vendor: "AIDR Endpoint", category: agent.platform,
          status: agent.status, confidence: 100, lastSeenAt: agent.last_seen, platform: agent.platform,
          endpointId: agent.id, sensors: agent.sensors || []
        })) };
      }
      else if (pathname === "/console/api/sessions" && req.method === "GET") {
        const endpointId = url.searchParams.get("endpoint_id");
        const rows = endpointId
          ? queryAll("SELECT * FROM sessions WHERE agent_id = ? ORDER BY start_time DESC LIMIT 100", [endpointId])
          : queryAll("SELECT * FROM sessions ORDER BY start_time DESC LIMIT 100");
        result = { sessions: rows.map(row => ({ ...row, agentId: row.agent_id, timestamp: row.start_time, endpointId: row.agent_id })) };
      }
      else if (/^\/console\/api\/sessions\/[^/]+$/.test(pathname) && req.method === "GET") {
        const sessionId = decodeURIComponent(pathname.split("/").pop());
        const row = queryOne("SELECT * FROM sessions WHERE id = ?", [sessionId]);
        if (!row) {
          res.writeHead(404, { "Content-Type": "application/json" });
          return res.end(JSON.stringify({ error: "session_not_found" }));
        }
        const sessionEvents = queryAll("SELECT * FROM events WHERE session_id = ? ORDER BY timestamp ASC", [sessionId]);
        result = {
          ...row,
          agentId: row.agent_id,
          timestamp: row.start_time,
          endpointId: row.agent_id,
          events: sessionEvents.map(event => ({
            ...event,
            eventId: event.event_id,
            agentId: event.agent_id,
            sessionId: event.session_id
          }))
        };
      }
      else if (/^\/console\/api\/sessions\/[^/]+\/orbit$/.test(pathname) && req.method === "GET") {
        const sessionId = decodeURIComponent(pathname.split("/")[4]);
        const session = queryOne("SELECT * FROM sessions WHERE id = ?", [sessionId]);
        const sessionEvents = queryAll("SELECT * FROM events WHERE session_id = ? ORDER BY timestamp ASC", [sessionId]);
        const policy = activeCentralPolicy();
        const allowed = policy.organizationBoundary.allowedAtoms || [];
        const inferredAtom = event => {
          const text = `${event.category || ""} ${event.summary || ""}`.toLowerCase();
          if (/credential|secret|ssh|token/.test(text)) return "DATA.CREDENTIAL_READ";
          if (/network|http|url|web/.test(text)) return "EXEC.HTTP_CONNECT";
          if (/write|modify|create/.test(text)) return "DATA.DATA_WRITE";
          if (/read|file|document/.test(text)) return "DATA.FILE_READ";
          if (/shell|process|exec/.test(text)) return "EXEC.PROGRAM_EXECUTE";
          return "INTENT.INTERPRET";
        };
        result = {
          sessionId,
          agentId: session?.agent_id || null,
          organizationBoundary: policy.organizationBoundary,
          taskBoundary: { maxLevel: Math.min(2, Number(policy.organizationBoundary.maxLevel || 3)), levels: policy.organizationBoundary.levels || {}, source: "central.session.taskBoundary" },
          predictedPath: allowed.slice(0, 8).map((atomId, index) => ({ atomId, sequence: index + 1, boundaryScope: "within", verdict: "allow" })),
          actualPath: sessionEvents.map((event, index) => ({ atomId: inferredAtom(event), sequence: index + 1, timestamp: event.timestamp, boundaryScope: event.verdict === "block" ? "organization" : "within", verdict: event.verdict })),
          decisionTrace: { steps: [] },
          generatedAt: new Date().toISOString()
        };
      }
      else if (pathname === "/console/api/events" && req.method === "GET") {
        const endpointId = url.searchParams.get("endpoint_id");
        const rows = endpointId
          ? queryAll("SELECT * FROM events WHERE agent_id = ? ORDER BY timestamp DESC LIMIT 500", [endpointId])
          : queryAll("SELECT * FROM events ORDER BY timestamp DESC LIMIT 500");
        result = { events: rows.map(row => ({ ...row, eventId: row.event_id, agentId: row.agent_id, sessionId: row.session_id, endpointId: row.agent_id })) };
      }
      else if (pathname === "/console/api/events/stats" && req.method === "GET") {
        const endpointId = url.searchParams.get("endpoint_id");
        const params = endpointId ? [endpointId] : [];
        const where = endpointId ? " WHERE agent_id = ?" : "";
        result = {
          total: queryOne("SELECT COUNT(*) as c FROM events" + where, params)?.c || 0,
          byVerdict: queryAll("SELECT verdict, COUNT(*) as c FROM events" + where + " GROUP BY verdict", params),
          byCategory: queryAll("SELECT category, COUNT(*) as c FROM events" + where + " GROUP BY category ORDER BY c DESC", params)
        };
      }
      else if (pathname === "/console/api/policy" && req.method === "GET") {
        result = activeCentralPolicy();
      }
      else if (pathname === "/console/api/policy" && req.method === "PUT") {
        result = { ok: true, policy: saveCentralPolicy({ ...activeCentralPolicy(), ...(body || {}) }) };
      }
      else if (pathname === "/console/api/behavior-atoms" && req.method === "GET") {
        const policy = activeCentralPolicy();
        const allowed = new Set(policy.organizationBoundary.allowedAtoms || []);
        const conditional = new Set(policy.organizationBoundary.conditionalAtoms || []);
        const denied = new Set(policy.organizationBoundary.deniedAtoms || []);
        const atomIds = Array.from(new Set((policy.policyRules || []).flatMap(rule => rule.atomIds || []))).sort();
        result = {
          catalog: atomIds.map(id => {
            const domain = id.split(".")[0];
            const scope = denied.has(id) ? "organization" : conditional.has(id) ? "conditional" : "within";
            return { id, domain, description: id, baseLevel: /CREDENTIAL|TRANSFER|REMOTE|PRIVILEGE/.test(id) ? 4 : /CONNECT|WRITE|EXECUTE/.test(id) ? 3 : 1, enabled: scope !== "organization", policyAllowed: scope === "within", authorizationState: scope === "within" ? "allow" : scope === "conditional" ? "conditional" : "deny", organizationBoundary: { scope, reason: denied.has(id) ? "atom_denied_by_policy" : conditional.has(id) ? "atom_requires_approval" : "within", source: policy.organizationBoundary.source } };
          }),
          agents: [], stats: [], occurrences: [], boundary: policy.organizationBoundary,
          mappingQuality: { status: "central_policy_catalog" }
        };
      }
      else if (/^\/console\/api\/behavior-atoms\/[^/]+$/.test(pathname) && req.method === "PUT") {
        const id = decodeURIComponent(pathname.split("/").pop()).toUpperCase();
        const enabled = body?.enabled !== false;
        const policy = activeCentralPolicy();
        const ruleId = `atom-authorization:${id}`;
        const rule = { id: ruleId, name: `${id} authorization`, description: enabled ? "Administrator allows this behavior atom." : "Administrator denies this behavior atom.", enabled: true, priority: 10, authorization: { allow: enabled ? [id] : [], conditional: [], deny: enabled ? [] : [id] }, agentScope: ["*"], atomIds: [id], source: "behavior-atom-grid" };
        const rules = (policy.policyRules || []).filter(item => item.id !== ruleId);
        rules.push(rule);
        const updated = saveCentralPolicy({ ...policy, policyRules: rules });
        result = { ok: true, atom: { id, enabled, policyAllowed: enabled }, policy: updated };
      }
      else if (pathname === "/console/api/semantic/local-config" && req.method === "GET") {
        result = { enabled: false, mode: "endpoint_managed", status: "central_view" };
      }
      else if (pathname === "/console/api/semantic/config" && req.method === "GET") {
        result = { enabled: false, provider: "central-policy", status: "not_configured" };
      }
      else if (pathname === "/console/api/diagnostics/performance" && req.method === "GET") {
        result = { status: "healthy", endpointCount: agents.size, database: "ready" };
      }
      // Agents
      else if (pathname === "/api/v1/agents" && req.method === "GET") {
        result = Array.from(agents.values()).map(a => ({
          id: a.id, agentType: a.agent_type, hostname: a.hostname,
          platform: a.platform, version: a.version, status: a.status,
          lastSeen: a.last_seen, sensors: a.sensors
        }));
      }
      else if (pathname.startsWith("/api/v1/agents/") && pathname.includes("/policy") && req.method === "POST") {
        const parts = pathname.split("/");
        const id = parts[4];
        const agent = agents.get(id);
        if (!agent || !agent.ws) { res.writeHead(404); return res.end(JSON.stringify({ error: "Agent not connected" })); }
        agent.ws.send(JSON.stringify({ type: "policy_update", policy: body }));
        result = { ok: true };
      }
      else if (pathname.startsWith("/api/v1/agents/") && req.method === "GET") {
        const id = pathname.split("/")[4];
        const agent = agents.get(id);
        if (!agent) { res.writeHead(404); return res.end(JSON.stringify({ error: "Agent not found" })); }
        result = agent;
      }

      // Events
      else if (pathname === "/api/v1/events" && req.method === "GET") {
        const limit = parseInt(url.searchParams.get("limit") || "100");
        const offset = parseInt(url.searchParams.get("offset") || "0");
        const agentId = url.searchParams.get("agent_id");
        const sql = agentId
          ? "SELECT * FROM events WHERE agent_id = ? ORDER BY timestamp DESC LIMIT ? OFFSET ?"
          : "SELECT * FROM events ORDER BY timestamp DESC LIMIT ? OFFSET ?";
        const events = queryAll(sql, agentId ? [agentId, limit, offset] : [limit, offset]);
        result = { events, total: events.length };
      }
      else if (pathname === "/api/v1/events/stats" && req.method === "GET") {
        result = {
          total: queryOne("SELECT COUNT(*) as c FROM events")?.c || 0,
          byVerdict: queryAll("SELECT verdict, COUNT(*) as c FROM events GROUP BY verdict"),
          byCategory: queryAll("SELECT category, COUNT(*) as c FROM events GROUP BY category ORDER BY c DESC")
        };
      }
      // Reliable local HTTP ingest fallback for endpoint audit events.
      else if (pathname === "/api/v1/ingest" && req.method === "POST") {
        const candidateAgentId = String(body?.agentId || body?.message?.agentId || "");
        const suppliedToken = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
        if (!endpointTokenValid(candidateAgentId, suppliedToken)) {
          res.writeHead(401, { "Content-Type": "application/json" });
          return res.end(JSON.stringify({ error: "endpoint_authentication_failed" }));
        }
        const accepted = ingestTransportMessage(body || {});
        res.writeHead(accepted.statusCode, { "Content-Type": "application/json" });
        return res.end(JSON.stringify(accepted.result));
      }

      // Sessions
      else if (pathname === "/api/v1/sessions" && req.method === "GET") {
        result = queryAll("SELECT * FROM sessions ORDER BY start_time DESC LIMIT 50");
      }
      else if (pathname === "/api/v1/sessions/start" && req.method === "POST") {
        const sessionId = uuidv4();
        execSQL("INSERT INTO sessions (id, agent_id, prompt, start_time, metadata) VALUES (?, ?, ?, ?, ?)",
          [sessionId, body.agentId, body.prompt, new Date().toISOString(), JSON.stringify(body.metadata || {})]);
        result = { sessionId };
      }

      // Graph
      else if (pathname.startsWith("/api/v1/graph/") && req.method === "GET") {
        const sessionId = pathname.split("/")[4];
        const events = queryAll("SELECT * FROM events WHERE session_id = ? ORDER BY timestamp ASC", [sessionId]);
        result = buildGraphData(events);
      }

      // Policies
      else if (pathname === "/api/v1/policies" && req.method === "GET") {
        result = queryAll("SELECT * FROM policies ORDER BY created_at DESC");
      }
      else if (pathname === "/api/v1/policies" && req.method === "POST") {
        const id = uuidv4();
        execSQL("INSERT INTO policies (id, name, description, config, scope) VALUES (?, ?, ?, ?, ?)",
          [id, body.name, body.description || "", JSON.stringify(body.config || {}), body.scope || "global"]);
        result = { id, ok: true };
      }
      else if (pathname.startsWith("/api/v1/policies/") && req.method === "PUT") {
        const id = pathname.split("/")[4];
        execSQL("UPDATE policies SET name=?, description=?, config=?, updated_at=datetime('now') WHERE id=?",
          [body.name, body.description || "", JSON.stringify(body.config || {}), id]);
        result = { ok: true };
      }
      else if (pathname.startsWith("/api/v1/policies/") && req.method === "DELETE") {
        const id = pathname.split("/")[4];
        execSQL("DELETE FROM policies WHERE id = ?", [id]);
        result = { ok: true };
      }

      // Alerts
      else if (pathname === "/api/v1/alerts" && req.method === "GET") {
        result = queryAll("SELECT * FROM alerts ORDER BY created_at DESC");
      }
      else if (pathname.startsWith("/api/v1/alerts/") && req.method === "PUT") {
        const id = pathname.split("/")[4];
        execSQL("UPDATE alerts SET status=?, resolved_at=datetime('now') WHERE id=?",
          [body.status || "resolved", id]);
        result = { ok: true };
      }

      else {
        res.writeHead(404, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ error: "Not found", path: pathname }));
      }

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(result));
    } catch (e) {
      console.error("API error:", e);
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: e.message }));
    }
  }

  function buildGraphData(events) {
    const nodes = [];
    const edges = [];
    const nodeMap = new Map();
    let nodeIdx = 0;

    function getNodeId(key, label, type, group) {
      if (nodeMap.has(key)) return nodeMap.get(key);
      const id = "n" + (nodeIdx++);
      nodeMap.set(key, id);
      nodes.push({ id, label, type, group });
      return id;
    }

    let prevNode = null;
    for (const evt of events) {
      const nodeId = getNodeId(evt.event_id || "e" + evt.id, (evt.summary || "").slice(0, 40),
        evt.category, evt.verdict === "block" ? "blocked" : evt.verdict === "alert" ? "alerted" : "normal");
      if (prevNode) edges.push({ source: prevNode, target: nodeId });
      prevNode = nodeId;
    }

    return { nodes, edges };
  }

  function readBody(req) {
    return new Promise((resolve, reject) => {
      let data = "";
      req.on("data", chunk => data += chunk);
      req.on("end", () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { resolve(null); }
      });
      req.on("error", reject);
    });
  }

  // WebSocket server
  const wss = new WebSocketServer({ server, path: "/ws/agent", perMessageDeflate: false });

  wss.on("connection", (ws) => {
    let agentId = null;

    ws.on("message", (data) => {
      try {
        const msg = JSON.parse(data.toString());

        switch (msg.type) {
          case "register": {
            agentId = msg.agentId;
            const now = new Date().toISOString();
            agents.set(agentId, {
              id: agentId, agent_type: msg.agentType || "codex", hostname: msg.hostname,
              platform: msg.platform, arch: msg.arch, version: msg.version,
              status: "online", last_seen: now, sensors: msg.sensors || [], metadata: {}, ws
            });
            execSQL(
              `INSERT OR REPLACE INTO agents (id, agent_type, hostname, platform, arch, version, last_seen, status, sensors, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, 'online', ?, datetime('now'))`,
              [agentId, msg.agentType || "codex", msg.hostname, msg.platform, msg.arch, msg.version, now, JSON.stringify(msg.sensors || [])]
            );
            console.log("Agent registered:", agentId, "(" + msg.hostname + ")");
            ws.send(JSON.stringify({ type: "ack", agentId, message: "registered" }));
            break;
          }

          case "heartbeat": {
            if (agentId) {
              const now = new Date().toISOString();
              execSQL("UPDATE agents SET last_seen = ?, updated_at = datetime('now') WHERE id = ?", [now, agentId]);
              const agent = agents.get(agentId);
              if (agent) agent.last_seen = now;
            }
            break;
          }

          case "event": {
            if (agentId && msg.event) {
              const eventId = ingestEvent(agentId, msg.event);
              ws.send(JSON.stringify({ type: "ack", ackType: "event", eventId }));
            }
            break;
          }

          case "batch_events": {
            if (agentId && msg.events) {
              const eventIds = msg.events.map(evt => ingestEvent(agentId, evt));
              ws.send(JSON.stringify({ type: "ack", ackType: "batch_events", eventIds }));
            }
            break;
          }

          case "session_start": {
            if (agentId && msg.sessionId) {

              console.log("Session started: " + (msg.prompt || "").slice(0, 60));
              ws.send(JSON.stringify({ type: "ack", ackType: "session_start", messageId: ingestSession(agentId, msg) }));
            }
            break;
          }
        }
      } catch (e) {
        console.error("WS message error:", e.message);
      }
    });

    ws.on("close", () => {
      if (agentId) {
        const agent = agents.get(agentId);
        if (agent) { agent.status = "offline"; agent.ws = null; }
        execSQL("UPDATE agents SET status = 'offline', updated_at = datetime('now') WHERE id = ?", [agentId]);
        console.log("Agent disconnected:", agentId);
      }
    });
  });

  
  // Dashboard WebSocket for real-time updates
  const dashWss = new WebSocketServer({ server, path: "/ws/dashboard" });
  const dashboardClients = new Set();

  dashWss.on("connection", (dws) => {
    dashboardClients.add(dws);
    dws.on("close", () => dashboardClients.delete(dws));
  });

  // Helper to broadcast to all dashboard clients
  function broadcastDashboard(type, data) {
    const msg = JSON.stringify({ type, ...data });
    for (const client of dashboardClients) {
      try { client.send(msg); } catch (_) {}
    }
  }

server.listen(PORT, HOST, () => {
    const displayHost = HOST === "0.0.0.0" ? "<server-address>" : HOST;
    console.log("AIDR 2.0 Server running at http://" + displayHost + ":" + PORT);
    console.log("WebSocket: ws://" + displayHost + ":" + PORT + "/ws/agent");
    console.log("Dashboard: http://" + displayHost + ":" + PORT + "/console");
  });
});
