(function () {
  "use strict";

  var state = { agents: [], sessions: [], events: [], status: {}, policy: {}, behaviorAtoms: { catalog: [], agents: [], stats: [] } };
  var abgSelectedAgent = "";
  var abgSessionMode = "permission";
  var abgSessionData = null;
  var abgViewport = { x: 0, y: 0, scale: 1 };
  var abgPlaybackTimer = null;
  var abgPlaybackIndex = 0;
  var abgBehaviorPlaybackTimer = null;
  var abgBehaviorPlaybackIndex = null;
  var abgMotionEnabled = true;
  var refreshInFlight = null;

  function ensureAbgStyles() {
    if (!document.getElementById("aidr-abg-runtime-style")) {
      var style = document.createElement("style");
      style.id = "aidr-abg-runtime-style";
      style.textContent = ".abg-orbit-box{position:relative;min-height:360px;overflow:hidden;background:radial-gradient(circle at 50% 50%,#f8fcfc 0,#f4f8f9 54%,#edf3f5 100%)}.abg-orbit-box svg{display:block;width:100%;height:100%;min-height:360px;touch-action:none;cursor:grab}.abg-orbit-box svg:active{cursor:grabbing}.abg-orbit-box:fullscreen{background:#071018;padding:18px}.abg-orbit-box:fullscreen svg{height:calc(100vh - 36px);min-height:0}.abg-orbit-box .abg-node{cursor:pointer;transition:filter .15s,stroke-width .15s}.abg-orbit-box .abg-node:hover,.abg-orbit-box .abg-node.selected{stroke:#173045;stroke-width:3;filter:drop-shadow(0 0 3px rgba(23,48,69,.35))}.abg-orbit-box .abg-node-label{pointer-events:none}.abg-node-detail{margin-top:10px;border:1px solid #cde2e6;border-radius:6px;background:#f8fbfc;padding:10px;font-size:11px;line-height:1.55}.abg-node-detail b{color:#173045}.abg-replay{display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin:8px 0}.abg-replay input{flex:1;min-width:120px;accent-color:#147f73}.abg-fullscreen{position:absolute;right:10px;top:10px;z-index:2}.abg-space-legend{display:flex;gap:12px;flex-wrap:wrap;margin-top:8px;font-size:11px;color:#687587}.abg-space-legend span{display:inline-flex;align-items:center;gap:5px}.abg-space-legend i{display:inline-block;width:18px;height:3px;border-radius:2px}.abg-ring{fill:none;stroke:#c9d8de;stroke-width:1}.abg-axis{stroke:#d5e1e5;stroke-width:1;stroke-dasharray:3 5}.abg-label{fill:#4c6474;font-size:10px;font-weight:600}.abg-level-label{fill:#78909e;font-size:10px}.abg-boundary{fill:rgba(20,127,115,.08);stroke:#147f73;stroke-width:2;stroke-dasharray:7 5}.abg-task-boundary{fill:rgba(194,118,0,.07);stroke:#c27600;stroke-width:2;stroke-dasharray:4 4}.abg-node.organization{fill:#b42318}.abg-node.task{fill:#c27600}.abg-node.within{fill:#147f73}.abg-node.predicted{fill:#718493}.abg-node.request{fill:#a35b00}.abg-node.current{animation:abgPulse 1.1s ease-out infinite}.abg-node-label{fill:#173045;font-size:9px}.abg-path{fill:none;stroke:#147f73;stroke-width:2.6;stroke-linecap:round;stroke-linejoin:round;stroke-dasharray:9 6;animation:abgFlow 1.15s linear infinite}.abg-request{fill:none;stroke:#a35b00;stroke-width:2.2;stroke-linecap:round;stroke-linejoin:round;stroke-dasharray:4 6;animation:abgFlow 1.25s linear infinite}.abg-predicted{fill:none;stroke:#718493;stroke-width:2;stroke-dasharray:7 7;animation:abgFlow 1.6s linear infinite}.abg-risk-boundary{fill:none;stroke:#b42318;stroke-width:2.8;stroke-linecap:round;stroke-linejoin:round;stroke-dasharray:9 5;animation:abgFlow .9s linear infinite}.abg-flow-particle{fill:#147f73;filter:drop-shadow(0 0 4px rgba(20,127,115,.65))}.abg-flow-particle.risk{fill:#b42318;filter:drop-shadow(0 0 5px rgba(180,35,24,.7))}.abg-flow-particle.request{fill:#a35b00;filter:drop-shadow(0 0 5px rgba(163,91,0,.7))}.abg-boundary-config{border:1px solid #cde2e6;border-radius:7px;background:#f8fbfc;padding:12px;margin-bottom:14px}.abg-boundary-config>div:first-child{display:flex;justify-content:space-between;gap:12px;align-items:flex-start}.abg-boundary-config p{margin:3px 0 0}.abg-boundary-levels{display:grid;grid-template-columns:repeat(9,minmax(60px,1fr));gap:7px;margin-top:10px}.abg-boundary-levels label{display:grid;gap:4px;font-size:10px;color:#687587}.abg-boundary-levels input{width:100%;height:30px;border:1px solid #bfd0d8;border-radius:5px;padding:4px 6px;background:#fff}.abg-boundary-actions{display:flex;justify-content:space-between;align-items:center;gap:10px;margin-top:10px}.abg-trace-strip{font-size:9px}.abg-trace-strip rect{fill:#fff;stroke:#b9cbd2;stroke-width:1}.abg-trace-strip .trace-index{fill:#147f73;font-weight:700}.abg-trace-strip .trace-name{fill:#173045;font-weight:700}.abg-trace-strip .trace-source{fill:#687587}@keyframes abgFlow{to{stroke-dashoffset:-30}}@keyframes abgPulse{0%{stroke-width:2;opacity:1}100%{stroke-width:9;opacity:.15}}";
      style.textContent += ".abg-intent-evidence{border:1px solid #cde2e6;border-radius:7px;background:#f8fbfc;padding:10px;margin-bottom:10px}.abg-intent-evidence-head{display:flex;justify-content:space-between;gap:10px;align-items:center;margin-bottom:7px}.abg-intent-evidence-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:7px}.abg-intent-evidence-item{border:1px solid #d8e5e8;border-radius:5px;background:#fff;padding:7px;min-width:0}.abg-intent-evidence-item b{display:block;color:#526879;font-size:10px;font-weight:600;margin-bottom:2px}.abg-intent-evidence-item span{display:block;overflow-wrap:anywhere;font-size:12px;color:#173045}.abg-intent-evidence-chips{display:flex;gap:5px;flex-wrap:wrap;margin-top:7px}.abg-intent-evidence-chip{border:1px solid #c6dadd;border-radius:4px;background:#fff;padding:3px 6px;font-size:10px;color:#315565}@media(max-width:800px){.abg-intent-evidence-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}";
      style.textContent += ".session-layout{grid-template-columns:285px minmax(0,1fr) 340px}.evidence{align-self:start;min-width:0}.prompt-history-side{margin-top:14px;padding-top:14px;border-top:1px solid #dce7eb}.prompt-history-side .panel-head{padding:0 0 10px}.prompt-history-side .panel-body{padding:4px 0 0;max-height:430px;overflow:auto}.prompt-history-side .trace-row{grid-template-columns:24px 48px minmax(0,1fr) auto;gap:6px;padding:9px 0}.prompt-history-side .trace-kind{white-space:nowrap;font-size:10px}.prompt-history-side .trace-detail{min-width:0}.prompt-history-side .trace-detail>span:first-child{display:block;overflow-wrap:anywhere}.abg-orbit-box{min-height:410px}.abg-orbit-box svg{min-height:410px}.abg-node-label{paint-order:stroke;stroke:#fbfdfd;stroke-width:3px;stroke-linejoin:round}.abg-node.organization .abg-node-label{stroke:#fff7f6}@media(max-width:1180px){.session-layout{grid-template-columns:250px minmax(0,1fr)}.evidence{grid-column:1/-1}}@media(max-width:780px){.session-layout{grid-template-columns:1fr}.evidence{grid-column:auto}.prompt-history-side .panel-body{max-height:none}.abg-orbit-box{min-height:360px}.abg-orbit-box svg{min-height:360px}}";
      style.textContent += ".abg-sector-fill{stroke:none;pointer-events:none}.abg-sector-fill.alt{fill:rgba(20,127,115,.045)}.abg-sector-fill:not(.alt){fill:rgba(82,113,132,.022)}.abg-sector-edge{stroke:#a9bdc6;stroke-width:1.35;stroke-dasharray:4 4;vector-effect:non-scaling-stroke}.abg-orbit-box .abg-axis{stroke:#c4d4da;stroke-width:1;stroke-dasharray:none}.abg-orbit-box .abg-label{paint-order:stroke;stroke:#fbfdfd;stroke-width:4px;stroke-linejoin:round}";
      style.textContent += ".abg-orbit-box .abg-boundary{fill:rgba(230,93,164,.10);stroke:#e65da4;stroke-width:2.5}.abg-orbit-box .abg-task-boundary{fill:rgba(255,138,30,.13);stroke:#ff8a1e;stroke-width:2.5}.abg-domain-label rect{fill:rgba(255,255,255,.88);stroke:#c9d8de;stroke-width:1}.abg-domain-label .abg-label{font-size:10px}.abg-actual-path{fill:none;stroke:#2f8be6;stroke-width:3;stroke-linecap:round;stroke-linejoin:round}.abg-node.actual{fill:#2f8be6;stroke:#fff;stroke-width:2}.abg-block-gate circle{fill:#fff0ef;stroke:#b42318;stroke-width:2.5}.abg-block-gate path{stroke:#b42318;stroke-width:2.5;stroke-linecap:round}.abg-block-gate text{fill:#b42318;font-size:9px;font-weight:700;paint-order:stroke;stroke:#fff;stroke-width:3px}.abg-task-gate circle{fill:#fff5df;stroke:#c27600;stroke-width:2.5}.abg-task-gate path{stroke:#c27600;stroke-width:2.5;stroke-linecap:round}.abg-task-gate text{fill:#a35b00;font-size:9px;font-weight:700;paint-order:stroke;stroke:#fff;stroke-width:3px}.abg-node.aggregate{stroke-width:2.2}.abg-node.aggregate.within{fill:#6f8792}.abg-node.aggregate.task{fill:#c27600}.abg-node.aggregate.organization{fill:#b42318}";
      document.head.appendChild(style);
    }
    if (!document.getElementById("aidr-abg-motion-style")) {
      var motionStyle = document.createElement("style");
      motionStyle.id = "aidr-abg-motion-style";
      motionStyle.textContent = ".abg-motion-off .abg-path,.abg-motion-off .abg-request,.abg-motion-off .abg-predicted,.abg-motion-off .abg-risk-boundary,.abg-motion-off .abg-flow-particle{animation:none!important}.abg-motion-off .abg-flow-particle{display:none!important}.abg-motion-toggle{min-width:86px}";
      document.head.appendChild(motionStyle);
    }
    if (window.__aidrAbgDetailListener) return;
    window.__aidrAbgDetailListener = true;
    window.addEventListener("aidr-abg-node-selected", function (event) {
      var item = event.detail || {};
      document.querySelectorAll(".abg-node-detail").forEach(function (detail) {
        detail.innerHTML = "<b>行为原子</b> " + escapeHtml(item.atomId || "未归属") + " · <b>状态</b> " + escapeHtml(item.verdict || item.state || "unknown") + "<br><b>边界</b> " + escapeHtml(eventBoundaryLabel(item) || item.boundaryScope || "未知") + " · <b>时间</b> " + escapeHtml(formatTime(item.timestamp) || "-") + (item.eventId ? "<br><b>事件</b> " + escapeHtml(item.eventId) : "");
      });
    });
    document.addEventListener("click", function (event) {
      var motionButton = event.target.closest && event.target.closest("[data-abg-motion-toggle]");
      if (motionButton) {
        abgMotionEnabled = !abgMotionEnabled;
        document.querySelectorAll("[data-abg-motion-toggle]").forEach(function (item) { item.textContent = abgMotionEnabled ? "\u52a8\u6001\uff1a\u5f00" : "\u52a8\u6001\uff1a\u5173"; item.setAttribute("aria-pressed", String(abgMotionEnabled)); });
        document.querySelectorAll("#abgBehaviorSvg,#abgSessionSvg,#abgPolicySvg").forEach(function (svg) { svg.classList.toggle("abg-motion-off", !abgMotionEnabled); });
        return;
      }
      var button = event.target.closest && event.target.closest("[data-abg-fullscreen]");
      if (!button) return;
      var target = button.closest(".abg-orbit-box") || document.querySelector(button.getAttribute("data-abg-fullscreen"));
      if (target && target.requestFullscreen) target.requestFullscreen().catch(function () {});
    });
  }
  var labels = {
    "openai-codex": "OpenAI Codex",
    opencode: "OpenCode",
    hermes: "Hermes (AI 助手)",
    cursor: "Cursor"
  };
  var tokenMeta = document.querySelector('meta[name="aidr-ui-token"]');
  var uiToken = tokenMeta ? tokenMeta.getAttribute("content") : "";

  function api(path, options) {
    var config = options || {};
    var headers = Object.assign({ Accept: "application/json" }, config.headers || {});
    if (uiToken && uiToken !== "__AIDR_UI_TOKEN__") headers["x-aidr-ui-token"] = uiToken;
    return fetch(path, Object.assign({}, config, { headers: headers, cache: "no-store" }))
      .then(function (response) {
        if (!response.ok) throw new Error("HTTP " + response.status);
        return response.json();
      });
  }

  function text(selector, value, root) {
    var element = (root || document).querySelector(selector);
    if (element && value !== undefined && value !== null) element.textContent = String(value);
    return element;
  }

  function agentName(id) {
    return labels[id] || String(id || "未归属 Agent");
  }

  function eventAgentId(event) {
    return event && (event.agent_id || event.agentId || event.agent || event.detail && (event.detail.agentId || event.detail.agent)) || "";
  }

  function eventBoundaryLabel(event) {
    var scope = event && (event.boundaryScope || event.boundary_scope || event.detail && (event.detail.boundaryScope || event.detail.boundary_scope));
    return scope === "organization" ? "组织边界外" : scope === "task" ? "任务边界外" : scope === "within" ? "边界内" : "";
  }

  function verdictClass(verdict) {
    var value = String(verdict || "").toLowerCase();
    if (value === "block") return "block";
    if (value === "alert" || value === "hold") return "hold";
    return "allow";
  }

  function badge(value, className) {
    return '<span class="badge ' + (className || verdictClass(value)) + '">' + escapeHtml(value || "UNKNOWN") + "</span>";
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function formatTime(value) {
    if (!value) return "-";
    var date = new Date(value);
    if (isNaN(date.getTime())) return String(value);
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  }

  function setMetric(page, index, value, foot, footClass) {
    var metric = document.querySelectorAll("#page-" + page + " .metric")[index];
    if (!metric) return;
    var valueElement = metric.querySelector(".metric-value");
    var footElement = metric.querySelector(".metric-foot");
    if (valueElement) valueElement.textContent = value;
    if (footElement && foot !== undefined) {
      footElement.textContent = foot;
      footElement.className = "metric-foot " + (footClass || "");
    }
  }

  function renderOverview() {
    var status = state.status || {};
    var stats = status.stats || {};
    var discovery = status.agentDiscovery || {};
    var activeAgents = discovery.activeCount || state.agents.filter(function (agent) { return agent.status === "active"; }).length;
    var totalEvents = state.eventStats && state.eventStats.total || state.events.length;
    var blocks = stats.block || 0;
    var alerts = stats.alert || 0;
    setMetric("overview", 0, activeAgents, "实时发现与进程心跳", "up");
    setMetric("overview", 1, totalEvents, "已关联 Session 和 Trace", "up");
    setMetric("overview", 2, blocks + alerts, "阻断 " + blocks + " · 告警 " + alerts, blocks ? "bad" : "up");
    setMetric("overview", 3, state.policy && state.policy.policyVerification && state.policy.policyVerification.valid ? "100%" : "待验证", "规则、模型和基线策略", "up");
    text("#page-overview .sidebar-foot", "");
    var top = document.querySelector("#page-overview .panel-head h2");
    if (top) top.textContent = "Agent 行为风险姿态";
  }

  function renderAgents() {
    var table = document.getElementById("agentTable");
    if (!table) return;
    var agents = state.agents.length ? state.agents : [];
    table.innerHTML = agents.map(function (agent) {
      var risk = agent.status === "active" ? "Low" : "Medium";
      var cls = risk === "Low" ? "allow" : "hold";
      var signal = (agent.signals || []).join(" / ") || (agent.configPaths || []).join(" / ") || "Endpoint discovery";
      var process = (agent.processes || [])[0];
      var path = process && process.name ? process.name : signal;
      return '<tr class="agent-click" data-agent-id="' + escapeHtml(agent.id) + '">' +
        '<td><div class="entity"><div class="entity-mark">' + escapeHtml((agentName(agent.id).match(/[A-Z]/g) || ["A"])[0]) + '</div><div><div class="entity-name">' + escapeHtml(agentName(agent.id)) + '</div><div class="entity-sub">' + escapeHtml(path) + '</div></div></div></td>' +
        '<td>' + badge(agent.status === "active" ? "在线" : "已配置", cls) + '</td>' +
        '<td>' + escapeHtml(agent.vendor || agent.category || "Agent") + '</td>' +
        '<td>' + escapeHtml(signal) + '</td>' +
        '<td><div class="progress"><i class="' + (cls === "hold" ? "amber" : "") + '" style="width:' + (agent.status === "active" ? 96 : 72) + '%"></i></div></td>' +
        '<td>' + badge(risk, cls) + '</td>' +
        '<td>' + escapeHtml(agent.lastSeenAt ? formatTime(agent.lastSeenAt) : "-") + '</td>' +
        '</tr>';
    }).join("") || '<tr><td colspan="7" class="empty">暂未发现 AI Agent</td></tr>';
    var count = document.querySelectorAll("#page-agents .metric-value")[0];
    if (count) count.textContent = String(agents.length);
    var statusLabel = document.getElementById("scanStatus");
    if (statusLabel) statusLabel.textContent = "上次扫描：刚刚 · " + agents.length + " 个 Agent";
    table.querySelectorAll(".agent-click").forEach(function (row) {
      row.addEventListener("click", function () {
        table.querySelectorAll(".agent-click").forEach(function (item) { item.classList.remove("active"); });
        row.classList.add("active");
      });
    });
  }

  function renderSessions() {
    movePromptHistoryToEvidence();
    var list = document.getElementById("sessionList");
    if (!list) { renderAbgBehavior(); return; }
    var sessions = state.sessions || [];
    list.innerHTML = sessions.slice(0, 40).map(function (session, index) {
      var risk = String(session.riskLevel || session.verdict || "low").toLowerCase();
      var riskLabel = risk === "high" || risk === "critical" || risk === "block" ? "High" : risk === "medium" || risk === "alert" ? "Medium" : "Low";
      var riskClass = riskLabel === "High" ? "block" : riskLabel === "Medium" ? "hold" : "allow";
      return '<div class="session-item ' + (index === 0 ? "active" : "") + '" data-live-session="' + escapeHtml(session.id) + '"><h3>' + escapeHtml(session.promptPreview || session.prompt || "未提供 Prompt") + '</h3><div class="session-meta"><span>' + escapeHtml(agentName(session.agent)) + '</span><span>' + escapeHtml(session.traceSequence || session.nodes || "0") + ' nodes</span>' + badge(riskLabel, riskClass) + '</div></div>';
    }).join("") || '<div class="empty">暂无匹配会话</div>';
    list.querySelectorAll("[data-live-session]").forEach(function (row) {
      row.addEventListener("click", function () {
        list.querySelectorAll(".session-item").forEach(function (item) { item.classList.remove("active"); });
        row.classList.add("active");
        var selected = sessions.filter(function (session) { return String(session.id) === row.getAttribute("data-live-session"); })[0];
        if (selected) loadSessionDetail(selected);
      });
    });
    var counter = document.querySelector("#page-sessions .panel-head h2 .muted");
    if (counter) counter.textContent = sessions.length + " / " + sessions.length;
    if (sessions[0]) loadSessionDetail(sessions[0]);
  }

  function loadSessionDetail(session) {
    if (!session || !session.id) return;
    api("/api/sessions/" + encodeURIComponent(session.id)).then(function (fullSession) {
      renderSessionDetail(fullSession);
    }).catch(function () {
      renderSessionDetail(session);
    });
  }

  function movePromptHistoryToEvidence() {
    var page = document.getElementById("page-sessions");
    if (!page) return;
    var evidence = page.querySelector(".evidence");
    if (!evidence || evidence.querySelector(".prompt-history-side")) return;
    var heading = Array.prototype.slice.call(page.querySelectorAll(".panel-head h2")).filter(function (item) {
      return String(item.textContent || "").indexOf("Prompt") >= 0;
    })[0];
    var panel = heading && heading.closest(".panel");
    if (!panel) return;
    panel.classList.remove("panel");
    panel.classList.add("prompt-history-side");
    panel.setAttribute("data-prompt-history-side", "1");
    evidence.appendChild(panel);
  }

  function renderPromptHistory(session) {
    movePromptHistoryToEvidence();
    var panel = document.querySelector("#page-sessions .prompt-history-side");
    var body = panel && panel.querySelector(".panel-body");
    if (!body) return;
    var history = Array.isArray(session && session.promptHistory) ? session.promptHistory : [];
    if (!history.length) {
      body.innerHTML = '<div class="empty">当前 Session 暂无 Prompt 历史</div>';
      return;
    }
    body.innerHTML = history.slice(0, 30).map(function (entry, index) {
      var item = typeof entry === "string" ? { prompt: entry } : (entry || {});
      var prompt = item.rawPrompt || item.prompt || item.text || item.content || "未提供 Prompt";
      var verdict = String(item.verdict || item.riskLevel || "allow").toLowerCase();
      var label = verdict === "block" ? "BLOCK" : verdict === "alert" ? "HOLD" : "ALLOW";
      var cls = verdict === "block" ? "block" : verdict === "alert" ? "hold" : "allow";
      return '<div class="trace-row"><div class="trace-num">' + String(index + 1).padStart(2, "0") + '</div><div class="trace-kind">' + escapeHtml(formatTime(item.timestamp) || "-") + '</div><div class="trace-detail"><span>' + escapeHtml(prompt) + '</span><span>' + escapeHtml(item.reason || "当前会话 Prompt") + '</span></div><span class="badge ' + cls + '">' + label + '</span></div>';
    }).join("");
  }

  function renderSessionDetail(session) {
    text("#sessionHeading", agentName(session.agent) + " · " + (session.promptPreview || session.prompt || "未提供 Prompt"));
    text("#sessionPrompt", session.rawPrompt || session.prompt || session.promptPreview || "未提供 Prompt");
    var verdict = String(session.verdict || session.riskLevel || "allow").toLowerCase();
    var verdictElement = document.getElementById("sessionVerdict");
    if (verdictElement) {
      var label = verdict === "block" ? "BLOCK · HIGH" : verdict === "alert" ? "HOLD · MEDIUM" : "ALLOW · LOW";
      verdictElement.textContent = label;
      verdictElement.className = "badge " + verdictClass(verdict);
    }
    renderPromptHistory(session);
    renderSessionOrbit(session);
  }

  var abgDomains = [
    ["INTENT", "意图"], ["PLAN", "计划"], ["AGENT", "Agent"], ["MODEL", "模型"],
    ["TOOL", "工具 / MCP"], ["AUTH", "身份 / 凭据"], ["DATA", "数据"], ["MEMORY", "记忆"], ["EXEC", "执行 / 系统"]
  ];

  var abgDomainKeys = abgDomains.map(function (item) { return item[0]; });

  function abgClampLevel(value, fallback) {
    var level = Number(value);
    return Number.isFinite(level) ? Math.max(0, Math.min(5, level)) : (fallback == null ? 3 : fallback);
  }

  function abgLevelRadii(maxRadius) {
    return [Math.max(34, maxRadius * .18), maxRadius * .34, maxRadius * .50, maxRadius * .66, maxRadius * .83, maxRadius];
  }

  function abgLevels(boundary, layer) {
    var source = layer === "task" ? (boundary && boundary.task) : (boundary && (boundary.organization || boundary));
    source = source || {};
    var max = abgClampLevel(source.maxLevel, 3);
    var configured = source.levels || source.domainLevels || {};
    return abgDomainKeys.map(function (domain) { return abgClampLevel(configured[domain], max); });
  }

  function abgCatalogPosition(atomId, level, cx, cy, maxRadius, catalog) {
    var domain = abgAtomDomain(atomId);
    var domainIndex = abgDomainKeys.indexOf(domain);
    if (domainIndex < 0) domainIndex = 0;
    var domainAtoms = (Array.isArray(catalog) ? catalog : []).filter(function (atom) { return abgAtomDomain(atom.id || atom.atomId) === domain; });
    var isDomainMarker = String(atomId || "").toUpperCase().endsWith(".__DOMAIN__");
    var localIndex = isDomainMarker ? 0 : domainAtoms.findIndex(function (atom) { return String(atom.id || atom.atomId).toUpperCase() === String(atomId || "").toUpperCase(); });
    if (localIndex < 0) localIndex = domainAtoms.length;
    var denominator = Math.max(1, domainAtoms.length - 1);
    var sector = Math.PI * 2 / abgDomains.length;
    var angle = -Math.PI / 2 + domainIndex * sector + (isDomainMarker ? 0 : (localIndex / denominator - .5) * sector * .58);
    var radii = abgLevelRadii(maxRadius);
    var safeLevel = Math.round(abgClampLevel(level, 1));
    var radius = radii[safeLevel];
    return { x: cx + Math.cos(angle) * radius, y: cy + Math.sin(angle) * radius, angle: angle, radius: radius, domain: domain, level: safeLevel };
  }

  function abgPoint(domain, level, cx, cy, maxRadius) {
    return abgCatalogPosition(domain + ".__domain__", level, cx, cy, maxRadius, []);
  }

  function abgRadarPath(levels, cx, cy, maxRadius) {
    var points = abgDomains.map(function (item, index) {
      return abgPoint(item[0], levels[index], cx, cy, maxRadius);
    });
    if (!points.length) return "";
    var path = "M" + points[0].x.toFixed(1) + " " + points[0].y.toFixed(1);
    points.forEach(function (point, index) {
      var next = points[(index + 1) % points.length];
      var midpoint = { x: (point.x + next.x) / 2, y: (point.y + next.y) / 2 };
      path += " Q" + point.x.toFixed(1) + " " + point.y.toFixed(1) + " " + midpoint.x.toFixed(1) + " " + midpoint.y.toFixed(1);
    });
    return path + " Z";
  }

  function abgSectorPath(index, cx, cy, maxRadius) {
    var sector = Math.PI * 2 / abgDomains.length;
    var centerAngle = -Math.PI / 2 + index * sector;
    var startAngle = centerAngle - sector / 2;
    var endAngle = centerAngle + sector / 2;
    var start = { x: cx + Math.cos(startAngle) * maxRadius, y: cy + Math.sin(startAngle) * maxRadius };
    var end = { x: cx + Math.cos(endAngle) * maxRadius, y: cy + Math.sin(endAngle) * maxRadius };
    return "M" + cx.toFixed(1) + " " + cy.toFixed(1) + " L" + start.x.toFixed(1) + " " + start.y.toFixed(1) + " A" + maxRadius.toFixed(1) + " " + maxRadius.toFixed(1) + " 0 0 1 " + end.x.toFixed(1) + " " + end.y.toFixed(1) + " Z";
  }

  function abgAtomDomain(atomId) {
    return String(atomId || "INTENT.INTERPRET").split(".")[0].toUpperCase();
  }

  function abgApplyViewport(svg) {
    if (!svg) return;
    var layer = svg.querySelector(".abg-layer");
    if (layer) layer.setAttribute("transform", "translate(" + abgViewport.x.toFixed(1) + " " + abgViewport.y.toFixed(1) + ") scale(" + abgViewport.scale.toFixed(2) + ")");
  }

  function abgAttachSvgInteractions(svg, items) {
    if (!svg) return;
    var dragging = false;
    var last = null;
    if (svg.dataset.interactive !== "1") svg.addEventListener("wheel", function (event) {
      event.preventDefault();
      abgViewport.scale = Math.max(.65, Math.min(2.2, abgViewport.scale + (event.deltaY < 0 ? .1 : -.1)));
      abgApplyViewport(svg);
    }, { passive: false });
    if (svg.dataset.interactive !== "1") svg.addEventListener("pointerdown", function (event) {
      if (event.target.closest && event.target.closest(".abg-node")) return;
      dragging = true; last = { x: event.clientX, y: event.clientY }; svg.setPointerCapture?.(event.pointerId);
    });
    if (svg.dataset.interactive !== "1") svg.addEventListener("pointermove", function (event) {
      if (!dragging || !last) return;
      abgViewport.x += (event.clientX - last.x) * .65;
      abgViewport.y += (event.clientY - last.y) * .65;
      last = { x: event.clientX, y: event.clientY };
      abgApplyViewport(svg);
    });
    if (svg.dataset.interactive !== "1") svg.addEventListener("pointerup", function (event) { dragging = false; last = null; svg.releasePointerCapture?.(event.pointerId); });
    if (svg.dataset.interactive !== "1") svg.addEventListener("dblclick", function () { abgViewport = { x: 0, y: 0, scale: 1 }; abgApplyViewport(svg); });
    svg.dataset.interactive = "1";
    svg.querySelectorAll(".abg-node").forEach(function (node) {
      node.addEventListener("click", function (event) {
        event.stopPropagation();
        var index = Number(node.getAttribute("data-abg-index"));
        var item = items[index] || {};
        svg.querySelectorAll(".abg-node").forEach(function (itemNode) { itemNode.classList.remove("selected"); });
        node.classList.add("selected");
        window.dispatchEvent(new CustomEvent("aidr-abg-node-selected", { detail: item }));
      });
    });
  }

  function abgCompressTrace(items) {
    var compressed = [];
    (Array.isArray(items) ? items : []).forEach(function (item, index) {
      var id = String(item.atomId || "UNMAPPED.UNKNOWN").toUpperCase();
      var previous = compressed[compressed.length - 1];
      if (previous && String(previous.atomId || "").toUpperCase() === id) {
        previous.hitCount = Number(previous.hitCount || 1) + 1;
        previous.sequenceEnd = item.sequence || index + 1;
        previous.timestampEnd = item.timestamp || previous.timestampEnd;
        if (String(item.verdict || "").toLowerCase() === "block") previous.verdict = "block";
        if (item.boundaryScope === "organization" || item.outOfOrganization) { previous.boundaryScope = "organization"; previous.outOfOrganization = true; }
        else if (previous.boundaryScope !== "organization" && (item.boundaryScope === "task" || item.outOfTask)) { previous.boundaryScope = "task"; previous.outOfTask = true; }
        return;
      }
      compressed.push(Object.assign({}, item, { atomId: id, hitCount: 1, sequenceStart: item.sequence || index + 1, sequenceEnd: item.sequence || index + 1 }));
    });
    return compressed;
  }

  // A session graph is a semantic path, not a raw telemetry timeline. Keep one
  // node per atom, retain hit counts, and model the last blocked transition as
  // a single policy-gate request just like the ABCG reference view.
  function abgSummarizeSessionPath(items) {
    var source = Array.isArray(items) ? items : [];
    var groups = {};
    var ordered = [];
    var terminalBlock = null;
    source.forEach(function (item, index) {
      var value = item || {};
      var id = String(value.atomId || "UNMAPPED.UNKNOWN").toUpperCase();
      var sequence = Number(value.sequence || index + 1);
      var verdict = String(value.verdict || value.action || "").toLowerCase();
      var effect = value.effect || {};
      var blocked = verdict === "block" || verdict === "blocked" || effect.prevented === true;
      var group = groups[id];
      if (!group) {
        group = Object.assign({}, value, {
          atomId: id,
          hitCount: 0,
          blockedCount: 0,
          sequenceStart: sequence,
          sequenceEnd: sequence
        });
        groups[id] = group;
        ordered.push(group);
      }
      group.hitCount = Number(group.hitCount || 0) + 1;
      group.sequenceEnd = sequence;
      if (blocked) {
        group.blockedCount = Number(group.blockedCount || 0) + 1;
        terminalBlock = { item: value, id: id, sequence: sequence, index: index };
      }
    });
    if (!terminalBlock) return { path: ordered, blockedEntry: null, total: source.length };
    var terminalGroup = groups[terminalBlock.id];
    var path = ordered.filter(function (group) {
      return String(group.atomId || "").toUpperCase() !== terminalBlock.id && Number(group.sequenceStart || 0) < terminalBlock.sequence;
    });
    var blockedEntry = Object.assign({}, terminalBlock.item, {
      atomId: terminalBlock.id,
      verdict: "block",
      hitCount: terminalGroup ? Number(terminalGroup.hitCount || 1) : 1,
      blockedCount: terminalGroup ? Number(terminalGroup.blockedCount || 1) : 1,
      sequenceStart: terminalGroup ? terminalGroup.sequenceStart : terminalBlock.sequence,
      sequenceEnd: terminalGroup ? terminalGroup.sequenceEnd : terminalBlock.sequence,
      blockedTransition: true
    });
    return { path: path, blockedEntry: blockedEntry, total: source.length };
  }

  function abgEventBoundaryScope(item) {
    var value = item || {};
    var layers = value.boundary && value.boundary.layers || {};
    var verdict = String(value.verdict || value.action || "").toLowerCase();
    var effectBlocked = value.effect && value.effect.prevented === true;
    var explicitlyBlocked = verdict === "block" || verdict === "blocked" || effectBlocked;
    var organizationDenied = value.outOfOrganization || layers.organization && layers.organization.denied === true || (explicitlyBlocked && value.boundaryScope === "organization");
    var taskDenied = value.outOfTask || layers.task && layers.task.denied === true || (explicitlyBlocked && value.boundaryScope === "task");
    return organizationDenied ? "organization" : taskDenied ? "task" : "within";
  }

  function abgRenderSvg(svg, items, mode, boundary, catalog, decisionTrace) {
    if (!svg) return;
    svg.classList.toggle("abg-motion-off", !abgMotionEnabled);
    var width = 760, height = 520, cx = 380, cy = 260, radius = 205, output = [];
    var list = Array.isArray(items) ? items : [];
    var blockedEntry = null;
    if (mode === "actual") {
      var sessionSummary = abgSummarizeSessionPath(list);
      list = sessionSummary.path;
      blockedEntry = sessionSummary.blockedEntry;
    }
    var definitions = Array.isArray(catalog) && catalog.length ? catalog : (state.behaviorAtoms?.catalog || []);
    var densePermission = definitions.length > 28;
    var byId = {};
    definitions.forEach(function (atom) { byId[String(atom.id).toUpperCase()] = atom; });
    if (!definitions.length) list.forEach(function (item) { if (!byId[String(item.atomId || "").toUpperCase()]) definitions.push({ id: item.atomId, domain: abgAtomDomain(item.atomId), baseLevel: item.requiredLevel || item.level || 1, description: "行为原子" }); });
    var orgLevels = abgLevels(boundary, "organization");
    var taskLevels = abgLevels(boundary, "task");
    var defsForBoundary = definitions;
    output.push('<defs><marker id="abgArrow" markerWidth="8" markerHeight="8" refX="7" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="#147f73"></path></marker><marker id="abgActualArrow" markerWidth="8" markerHeight="8" refX="7" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="#2f8be6"></path></marker><marker id="abgRiskArrow" markerWidth="8" markerHeight="8" refX="7" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="#b42318"></path></marker><marker id="abgRequestArrow" markerWidth="8" markerHeight="8" refX="7" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="#a35b00"></path></marker></defs>');
    abgDomains.forEach(function (domain, index) {
      output.push('<path class="abg-sector-fill ' + (index % 2 ? 'alt' : '') + '" d="' + abgSectorPath(index, cx, cy, radius) + '"><title>' + escapeHtml(domain[1]) + '</title></path>');
      var sector = Math.PI * 2 / abgDomains.length;
      var edgeAngle = -Math.PI / 2 + index * sector - sector / 2;
      var edge = { x: cx + Math.cos(edgeAngle) * radius, y: cy + Math.sin(edgeAngle) * radius };
      output.push('<line class="abg-sector-edge" x1="' + cx + '" y1="' + cy + '" x2="' + edge.x.toFixed(1) + '" y2="' + edge.y.toFixed(1) + '"/>');
    });
    var radii = abgLevelRadii(radius);
    radii.forEach(function (ringRadius, level) { output.push('<circle class="abg-ring" cx="' + cx + '" cy="' + cy + '" r="' + ringRadius.toFixed(1) + '"/><text class="abg-level-label" x="' + (cx + 6) + '" y="' + (cy - ringRadius + 13) + '">L' + level + '</text>'); });
    abgDomains.forEach(function (domain) {
      var outer = abgPoint(domain[0], 5, cx, cy, radius);
      var label = abgPoint(domain[0], 5, cx, cy, radius + 34);
      output.push('<line class="abg-axis" x1="' + cx + '" y1="' + cy + '" x2="' + outer.x.toFixed(1) + '" y2="' + outer.y.toFixed(1) + '"/>');
      var labelWidth = Math.max(42, String(domain[1]).length * 7.6 + 16);
      output.push('<g class="abg-domain-label"><rect x="' + (label.x - labelWidth / 2).toFixed(1) + '" y="' + (label.y - 11).toFixed(1) + '" width="' + labelWidth.toFixed(1) + '" height="18" rx="4"/><text class="abg-label" x="' + label.x.toFixed(1) + '" y="' + (label.y + 4).toFixed(1) + '" text-anchor="middle">' + escapeHtml(domain[1]) + '</text></g>');
    });
    output.push('<path class="abg-boundary" d="' + abgRadarPath(orgLevels, cx, cy, radius) + '"><title>组织边界 · 全局策略上限 · ' + escapeHtml(orgLevels.map(function (level, index) { return abgDomainKeys[index] + ' L' + level; }).join(' / ')) + '</title></path>');
    if (boundary && boundary.task && (boundary.task.levels || boundary.task.maxLevel !== undefined)) output.push('<path class="abg-task-boundary" d="' + abgRadarPath(taskLevels, cx, cy, radius) + '"><title>任务边界 · 当前会话最小权限 · ' + escapeHtml(taskLevels.map(function (level, index) { return abgDomainKeys[index] + ' L' + level; }).join(' / ')) + '</title></path>');
    output.push('<text class="abg-level-label" x="' + (cx + 12) + '" y="' + (cy + 18) + '">权限空间</text>');

    var points = [];
    if (mode === "permission") {
      definitions.forEach(function (atom, index) {
        var id = String(atom.id || "").toUpperCase();
        var item = list.find(function (candidate) { return String(candidate.atomId || "").toUpperCase() === id; }) || { atomId: id, level: atom.baseLevel, verdict: "allow", boundaryScope: "within" };
        var point = abgCatalogPosition(id, item.requiredLevel || item.level || atom.baseLevel, cx, cy, radius, definitions);
        var orgBoundary = (boundary && (boundary.organization || boundary)) || {};
        var taskBoundary = (boundary && boundary.task) || {};
        var orgLevelsForAtom = orgBoundary.levels || orgBoundary.domainLevels || {};
        var taskLevelsForAtom = taskBoundary.levels || taskBoundary.domainLevels || {};
        var orgLevel = Number(orgLevelsForAtom[atom.domain] ?? orgBoundary.maxLevel ?? 3);
        var taskLevel = Number(taskLevelsForAtom[atom.domain] ?? taskBoundary.maxLevel ?? orgLevel);
        var deniedByOrg = (orgBoundary.deniedAtoms || []).some(function (denied) { return String(denied).toUpperCase() === id; });
        var organizationOutside = deniedByOrg || Number(atom.baseLevel || 0) > orgLevel || item.boundaryScope === "organization" || item.outOfOrganization || atom.enabled === false;
        var taskOutside = !organizationOutside && (Number(atom.baseLevel || 0) > taskLevel || item.boundaryScope === "task" || item.outOfTask);
        var stateClass = organizationOutside ? "organization" : taskOutside ? "task" : "within";
        var selected = item.selected || atom.selected;
        var atomLabel = String(id).split(".").pop().replace(/_/g, " ");
        var denseLabelStride = Math.max(4, Math.ceil(definitions.length / 8));
        var showLabel = !densePermission || selected || atom.hits > 0 || item.hits > 0 || (organizationOutside && index % denseLabelStride === 0);
        var verdict = organizationOutside || taskOutside ? "block" : (item.verdict || "allow");
        output.push('<g class="abg-node ' + stateClass + '" data-abg-index="' + index + '" transform="translate(' + point.x.toFixed(1) + ' ' + point.y.toFixed(1) + ')"><circle r="' + (showLabel ? 5.5 : 4) + '"/><title>' + escapeHtml(id + " · L" + point.level + " · " + (atom.description || "行为原子") + " · " + verdict + " · " + stateClass) + '</title>' + (showLabel ? '<text class="abg-node-label" x="8" y="-6">' + escapeHtml(atomLabel) + '</text>' : '') + '</g>');
      });
    } else {
      points = list.map(function (item, index) {
        var point = abgCatalogPosition(item.atomId, item.requiredLevel || item.level || 1, cx, cy, radius, definitions);
        var sameAtomBefore = list.slice(0, index).filter(function (previous) { return String(previous.atomId || "").toUpperCase() === String(item.atomId || "").toUpperCase(); }).length;
        if (sameAtomBefore) {
          var ringIndex = Math.floor((sameAtomBefore - 1) / 8) + 1;
          var offset = Math.min(52, 8 + ringIndex * 8);
          var offsetAngle = point.angle + (sameAtomBefore % 8) * (Math.PI * 2 / 8);
          point = Object.assign({}, point, { x: point.x + Math.cos(offsetAngle) * offset, y: point.y + Math.sin(offsetAngle) * offset });
        }
        return { item: item, point: point, index: index, repeatIndex: sameAtomBefore };
      });
      if (mode === "aggregate") {
        var aggregateStride = Math.max(1, Math.ceil(points.length / 18));
        points.forEach(function (entry) {
          var item = entry.item;
          var aggregateScope = abgEventBoundaryScope(item);
          var organizationOutside = aggregateScope === "organization";
          var taskOutside = aggregateScope === "task";
          var stateClass = organizationOutside ? "organization" : taskOutside ? "task" : "within";
          var showLabel = points.length <= 28 || entry.index % aggregateStride === 0 || Number(item.hits || 0) >= 3 || organizationOutside;
          var label = String(item.atomId || "").split(".").pop().replace(/_/g, " ");
          var hitLabel = Number(item.hits || 0) ? " · " + Number(item.hits || 0) + " 次命中" : "";
          output.push('<g class="abg-node aggregate ' + stateClass + '" data-abg-index="' + entry.index + '" transform="translate(' + entry.point.x.toFixed(1) + ' ' + entry.point.y.toFixed(1) + ')"><circle r="' + (Number(item.hits || 0) >= 3 ? 6.5 : 4.5) + '"/><title>' + escapeHtml(String(item.atomId || "行为原子") + hitLabel + " · " + (organizationOutside ? "组织边界外" : taskOutside ? "任务边界外" : "边界内")) + '</title>' + (showLabel ? '<text class="abg-node-label" x="8" y="-6">' + escapeHtml(label) + '</text>' : '') + '</g>');
        });
      } else if (points.length > 1) {
        var pathData = points.map(function (entry, index) { return (index ? "L" : "M") + entry.point.x.toFixed(1) + " " + entry.point.y.toFixed(1); }).join(" ");
        if (mode === "predicted") output.push('<path class="abg-predicted" d="' + pathData + '" marker-end="url(#abgArrow)"/>');
        else {
          var segmentStart = points[0];
          points.slice(1).forEach(function (entry) {
            var eventScope = abgEventBoundaryScope(entry.item);
            var organizationRisk = eventScope === "organization";
            var taskRisk = eventScope === "task";
            var risk = organizationRisk || taskRisk;
            var request = mode === "request";
            var actualPath = mode === "actual" && !risk && !request;
            var edgeClass = request ? "abg-request" : (!actualPath && risk) ? "abg-risk-boundary" : actualPath ? "abg-actual-path" : "abg-path";
            var markerId = request ? "abgRequestArrow" : (!actualPath && risk) ? "abgRiskArrow" : actualPath ? "abgActualArrow" : "abgArrow";
            output.push('<path class="' + edgeClass + '" d="M' + segmentStart.point.x.toFixed(1) + ' ' + segmentStart.point.y.toFixed(1) + ' L' + entry.point.x.toFixed(1) + ' ' + entry.point.y.toFixed(1) + '" marker-end="url(#' + markerId + ')"/>');
            if (abgMotionEnabled && mode !== "actual") output.push('<circle class="abg-flow-particle ' + (request ? "request" : risk ? "risk" : "") + '" r="3"><animateMotion dur="1.5s" repeatCount="indefinite" path="M' + segmentStart.point.x.toFixed(1) + ' ' + segmentStart.point.y.toFixed(1) + ' L' + entry.point.x.toFixed(1) + ' ' + entry.point.y.toFixed(1) + '"/></circle>');
            segmentStart = entry;
          });
        }
      }
      points.forEach(function (entry) {
        var item = entry.item;
        var stateClass = mode === "request" ? "request" : abgEventBoundaryScope(item) === "organization" ? "organization" : abgEventBoundaryScope(item) === "task" ? "task" : mode === "predicted" ? "predicted" : mode === "actual" ? "actual" : "within";
        var current = entry.index === points.length - 1 ? " current" : "";
        var densePath = points.length > 16;
        var showPathLabel = !densePath && entry.repeatIndex === 0;
        var hitSuffix = Number(item.hitCount || 1) > 1 ? " · " + Number(item.hitCount) + " 次" : "";
        output.push('<g class="abg-node ' + stateClass + current + '" data-abg-index="' + entry.index + '" transform="translate(' + entry.point.x.toFixed(1) + ' ' + entry.point.y.toFixed(1) + ')"><circle r="' + (densePath ? 3.5 : 6) + '"/><title>' + escapeHtml(String(item.atomId || "行为原子") + hitSuffix + " · " + String(item.verdict || item.state || "unknown") + " · " + (item.boundaryScope || "within")) + '</title>' + (showPathLabel ? '<text class="abg-node-label" x="8" y="-7">' + escapeHtml(String(item.atomId || "").split(".").pop().replace(/_/g, " ")) + '</text>' : '') + '</g>');
      });
      if (mode === "actual" && blockedEntry) {
        var sourcePoint = points.length ? points[points.length - 1].point : { x: cx, y: cy };
        var targetPoint = abgCatalogPosition(blockedEntry.atomId, blockedEntry.requiredLevel || blockedEntry.level || 1, cx, cy, radius, definitions);
        var gate = { x: sourcePoint.x + (targetPoint.x - sourcePoint.x) * 0.58, y: sourcePoint.y + (targetPoint.y - sourcePoint.y) * 0.58 };
        var requestPath = "M" + sourcePoint.x.toFixed(1) + " " + sourcePoint.y.toFixed(1) + " Q" + ((sourcePoint.x + gate.x) / 2).toFixed(1) + " " + (((sourcePoint.y + gate.y) / 2) - 18).toFixed(1) + " " + gate.x.toFixed(1) + " " + gate.y.toFixed(1);
        var blockedScope = abgEventBoundaryScope(blockedEntry);
        var gateClass = blockedScope === "organization" ? "abg-block-gate" : "abg-task-gate";
        var blockedClass = blockedScope === "organization" ? "organization" : blockedScope === "task" ? "task" : "actual";
        output.push('<path class="abg-request" d="' + requestPath + '" marker-end="url(#abgRequestArrow)"/><path class="abg-risk-boundary" d="M' + gate.x.toFixed(1) + ' ' + gate.y.toFixed(1) + ' L' + targetPoint.x.toFixed(1) + ' ' + targetPoint.y.toFixed(1) + '" marker-end="url(#abgRiskArrow)"/>');
        output.push('<g class="' + gateClass + '" transform="translate(' + gate.x.toFixed(1) + ' ' + gate.y.toFixed(1) + ')"><circle r="11"/><path d="M-4,-4 L4,4 M4,-4 L-4,4"/><text y="20" text-anchor="middle">BLOCKED</text></g>');
        output.push('<g class="abg-node ' + blockedClass + ' current" data-abg-index="' + list.length + '" transform="translate(' + targetPoint.x.toFixed(1) + ' ' + targetPoint.y.toFixed(1) + ')"><circle r="7"/><title>' + escapeHtml(String(blockedEntry.atomId || "行为原子") + " · BLOCKED · " + Number(blockedEntry.hitCount || 1) + " 次命中") + '</title><text class="abg-node-label" x="8" y="-7">BLOCKED</text></g>');
      }
    }
    var centerTitle = mode === "actual" ? "REVIEW" : mode === "predicted" ? "PLAN" : "POLICY";
    var centerSubtitle = mode === "permission" ? "ORG / TASK" : mode === "aggregate" ? "HIT ATOMS" : mode.toUpperCase();
    output.push('<circle cx="' + cx + '" cy="' + cy + '" r="24" fill="#f2faf8" stroke="#147f73" stroke-width="2"/><text x="' + cx + '" y="' + (cy - 2) + '" text-anchor="middle" fill="#173045" font-size="10" font-weight="700">' + centerTitle + '</text><text x="' + cx + '" y="' + (cy + 12) + '" text-anchor="middle" fill="#687587" font-size="9">' + centerSubtitle + '</text>');
    svg.setAttribute("viewBox", "0 0 " + width + " " + height);
    svg.innerHTML = '<g class="abg-layer">' + output.join("") + '</g>';
    abgApplyViewport(svg);
    abgAttachSvgInteractions(svg, mode === "permission" ? definitions.map(function (atom) { return Object.assign({ atomId: atom.id, level: atom.baseLevel }, atom); }) : list.concat(blockedEntry ? [blockedEntry] : []));
  }

  function ensureBehaviorOrbitPanel() {
    var page = document.getElementById("page-behavior");
    if (!page) return null;
    var panel = document.getElementById("abg-behavior-orbit");
    if (panel) return panel;
    var kpis = page.querySelector(".behavior-kpis");
    if (!kpis) return null;
    panel = document.createElement("div");
    panel.id = "abg-behavior-orbit";
    panel.className = "panel abg-orbit-panel";
    panel.innerHTML = '<div class="panel-head"><div><h2>Agent 行为原子空间</h2><p>聚合当前窗口已命中的行为原子；红色节点表示越过组织边界。</p></div><span class="badge info">ABCG AGGREGATE</span></div><div class="panel-body"><div class="abg-controls"><select class="select" id="abgBehaviorAgent"><option value="">所有 Agent</option></select><select class="select" id="abgBehaviorWindow"><option value="24">最近 24 小时</option><option value="168">最近 7 天</option></select><span class="small muted" id="abgBehaviorUpdated">等待数据</span></div><div class="abg-orbit-layout"><div><div class="abg-orbit-box"><svg id="abgBehaviorSvg" viewBox="0 0 520 300" role="img" aria-label="Agent 行为原子空间"></svg></div><div class="abg-legend"><span><i style="background:#177f72"></i>组织边界内</span><span><i style="background:#c27600"></i>任务边界外</span><span><i style="background:#b42318"></i>组织边界外</span><span><i style="background:#2463c4"></i>策略空间</span></div></div><div class="abg-summary"><div class="abg-stat"><small>当前 Agent</small><strong id="abgBehaviorAgentName">全部 Agent</strong></div><div class="abg-stat"><small>行为事件</small><strong id="abgBehaviorEventTotal">0</strong></div><div class="abg-stat warn"><small>任务边界偏移</small><strong id="abgBehaviorTaskDrift">0</strong></div><div class="abg-stat danger"><small>组织边界越界</small><strong id="abgBehaviorOrgDrift">0</strong></div></div></div><div class="table-wrap" style="margin-top:14px"><table class="abg-matrix"><thead><tr><th>Agent</th><th>意图</th><th>计划</th><th>工具 / MCP</th><th>身份</th><th>数据</th><th>记忆</th><th>执行</th><th>总体</th></tr></thead><tbody id="abgBehaviorMatrix"></tbody></table></div></div>';
    panel.querySelector(".abg-orbit-box").insertAdjacentHTML("afterbegin", '<button class="btn abg-fullscreen" data-abg-fullscreen title="全屏查看行为风险轨迹">全屏</button>');
    ensureAbgStyles();
    panel.querySelector(".panel-body").insertAdjacentHTML("beforeend", '<div class="abg-node-detail">选择轨迹节点查看行为原子、边界和事件证据。</div><div class="table-wrap" style="margin-top:10px"><table class="abg-catalog-table"><thead><tr><th>序号</th><th>行为原子</th><th>来源</th><th>决策</th><th>边界</th><th>时间</th></tr></thead><tbody id="abgBehaviorTimeline"></tbody></table></div>');
    kpis.insertAdjacentElement("afterend", panel);
    var oldMatrix = page.querySelector(".behavior-kpis + .panel:not(#abg-behavior-orbit)");
    if (oldMatrix && oldMatrix.querySelector("table.matrix")) oldMatrix.classList.add("abg-old-graph-hidden");
    panel.querySelector("#abgBehaviorAgent").addEventListener("change", function () { abgSelectedAgent = this.value; renderAbgBehavior(); });
    panel.querySelector("#abgBehaviorWindow").addEventListener("change", function () { refresh(); });
    return panel;
  }

  function abgBuildHitAggregate(events, catalog) {
    var catalogById = {};
    (Array.isArray(catalog) ? catalog : []).forEach(function (atom) { catalogById[String(atom.id || "").toUpperCase()] = atom; });
    var grouped = {};
    (Array.isArray(events) ? events : []).forEach(function (event, index) {
      var id = String(event.atomId || "UNMAPPED.UNKNOWN").toUpperCase();
      var atom = catalogById[id] || {};
      var row = grouped[id];
      if (!row) {
        row = grouped[id] = { atomId: id, level: event.level || atom.baseLevel || 1, requiredLevel: event.requiredLevel || atom.baseLevel || event.level || 1, domain: event.domain || atom.domain || abgAtomDomain(id), hits: 0, boundaryScope: "within", outOfOrganization: false, outOfTask: false, verdict: "allow", source: event.source || "event" };
      }
      row.hits += 1;
      row.lastSequence = event.sequence || index + 1;
      row.lastTimestamp = event.timestamp || row.lastTimestamp;
      row.source = event.source || row.source;
      if (event.boundaryScope === "organization" || event.outOfOrganization) { row.boundaryScope = "organization"; row.outOfOrganization = true; }
      else if (!row.outOfOrganization && (event.boundaryScope === "task" || event.outOfTask)) { row.boundaryScope = "task"; row.outOfTask = true; }
      if (String(event.verdict || "").toLowerCase() === "block" || String(event.state || "").toLowerCase() === "blocked") row.verdict = "block";
    });
    return Object.keys(grouped).map(function (id) { return grouped[id]; }).sort(function (a, b) {
      return (a.domain || "").localeCompare(b.domain || "") || Number(a.requiredLevel || 0) - Number(b.requiredLevel || 0) || String(a.atomId).localeCompare(String(b.atomId));
    });
  }

  function renderAbgBehavior() {
    var panel = ensureBehaviorOrbitPanel();
    if (!panel) return;
    var data = state.behaviorAtoms || { agents: [], catalog: [] };
    var agents = data.agents || [];
    var select = panel.querySelector("#abgBehaviorAgent");
    if (select && select.options.length !== agents.length + 1) {
      select.innerHTML = '<option value="">所有 Agent</option>' + agents.map(function (agent) { return '<option value="' + escapeHtml(agent.agentId) + '">' + escapeHtml(agentName(agent.agentId)) + '</option>'; }).join("");
    }
    if (select) select.value = abgSelectedAgent;
    var chosen = agents.filter(function (agent) { return String(agent.agentId) === String(abgSelectedAgent); })[0] || null;
    var fullPath = chosen ? (chosen.path || []) : agents.reduce(function (all, agent) { return all.concat(agent.path || []); }, []).sort(function (a, b) {
      return Number(a.sequence || 0) - Number(b.sequence || 0) || String(a.timestamp || "").localeCompare(String(b.timestamp || ""));
    });
    var graphLimit = 160;
    var path = fullPath.length > graphLimit ? fullPath.slice(-graphLimit) : fullPath;
    var total = chosen ? chosen.total || 0 : agents.reduce(function (sum, agent) { return sum + Number(agent.total || 0); }, 0);
    var orgDrift = chosen ? chosen.outOfOrganization || 0 : agents.reduce(function (sum, agent) { return sum + Number(agent.outOfOrganization || 0); }, 0);
    var taskDrift = chosen ? chosen.outOfTask || 0 : agents.reduce(function (sum, agent) { return sum + Number(agent.outOfTask || 0); }, 0);
    panel.querySelector("#abgBehaviorAgentName").textContent = chosen ? agentName(chosen.agentId) : "全部 Agent";
    panel.querySelector("#abgBehaviorEventTotal").textContent = String(total);
    panel.querySelector("#abgBehaviorTaskDrift").textContent = String(taskDrift);
    panel.querySelector("#abgBehaviorOrgDrift").textContent = String(orgDrift);
    var catalog = data.catalog || [];
    var hitSpace = abgBuildHitAggregate(fullPath, catalog);
    panel.querySelector("#abgBehaviorUpdated").textContent = "已关联 " + agents.length + " 个 Agent · " + (data.windowHours || 24) + " 小时 · 聚合 " + hitSpace.length + " 个命中行为原子 / " + fullPath.length + " 个事件";
    abgRenderSvg(panel.querySelector("#abgBehaviorSvg"), hitSpace, "aggregate", data.boundary || {}, catalog);
    var domainMap = {};
    catalog.forEach(function (atom) { domainMap[atom.id] = atom.domain; });
    panel.querySelector("#abgBehaviorMatrix").innerHTML = agents.map(function (agent) {
      var counts = {}; Object.keys(agent.atoms || {}).forEach(function (id) { var domain = domainMap[id] || String(id).split(".")[0]; counts[domain] = (counts[domain] || 0) + Number(agent.atoms[id] || 0); });
      var risk = agent.outOfOrganization ? "HIGH" : agent.outOfTask ? "MEDIUM" : "LOW";
      var riskClass = risk === "HIGH" ? "block" : risk === "MEDIUM" ? "hold" : "allow";
      return '<tr class="' + (String(agent.agentId) === String(abgSelectedAgent) ? "selected" : "") + '" data-abg-agent="' + escapeHtml(agent.agentId) + '"><td><strong>' + escapeHtml(agentName(agent.agentId)) + '</strong><small class="policy-sub">' + escapeHtml(agent.agentId) + '</small></td>' + abgDomains.map(function (domain) { var value = counts[domain[0]] || 0; var cls = value >= 4 ? "high" : value >= 2 ? "medium" : "low"; return '<td><span class="abg-cell ' + cls + '">' + value + '</span></td>'; }).join("") + '<td>' + badge(risk, riskClass) + '</td></tr>';
    }).join("") || '<tr><td colspan="9" class="empty">当前窗口暂无行为原子事件</td></tr>';
    var timeline = panel.querySelector("#abgBehaviorTimeline");
    if (timeline) timeline.innerHTML = path.slice(-40).map(function (item, index) {
      var scope = item.boundaryScope || "within";
      var decisionClass = verdictClass(item.verdict);
      return '<tr><td>' + escapeHtml(item.sequence || index + 1) + '</td><td><strong>' + escapeHtml(item.atomId || "UNMAPPED.UNKNOWN") + '</strong></td><td>' + escapeHtml(item.source || "-") + '</td><td>' + badge(item.verdict || "allow", decisionClass) + '</td><td>' + escapeHtml(scope === "organization" ? "组织边界外" : scope === "task" ? "任务边界外" : scope === "within" ? "边界内" : "未归属") + '</td><td>' + escapeHtml(formatTime(item.timestamp)) + '</td></tr>';
    }).join("") || '<tr><td colspan="6" class="empty">当前窗口暂无行为原子事件</td></tr>';
    panel.querySelectorAll("[data-abg-agent]").forEach(function (row) { row.addEventListener("click", function () { abgSelectedAgent = row.getAttribute("data-abg-agent"); renderAbgBehavior(); }); });
  }

  function ensureSessionOrbitPanel() {
    var page = document.getElementById("page-sessions");
    if (!page) return null;
    var panel = page.querySelector(".abg-session-orbit");
    if (panel) return panel;
    var oldGraph = page.querySelector(".mini-graph");
    if (oldGraph) { var oldPanel = oldGraph.closest(".panel"); if (oldPanel) oldPanel.classList.add("abg-old-graph-hidden"); }
    var anchor = page.querySelector(".drift") || page.querySelector(".session-center");
    if (!anchor) return null;
    panel = document.createElement("div");
    panel.className = "panel abg-session-orbit";
    var evidenceMarkup = '<div class="abg-intent-evidence" data-abg-intent-evidence><div class="abg-intent-evidence-head"><strong>意图证据</strong><span class="badge neutral" data-abg-intent-source>等待会话分析</span></div><div class="abg-intent-evidence-grid"><div class="abg-intent-evidence-item"><b>目标</b><span data-abg-intent-goal>-</span></div><div class="abg-intent-evidence-item"><b>风险</b><span data-abg-intent-risk>-</span></div><div class="abg-intent-evidence-item"><b>分析置信度</b><span data-abg-intent-confidence>-</span></div><div class="abg-intent-evidence-item"><b>Prompt 指纹</b><span data-abg-intent-hash>-</span></div></div><div class="abg-intent-evidence-chips" data-abg-intent-capabilities></div></div>';
    panel.innerHTML = '<div class="panel-head"><div><h2>Policy Orbit</h2><p>组织边界、任务边界、预测行为链和实际行为链保持同一坐标系展示。</p></div><span class="badge info">SESSION ORBIT</span></div><div class="panel-body"><div class="abg-orbit-tabs"><button class="active" data-abg-mode="permission">权限空间</button><button data-abg-mode="predicted">预测行为链</button><button data-abg-mode="actual">实际行为链</button></div><div class="abg-orbit-box"><svg id="abgSessionSvg" viewBox="0 0 520 300" role="img" aria-label="Policy Orbit"></svg></div><div class="abg-orbit-note" id="abgSessionNote">正在加载当前会话的组织边界、任务边界和实际行为证据。</div></div>';
    panel.querySelector(".panel-body").insertAdjacentHTML("afterbegin", evidenceMarkup);
    panel.querySelector(".abg-orbit-box").insertAdjacentHTML("afterbegin", '<button class="btn abg-fullscreen" data-abg-fullscreen title="全屏查看权限空间">全屏</button>');
    panel.querySelector(".abg-orbit-note").insertAdjacentHTML("afterend", '<div class="abg-space-legend"><span><i style="background:#e65da4"></i>\\u7ec4\\u7ec7\\u8fb9\\u754c</span><span><i style="background:#ff8a1e"></i>\\u4efb\\u52a1\\u8fb9\\u754c</span><span><i style="background:#147f73"></i>\\u5b9e\\u9645\\u884c\\u4e3a\\u94fe</span><span><i style="background:#b42318"></i>\\u8d8a\\u754c\\u88ab\\u963b\\u65ad</span></div>');
    panel.querySelector(".panel-head").insertAdjacentHTML("beforeend", '<button class="btn abg-motion-toggle" data-abg-motion-toggle aria-pressed="true">\\u52a8\\u6001\\uff1a\\u5f00</button>');
    panel.querySelector(".abg-space-legend").innerHTML = '<span><i style="background:#e65da4"></i>\u7ec4\u7ec7\u8fb9\u754c</span><span><i style="background:#ff8a1e"></i>\u4efb\u52a1\u8fb9\u754c</span><span><i style="background:#147f73"></i>\u5b9e\u9645\u884c\u4e3a\u94fe</span><span><i style="background:#b42318"></i>\u8d8a\u754c\u88ab\u963b\u65ad</span>';
    panel.querySelectorAll("[data-abg-motion-toggle]").forEach(function (button) { button.textContent = "\u52a8\u6001\uff1a\u5f00"; });
    ensureAbgStyles();
    panel.querySelector(".panel-body").insertAdjacentHTML("beforeend", '<div class="abg-replay"><button class="btn" data-abg-replay="prev">上一步</button><button class="btn primary" data-abg-replay="play">播放行为链</button><button class="btn" data-abg-replay="next">下一步</button><input type="range" min="0" max="0" value="0" data-abg-replay="range"><span class="small muted" data-abg-replay="status">未加载</span></div><div class="abg-node-detail">选择图谱节点查看行为原子和证据。</div><div class="table-wrap" style="margin-top:10px"><table class="abg-catalog-table"><thead><tr><th>Decision Trace</th><th>来源</th><th>状态</th><th>原因</th></tr></thead><tbody data-abg-trace></tbody></table></div>');
    anchor.insertAdjacentElement("afterend", panel);
    panel.querySelectorAll("[data-abg-mode]").forEach(function (button) { button.addEventListener("click", function () { abgSessionMode = button.getAttribute("data-abg-mode"); abgPlaybackIndex = 0; panel.querySelectorAll("[data-abg-mode]").forEach(function (item) { item.classList.toggle("active", item === button); }); abgRenderSessionOrbit(panel); }); });
    panel.querySelectorAll("[data-abg-replay]").forEach(function (button) { button.addEventListener("click", function () { var action = button.getAttribute("data-abg-replay"); if (action === "play") { if (abgPlaybackTimer) { clearInterval(abgPlaybackTimer); abgPlaybackTimer = null; button.textContent = "播放行为链"; } else { button.textContent = "暂停行为链"; abgPlaybackTimer = setInterval(function () { var max = (abgSessionData?.actualPath || []).length - 1; abgPlaybackIndex = Math.min(max, abgPlaybackIndex + 1); abgRenderSessionOrbit(panel); if (abgPlaybackIndex >= max) { clearInterval(abgPlaybackTimer); abgPlaybackTimer = null; button.textContent = "重新播放"; } }, 700); } } else { var max = Math.max(0, (abgSessionData?.actualPath || []).length - 1); abgPlaybackIndex = action === "prev" ? Math.max(0, abgPlaybackIndex - 1) : Math.min(max, abgPlaybackIndex + 1); abgRenderSessionOrbit(panel); } }); });
    return panel;
  }

  function abgRenderSessionOrbit(panel) {
    if (!panel || !abgSessionData) return;
    var evidencePanel = panel.querySelector("[data-abg-intent-evidence]");
    if (evidencePanel) {
      var evidence = abgSessionData.intentEvidence || abgSessionData.intent?.intentEvidence || null;
      var intent = abgSessionData.intent || {};
      var sourceLabel = { hybrid: "规则 + 语义模型", semantic_model: "语义模型", local_rules: "本地规则" };
      var source = evidence?.source || "unavailable";
      var sourceBadge = evidencePanel.querySelector("[data-abg-intent-source]");
      var goal = evidence?.goal || intent.summary || "未生成结构化目标";
      var risk = evidence?.risk || {};
      var confidenceValues = [risk.localConfidence, risk.semanticConfidence].filter(function (value) { return Number(value) > 0; });
      var confidence = confidenceValues.length ? Math.round(Math.max.apply(Math, confidenceValues) * 100) + "%" : "未提供";
      var hash = evidence?.promptSha256 ? String(evidence.promptSha256).slice(0, 12) + "…" : "未提供";
      if (sourceBadge) { sourceBadge.textContent = sourceLabel[source] || "未采集证据"; sourceBadge.className = "badge " + (source === "hybrid" || source === "semantic_model" ? "allow" : "neutral"); }
      var fieldValues = { "[data-abg-intent-goal]": goal, "[data-abg-intent-risk]": (risk.level || "unknown") + (risk.score !== null && risk.score !== undefined ? " · " + risk.score : ""), "[data-abg-intent-confidence]": confidence, "[data-abg-intent-hash]": hash };
      Object.keys(fieldValues).forEach(function (selector) { var field = evidencePanel.querySelector(selector); if (field) field.textContent = String(fieldValues[selector]); });
      var chips = evidencePanel.querySelector("[data-abg-intent-capabilities]");
      if (chips) {
        var capabilities = evidence ? Object.keys(evidence.requestedCapabilities || {}).filter(function (key) { return evidence.requestedCapabilities[key]; }) : [];
        chips.innerHTML = capabilities.length ? capabilities.map(function (key) { var granted = evidence.grantedCapabilities?.[key] === true; return '<span class="abg-intent-evidence-chip">' + escapeHtml(key) + " · " + (granted ? "已授权" : "待阻断/审批") + "</span>"; }).join("") : '<span class="abg-intent-evidence-chip">未发现新增能力请求</span>';
      }
    }
    if (abgSessionData.unavailable) {
      panel.querySelector("#abgSessionSvg").innerHTML = '<text x="260" y="145" text-anchor="middle" fill="#687587" font-size="12">Orbit 数据暂不可用</text><text x="260" y="166" text-anchor="middle" fill="#687587" font-size="10">请检查会话关联或 API 状态</text>';
      panel.querySelector("#abgSessionNote").textContent = abgSessionData.message || "会话 Orbit API 未返回数据";
      return;
    }
    var mode = abgSessionMode;
    var fullActual = abgSessionData.actualPath || [];
    var actualItems = abgPlaybackIndex > 0 ? fullActual.slice(0, abgPlaybackIndex + 1) : fullActual;
    var items = mode === "predicted" ? (abgSessionData.predictedPath || []) : mode === "actual" ? actualItems : [];
    abgRenderSvg(panel.querySelector("#abgSessionSvg"), items, mode, { organization: abgSessionData.organizationBoundary || {}, task: abgSessionData.taskBoundary || {} }, state.behaviorAtoms?.catalog || [], abgSessionData.decisionTrace);
    var note = mode === "permission" ? "组织边界为全局策略上限；任务边界来自当前会话的最小权限策略。" : mode === "predicted" ? "预测行为链来自 Prompt、Agent 能力和工具声明，尚未代表已发生副作用。" : "实际行为链来自 Hook、MCP、文件、网络和进程事件；越过组织边界的行为在图中显示 BLOCKED。";
    panel.querySelector("#abgSessionNote").textContent = note;
    var range = panel.querySelector('[data-abg-replay="range"]');
    var status = panel.querySelector('[data-abg-replay="status"]');
    if (range) { range.max = String(Math.max(0, fullActual.length - 1)); range.value = String(abgPlaybackIndex > 0 ? Math.min(abgPlaybackIndex, Math.max(0, fullActual.length - 1)) : Math.max(0, fullActual.length - 1)); range.disabled = mode !== "actual"; range.oninput = function () { abgPlaybackIndex = Number(range.value); abgRenderSessionOrbit(panel); }; }
    if (status) status.textContent = mode === "actual" ? ((actualItems.length) + " / " + fullActual.length + " 个实际行为") : mode === "predicted" ? ((abgSessionData.predictedPath || []).length + " 个预测原子") : "组织权限空间";
    var trace = panel.querySelector("[data-abg-trace]");
    if (trace) {
      var traceItems = abgSessionData.decisionTrace?.steps || abgSessionData.decisionTrace?.decisionPath || abgSessionData.decisionTrace?.trace || [];
      if (!Array.isArray(traceItems)) traceItems = [];
      trace.innerHTML = traceItems.map(function (step, index) { return "<tr><td>" + escapeHtml(step.name || step.stage || ("Step " + (index + 1))) + "</td><td>" + escapeHtml(step.source || step.provider || "Decision Trace") + "</td><td>" + badge(step.verdict || step.action || "observed", verdictClass(step.verdict || step.action)) + "</td><td>" + escapeHtml(step.reason || step.detail || step.rule || "-") + "</td></tr>"; }).join("") || '<tr><td colspan="4" class="empty">当前会话暂无结构化 Decision Trace 步骤</td></tr>';
    }
  }

  function renderSessionOrbit(session) {
    var panel = ensureSessionOrbitPanel();
    if (!panel || !session || !session.id) return;
    abgSessionData = null;
    api("/api/sessions/" + encodeURIComponent(session.id) + "/orbit").then(function (data) { abgSessionData = data; if (["permission", "predicted", "actual"].indexOf(abgSessionMode) < 0) abgSessionMode = "permission"; abgPlaybackIndex = 0; panel.querySelectorAll("[data-abg-mode]").forEach(function (button) { button.classList.toggle("active", button.getAttribute("data-abg-mode") === abgSessionMode); }); abgRenderSessionOrbit(panel); }).catch(function (error) { abgSessionData = { unavailable: true, message: "会话 Orbit 加载失败：" + (error.message || "API unavailable") }; abgRenderSessionOrbit(panel); });
  }

  function ensurePolicyAbgPanel() {
    var page = document.getElementById("page-policy");
    if (!page) return null;
    var panel = page.querySelector(".abg-policy-panel");
    if (panel) return panel;
    var layout = page.querySelector(".policy-layout");
    if (!layout) return null;
    panel = document.createElement("div");
    panel.className = "panel section-gap abg-policy-panel";
    panel.innerHTML = '<div class="panel-head"><div><h2>Policy Orbit 与行为原子</h2><p>组织权限空间由当前策略生成；行为原子支持查看、扩展、禁用和命中统计。</p></div><span class="badge info">POLICY SPACE</span></div><div class="panel-body"><div class="abg-boundary-config"><div><strong>组织边界等级</strong><p class="small muted">每个领域的 L0-L5 是所有 Agent 和任务的全局上限，保存后进入策略签名、验证和回滚链。</p></div><div class="abg-boundary-levels">' + abgDomains.map(function (domain) { return '<label><span>' + escapeHtml(domain[1]) + '</span><input type="number" min="0" max="5" data-abg-domain-level="' + domain[0] + '"></label>'; }).join("") + '</div><div class="abg-boundary-actions"><span class="small muted" data-abg-boundary-status>当前配置未修改</span><button class="btn primary" data-abg-boundary-save>保存组织边界</button></div></div><div class="abg-catalog"><div><div class="abg-orbit-box"><svg id="abgPolicySvg" viewBox="0 0 520 300" role="img" aria-label="组织权限空间"></svg></div><div class="abg-legend"><span><i style="background:#527184"></i>组织边界</span><span><i style="background:#b42318"></i>禁止行为原子</span><span><i style="background:#2463c4"></i>L0-L5 权限等级</span></div></div><div><div class="abg-atom-form"><input class="input" id="abgAtomId" placeholder="例如 DATA.CUSTOM_EXPORT"><input class="input" id="abgAtomDescription" placeholder="行为原子说明"><input class="input" id="abgAtomLevel" type="number" min="0" max="5" value="3"><button class="btn primary" id="abgAtomAdd">新增</button></div><div class="abg-controls"><input class="input" id="abgAtomSearch" placeholder="搜索行为原子或域名"><span class="small muted" id="abgAtomCount"></span></div><div class="table-wrap" style="max-height:430px"><table class="abg-catalog-table"><thead><tr><th>行为原子</th><th>等级</th><th>命中</th><th>允许 / 审查 / 阻断</th><th>状态</th><th></th></tr><tbody id="abgAtomTable"></tbody></table></div></div></div></div>';
    panel.querySelector(".abg-orbit-box").insertAdjacentHTML("afterbegin", '<button class="btn abg-fullscreen" data-abg-fullscreen title="全屏查看组织权限空间">全屏</button>');
    panel.querySelector(".panel-body").insertAdjacentHTML("beforeend", '<div class="abg-node-detail">选择权限空间中的行为原子查看当前组织边界与命中状态。</div>');
    var versionPanel = page.querySelector(".version-row")?.closest(".panel");
    if (versionPanel) versionPanel.insertAdjacentElement("beforebegin", panel); else page.appendChild(panel);
    panel.querySelector("#abgAtomAdd").addEventListener("click", function () {
      var id = panel.querySelector("#abgAtomId").value.trim().toUpperCase();
      if (!/^[A-Z][A-Z0-9_-]*\.[A-Z][A-Z0-9_-]*$/.test(id)) { window.alert("行为原子格式应为 DOMAIN.NAME"); return; }
      api("/api/behavior-atoms", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: id, description: panel.querySelector("#abgAtomDescription").value.trim() || "自定义行为原子", baseLevel: Number(panel.querySelector("#abgAtomLevel").value || 3) }) }).then(refresh);
    });
    panel.querySelector("[data-abg-boundary-save]").addEventListener("click", function () {
      var levels = {};
      panel.querySelectorAll("[data-abg-domain-level]").forEach(function (input) { levels[input.getAttribute("data-abg-domain-level")] = Math.max(0, Math.min(5, Number(input.value || 0))); });
      var button = panel.querySelector("[data-abg-boundary-save]");
      var status = panel.querySelector("[data-abg-boundary-status]");
      button.disabled = true;
      status.textContent = "正在验证并签名...";
      api("/api/policy", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ organizationBoundary: { levels: levels, maxLevel: Math.max.apply(null, Object.keys(levels).map(function (key) { return levels[key]; })), source: "policy.organizationBoundary.ui" } }) }).then(function () { status.textContent = "组织边界已保存并生效"; refresh(); }).catch(function (error) { status.textContent = "保存失败：" + (error.message || "API unavailable"); }).then(function () { button.disabled = false; });
    });
    panel.querySelector("#abgAtomSearch").addEventListener("input", function () { renderPolicyAbg(); });
    return panel;
  }

  function renderPolicyAbg() {
    var panel = ensurePolicyAbgPanel();
    if (!panel) return;
    var data = state.behaviorAtoms || { catalog: [] };
    data.boundary = data.boundary || {};
    var boundaryLevels = data.boundary.levels || {};
    panel.querySelectorAll("[data-abg-domain-level]").forEach(function (input) { var domain = input.getAttribute("data-abg-domain-level"); input.value = String(boundaryLevels[domain] ?? data.boundary.maxLevel ?? 3); });
    var policyItems = (data.catalog || []).map(function (atom, index) {
      var stats = atom.stats || {};
      var deniedByPolicy = (data.boundary.deniedAtoms || []).some(function (id) { return String(id).toUpperCase() === String(atom.id).toUpperCase(); });
      var allowedLevel = Number(data.boundary.levels?.[atom.domain] ?? data.boundary.maxLevel ?? 3);
      var outside = atom.enabled === false || deniedByPolicy || Number(atom.baseLevel || 0) > allowedLevel;
      return { atomId: atom.id, level: atom.baseLevel, requiredLevel: atom.baseLevel, hits: stats.hits || 0, boundaryScope: outside ? "organization" : "within", verdict: outside ? "block" : "allow", sequence: index + 1, timestamp: stats.lastSeen };
    });
    abgRenderSvg(panel.querySelector("#abgPolicySvg"), policyItems, "permission", data.boundary || {}, data.catalog || []);
    var query = String(panel.querySelector("#abgAtomSearch")?.value || "").toLowerCase();
    var rows = (data.catalog || []).filter(function (atom) { return !query || String(atom.id + " " + atom.description + " " + atom.domain).toLowerCase().indexOf(query) >= 0; });
    panel.querySelector("#abgAtomCount").textContent = "共 " + rows.length + " 个行为原子";
    panel.querySelector("#abgAtomTable").innerHTML = rows.map(function (atom) {
      var stats = atom.stats || {}; var stateLabel = atom.enabled === false ? "DISABLED" : atom.system ? "SYSTEM" : "CUSTOM";
      var action = atom.system ? "禁用" : "删除";
      return '<tr><td><span class="atom-id">' + escapeHtml(atom.id) + '</span><small>' + escapeHtml(atom.description || "") + '</small></td><td>L' + escapeHtml(atom.baseLevel) + '</td><td class="abg-hit ' + (stats.hits ? "danger" : "") + '">' + escapeHtml(stats.hits || 0) + '</td><td>' + escapeHtml((stats.allow || 0) + " / " + (stats.alert || 0) + " / " + (stats.block || 0)) + '</td><td>' + badge(stateLabel, atom.enabled === false ? "hold" : atom.highRisk ? "block" : "allow") + '</td><td><button class="btn" data-abg-atom-action="' + escapeHtml(atom.id) + '">' + action + '</button></td></tr>';
    }).join("") || '<tr><td colspan="6" class="empty">没有匹配的行为原子</td></tr>';
    panel.querySelectorAll("[data-abg-atom-action]").forEach(function (button) { button.addEventListener("click", function () { api("/api/behavior-atoms/" + encodeURIComponent(button.getAttribute("data-abg-atom-action")), { method: "DELETE" }).then(refresh); }); });
  }

  function renderBehavior() {
    var stats = state.eventStats || {};
    var byVerdict = {};
    (stats.byVerdict || []).forEach(function (row) { byVerdict[row.verdict] = row.c || 0; });
    var values = [stats.total || state.events.length, 0, byVerdict.block || 0, byVerdict.alert || 0, 0];
    values.forEach(function (value, index) {
      var element = document.querySelectorAll("#page-behavior .behavior-kpi strong")[index];
      if (element) element.textContent = String(value);
    });
    var list = document.getElementById("eventList");
    if (!list) return;
    var eventSubtitle = document.querySelector("#page-behavior .behavior-layout .panel-head p");
    if (eventSubtitle) eventSubtitle.textContent = "\u4ec5\u5c55\u793a\u5df2\u5173\u8054 Agent \u6216\u4f1a\u8bdd\u7684\u4e8b\u4ef6\uff1b\u4e3b\u673a\u7ea7\u9065\u6d4b\u4fdd\u7559\u5728\u5ba1\u8ba1\u63a5\u53e3\u548c\u7cfb\u7edf\u9875\u3002";
    var sessionAgents = {};
    (state.sessions || []).forEach(function (session) {
      var sessionId = session && (session.id || session.sessionId);
      var sessionAgent = session && (session.agent || session.agentId);
      if (sessionId && sessionAgent) sessionAgents[String(sessionId)] = sessionAgent;
    });
    var agentEvents = state.events.filter(function (event) {
      return Boolean(eventAgentId(event) || sessionAgents[String(event.sessionId || event.session_id || "")]);
    });
    list.innerHTML = agentEvents.slice(0, 30).map(function (event) {
      var kind = event.verdict === "block" ? "block" : event.verdict === "alert" ? "drift" : "all";
      var atomId = event.atomId || event.atom_id || event.detail && (event.detail.atomId || event.detail.atom_id) || "";
      var boundary = eventBoundaryLabel(event);
      var meta = [atomId, boundary].filter(Boolean).join(" · ");
      var agentId = eventAgentId(event) || sessionAgents[String(event.sessionId || event.session_id || "")];
      var agentLabel = agentId ? agentName(agentId) : "未归属事件";
      return '<div class="event-row" data-kind="' + kind + '"><span class="event-time">' + escapeHtml(formatTime(event.timestamp)) + '</span><span class="event-agent">' + escapeHtml(agentLabel) + '</span><span class="event-desc">' + escapeHtml(event.summary || event.category || "行为事件") + (meta ? '<small class="event-meta">' + escapeHtml(meta) + '</small>' : '') + '</span>' + badge(String(event.verdict || "allow").toUpperCase(), verdictClass(event.verdict)) + '</div>';
    }).join("") || '<div class="empty">当前窗口暂无已关联 Agent 的行为事件</div>';
    renderAbgBehavior();
  }

  function renderPolicy() {
    var policy = state.policy || {};
    var verification = policy.policyVerification || {};
    var page = document.getElementById("page-policy");
    if (!page) return;
    var version = page.querySelector(".panel-head h2");
    if (version && /策略中心/.test(version.textContent)) version.textContent = "策略中心";
    var badges = page.querySelectorAll(".badge");
    if (badges.length && verification.valid === false) {
      badges[0].textContent = "待验证";
      badges[0].className = "badge hold";
    }
    renderPolicyAbg();
  }

  function renderSemantic() {
    var local = state.localSemantic || {};
    var remote = state.remoteSemantic || {};
    var localStatus = document.querySelector('#page-semantic [data-provider="local"] .badge');
    if (localStatus) {
      localStatus.textContent = local.config && local.config.enabled !== false ? "已连接" : "未启用";
      localStatus.className = "badge " + (local.config && local.config.enabled !== false ? "allow" : "neutral");
    }
    var remoteStatus = document.querySelector('#page-semantic [data-provider="deepseek"] .badge');
    if (remoteStatus) {
      remoteStatus.textContent = remote.config && remote.config.apiKeyConfigured ? "已配置" : "未配置";
      remoteStatus.className = "badge " + (remote.config && remote.config.apiKeyConfigured ? "allow" : "neutral");
    }
  }

  function renderSystem() {
    var page = document.getElementById("page-system");
    if (!page) return;
    var status = state.status || {};
    var service = page.querySelector(".health-card .health-state");
    if (service) service.textContent = "运行中";
    var detail = page.querySelector(".health-card .health-detail");
    if (detail && status.pid) detail.textContent = "AIDR Endpoint\nPID " + status.pid + "\n实时监控正常";
    var metrics = state.performance || {};
    var behavior = metrics.behaviorView || {};
    var card = page.querySelector(".aidr-performance-card");
    if (!card) {
      var grid = page.querySelector(".system-grid");
      if (grid) {
        card = document.createElement("div");
        card.className = "panel health-card aidr-performance-card";
        card.innerHTML = '<h3>运行时性能</h3><div class="health-state"><span class="dot"></span>遥测稳定</div><div class="health-detail"></div>';
        grid.appendChild(card);
      }
    }
    if (card) {
      var metricDetail = card.querySelector(".health-detail");
      if (metricDetail) metricDetail.innerHTML = "行为视图缓存命中率：" + Math.round(Number(behavior.cacheHitRate || 0) * 100) + "%<br>最近计算：" + (behavior.lastDurationMs || 0) + " ms · 事件 " + (behavior.lastSourceCount || 0) + " 条<br>进程内存：" + Math.round(Number(metrics.process?.rssBytes || 0) / 1048576) + " MB";
    }
  }

  function initialPage() {
    var query = new URLSearchParams(window.location.search).get("view");
    var map = { events: "behavior", overview: "overview", sessions: "sessions", agents: "agents", policy: "policy", behavior: "behavior", semantic: "semantic", system: "system" };
    var page = map[query] || window.location.hash.replace(/^#/, "");
    if (page) navigate(page);
  }

  function navigate(page) {
    var titleMap = { overview: "安全概述", sessions: "意图分析", agents: "Agent发现", policy: "策略中心", behavior: "行为监控", semantic: "语义模型", system: "系统" };
    document.querySelectorAll(".nav button").forEach(function (item) {
      item.classList.toggle("active", item.getAttribute("data-page") === page);
    });
    document.querySelectorAll(".page").forEach(function (item) {
      item.classList.toggle("active", item.id === "page-" + page);
    });
    text("#topTitle", titleMap[page] || "AIDR");
    if (window.location.hash !== "#" + page) window.history.replaceState(null, "", "#" + page);
  }

  function refresh() {
    if (refreshInFlight) return refreshInFlight;
    ensureAbgStyles();
    refreshInFlight = Promise.allSettled([
      api("/api/status"),
      api("/api/agents"),
      api("/api/sessions?compact=1&limit=40"),
      api("/api/events?limit=100"),
      api("/api/events/stats"),
      api("/api/policy"),
      api("/api/semantic/local-config"),
      api("/api/semantic/config"),
      api("/api/behavior-atoms?windowHours=24&pathLimit=160&occurrenceLimit=200"),
      api("/api/diagnostics/performance")
    ]).then(function (results) {
      state.status = results[0].status === "fulfilled" ? results[0].value : {};
      state.agents = results[1].status === "fulfilled" ? (results[1].value.agents || []) : [];
      state.sessions = results[2].status === "fulfilled" ? (results[2].value.sessions || []) : [];
      state.events = results[3].status === "fulfilled" ? (results[3].value.events || []) : [];
      state.eventStats = results[4].status === "fulfilled" ? results[4].value : {};
      state.policy = results[5].status === "fulfilled" ? results[5].value : {};
      state.localSemantic = results[6].status === "fulfilled" ? results[6].value : {};
      state.remoteSemantic = results[7].status === "fulfilled" ? results[7].value : {};
      state.behaviorAtoms = results[8].status === "fulfilled" ? results[8].value : { catalog: [], agents: [], stats: [] };
      state.performance = results[9].status === "fulfilled" ? results[9].value : {};
      renderOverview();
      renderAgents();
      renderSessions();
      renderBehavior();
      renderPolicy();
      renderSemantic();
      renderSystem();
      document.documentElement.setAttribute("data-aidr-data", "live");
    }).finally(function () { refreshInFlight = null; });
    return refreshInFlight;
  }

  window.refreshAidrData = refresh;
  window.aidrNavigate = navigate;
  initialPage();
  document.getElementById("refreshBtn")?.addEventListener("click", refresh);
  document.querySelectorAll(".nav button").forEach(function (button) {
    button.addEventListener("click", function () { window.setTimeout(refresh, 0); });
  });
  refresh();
  window.setInterval(refresh, 15000);
})();
