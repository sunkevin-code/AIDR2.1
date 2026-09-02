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
const BEHAVIOR_ATOM_CATALOG = require("./behavior-atom-catalog");
const MODEL_STUDIO_BASE = process.env.AIDR_MODEL_STUDIO_URL || "http://127.0.0.1:8100";
const MODEL_STUDIO_DEFAULT_MODEL = process.env.AIDR_MODEL_STUDIO_MODEL || "mmbert-base";

// 离线意图分类桥接：转发到 Model Studio（tinybert_intent.py / mmBERT / TinyBERT + intent_head.pt）
function modelStudioFetch(apiPath, method = "GET", payload = null, timeoutMs = 60000) {
  return new Promise(resolve => {
    let target;
    try { target = new URL(MODEL_STUDIO_BASE); } catch (_) { return resolve({ ok: false, status: 0, data: { error: "model_studio_url_invalid" } }); }
    const data = payload === null || payload === undefined ? null : JSON.stringify(payload);
    const req = http.request({
      hostname: target.hostname,
      port: target.port || (target.protocol === "https:" ? 443 : 80),
      path: apiPath,
      method,
      headers: { "Content-Type": "application/json", ...(data ? { "Content-Length": Buffer.byteLength(data) } : {}) },
      timeout: timeoutMs
    }, res => {
      let chunk = "";
      res.on("data", c => chunk += c);
      res.on("end", () => {
        try { resolve({ ok: res.statusCode < 400, status: res.statusCode, data: JSON.parse(chunk || "{}") }); }
        catch (_) { resolve({ ok: false, status: res.statusCode, data: { error: "model_studio_invalid_json", raw: chunk.slice(0, 200) } }); }
      });
    });
    req.on("error", () => resolve({ ok: false, status: 0, data: { error: "model_studio_unreachable" } }));
    req.on("timeout", () => { req.destroy(); resolve({ ok: false, status: 0, data: { error: "model_studio_timeout" } }); });
    if (data) req.write(data);
    req.end();
  });
}

async function modelStudioModels() {
  const probe = await modelStudioFetch("/api/models");
  if (!probe.ok) return { ok: false, models: [], error: probe.data && probe.data.error || "model_studio_unreachable" };
  return { ok: true, models: Array.isArray(probe.data.models) ? probe.data.models : [] };
}

async function modelStudioOfflineIntent(prompt, modelId) {
  const model = modelId || MODEL_STUDIO_DEFAULT_MODEL;
  const resp = await modelStudioFetch(`/api/models/${encodeURIComponent(model)}/infer`, "POST", { prompt }, 30000);
  if (!resp.ok) return { ok: false, error: resp.data && resp.data.error || "offline_intent_failed" };
  return { ok: true, model, intent: resp.data.intent || resp.data };
}

// tool:operation -> AIDR 行为原子（与 Model Studio policy_mapper atom_mapping 对齐）
const TOOL_OPERATION_TO_ATOMS = {
  "file:read": ["DATA.FILE_READ", "DATA.DOCUMENT_READ", "DATA.SOURCE_CODE_READ", "DATA.CONFIG_READ", "DATA.DATA_READ"],
  "file:write": ["DATA.DATA_WRITE", "DATA.RESOURCE_CREATE", "DATA.DATA_TRANSFORM"],
  "file:delete": ["DATA.RESOURCE_DELETE"],
  "process:execute": ["EXEC.PROGRAM_EXECUTE", "EXEC.SHELL_COMMAND", "EXEC.CODE_EXECUTE", "EXEC.TEST_EXECUTE", "EXEC.BUILD_EXECUTE"],
  "network:connect": ["EXEC.NETWORK_CONNECT", "EXEC.HTTP_CONNECT", "TOOL.API_REQUEST", "EXEC.DNS_QUERY"],
  "network:send": ["EXEC.NETWORK_SEND", "EXEC.MESSAGE_SERVICE_CONNECT", "AGENT.COMMUNICATE", "DATA.DATA_TRANSFER"],
  "db:read": ["DATA.DATABASE_READ", "EXEC.DATABASE_CONNECT"],
  "db:write": ["DATA.DATA_WRITE", "EXEC.DATABASE_CONNECT"],
  "api:read": ["TOOL.API_REQUEST", "EXEC.HTTP_CONNECT", "EXEC.NETWORK_CONNECT"],
  "api:connect": ["TOOL.API_REQUEST", "EXEC.HTTP_CONNECT", "EXEC.NETWORK_CONNECT"],
  "secret:read": ["DATA.CREDENTIAL_READ", "AUTH.CREDENTIAL_DISCOVER"],
  "secret:use": ["AUTH.CREDENTIAL_USE"],
  "system:admin": ["EXEC.SYSTEM_CONFIGURE", "EXEC.SYSTEM_PRIVILEGE_CHANGE", "AUTH.PERMISSION_MODIFY", "EXEC.SERVICE_START", "EXEC.SERVICE_CONTROL"],
  "memory:read": ["MEMORY.MEMORY_READ"],
  "memory:write": ["MEMORY.MEMORY_WRITE", "MEMORY.MEMORY_MODIFY"],
  "model:invoke": ["MODEL.INVOKE", "MODEL.SEND_CONTEXT"]
};

function toolOperationAtoms(tool, operation) {
  return TOOL_OPERATION_TO_ATOMS[`${tool}:${operation}`] || TOOL_OPERATION_TO_ATOMS[`${tool}:read`] || [];
}

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
      trace_id TEXT,
      decision_id TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);
  db.run("CREATE INDEX IF NOT EXISTS idx_events_agent ON events(agent_id, timestamp)");
  db.run("CREATE INDEX IF NOT EXISTS idx_events_time ON events(timestamp)");
  db.run("CREATE INDEX IF NOT EXISTS idx_events_verdict ON events(verdict)");
  const eventColumnResult = db.exec("PRAGMA table_info(events)");
  const eventColumnNames = eventColumnResult[0]?.columns || [];
  const eventColumns = new Set((eventColumnResult[0]?.values || []).map(row => row[eventColumnNames.indexOf("name")]));
  if (!eventColumns.has("trace_id")) db.run("ALTER TABLE events ADD COLUMN trace_id TEXT");
  if (!eventColumns.has("decision_id")) db.run("ALTER TABLE events ADD COLUMN decision_id TEXT");
  db.run("CREATE INDEX IF NOT EXISTS idx_events_decision ON events(decision_id, timestamp)");
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
  try {
    const sessionCols = db.exec("PRAGMA table_info(sessions)");
    const hasPromptHistory = sessionCols[0] && sessionCols[0].values.some(row => row[1] === "prompt_history");
    if (!hasPromptHistory) db.run("ALTER TABLE sessions ADD COLUMN prompt_history TEXT DEFAULT '[]'");
    const hasAgentName = sessionCols[0] && sessionCols[0].values.some(row => row[1] === "agent_name");
    if (!hasAgentName) db.run("ALTER TABLE sessions ADD COLUMN agent_name TEXT");
  } catch (_) {}
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
    // 策略模板 v2.0：语句类型 -> AIDR 行为原子（与 Model Studio policy_mapper DEFAULT_DESIGN 对齐）
    const template = {
      id: "aidr-least-privilege-v2",
      name: "AIDR 最小权限策略模板 v2.0",
      version: "2.0",
      denyByDefault: true,
      maxAllowedLevel: 3,
      requireApprovalHighRisk: true,
      description: "意图 -> tool:operation 语句 -> AIDR 行为原子，Deny by default。",
      statementTypes: [
        { tool: "file", operation: "read", label: "文件读取", approval: false },
        { tool: "file", operation: "write", label: "文件写入", approval: false },
        { tool: "file", operation: "delete", label: "文件删除", approval: true },
        { tool: "process", operation: "execute", label: "进程/命令执行", approval: true },
        { tool: "network", operation: "connect", label: "网络连接", approval: true },
        { tool: "network", operation: "send", label: "网络发送 / 邮件 / 通知", approval: true },
        { tool: "db", operation: "read", label: "数据库读取", approval: false },
        { tool: "db", operation: "write", label: "数据库写入", approval: true },
        { tool: "api", operation: "connect", label: "API 调用", approval: true },
        { tool: "api", operation: "read", label: "API 读取", approval: false },
        { tool: "secret", operation: "read", label: "密钥/凭据读取", approval: true },
        { tool: "secret", operation: "use", label: "密钥/凭据使用", approval: true },
        { tool: "system", operation: "admin", label: "系统管理", approval: true },
        { tool: "memory", operation: "read", label: "记忆读取", approval: false },
        { tool: "memory", operation: "write", label: "记忆写入", approval: false },
        { tool: "model", operation: "invoke", label: "模型调用", approval: false }
      ],
      principles: [
        { id: "P1", name: "默认拒绝（Deny by Default）" },
        { id: "P2", name: "最小权限（Least Privilege）" },
        { id: "P3", name: "动作 × 资源 × 条件" },
        { id: "P4", name: "路径级作用域（Path Scope）" },
        { id: "P5", name: "高风险审批（High-Risk Approval）" },
        { id: "P6", name: "身份绑定（Identity Binding）" },
        { id: "P7", name: "可审计（Auditable）" }
      ],
      benchmark: "AWS IAM / NIST SP 800-207 / OWASP LLM Top 10"
    };
    return {
      version: "central-policy-v1",
      mode: "enforce",
      policyBaseline: { id: "central-baseline", name: "AIDR Organization Baseline", version: "2.0", revision: 1, status: "active", scope: "all-agents" },
      template,
      policyRules: [
        // 文件读取（allow）
        { id: "template-file-read", name: "文件读取", description: "读取文件内容用于分析/处理", enabled: true, priority: 10, action: "allow", agentScope: ["*"], atomIds: ["DATA.FILE_READ", "DATA.DOCUMENT_READ", "DATA.SOURCE_CODE_READ", "DATA.CONFIG_READ", "DATA.DATA_READ"], source: "template-v2" },
        // 文件写入（allow）
        { id: "template-file-write", name: "文件写入", description: "写入/创建/更新文件", enabled: true, priority: 20, action: "allow", agentScope: ["*"], atomIds: ["DATA.DATA_WRITE", "DATA.RESOURCE_CREATE", "DATA.DATA_TRANSFORM"], source: "template-v2" },
        // 文件删除（conditional）
        { id: "template-file-delete", name: "文件删除需审批", description: "删除文件需人工审批", enabled: true, priority: 30, action: "require_approval", agentScope: ["*"], atomIds: ["DATA.RESOURCE_DELETE"], source: "template-v2" },
        // 进程/命令执行（conditional）
        { id: "template-process-execute", name: "进程/命令执行需审批", description: "执行命令/运行脚本/启动进程需审批", enabled: true, priority: 40, action: "require_approval", agentScope: ["*"], atomIds: ["EXEC.PROGRAM_EXECUTE", "EXEC.SHELL_COMMAND", "EXEC.CODE_EXECUTE", "EXEC.TEST_EXECUTE", "EXEC.BUILD_EXECUTE"], source: "template-v2" },
        // 网络连接（conditional）
        { id: "template-network-connect", name: "外部网络连接需审批", description: "访问外部网络/调用远程接口需审批", enabled: true, priority: 50, action: "require_approval", agentScope: ["*"], atomIds: ["EXEC.NETWORK_CONNECT", "EXEC.HTTP_CONNECT", "TOOL.API_REQUEST", "EXEC.DNS_QUERY"], source: "template-v2" },
        // 网络发送（conditional）
        { id: "template-network-send", name: "网络发送/邮件/通知需审批", description: "发送消息/邮件/通知到外部需审批", enabled: true, priority: 60, action: "require_approval", agentScope: ["*"], atomIds: ["EXEC.NETWORK_SEND", "EXEC.MESSAGE_SERVICE_CONNECT", "AGENT.COMMUNICATE", "DATA.DATA_TRANSFER"], source: "template-v2" },
        // 数据库读取（allow）
        { id: "template-db-read", name: "数据库读取", description: "查询/读取数据库", enabled: true, priority: 70, action: "allow", agentScope: ["*"], atomIds: ["DATA.DATABASE_READ", "EXEC.DATABASE_CONNECT"], source: "template-v2" },
        // 数据库写入（conditional）
        { id: "template-db-write", name: "数据库写入需审批", description: "写入/更新数据库需审批", enabled: true, priority: 80, action: "require_approval", agentScope: ["*"], atomIds: ["DATA.DATA_WRITE", "EXEC.DATABASE_CONNECT"], source: "template-v2" },
        // API 调用（conditional）
        { id: "template-api-connect", name: "API 调用需审批", description: "调用内部/外部 API 需审批", enabled: true, priority: 90, action: "require_approval", agentScope: ["*"], atomIds: ["TOOL.API_REQUEST", "EXEC.HTTP_CONNECT", "EXEC.NETWORK_CONNECT"], source: "template-v2" },
        // API 读取（allow）
        { id: "template-api-read", name: "API 读取", description: "读取 API 返回数据", enabled: true, priority: 100, action: "allow", agentScope: ["*"], atomIds: ["TOOL.API_REQUEST", "EXEC.HTTP_CONNECT", "EXEC.NETWORK_CONNECT"], source: "template-v2" },
        // 密钥/凭据读取（conditional）
        { id: "template-secret-read", name: "密钥/凭据读取需审批", description: "访问密钥/凭据/敏感配置需审批", enabled: true, priority: 110, action: "require_approval", agentScope: ["*"], atomIds: ["DATA.CREDENTIAL_READ", "AUTH.CREDENTIAL_DISCOVER"], source: "template-v2" },
        // 密钥/凭据使用（conditional）
        { id: "template-secret-use", name: "密钥/凭据使用需审批", description: "使用密钥/凭据调用服务需审批", enabled: true, priority: 120, action: "require_approval", agentScope: ["*"], atomIds: ["AUTH.CREDENTIAL_USE"], source: "template-v2" },
        // 系统管理（conditional）
        { id: "template-system-admin", name: "系统管理需审批", description: "系统管理/安装/全局配置需审批", enabled: true, priority: 130, action: "require_approval", agentScope: ["*"], atomIds: ["EXEC.SYSTEM_CONFIGURE", "EXEC.SYSTEM_PRIVILEGE_CHANGE", "AUTH.PERMISSION_MODIFY", "EXEC.SERVICE_START", "EXEC.SERVICE_CONTROL"], source: "template-v2" },
        // 记忆读取/写入（allow）
        { id: "template-memory", name: "记忆读写", description: "读取/写入 Agent 会话记忆", enabled: true, priority: 140, action: "allow", agentScope: ["*"], atomIds: ["MEMORY.MEMORY_READ", "MEMORY.MEMORY_WRITE", "MEMORY.MEMORY_MODIFY"], source: "template-v2" },
        // 模型调用（allow）
        { id: "template-model-invoke", name: "模型调用", description: "向模型发送 Prompt、文件或工具结果", enabled: true, priority: 150, action: "allow", agentScope: ["*"], atomIds: ["MODEL.INVOKE", "MODEL.SEND_CONTEXT"], source: "template-v2" },
        // 高危默认拒绝（保留原 baseline）
        { id: "secret-read-deny", name: "Sensitive credential read protection", description: "Block access to credentials and secrets.", enabled: true, priority: 160, action: "block", agentScope: ["*"], atomIds: ["AUTH.CREDENTIAL_DISCOVER", "DATA.CREDENTIAL_READ"], source: "baseline" },
        { id: "external-network-review", name: "External network approval", description: "Require approval for external connections and transfers.", enabled: true, priority: 170, action: "require_approval", agentScope: ["*"], atomIds: ["EXEC.HTTP_CONNECT", "EXEC.REMOTE_ACCESS_CONNECT", "DATA.DATA_TRANSFER"], source: "baseline" },
        { id: "workspace-read", name: "Workspace read", description: "Allow source code and document reads.", enabled: true, priority: 180, action: "allow", agentScope: ["*"], atomIds: ["DATA.SOURCE_CODE_READ", "DATA.DOCUMENT_READ", "DATA.FILE_READ"], source: "baseline" }
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
    // 将完整行为原子目录同步进策略授权视图：未被规则显式治理的原子默认允许（与 agent 端 getOrganizationBoundary 语义一致）
    const catalogIds = new Set(BEHAVIOR_ATOM_CATALOG.map(atom => atom.id));
    for (const id of Object.keys((policy.behaviorAtoms && policy.behaviorAtoms.custom) || {})) catalogIds.add(id);
    for (const id of catalogIds) {
      if (conditional.has(id) || denied.has(id)) continue;
      allowed.add(id);
      if (!decisions.has(id)) {
        const domain = id.split(".")[0] || "OTHER";
        domainStats[domain] ||= { domain, allow: 0, conditional: 0, deny: 0, total: 0 };
        domainStats[domain].allow += 1;
        domainStats[domain].total += 1;
      }
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
    execSQL("INSERT OR IGNORE INTO events (event_id, agent_id, timestamp, category, severity, verdict, summary, detail, mitre_tactic, mitre_technique, session_id, trace_id, decision_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [eventId, agentId, evt.timestamp || new Date().toISOString(), evt.category || "system", evt.severity || "info", evt.verdict || "allow", evt.summary || "", JSON.stringify(evt.detail || {}), evt.mitreTactic || null, evt.mitreTechnique || null, evt.sessionId || null, evt.traceId || evt.detail?.traceId || null, evt.decisionId || evt.detail?.decisionId || null]);
    if (evt.verdict === "block") execSQL("INSERT OR IGNORE INTO alerts (id, agent_id, event_id, title, description, severity) VALUES (?, ?, ?, ?, ?, ?)",
      [eventId + ":alert", agentId, eventId, "Blocked: " + (evt.summary || "").slice(0, 100), evt.summary || "", "high"]);
    return eventId;
  }

  function ingestSession(agentId, msg) {
    const now = new Date().toISOString();
    const sessionId = String(msg.sessionId || "");
    const prompt = (msg.prompt || "").slice(0, 500);
    const agentName = String(msg.agent || msg.agentLabel || "").trim() || null;
    const meta = { threadId: msg.threadId || null, submissionId: msg.submissionId || null, promptHash: msg.promptHash || null, promptLength: msg.promptLength || null, agentLabel: msg.agentLabel || null };
    const existing = queryOne("SELECT id, prompt_history FROM sessions WHERE id = ?", [sessionId]);
    if (existing) {
      let history = [];
      try { history = JSON.parse(existing.prompt_history || "[]"); } catch (_) { history = []; }
      if (prompt) {
        history.push({ prompt, timestamp: msg.timestamp || now, submissionId: msg.submissionId || null });
        if (history.length > 100) history = history.slice(-100);
      }
      execSQL("UPDATE sessions SET prompt = ?, prompt_history = ?, metadata = ?, status = 'active', agent_name = COALESCE(?, agent_name) WHERE id = ?",
        [prompt, JSON.stringify(history), JSON.stringify(meta), agentName, sessionId]);
    } else {
      const history = prompt ? [{ prompt, timestamp: msg.timestamp || now, submissionId: msg.submissionId || null }] : [];
      execSQL("INSERT INTO sessions (id, agent_id, agent_name, prompt, prompt_history, start_time, status, metadata) VALUES (?, ?, ?, ?, ?, ?, 'active', ?)",
        [sessionId, agentId, agentName, prompt, JSON.stringify(history), msg.timestamp || now, JSON.stringify(meta)]);
    }
    return "session:" + sessionId + ":" + (msg.timestamp || "");
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
        // 从各 endpoint 上报的 agent_discovery 事件聚合 AI Agent 发现状态（codex / hermes / opencode / openclaw ...）
        const discoveryRows = queryAll("SELECT detail FROM events WHERE category='agent_discovery' ORDER BY timestamp DESC LIMIT 1000");
        const discovered = new Map();
        for (const row of discoveryRows) {
          let detail = null;
          try { detail = JSON.parse(row.detail || "{}"); } catch (_) {}
          if (!detail) continue;
          const id = String(detail.agentId || "").trim();
          if (!id) continue;
          if (!discovered.has(id)) {
            discovered.set(id, {
              id, agentId: id, vendor: detail.vendor || "AI Agent",
              category: detail.category || "ai-agent", confidence: Number(detail.confidence) || 100,
              signals: Array.isArray(detail.signals) ? detail.signals : [],
              status: "active", lastSeenAt: detail.timestamp || null
            });
          }
        }
        result = {
          status: selected ? selected.status : "central",
          mode: "central-control-plane",
          endpointId: selected?.id || null,
          endpointCount: agents.size,
          onlineEndpoints: Array.from(agents.values()).filter(agent => agent.status === "online").length,
          platform: selected?.platform || "multi-platform",
          version: selected?.version || "2.4.0",
          agentDiscovery: {
            agents: Array.from(discovered.values()),
            catalog: [],
            activeCount: discovered.size,
            configuredCount: discovered.size,
            sources: ["endpoint_agent_discovery"]
          }
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
        result = { sessions: rows.map(row => {
          let promptHistory = [];
          try { promptHistory = JSON.parse(row.prompt_history || "[]"); } catch (_) {}
          return { ...row, agent: row.agent_name || row.agent_id, agentId: row.agent_id, timestamp: row.start_time, endpointId: row.agent_id, promptHistory, promptPreview: row.prompt };
        }) };
      }
      else if (/^\/console\/api\/sessions\/[^/]+$/.test(pathname) && req.method === "GET") {
        const sessionId = decodeURIComponent(pathname.split("/").pop());
        const row = queryOne("SELECT * FROM sessions WHERE id = ?", [sessionId]);
        if (!row) {
          res.writeHead(404, { "Content-Type": "application/json" });
          return res.end(JSON.stringify({ error: "session_not_found" }));
        }
        const sessionEvents = queryAll("SELECT * FROM events WHERE session_id = ? ORDER BY timestamp ASC", [sessionId]);
        let promptHistory = [];
        try { promptHistory = JSON.parse(row.prompt_history || "[]"); } catch (_) {}
        result = {
          ...row,
          agent: row.agent_name || row.agent_id,
          agentId: row.agent_id,
          timestamp: row.start_time,
          endpointId: row.agent_id,
          promptHistory,
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
        const deniedAtoms = new Set(policy.organizationBoundary.deniedAtoms || []);
        const inferredAtom = event => {
          const text = `${event.category || ""} ${event.summary || ""}`.toLowerCase();
          if (/credential|secret|ssh|token/.test(text)) return "DATA.CREDENTIAL_READ";
          if (/network|http|url|web/.test(text)) return "EXEC.HTTP_CONNECT";
          if (/write|modify|create/.test(text)) return "DATA.DATA_WRITE";
          if (/read|file|document/.test(text)) return "DATA.FILE_READ";
          if (/shell|process|exec/.test(text)) return "EXEC.PROGRAM_EXECUTE";
          return "INTENT.INTERPRET";
        };
        // 意图分析：优先使用离线语义模型（Model Studio mmBERT/TinyBERT），失败回退规则推断
        let intentAnalysis = null;
        let semanticPredicted = [];
        if (session && session.prompt) {
          try {
            const semantic = await modelStudioOfflineIntent(String(session.prompt).slice(0, 6000));
            if (semantic.ok && semantic.intent && Array.isArray(semantic.intent.actions)) {
              const mapped = [];
              for (const action of semantic.intent.actions) {
                const candidates = toolOperationAtoms(action.tool, action.operation);
                if (!candidates.length) continue;
                for (const atomId of candidates) {
                  if (deniedAtoms.has(atomId)) continue;
                  if (!mapped.includes(atomId)) mapped.push(atomId);
                }
              }
              semanticPredicted = mapped;
              const topScores = semantic.intent.scores || {};
              const confidence = Object.keys(topScores).length
                ? Math.max(...Object.values(topScores).map(Number)) : 0;
              intentAnalysis = {
                engine: semantic.model || "mmbert",
                source: "offline_model_studio",
                confidence: Number(confidence) || 0,
                scores: topScores,
                actions: semantic.intent.actions,
                notes: semantic.intent.notes || "",
                sensitive: Boolean(semantic.intent.sensitive),
                fallback: false
              };
            }
          } catch (_) { /* keep rule-based fallback */ }
        }
        // 预测行为链：优先取会话实际行为推断的原子（策略允许范围内），不足 8 个用策略允许原子补足
        const predicted = [];
        for (const atomId of semanticPredicted.length ? semanticPredicted : sessionEvents.map(inferredAtom)) {
          if (deniedAtoms.has(atomId)) continue;
          if (!predicted.includes(atomId)) predicted.push(atomId);
        }
        for (const atomId of allowed) {
          if (predicted.length >= 8) break;
          if (!predicted.includes(atomId)) predicted.push(atomId);
        }
        const allowedSet = new Set(allowed);
        const conditionalSet = new Set(policy.organizationBoundary.conditionalAtoms || []);
        const atomLevel = atomId => {
          const atomDef = BEHAVIOR_ATOM_CATALOG.find(atom => atom.id === atomId);
          return Math.max(0, Math.min(5, Number(atomDef && atomDef.baseLevel) ?? 1));
        };
        const predictedPath = predicted.slice(0, 8).map((atomId, index) => ({ atomId, sequence: index + 1, boundaryScope: "within", verdict: "allow", level: atomLevel(atomId) }));
        // 任务边界：基于预测行为链实时推导（每域取预测原子 baseLevel 最大值，受组织边界约束）
        const orgMax = Math.max(0, Math.min(5, Number(policy.organizationBoundary.maxLevel ?? 3)));
        const orgLevels = policy.organizationBoundary.levels || {};
        const taskDomains = ["INTENT", "PLAN", "AGENT", "MODEL", "TOOL", "AUTH", "DATA", "MEMORY", "EXEC"];
        const taskLevels = {};
        let taskMax = 0;
        for (const step of predictedPath) {
          const atomDef = BEHAVIOR_ATOM_CATALOG.find(atom => atom.id === step.atomId);
          const level = Math.max(0, Math.min(5, Number(atomDef && atomDef.baseLevel) ?? 1));
          const domain = String(step.atomId).split(".")[0];
          if (taskDomains.includes(domain)) {
            taskLevels[domain] = Math.max(taskLevels[domain] || 0, level);
            taskMax = Math.max(taskMax, level);
          }
        }
        // 组织边界等级：按各域"策略允许原子"的最外层等级推导（显式配置的等级作为上限），
        // 保证组织边界包住全部允许原子，从而任务边界（预测链包络）不会越出组织边界
        const orgLevelsOverride = {};
        let orgOverrideMax = 0;
        for (const domain of taskDomains) {
          const configured = Number.isFinite(Number(orgLevels[domain])) ? Math.max(0, Math.min(5, Number(orgLevels[domain]))) : null;
          const allowedMax = BEHAVIOR_ATOM_CATALOG
            .filter(atom => atom.domain === domain && allowedSet.has(atom.id))
            .reduce((highest, atom) => Math.max(highest, Number(atom.baseLevel) || 0), 0);
          const level = configured === null ? Math.max(1, allowedMax) : Math.min(configured, Math.max(1, allowedMax));
          orgLevelsOverride[domain] = level;
          orgOverrideMax = Math.max(orgOverrideMax, level);
        }
        const effectiveOrgBoundary = { ...policy.organizationBoundary, levels: orgLevelsOverride, maxLevel: Math.max(orgOverrideMax, orgMax) };
        const taskBoundaryLevels = {};
        if (taskMax === 0) {
          // 预测链为空：任务未约束，任务边界 = 组织边界
          for (const domain of taskDomains) taskBoundaryLevels[domain] = orgLevelsOverride[domain] ?? orgMax;
        } else {
          for (const domain of taskDomains) {
            // 任务边界 = 预测链在该域的最外层原子等级；组织边界已保证 ≥ 预测链，因此预测链必在任务边界内
            taskBoundaryLevels[domain] = Math.max(0, Math.min(5, Math.min(orgLevelsOverride[domain] ?? orgMax, taskLevels[domain] ?? 0)));
          }
        }
        result = {
          sessionId,
          agentId: session?.agent_id || null,
          intentAnalysis,
          organizationBoundary: effectiveOrgBoundary,
          taskBoundary: { maxLevel: Math.max(0, ...Object.values(taskBoundaryLevels).map(Number)), levels: taskBoundaryLevels, source: "central.session.taskBoundary.predicted", predictedAtoms: predictedPath.map(step => step.atomId), allowedAtoms: predictedPath.map(step => step.atomId) },
          predictedPath,
          taskAuthorization: {
            allowedAtoms: predictedPath.filter(step => allowedSet.has(step.atomId)).map(step => step.atomId),
            conditionalAtoms: predictedPath.filter(step => conditionalSet.has(step.atomId)).map(step => step.atomId),
            deniedAtoms: predictedPath.filter(step => deniedAtoms.has(step.atomId)).map(step => step.atomId)
          },
          actualPath: sessionEvents.map((event, index) => {
            const atomId = inferredAtom(event);
            return { atomId, sequence: index + 1, timestamp: event.timestamp, boundaryScope: event.verdict === "block" ? "organization" : "within", verdict: event.verdict, level: atomLevel(atomId) };
          }),
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
        const windowHours = Math.max(1, Math.min(720, Number(url.searchParams.get("windowHours")) || 24));
        const params = endpointId ? [endpointId] : [];
        const where = endpointId ? " WHERE agent_id = ?" : "";
        const windowWhere = endpointId ? " WHERE agent_id = ? AND timestamp > datetime('now', ?)" : " WHERE timestamp > datetime('now', ?)";
        const windowParams = endpointId ? [endpointId, `-${windowHours} hours`] : [`-${windowHours} hours`];
        result = {
          total: queryOne("SELECT COUNT(*) as c FROM events" + where, params)?.c || 0,
          byVerdict: queryAll("SELECT verdict, COUNT(*) as c FROM events" + where + " GROUP BY verdict", params),
          byCategory: queryAll("SELECT category, COUNT(*) as c FROM events" + where + " GROUP BY category ORDER BY c DESC", params),
          windowHours,
          scope: { agentId: endpointId || null, sessionId: null },
          windowTotal: queryOne("SELECT COUNT(*) as c FROM events" + windowWhere, windowParams)?.c || 0,
          byWindowVerdict: queryAll("SELECT verdict, COUNT(*) as c FROM events" + windowWhere + " GROUP BY verdict", windowParams),
          byHourVerdict: queryAll("SELECT strftime('%Y-%m-%dT%H:00:00', timestamp) as hour, verdict, COUNT(*) as c FROM events" + windowWhere + " GROUP BY hour, verdict ORDER BY hour", windowParams)
        };
      }
      else if (pathname === "/console/api/diagnostics/data-quality" && req.method === "GET") {
        const total = queryOne("SELECT COUNT(*) as c FROM events")?.c || 0;
        const withAgent = queryOne("SELECT COUNT(*) as c FROM events WHERE agent_id IS NOT NULL AND agent_id <> ''")?.c || 0;
        const withSession = queryOne("SELECT COUNT(*) as c FROM events WHERE session_id IS NOT NULL AND session_id <> ''")?.c || 0;
        const denominator = Math.max(1, total);
        result = {
          schemaVersion: "aidr-data-quality-v1",
          generatedAt: new Date().toISOString(),
          totalEvents: total,
          identity: {
            agentLinkRate: Number((withAgent / denominator).toFixed(4)),
            sessionLinkRate: Number((withSession / denominator).toFixed(4)),
            processLinkRate: 0,
            taskLinkRate: 0,
            unattributedEvents: Math.max(0, total - withAgent)
          },
          sensors: {},
          stale: total === 0,
          status: total === 0 ? "no_data" : (withAgent / denominator < 0.8 || withSession / denominator < 0.5) ? "degraded" : "healthy"
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
        const ruleAtomIds = new Set((policy.policyRules || []).flatMap(rule => rule.atomIds || []));
        const custom = (policy.behaviorAtoms && policy.behaviorAtoms.custom) || {};
        const disabledSet = new Set((policy.behaviorAtoms && policy.behaviorAtoms.disabled) || []);
        const classifyAtom = (id, fallbackLevel) => {
          const scope = denied.has(id) ? "organization" : conditional.has(id) ? "conditional" : "within";
          const [domain, name] = String(id).toUpperCase().split(".");
          return { id, domain: domain || "OTHER", domainLabel: domain || "OTHER", name: name || id, baseLevel: fallbackLevel, highRisk: false, description: id, enabled: scope !== "organization", policyAllowed: scope === "within", authorizationState: scope === "within" ? "allow" : scope === "conditional" ? "conditional" : "deny", organizationBoundary: { scope, reason: denied.has(id) ? "atom_denied_by_policy" : conditional.has(id) ? "atom_requires_approval" : "within", source: policy.organizationBoundary.source } };
        };
        const catalog = BEHAVIOR_ATOM_CATALOG.map(atom => {
          const scope = denied.has(atom.id) ? "organization" : conditional.has(atom.id) ? "conditional" : "within";
          return Object.assign({}, atom, {
            enabled: scope !== "organization" && !disabledSet.has(atom.id),
            policyAllowed: scope === "within",
            authorizationState: scope === "within" ? "allow" : scope === "conditional" ? "conditional" : "deny",
            organizationBoundary: { scope, reason: denied.has(atom.id) ? "atom_denied_by_policy" : conditional.has(atom.id) ? "atom_requires_approval" : "within", source: policy.organizationBoundary.source }
          });
        });
        for (const [id, value] of Object.entries(custom)) {
          if (catalog.some(item => item.id === id)) continue;
          catalog.push(classifyAtom(id, (value && Number(value.baseLevel)) || 2));
        }
        for (const id of ruleAtomIds) {
          if (catalog.some(item => item.id === id)) continue;
          catalog.push(classifyAtom(id, /CREDENTIAL|TRANSFER|REMOTE|PRIVILEGE/.test(id) ? 4 : /CONNECT|WRITE|EXECUTE/.test(id) ? 3 : 1));
        }
        catalog.sort((a, b) => (a.domain + "." + a.name).localeCompare(b.domain + "." + b.name));
        // 行为命中统计：把控制面事件映射到行为原子（与会话 orbit 的推断逻辑一致），按原子与 Agent 聚合
        const inferAtom = event => {
          const text = `${event.category || ""} ${event.summary || ""}`.toLowerCase();
          if (/credential|secret|ssh|token/.test(text)) return "DATA.CREDENTIAL_READ";
          if (/network|http|url|web/.test(text)) return "EXEC.HTTP_CONNECT";
          if (/write|modify|create/.test(text)) return "DATA.DATA_WRITE";
          if (/read|file|document/.test(text)) return "DATA.FILE_READ";
          if (/shell|process|exec/.test(text)) return "EXEC.PROGRAM_EXECUTE";
          return "INTENT.INTERPRET";
        };
        const eventRows = queryAll("SELECT agent_id, session_id, verdict, category, summary, timestamp FROM events ORDER BY timestamp DESC LIMIT 5000");
        const statsById = new Map();
        const agentById = new Map();
        for (const row of eventRows) {
          const atomId = inferAtom(row);
          const stat = statsById.get(atomId) || { atomId, hits: 0, allow: 0, alert: 0, block: 0, agents: [], sessions: [], outOfOrganization: 0, outOfTask: 0 };
          stat.hits += 1;
          const verdict = String(row.verdict || "allow").toLowerCase();
          if (verdict === "block") stat.block += 1;
          else if (verdict === "alert" || verdict === "hold") stat.alert += 1;
          else stat.allow += 1;
          if (row.agent_id && !stat.agents.includes(row.agent_id)) stat.agents.push(row.agent_id);
          if (row.session_id && !stat.sessions.includes(row.session_id)) stat.sessions.push(row.session_id);
          if (verdict === "block") stat.outOfOrganization += 1;
          statsById.set(atomId, stat);
          const agentId = String(row.agent_id || "unknown");
          let agent = agentById.get(agentId);
          if (!agent) { agent = { agentId, atoms: {}, total: 0, outOfOrganization: 0, outOfTask: 0, path: [] }; agentById.set(agentId, agent); }
          agent.total += 1;
          agent.atoms[atomId] = (agent.atoms[atomId] || 0) + 1;
          if (verdict === "block") agent.outOfOrganization += 1;
          if (agent.path.length < 200) agent.path.push({ atomId, sequence: agent.path.length + 1, timestamp: row.timestamp });
        }
        const qualityTotal = eventRows.length;
        const qualityWithAgent = eventRows.filter(row => row.agent_id).length;
        const qualityWithSession = eventRows.filter(row => row.session_id).length;
        const qualityDenominator = Math.max(1, qualityTotal);
        result = {
          catalog,
          agents: Array.from(agentById.values()).map(agent => Object.assign({}, agent, { atomHits: Object.values(agent.atoms).reduce((a, b) => a + b, 0) })),
          stats: Array.from(statsById.values()),
          occurrences: [],
          windowHours: 24,
          boundary: policy.organizationBoundary,
          dataQuality: {
            status: qualityTotal === 0 ? "no_data" : (qualityWithAgent / qualityDenominator < 0.8 || qualityWithSession / qualityDenominator < 0.5) ? "degraded" : "healthy",
            identity: {
              agentLinkRate: Number((qualityWithAgent / qualityDenominator).toFixed(4)),
              sessionLinkRate: Number((qualityWithSession / qualityDenominator).toFixed(4)),
              processLinkRate: 0,
              taskLinkRate: 0
            },
            stale: qualityTotal === 0
          },
          mappingQuality: { status: "central_policy_catalog" }
        };
      }
      else if (pathname === "/console/api/behavior-atoms" && req.method === "POST") {
        const id = String((body && body.id) || "").trim().toUpperCase();
        if (!/^[A-Z][A-Z0-9_-]*\.[A-Z][A-Z0-9_-]*$/.test(id)) {
          res.writeHead(400, { "Content-Type": "application/json" });
          return res.end(JSON.stringify({ error: "behavior_atom_id_invalid" }));
        }
        const policy = activeCentralPolicy();
        policy.behaviorAtoms = {
          ...(policy.behaviorAtoms || {}),
          custom: { ...((policy.behaviorAtoms && policy.behaviorAtoms.custom) || {}), [id]: { description: String((body && body.description) || "自定义行为原子"), baseLevel: Math.max(0, Math.min(5, Number((body && body.baseLevel) ?? 2))), system: false } }
        };
        const updated = saveCentralPolicy(policy);
        result = { ok: true, atom: { id, enabled: true, policyAllowed: !(updated.organizationBoundary.deniedAtoms || []).includes(id) }, policy: updated };
      }
      else if (/^\/console\/api\/behavior-atoms\/[^/]+$/.test(pathname) && req.method === "DELETE") {
        const id = decodeURIComponent(pathname.split("/").pop()).toUpperCase();
        const policy = activeCentralPolicy();
        const isSystem = BEHAVIOR_ATOM_CATALOG.some(atom => atom.id === id);
        const behaviorAtoms = policy.behaviorAtoms || {};
        const custom = { ...(behaviorAtoms.custom || {}) };
        delete custom[id];
        const disabled = Array.from(new Set([...(behaviorAtoms.disabled || []), ...(isSystem ? [id] : [])]));
        policy.behaviorAtoms = { ...behaviorAtoms, custom, disabled };
        const updated = saveCentralPolicy(policy);
        result = { ok: true, atom: { id, enabled: false, policyAllowed: false }, policy: updated };
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
        const reg = await modelStudioModels();
        result = {
          enabled: reg.ok,
          mode: "offline_model_studio",
          status: reg.ok ? "ready" : "unreachable",
          provider: "model-studio",
          endpoint: MODEL_STUDIO_BASE,
          defaultModel: reg.models.find(m => m.selected)?.id || reg.models[0]?.id || null,
          models: reg.ok ? reg.models.map(m => ({ id: m.id, name: m.name, kind: m.kind, engine: m.engine, available: m.available, selected: m.selected, description: m.description })) : [],
          error: reg.ok ? null : reg.error
        };
      }
      else if (pathname === "/console/api/semantic/config" && req.method === "GET") {
        const reg = await modelStudioModels();
        result = {
          enabled: reg.ok,
          provider: "model-studio-offline",
          status: reg.ok ? "ready" : "not_configured",
          endpoint: MODEL_STUDIO_BASE,
          defaultModel: reg.models.find(m => m.selected)?.id || reg.models[0]?.id || MODEL_STUDIO_DEFAULT_MODEL,
          modelCount: reg.models.length,
          availableCount: reg.models.filter(m => m.available).length,
          error: reg.ok ? null : reg.error
        };
      }
      else if (pathname === "/console/api/semantic/models" && req.method === "GET") {
        const reg = await modelStudioModels();
        // 附加主机 CPU/内存实测信息（Model Studio /api/system）
        let system = null;
        if (reg.ok) {
          const sysResp = await modelStudioFetch("/api/system");
          if (sysResp.ok) system = sysResp.data;
        }
        result = { ok: reg.ok, models: reg.models, system, error: reg.error || null };
      }
      else if (pathname === "/console/api/semantic/models" && req.method === "POST") {
        const resp = await modelStudioFetch("/api/models/select", "POST", { model_id: body && body.model_id });
        result = resp.ok ? resp.data : { ok: false, error: resp.data && resp.data.error || "model_studio_select_failed" };
      }
      else if (pathname === "/console/api/semantic/models/select" && req.method === "POST") {
        const resp = await modelStudioFetch("/api/models/select", "POST", { model_id: body && body.model_id });
        result = resp.ok ? resp.data : { ok: false, error: resp.data && resp.data.error || "model_studio_select_failed" };
      }
      else if (pathname === "/console/api/semantic/models/load" && req.method === "POST") {
        const resp = await modelStudioFetch(`/api/models/${encodeURIComponent(body && body.model_id || MODEL_STUDIO_DEFAULT_MODEL)}/load`, "POST", {});
        result = resp.ok ? resp.data : { ok: false, error: resp.data && resp.data.error || "model_studio_load_failed" };
      }
      else if (pathname === "/console/api/semantic/infer" && req.method === "POST") {
        if (!body || !String(body.prompt || "").trim()) {
          res.writeHead(400, { "Content-Type": "application/json" });
          return res.end(JSON.stringify({ error: "prompt_required" }));
        }
        const resp = await modelStudioFetch(`/api/models/${encodeURIComponent(body.model_id || MODEL_STUDIO_DEFAULT_MODEL)}/infer`, "POST", { prompt: body.prompt }, 30000);
        if (!resp.ok) {
          res.writeHead(502, { "Content-Type": "application/json" });
          return res.end(JSON.stringify({ error: resp.data && resp.data.error || "offline_intent_failed", detail: resp.data }));
        }
        result = { ok: true, model: body.model_id || MODEL_STUDIO_DEFAULT_MODEL, intent: resp.data.intent || resp.data };
      }
      else if (pathname === "/console/api/semantic/simulate" && req.method === "POST") {
        if (!body || !String(body.prompt || "").trim()) {
          res.writeHead(400, { "Content-Type": "application/json" });
          return res.end(JSON.stringify({ error: "prompt_required" }));
        }
        const resp = await modelStudioFetch("/api/simulate", "POST", {
          prompt: body.prompt,
          model_id: body.model_id || null,
          format: body.format || "aidr"
        }, 30000);
        if (!resp.ok) {
          res.writeHead(502, { "Content-Type": "application/json" });
          return res.end(JSON.stringify({ error: resp.data && resp.data.error || "simulate_failed", detail: resp.data }));
        }
        result = { ok: true, ...resp.data };
      }
      else if (pathname === "/console/api/semantic/template" && req.method === "GET") {
        const resp = await modelStudioFetch("/api/template");
        result = resp.ok ? resp.data : { ok: false, error: resp.data && resp.data.error || "template_unavailable" };
      }
      else if (pathname === "/console/api/semantic/template" && req.method === "POST") {
        const resp = await modelStudioFetch("/api/template", "POST", { design: body && body.design || {} });
        result = resp.ok ? resp.data : { ok: false, error: resp.data && resp.data.error || "template_save_failed" };
      }
      else if (pathname === "/console/api/semantic/atoms" && req.method === "GET") {
        const resp = await modelStudioFetch("/api/atoms");
        result = resp.ok ? resp.data : { ok: false, error: resp.data && resp.data.error || "atoms_unavailable" };
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
