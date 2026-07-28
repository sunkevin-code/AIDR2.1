(function () {
  "use strict";

  var state = { agents: [], sessions: [], events: [], status: {}, policy: {}, behaviorAtoms: { catalog: [], agents: [], stats: [] }, dataErrors: {}, lastSuccessfulRefresh: null, hasSuccessfulDataset: false };
  var dataSource = (function () {
    var modeMeta = document.querySelector('meta[name="aidr-data-mode"]');
    var baseMeta = document.querySelector('meta[name="aidr-api-base"]');
    var endpointMeta = document.querySelector('meta[name="aidr-endpoint-id"]');
    return {
      mode: modeMeta ? modeMeta.getAttribute("content") : "local",
      base: (baseMeta ? baseMeta.getAttribute("content") : "").replace(/\/$/, ""),
      endpointId: endpointMeta ? endpointMeta.getAttribute("content") : ""
    };
  })();
  var abgSelectedAgent = "";
  var abgSelectedAtomId = "";
  var abgSessionMode = "permission";
  var abgSessionData = null;
  var abgSessionRequestSequence = 0;
  var abgViewport = { x: 0, y: 0, scale: 1 };
  var abgPlaybackTimer = null;
  var abgPlaybackIndex = 0;
  var abgBehaviorPlaybackTimer = null;
  var abgBehaviorPlaybackIndex = null;
  var abgMotionEnabled = true;
  var refreshInFlight = null;
  var ABG_VIEW_TITLE = "Policy Orbit · 行为原子空间";

  function ensureAbgStyles() {
    if (!document.getElementById("aidr-abg-runtime-style")) {
      var style = document.createElement("style");
      style.id = "aidr-abg-runtime-style";
      style.textContent = ".abg-orbit-box{position:relative;min-height:360px;overflow:hidden;background:radial-gradient(circle at 50% 50%,#f8fcfc 0,#f4f8f9 54%,#edf3f5 100%)}.abg-orbit-box svg{display:block;width:100%;height:100%;min-height:360px;touch-action:none;cursor:grab}.abg-orbit-box svg:active{cursor:grabbing}.abg-orbit-box:fullscreen{background:#071018;padding:18px}.abg-orbit-box:fullscreen svg{height:calc(100vh - 36px);min-height:0}.abg-orbit-box .abg-node{cursor:pointer;transition:filter .15s,stroke-width .15s}.abg-orbit-box .abg-node:hover,.abg-orbit-box .abg-node.selected{stroke:#173045;stroke-width:3;filter:drop-shadow(0 0 3px rgba(23,48,69,.35))}.abg-orbit-box .abg-node-label{pointer-events:none}.abg-node-detail{margin-top:10px;border:1px solid #cde2e6;border-radius:6px;background:#f8fbfc;padding:10px;font-size:11px;line-height:1.55}.abg-node-detail b{color:#173045}.abg-replay{display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin:8px 0}.abg-replay input{flex:1;min-width:120px;accent-color:#147f73}.abg-fullscreen{position:absolute;right:10px;top:10px;z-index:2}.abg-space-legend{display:flex;gap:12px;flex-wrap:wrap;margin-top:8px;font-size:11px;color:#687587}.abg-space-legend span{display:inline-flex;align-items:center;gap:5px}.abg-space-legend i{display:inline-block;width:18px;height:3px;border-radius:2px}.abg-ring{fill:none;stroke:#c9d8de;stroke-width:1}.abg-axis{stroke:#d5e1e5;stroke-width:1;stroke-dasharray:3 5}.abg-label{fill:#4c6474;font-size:10px;font-weight:600}.abg-level-label{fill:#78909e;font-size:10px}.abg-boundary{fill:rgba(20,127,115,.08);stroke:#147f73;stroke-width:2;stroke-dasharray:7 5}.abg-task-boundary{fill:rgba(194,118,0,.07);stroke:#c27600;stroke-width:2;stroke-dasharray:4 4}.abg-node.organization{fill:#b42318}.abg-node.task{fill:#c27600}.abg-node.within{fill:#147f73}.abg-node.predicted{fill:#718493}.abg-node.request{fill:#a35b00}.abg-node.current{animation:abgPulse 1.1s ease-out infinite}.abg-node-label{fill:#173045;font-size:9px}.abg-path{fill:none;stroke:#147f73;stroke-width:2.6;stroke-linecap:round;stroke-linejoin:round;stroke-dasharray:9 6;animation:abgFlow 1.15s linear infinite}.abg-request{fill:none;stroke:#a35b00;stroke-width:2.2;stroke-linecap:round;stroke-linejoin:round;stroke-dasharray:4 6;animation:abgFlow 1.25s linear infinite}.abg-predicted{fill:none;stroke:#718493;stroke-width:2;stroke-dasharray:7 7;animation:abgFlow 1.6s linear infinite}.abg-risk-boundary{fill:none;stroke:#b42318;stroke-width:2.8;stroke-linecap:round;stroke-linejoin:round;stroke-dasharray:9 5;animation:abgFlow .9s linear infinite}.abg-flow-particle{fill:#147f73;filter:drop-shadow(0 0 4px rgba(20,127,115,.65))}.abg-flow-particle.risk{fill:#b42318;filter:drop-shadow(0 0 5px rgba(180,35,24,.7))}.abg-flow-particle.request{fill:#a35b00;filter:drop-shadow(0 0 5px rgba(163,91,0,.7))}.abg-boundary-config{border:1px solid #cde2e6;border-radius:7px;background:#f8fbfc;padding:12px;margin-bottom:14px}.abg-boundary-config>div:first-child{display:flex;justify-content:space-between;gap:12px;align-items:flex-start}.abg-boundary-config p{margin:3px 0 0}.abg-boundary-levels{display:grid;grid-template-columns:repeat(9,minmax(60px,1fr));gap:7px;margin-top:10px}.abg-boundary-levels label{display:grid;gap:4px;font-size:10px;color:#687587}.abg-boundary-levels input{width:100%;height:30px;border:1px solid #bfd0d8;border-radius:5px;padding:4px 6px;background:#fff}.abg-boundary-actions{display:flex;justify-content:space-between;align-items:center;gap:10px;margin-top:10px}.abg-trace-strip{font-size:9px}.abg-trace-strip rect{fill:#fff;stroke:#b9cbd2;stroke-width:1}.abg-trace-strip .trace-index{fill:#147f73;font-weight:700}.abg-trace-strip .trace-name{fill:#173045;font-weight:700}.abg-trace-strip .trace-source{fill:#687587}@keyframes abgFlow{to{stroke-dashoffset:-30}}@keyframes abgPulse{0%{stroke-width:2;opacity:1}100%{stroke-width:9;opacity:.15}}";
      style.textContent += ".policy-layout{grid-template-columns:minmax(0,1fr)!important}.abg-boundary-config{display:none!important}.abg-catalog{grid-template-columns:minmax(0,1.08fr) minmax(500px,.92fr)}.abg-lattice-side{min-width:0;border:1px solid #d8e5e8;border-radius:7px;background:#fbfdfd;padding:10px}.abg-lattice-head{display:flex;justify-content:space-between;align-items:flex-start;gap:8px;margin-bottom:8px}.abg-lattice-head strong{color:#173045}.abg-lattice-head p{margin:3px 0 0;color:#687587;font-size:11px;line-height:1.45}.abg-lattice-toolbar{display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:8px}.abg-lattice-toolbar .choice{font-size:10px;padding:5px 7px}.abg-lattice-toolbar .choice.active{background:#173045;color:#fff;border-color:#173045}.abg-lattice-filter{flex:1;min-width:130px;height:30px}.abg-capability-grid-wrap{overflow:auto;border:1px solid #d8e5e8;border-radius:6px;background:#fff;max-height:522px}.abg-capability-grid{display:grid;grid-template-columns:78px repeat(6,minmax(72px,1fr));min-width:520px}.abg-lattice-corner,.abg-lattice-level,.abg-lattice-domain,.abg-lattice-cell{border-right:1px solid #dbe7ea;border-bottom:1px solid #dbe7ea}.abg-lattice-corner,.abg-lattice-level{position:sticky;top:0;z-index:2;background:#f3f8f9;color:#526879;font-size:10px;font-weight:700;padding:7px 5px;text-align:center}.abg-lattice-corner{left:0;z-index:3}.abg-lattice-domain{position:sticky;left:0;z-index:1;background:#f7fbfb;padding:8px 6px;font-size:10px;font-weight:700;color:#173045}.abg-lattice-domain small{display:block;margin-top:2px;color:#7a8b96;font-size:9px;font-weight:400}.abg-lattice-cell{min-height:64px;padding:5px;display:flex;align-content:flex-start;flex-wrap:wrap;gap:3px;background:#fff}.abg-lattice-cell.empty{background:#fbfdfd}.abg-lattice-atom{display:inline-flex;align-items:center;gap:3px;max-width:100%;border:1px solid #c8dadd;border-radius:4px;padding:3px 4px;background:#f4faf9;color:#146f65;font-size:9px;line-height:1.1;cursor:pointer}.abg-lattice-atom:hover,.abg-lattice-atom.selected{border-color:#173045;box-shadow:0 0 0 2px rgba(23,48,69,.12)}.abg-lattice-atom.high{border-color:#e8a338;background:#fff7e8;color:#a35b00}.abg-lattice-atom.blocked{border-color:#e5aaa6;background:#fff1f0;color:#b42318}.abg-lattice-atom em{font-style:normal;font-weight:700;opacity:.72}.abg-lattice-footer{display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;margin-top:8px;color:#687587;font-size:10px}.abg-lattice-legend{display:flex;gap:8px;flex-wrap:wrap}.abg-lattice-legend span{display:inline-flex;align-items:center;gap:4px}.abg-lattice-legend i{width:8px;height:8px;border-radius:50%;display:inline-block}.abg-lattice-actions{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr) 70px auto;gap:6px;margin-top:9px}.abg-lattice-actions .input{min-width:0}.abg-lattice-detail{margin-top:8px;padding:8px;border:1px solid #d8e5e8;border-radius:5px;background:#f7fbfb;color:#526879;font-size:10px;line-height:1.45;min-height:34px}@media(max-width:1380px){.abg-catalog{grid-template-columns:1fr}.abg-capability-grid-wrap{max-height:430px}}";
      style.textContent += ".abg-intent-evidence{border:1px solid #cde2e6;border-radius:7px;background:#f8fbfc;padding:10px;margin-bottom:10px}.abg-intent-evidence-head{display:flex;justify-content:space-between;gap:10px;align-items:center;margin-bottom:7px}.abg-intent-evidence-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:7px}.abg-intent-evidence-item{border:1px solid #d8e5e8;border-radius:5px;background:#fff;padding:7px;min-width:0}.abg-intent-evidence-item b{display:block;color:#526879;font-size:10px;font-weight:600;margin-bottom:2px}.abg-intent-evidence-item span{display:block;overflow-wrap:anywhere;font-size:12px;color:#173045}.abg-intent-evidence-chips{display:flex;gap:5px;flex-wrap:wrap;margin-top:7px}.abg-intent-evidence-chip{border:1px solid #c6dadd;border-radius:4px;background:#fff;padding:3px 6px;font-size:10px;color:#315565}@media(max-width:800px){.abg-intent-evidence-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}";
      style.textContent += ".session-layout{grid-template-columns:285px minmax(0,1fr) 340px}.evidence{align-self:start;min-width:0}.prompt-history-side{margin-top:14px;padding-top:14px;border-top:1px solid #dce7eb}.prompt-history-side .panel-head{padding:0 0 10px}.prompt-history-side .panel-body{padding:4px 0 0;max-height:430px;overflow:auto}.prompt-history-side .trace-row{grid-template-columns:24px 48px minmax(0,1fr) auto;gap:6px;padding:9px 0}.prompt-history-side .trace-kind{white-space:nowrap;font-size:10px}.prompt-history-side .trace-detail{min-width:0}.prompt-history-side .trace-detail>span:first-child{display:block;overflow-wrap:anywhere}.abg-orbit-box{min-height:410px}.abg-orbit-box svg{min-height:410px}.abg-node-label{paint-order:stroke;stroke:#fbfdfd;stroke-width:3px;stroke-linejoin:round}.abg-node.organization .abg-node-label{stroke:#fff7f6}@media(max-width:1180px){.session-layout{grid-template-columns:250px minmax(0,1fr)}.evidence{grid-column:1/-1}}@media(max-width:780px){.session-layout{grid-template-columns:1fr}.evidence{grid-column:auto}.prompt-history-side .panel-body{max-height:none}.abg-orbit-box{min-height:360px}.abg-orbit-box svg{min-height:360px}}";
      style.textContent += ".abg-sector-fill{stroke:none;pointer-events:none}.abg-sector-fill.alt{fill:rgba(20,127,115,.045)}.abg-sector-fill:not(.alt){fill:rgba(82,113,132,.022)}.abg-sector-edge{stroke:#a9bdc6;stroke-width:1.35;stroke-dasharray:4 4;vector-effect:non-scaling-stroke}.abg-orbit-box .abg-axis{stroke:#c4d4da;stroke-width:1;stroke-dasharray:none}.abg-orbit-box .abg-label{paint-order:stroke;stroke:#fbfdfd;stroke-width:4px;stroke-linejoin:round}.abg-node-hit{fill:transparent;stroke:transparent!important;pointer-events:all}";
      style.textContent += ".abg-orbit-box .abg-boundary{fill:rgba(230,93,164,.10);stroke:#e65da4;stroke-width:2.5}.abg-orbit-box .abg-task-boundary{fill:rgba(255,138,30,.13);stroke:#ff8a1e;stroke-width:2.5}.abg-orbit-box .abg-boundary,.abg-orbit-box .abg-task-boundary,.abg-orbit-box .abg-risk-boundary{pointer-events:none}.abg-boundary-anchor{fill:#fff;stroke-width:2.4;pointer-events:none}.abg-boundary-anchor.organization{stroke:#e65da4}.abg-boundary-anchor.task{stroke:#ff8a1e}.abg-domain-label rect{fill:rgba(255,255,255,.88);stroke:#c9d8de;stroke-width:1}.abg-domain-label .abg-label{font-size:10px}.abg-actual-path{fill:none;stroke:#2f8be6;stroke-width:3;stroke-linecap:round;stroke-linejoin:round}.abg-node.actual{fill:#2f8be6;stroke:#fff;stroke-width:2}.abg-block-gate circle{fill:#fff0ef;stroke:#b42318;stroke-width:2.5}.abg-block-gate path{stroke:#b42318;stroke-width:2.5;stroke-linecap:round}.abg-block-gate text{fill:#b42318;font-size:9px;font-weight:700;paint-order:stroke;stroke:#fff;stroke-width:3px}.abg-task-gate circle{fill:#fff5df;stroke:#c27600;stroke-width:2.5}.abg-task-gate path{stroke:#c27600;stroke-width:2.5;stroke-linecap:round}.abg-task-gate text{fill:#a35b00;font-size:9px;font-weight:700;paint-order:stroke;stroke:#fff;stroke-width:3px}.abg-node.aggregate{stroke-width:2.2}.abg-node.aggregate.within{fill:#6f8792}.abg-node.aggregate.task{fill:#c27600}.abg-node.aggregate.organization{fill:#b42318}";
      style.textContent += ".abg-orbit-box .abg-boundary{stroke-width:3;stroke-dasharray:10 5}.abg-orbit-box .abg-task-boundary{stroke-width:3.4;stroke-dasharray:3 3}.abg-boundary-halo{fill:none;stroke:rgba(255,255,255,.92);stroke-width:7;pointer-events:none}.abg-boundary-key rect{fill:rgba(255,255,255,.94);stroke:#c9d8de;stroke-width:1}.abg-boundary-key text{font-size:9px;font-weight:700;fill:#33495e}.abg-boundary-key .organization{stroke:#e65da4;stroke-width:3;stroke-dasharray:10 5}.abg-boundary-key .task{stroke:#ff8a1e;stroke-width:3.4;stroke-dasharray:3 3}";
      style.textContent += ".abg-exclusion-boundary{fill:rgba(180,35,24,.08);stroke:#b42318;stroke-width:1.8;stroke-dasharray:3 2;pointer-events:none}.abg-exclusion-label{fill:#b42318;font-size:8px;font-weight:700;paint-order:stroke;stroke:#fff;stroke-width:3px;pointer-events:none}";
      style.textContent += ".behavior-ops{display:grid;grid-template-columns:minmax(0,1.25fr) minmax(300px,.75fr);gap:12px;margin-top:12px}.behavior-funnel,.behavior-quality{border:1px solid #d8e5e8;border-radius:7px;background:#fff;padding:13px}.behavior-ops-head{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:10px}.behavior-ops-head h3{font-size:13px;margin:0}.behavior-funnel-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:7px}.behavior-stage{position:relative;border:1px solid #dce7eb;border-radius:6px;padding:9px;background:#f9fbfc}.behavior-stage small,.quality-item small{display:block;color:#687587;font-size:10px}.behavior-stage b{display:block;margin-top:4px;font-size:18px;color:#173045}.behavior-stage.block b{color:#b42318}.behavior-stage.alert b{color:#a35b00}.quality-list{display:grid;gap:7px}.quality-item{display:flex;align-items:center;justify-content:space-between;gap:10px;border-bottom:1px solid #edf2f4;padding-bottom:7px}.quality-item:last-child{border-bottom:0;padding-bottom:0}.quality-item b{font-size:11px}.event-row{cursor:pointer}.event-row.selected{background:#eef8f6;box-shadow:inset 3px 0 #147f73}.behavior-evidence{margin-top:10px;border:1px solid #cde2e6;border-radius:6px;background:#f8fbfc;padding:11px;display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px}.behavior-evidence[hidden]{display:none}.behavior-evidence small{display:block;color:#687587;font-size:10px;margin-bottom:3px}.behavior-evidence b{display:block;overflow-wrap:anywhere;font-size:11px}@media(max-width:980px){.behavior-ops{grid-template-columns:1fr}.behavior-funnel-grid,.behavior-evidence{grid-template-columns:repeat(2,minmax(0,1fr))}}";
      style.textContent += ".policy-rule-actions{display:flex;gap:5px;justify-content:flex-end;flex-wrap:wrap}.policy-rule-actions .btn{padding:5px 8px}.policy-rule-editor{border-top:1px solid #e4eaee;background:#fbfdfd}.policy-rule-editor-actions{display:flex;align-items:center;gap:8px;margin-top:10px}.policy-row{grid-template-columns:minmax(220px,.9fr) minmax(360px,1.5fr) 78px auto!important}.policy-row .policy-sub{margin-bottom:4px}.policy-baseline-summary{display:grid;grid-template-columns:repeat(6,minmax(110px,1fr));gap:10px}.policy-rule-groups{display:grid;gap:6px;min-width:0}.policy-rule-groups>div{display:flex;align-items:center;gap:5px;min-width:0;overflow:hidden}.policy-rule-groups .badge{max-width:190px;overflow:hidden;text-overflow:ellipsis}.policy-domain-table{margin-top:14px}@media(max-width:1100px){.policy-row{grid-template-columns:1fr 110px!important}.policy-rule-groups,.policy-rule-actions{grid-column:1/-1}.policy-rule-actions{justify-content:flex-start}.policy-baseline-summary{grid-template-columns:repeat(3,minmax(110px,1fr))}}";
      document.head.appendChild(style);
    }
    if (!document.getElementById("aidr-abg-boundary-style")) {
      var boundaryStyle = document.createElement("style");
      boundaryStyle.id = "aidr-abg-boundary-style";
      boundaryStyle.textContent = ".abg-boundary-strip{display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:8px 17px;border-bottom:1px solid #dbe7ea;background:#f7fbfb;font-size:11px}.abg-boundary-strip strong{color:#173045}.abg-boundary-strip [data-abg-boundary-summary]{color:#147f73}.abg-boundary-strip [data-abg-boundary-meta]{flex:1;min-width:220px}.abg-boundary-strip .badge{white-space:nowrap}.abg-lattice-detail-title{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:8px}.abg-lattice-detail-title b{font-size:12px}.abg-lattice-detail-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:7px}.abg-lattice-detail-grid>div{border:1px solid #d8e5e8;border-radius:5px;background:#fff;padding:7px;min-width:0}.abg-lattice-detail-grid small,.abg-impact-preview small{display:block;color:#687587;margin-bottom:3px}.abg-lattice-detail-grid strong,.abg-lattice-detail-grid span{display:block;overflow-wrap:anywhere}.abg-lattice-detail-grid span{margin-top:2px;color:#687587}.abg-impact-preview{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:7px;padding:7px;border:1px solid #f0d190;border-radius:5px;background:#fff9ec;color:#7b5000}.abg-impact-preview small{margin:0}.abg-impact-preview span{color:#687587}@media(max-width:780px){.abg-lattice-detail-grid{grid-template-columns:1fr}}";
      document.head.appendChild(boundaryStyle);
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
  function ensureBoundaryStrip(panel) {
    if (!panel || panel.querySelector("[data-abg-boundary-strip]")) return;
    var panelHead = panel.querySelector(".panel-head");
    if (!panelHead) return;
    ensureAbgStyles();
    panelHead.insertAdjacentHTML("afterend", '<div class="abg-boundary-strip" data-abg-boundary-strip><strong>\u7ec4\u7ec7\u6743\u9650\u8fb9\u754c</strong><span data-abg-boundary-summary>\u6b63\u5728\u540c\u6b65\u57fa\u7840\u7b56\u7565</span><span class="small muted" data-abg-boundary-meta></span><span class="badge allow" data-abg-boundary-state>\u5df2\u540c\u6b65</span></div>');
  }

  var labels = {
    "openai-codex": "OpenAI Codex",
    opencode: "OpenCode",
    hermes: "Hermes (AI 助手)",
    cursor: "Cursor"
  };
  function resolveApiPath(apiPath) {
    if (dataSource.mode !== "central") return apiPath;
    var target = dataSource.base + "/console" + apiPath;
    if (dataSource.endpointId && /^\/api\/(?:status|agents|sessions|events|behavior-atoms|orbits)/.test(apiPath)) {
      target += (target.indexOf("?") >= 0 ? "&" : "?") + "endpoint_id=" + encodeURIComponent(dataSource.endpointId);
    }
    return target;
  }

  function api(path, options) {
    var config = options || {};
    var headers = Object.assign({ Accept: "application/json" }, config.headers || {});
    var tokenMeta = document.querySelector('meta[name="aidr-ui-token"]');
    var uiToken = tokenMeta ? tokenMeta.getAttribute("content") : "";
    if (uiToken) headers["x-aidr-ui-token"] = uiToken;
    return fetch(resolveApiPath(path), Object.assign({}, config, { headers: headers, cache: "no-store" }))
      .then(function (response) {
        if (!response.ok) throw new Error("HTTP " + response.status);
        return response.json();
      });
  }

  function ensureEndpointSelector() {
    if (dataSource.mode !== "central" || document.getElementById("aidrEndpointSelector")) return;
    var topMeta = document.querySelector(".top-meta") || document.querySelector(".topbar");
    if (!topMeta) return;
    var select = document.createElement("select");
    select.id = "aidrEndpointSelector";
    select.className = "select";
    select.setAttribute("aria-label", "Endpoint");
    select.innerHTML = '<option value="">全部 Endpoint</option>';
    select.addEventListener("change", function () {
      dataSource.endpointId = select.value;
      refresh();
    });
    topMeta.insertBefore(select, topMeta.firstChild);
    fetch(dataSource.base + "/console/api/endpoints", { cache: "no-store" }).then(function (response) {
      if (!response.ok) throw new Error("HTTP " + response.status);
      return response.json();
    }).then(function (payload) {
      (payload.endpoints || payload || []).forEach(function (endpoint) {
        var option = document.createElement("option");
        option.value = endpoint.id;
        option.textContent = (endpoint.hostname || endpoint.id) + " · " + (endpoint.platform || "unknown");
        select.appendChild(option);
      });
    }).catch(function () {});
  }

  function renderDataHealth(errors) {
    var banner = document.getElementById("aidr-data-health");
    if (!banner) {
      banner = document.createElement("div");
      banner.id = "aidr-data-health";
      banner.setAttribute("role", "alert");
      banner.style.cssText = "display:none;margin:12px 30px 0;padding:10px 13px;border:1px solid #e6b8b4;border-left:4px solid #b42318;border-radius:6px;background:#fff4f3;color:#7a271f;font-size:12px;line-height:1.45";
      var topbar = document.querySelector(".topbar");
      if (topbar && topbar.parentNode) topbar.parentNode.insertBefore(banner, topbar.nextSibling);
    }
    var failed = Object.keys(errors || {});
    if (!failed.length) {
      banner.style.display = "none";
      banner.textContent = "";
      document.documentElement.setAttribute("data-aidr-data", "live");
      return;
    }
    banner.style.display = "block";
    var retained = state.hasSuccessfulDataset && state.lastSuccessfulRefresh
      ? "\u5df2\u4fdd\u7559 " + new Date(state.lastSuccessfulRefresh).toLocaleString() + " \u7684\u6700\u540e\u6210\u529f\u6570\u636e\uff08\u5df2\u8fc7\u671f\uff09"
      : "\u5f53\u524d\u6ca1\u6709\u53ef\u7528\u7684\u6210\u529f\u6570\u636e";
    banner.textContent = "\u6570\u636e\u670d\u52a1\u4e0d\u53ef\u7528\uff1a" + failed.join("\u3001") + "\u3002" + retained +
      "\uff0c\u8bf7\u5728\u201c\u7cfb\u7edf\u201d\u9875\u68c0\u67e5 User-mode Agent \u548c Agent API\u3002";
    document.documentElement.setAttribute("data-aidr-data", "degraded");
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
    renderSessionTaskPolicy({ effectivePolicy: session.effectivePolicy || {}, taskAuthorization: session.taskAuthorization || null, taskBoundary: session.taskBoundary || null });
    renderSessionOrbit(session);
  }

  function renderSessionTaskPolicy(snapshot) {
    var preview = document.getElementById("policyPreview");
    var button = document.getElementById("showPolicy");
    var panel = button && button.closest(".panel");
    if (!panel || !preview) return;
    var effective = snapshot && snapshot.effectivePolicy || {};
    var task = snapshot && snapshot.taskAuthorization || {};
    var capabilities = effective.capabilities || {};
    var enabledCapabilities = Object.keys(capabilities).filter(function (key) { return capabilities[key] === true; });
    var deniedCapabilities = Object.keys(capabilities).filter(function (key) { return capabilities[key] === false; });
    var allowedAtoms = task.allowedAtoms || effective.allowedAtoms || [];
    var conditionalAtoms = task.conditionalAtoms || effective.conditionalAtoms || [];
    var deniedAtoms = task.deniedAtoms || effective.deniedAtoms || [];
    var values = panel.querySelectorAll(".cap-value");
    if (values[0]) values[0].textContent = enabledCapabilities.join(" · ") || allowedAtoms.join(" · ") || "无";
    if (values[1]) values[1].textContent = deniedCapabilities.join(" · ") || deniedAtoms.join(" · ") || "无";
    if (values[2]) values[2].textContent = (effective.allowedDomains || []).join(" · ") || (capabilities.network ? "仅任务声明域名" : "禁止外部网络");
    if (values[3]) values[3].textContent = conditionalAtoms.length ? conditionalAtoms.length + " 个行为原子需审批" : "无";
    var subtitle = panel.querySelector(".panel-head p");
    if (subtitle) subtitle.textContent = "与当前会话任务边界使用同一份 session.effectivePolicy 快照。";
    preview.textContent = JSON.stringify({
      source: "session.effectivePolicy",
      capabilities: capabilities,
      authorization: {
        allow: allowedAtoms,
        requireApproval: conditionalAtoms,
        deny: deniedAtoms
      },
      allowedPaths: effective.allowedPaths || effective.allowedReadPaths || [],
      allowedDomains: effective.allowedDomains || [],
      taskBoundary: snapshot && snapshot.taskBoundary || null
    }, null, 2);
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

  function abgAtomicBoundary(catalog, boundary, layer, cx, cy, maxRadius) {
    var groups = window.AIDR_ABCG && window.AIDR_ABCG.selectBoundaryAtoms
      ? window.AIDR_ABCG.selectBoundaryAtoms(catalog, boundary, layer, abgDomainKeys)
      : [];
    var anchors = [];
    var polygon = [];
    groups.forEach(function (group) {
      if (!group.atoms.length) {
        polygon.push({
          atomId: null,
          domain: group.domain,
          point: abgPoint(group.domain, Math.max(0, group.effectiveLevel), cx, cy, maxRadius),
          effectiveLevel: Math.max(0, group.effectiveLevel),
          synthetic: true
        });
        return;
      }
      var domainPoint = abgPoint(group.domain, group.effectiveLevel, cx, cy, maxRadius);
      var domainAnchors = [];
      group.atoms.forEach(function (atom) {
        var anchor = {
          atomId: atom.id,
          domain: group.domain,
          effectiveLevel: group.effectiveLevel,
          point: abgCatalogPosition(atom.id, atom.baseLevel, cx, cy, maxRadius, catalog)
        };
        anchors.push(anchor);
        domainAnchors.push(anchor);
      });
      domainAnchors.sort(function (left, right) {
        var leftDistance = Math.pow(left.point.x - domainPoint.x, 2) + Math.pow(left.point.y - domainPoint.y, 2);
        var rightDistance = Math.pow(right.point.x - domainPoint.x, 2) + Math.pow(right.point.y - domainPoint.y, 2);
        return leftDistance - rightDistance || left.atomId.localeCompare(right.atomId);
      });
      polygon.push(domainAnchors[0]);
    });
    if (!polygon.length) return { path: "", anchors: [], polygon: [], groups: groups };
    var path = "M" + polygon[0].point.x.toFixed(1) + " " + polygon[0].point.y.toFixed(1);
    polygon.slice(1).forEach(function (anchor) {
      path += " L" + anchor.point.x.toFixed(1) + " " + anchor.point.y.toFixed(1);
    });
    return { path: path + " Z", anchors: anchors, polygon: polygon, groups: groups };
  }

  function abgPointInsidePolygon(point, polygon) {
    if (!point || !Array.isArray(polygon) || polygon.length < 3) return false;
    var inside = false;
    for (var i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      var xi = polygon[i].x, yi = polygon[i].y;
      var xj = polygon[j].x, yj = polygon[j].y;
      var crosses = ((yi > point.y) !== (yj > point.y))
        && (point.x < (xj - xi) * (point.y - yi) / ((yj - yi) || 0.00001) + xi);
      if (crosses) inside = !inside;
    }
    return inside;
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
        if (item.atomId || item.id) abgSetAtomSelection(item.atomId || item.id, true);
      });
    });
  }

  function abgSetAtomSelection(atomId, syncDetail) {
    var id = String(atomId || "").toUpperCase();
    if (!id) return;
    abgSelectedAtomId = id;
    document.querySelectorAll("[data-abg-lattice-atom]").forEach(function (button) {
      button.classList.toggle("selected", String(button.getAttribute("data-abg-lattice-atom") || "").toUpperCase() === id);
    });
    document.querySelectorAll("[data-abg-atom-id]").forEach(function (node) {
      node.classList.toggle("selected", String(node.getAttribute("data-abg-atom-id") || "").toUpperCase() === id);
    });
    if (syncDetail) {
      var matchingAtom = Array.from(document.querySelectorAll("[data-abg-lattice-atom]")).find(function (button) {
        return String(button.getAttribute("data-abg-lattice-atom") || "").toUpperCase() === id;
      });
      if (matchingAtom) matchingAtom.click();
    }
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

  function abgOrganizationAtomState(atom, boundary) {
    var value = atom || {};
    if (value.organizationBoundary && value.organizationBoundary.scope) return value.organizationBoundary;
    var org = (boundary && (boundary.organization || boundary)) || {};
    var id = String(value.id || value.atomId || "").toUpperCase();
    var domain = String(value.domain || id.split(".")[0]).toUpperCase();
    var requiredLevel = Number(value.baseLevel ?? value.requiredLevel ?? value.level ?? 0);
    var allowedLevel = Number(org.levels?.[domain] ?? org.maxLevel ?? 3);
    var explicitlyAllowed = (org.allowedAtoms || []).some(function (item) { return String(item).toUpperCase() === id; });
    var conditional = (org.conditionalAtoms || []).some(function (item) { return String(item).toUpperCase() === id; });
    var denied = (org.deniedAtoms || []).some(function (item) { return String(item).toUpperCase() === id; });
    var disabled = value.enabled === false;
    var reason = denied ? "atom_denied_by_policy" : conditional ? "atom_requires_approval" : explicitlyAllowed ? "within" : disabled ? "atom_disabled" : requiredLevel > allowedLevel ? "level_exceeds_organization" : "atom_denied_by_default";
    return { scope: reason === "within" ? "within" : reason === "atom_requires_approval" ? "conditional" : "organization", reason: reason, policyAllowed: reason === "within", conditionallyAllowed: conditional, explicitlyAllowed: explicitlyAllowed, requiredLevel: requiredLevel, allowedLevel: allowedLevel, version: org.version, source: org.source };
  }

  function abgBoundaryReasonLabel(reason) {
    return {
      within: "\u7ec4\u7ec7\u8fb9\u754c\u5185",
      atom_disabled: "\u7b56\u7565\u4e0d\u5141\u8bb8",
      atom_denied_by_policy: "\u7b56\u7565\u660e\u786e\u4e0d\u5141\u8bb8",
      atom_requires_approval: "\u9700\u8981\u4eba\u5de5\u5ba1\u6279",
      atom_denied_by_default: "\u672a\u58f0\u660e\u6743\u9650\uff0c\u9ed8\u8ba4\u4e0d\u5141\u8bb8",
      level_exceeds_organization: "\u6240\u9700\u6743\u9650\u8d85\u8fc7\u7ec4\u7ec7\u4e0a\u9650"
    }[reason] || reason || "\u672a\u77e5";
  }

  function renderAbgLatticeDetail(panel, atom, boundary, catalog) {
    var detail = panel && panel.querySelector("#abgLatticeDetail");
    if (!detail || !atom) return;
    var stats = atom.stats || {};
    var organizationState = abgOrganizationAtomState(atom, boundary);
    var outside = organizationState.scope === "organization";
    var outsideCount = (catalog || []).filter(function (item) { return abgOrganizationAtomState(item, boundary).scope === "organization"; }).length;
    var nextEnabled = atom.enabled === false;
    var nextState = { scope: nextEnabled ? "within" : "organization" };
    var nextOutsideCount = outsideCount + (nextState.scope === "organization" ? 1 : 0) - (outside ? 1 : 0);
    var revision = Number(boundary && boundary.policyRevision);
    var revisionText = Number.isFinite(revision) ? revision + " \u2192 " + (revision + 1) : "\u4fdd\u5b58\u540e\u751f\u6210\u65b0 revision";
    var actionLabel = nextEnabled ? "\u5141\u8bb8" : "\u4e0d\u5141\u8bb8";
    var actionClass = nextEnabled ? "enable" : "disable";
    var nextScopeLabel = nextState.scope === "organization" ? "\u7ec4\u7ec7\u8fb9\u754c\u5916" : "\u7ec4\u7ec7\u8fb9\u754c\u5185";
    detail.innerHTML = '<div class="abg-lattice-detail-row"><div class="abg-lattice-detail-copy"><div class="abg-lattice-detail-title"><b>' + escapeHtml(atom.id) + '</b><span class="badge ' + (outside ? "block" : "allow") + '">' + (outside ? "\u8d8a\u754c / \u7981\u7528" : "\u7b56\u7565\u5185") + '</span></div><div class="abg-lattice-detail-grid"><div><small>\u8fb9\u754c\u5224\u5b9a</small><strong>' + escapeHtml(abgBoundaryReasonLabel(organizationState.reason)) + '</strong><span>L' + escapeHtml(organizationState.requiredLevel) + ' \u9700\u6c42 / L' + escapeHtml(organizationState.allowedLevel) + ' \u4e0a\u9650</span></div><div><small>\u547d\u4e2d\u7edf\u8ba1</small><strong>' + escapeHtml(stats.hits || 0) + ' hits</strong><span>allow ' + escapeHtml(stats.allow || 0) + ' / alert ' + escapeHtml(stats.alert || 0) + ' / block ' + escapeHtml(stats.block || 0) + '</span></div><div><small>\u7b56\u7565\u6765\u6e90</small><strong>' + escapeHtml(organizationState.source || boundary.source || "policy.organizationBoundary") + '</strong><span>policy ' + escapeHtml(organizationState.policyVersion || boundary.policyVersion || "-") + ' / revision ' + escapeHtml(organizationState.policyRevision ?? boundary.policyRevision ?? "-") + '</span></div></div><div class="abg-impact-preview"><small>\u53d8\u66f4\u5f71\u54cd\u9884\u89c8</small><b>' + actionLabel + ' \u540e\uff1a' + nextScopeLabel + '</b><span>\u7ec4\u7ec7\u8fb9\u754c\u5916\u539f\u5b50 ' + outsideCount + ' \u2192 ' + nextOutsideCount + ' \u00b7 revision ' + revisionText + '</span></div></div><button type="button" class="btn abg-lattice-detail-toggle ' + actionClass + '" data-abg-lattice-detail-toggle="' + escapeHtml(atom.id) + '">' + actionLabel + '</button></div>';
    var toggle = detail.querySelector("[data-abg-lattice-detail-toggle]");
    if (toggle) {
      toggle.addEventListener("click", function (event) {
        event.preventDefault();
        event.stopPropagation();
        var enabled = atom.enabled === false;
        toggle.disabled = true;
        toggle.textContent = enabled ? "\u6b63\u5728\u66f4\u65b0\u4e3a\u5141\u8bb8..." : "\u6b63\u5728\u66f4\u65b0\u4e3a\u4e0d\u5141\u8bb8...";
        api("/api/behavior-atoms/" + encodeURIComponent(atom.id), {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ enabled: enabled })
        }).then(function (result) {
          if (!result || result.ok !== true || !result.atom || result.atom.enabled !== enabled) {
            throw new Error("\u7b56\u7565\u72b6\u6001\u672a\u6301\u4e45\u5316");
          }
          applyBehaviorAuthorizationSnapshot(result.authorization);
          abgSetAtomSelection(atom.id);
          return refreshBehaviorAtomPolicy().catch(function () {
            // The mutation response is the authoritative committed snapshot.
            // A failed reconciliation fetch must not roll back or misreport it.
            return result.authorization;
          });
        }).catch(function (error) {
          toggle.disabled = false;
          toggle.textContent = actionLabel;
          var preview = detail.querySelector(".abg-impact-preview");
          if (preview) {
            preview.classList.add("error");
            preview.innerHTML = "<small>\u64cd\u4f5c\u5931\u8d25</small><b>" + escapeHtml(error && error.message || "\u672a\u77e5\u9519\u8bef") + "</b><span>\u7b56\u7565\u672a\u53d8\u66f4\uff0c\u8bf7\u91cd\u8bd5\u6216\u68c0\u67e5 Endpoint \u670d\u52a1\u3002</span>";
          }
        });
      });
    }
  }

  function applyBehaviorAuthorizationSnapshot(authorization) {
    if (!authorization || !authorization.boundary || !Array.isArray(authorization.catalog)) return false;
    var current = state.behaviorAtoms || { catalog: [] };
    var updates = new Map(authorization.catalog.map(function (atom) {
      return [String(atom.id || "").toUpperCase(), atom];
    }));
    current.catalog = (current.catalog || []).map(function (atom) {
      var update = updates.get(String(atom.id || "").toUpperCase());
      return update ? Object.assign({}, atom, update) : atom;
    });
    current.boundary = authorization.boundary;
    state.behaviorAtoms = current;
    renderPolicyAbg();
    renderBehavior();
    return true;
  }

  function refreshBehaviorAtomPolicy() {
    return api("/api/behavior-atoms?windowHours=24&pathLimit=1000&occurrenceLimit=1000&sourceLimit=5000&policyRefresh=" + Date.now()).then(function (data) {
      state.behaviorAtoms = data;
      renderPolicyAbg();
      renderBehavior();
      return data;
    });
  }

  function abgRenderSvg(svg, items, mode, boundary, catalog, decisionTrace) {
    if (!svg) return;
    var hasTaskBoundary = Boolean(boundary && boundary.task && (boundary.task.levels || boundary.task.domainLevels || boundary.task.maxLevel !== undefined));
    var sharedModel = window.AIDR_ABCG && window.AIDR_ABCG.createViewModel({
      items: items,
      mode: mode,
      boundary: boundary,
      catalog: catalog,
      decisionTrace: decisionTrace
    });
    if (sharedModel) {
      items = sharedModel.items;
      mode = sharedModel.mode;
      boundary = sharedModel.boundary;
      catalog = sharedModel.catalog;
      decisionTrace = sharedModel.decisionTrace;
    }
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
    var organizationAtomicBoundary = abgAtomicBoundary(definitions, boundary, "organization", cx, cy, radius);
    var taskAtomicBoundary = abgAtomicBoundary(definitions, boundary, "task", cx, cy, radius);
    var organizationPolygon = organizationAtomicBoundary.polygon.map(function (anchor) { return anchor.point; });
    var exclusionHoles = definitions.map(function (atom) {
      var point = abgCatalogPosition(atom.id, atom.baseLevel, cx, cy, radius, definitions);
      return { atom: atom, point: point, state: abgOrganizationAtomState(atom, boundary) };
    }).filter(function (entry) {
      return entry.state.scope === "organization" && abgPointInsidePolygon(entry.point, organizationPolygon);
    });
    var permissionMaskId = "abgPermissionMask-" + String(svg.id || "orbit").replace(/[^A-Za-z0-9_-]/g, "");
    if (exclusionHoles.length) {
      output.push('<defs><mask id="' + permissionMaskId + '"><rect x="0" y="0" width="' + width + '" height="' + height + '" fill="#fff"/>' + exclusionHoles.map(function (entry) {
        return '<circle cx="' + entry.point.x.toFixed(1) + '" cy="' + entry.point.y.toFixed(1) + '" r="10" fill="#000"/>';
      }).join("") + '</mask></defs>');
    }
    output.push('<path class="abg-boundary-halo" d="' + organizationAtomicBoundary.path + '"/>');
    output.push('<path class="abg-boundary" d="' + organizationAtomicBoundary.path + '"' + (exclusionHoles.length ? ' mask="url(#' + permissionMaskId + ')"' : '') + '><title>组织边界 · 连接策略允许集合中各领域的最外层行为原子 · ' + escapeHtml(organizationAtomicBoundary.anchors.filter(function (anchor) { return anchor.atomId; }).map(function (anchor) { return anchor.atomId; }).join(' / ')) + '</title></path>');
    exclusionHoles.forEach(function (entry) {
      output.push('<circle class="abg-exclusion-boundary" cx="' + entry.point.x.toFixed(1) + '" cy="' + entry.point.y.toFixed(1) + '" r="10"><title>' + escapeHtml(entry.atom.id + " · 策略不允许 · 权限空间排除孔 · 原始等级 L" + entry.point.level) + '</title></circle>');
    });
    organizationAtomicBoundary.anchors.filter(function (anchor) { return anchor.atomId; }).forEach(function (anchor) {
      output.push('<circle class="abg-boundary-anchor organization" cx="' + anchor.point.x.toFixed(1) + '" cy="' + anchor.point.y.toFixed(1) + '" r="4"><title>组织边界锚点 · ' + escapeHtml(anchor.atomId) + '</title></circle>');
    });
    if (hasTaskBoundary) {
      output.push('<path class="abg-boundary-halo" d="' + taskAtomicBoundary.path + '"/>');
      output.push('<path class="abg-task-boundary" d="' + taskAtomicBoundary.path + '"><title>任务边界 · 连接当前会话允许集合中的最外层行为原子 · ' + escapeHtml(taskAtomicBoundary.anchors.filter(function (anchor) { return anchor.atomId; }).map(function (anchor) { return anchor.atomId; }).join(' / ')) + '</title></path>');
      taskAtomicBoundary.anchors.filter(function (anchor) { return anchor.atomId; }).forEach(function (anchor) {
        output.push('<circle class="abg-boundary-anchor task" cx="' + anchor.point.x.toFixed(1) + '" cy="' + anchor.point.y.toFixed(1) + '" r="3.4"><title>任务边界锚点 · ' + escapeHtml(anchor.atomId) + '</title></circle>');
      });
    }
    output.push('<g class="abg-boundary-key" transform="translate(12 12)"><rect width="126" height="' + (hasTaskBoundary ? 40 : 23) + '" rx="5"/><line class="organization" x1="9" y1="12" x2="31" y2="12"/><text x="38" y="15">组织权限边界</text>' + (hasTaskBoundary ? '<line class="task" x1="9" y1="29" x2="31" y2="29"/><text x="38" y="32">当前会话任务边界</text>' : '') + '</g>');
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
         var organizationState = abgOrganizationAtomState(atom, boundary);
         var organizationOutside = organizationState.scope === "organization" || item.boundaryScope === "organization" || item.outOfOrganization;
         var taskOutside = !organizationOutside && (Number(atom.baseLevel || 0) > taskLevel || item.boundaryScope === "task" || item.outOfTask);
        var stateClass = organizationOutside ? "organization" : taskOutside ? "task" : "within";
        var selected = item.selected || atom.selected;
        var atomLabel = String(id).split(".").pop().replace(/_/g, " ");
        var denseLabelStride = Math.max(4, Math.ceil(definitions.length / 8));
        var showLabel = !densePermission || selected || atom.hits > 0 || item.hits > 0 || (organizationOutside && index % denseLabelStride === 0);
        var verdict = organizationOutside || taskOutside ? "block" : (item.verdict || "allow");
        output.push('<g class="abg-node ' + stateClass + '" data-abg-index="' + index + '" transform="translate(' + point.x.toFixed(1) + ' ' + point.y.toFixed(1) + ')"><circle class="abg-node-hit" r="7"/><circle r="' + (showLabel ? 5.5 : 4) + '"/><title>' + escapeHtml(id + " · L" + point.level + " · " + (atom.description || "行为原子") + " · " + verdict + " · " + stateClass) + '</title>' + (showLabel ? '<text class="abg-node-label" x="8" y="-6">' + escapeHtml(atomLabel) + '</text>' : '') + '</g>');
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
          output.push('<g class="abg-node aggregate ' + stateClass + '" data-abg-index="' + entry.index + '" transform="translate(' + entry.point.x.toFixed(1) + ' ' + entry.point.y.toFixed(1) + ')"><circle class="abg-node-hit" r="7"/><circle r="' + (Number(item.hits || 0) >= 3 ? 6.5 : 4.5) + '"/><title>' + escapeHtml(String(item.atomId || "行为原子") + hitLabel + " · " + (organizationOutside ? "组织边界外" : taskOutside ? "任务边界外" : "边界内")) + '</title>' + (showLabel ? '<text class="abg-node-label" x="8" y="-6">' + escapeHtml(label) + '</text>' : '') + '</g>');
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
        output.push('<g class="abg-node ' + stateClass + current + '" data-abg-index="' + entry.index + '" transform="translate(' + entry.point.x.toFixed(1) + ' ' + entry.point.y.toFixed(1) + ')"><circle class="abg-node-hit" r="7"/><circle r="' + (densePath ? 3.5 : 6) + '"/><title>' + escapeHtml(String(item.atomId || "行为原子") + hitSuffix + " · " + String(item.verdict || item.state || "unknown") + " · " + (item.boundaryScope || "within")) + '</title>' + (showPathLabel ? '<text class="abg-node-label" x="8" y="-7">' + escapeHtml(String(item.atomId || "").split(".").pop().replace(/_/g, " ")) + '</text>' : '') + '</g>');
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
        output.push('<g class="abg-node ' + blockedClass + ' current" data-abg-index="' + list.length + '" transform="translate(' + targetPoint.x.toFixed(1) + ' ' + targetPoint.y.toFixed(1) + ')"><circle class="abg-node-hit" r="7"/><circle r="7"/><title>' + escapeHtml(String(blockedEntry.atomId || "行为原子") + " · BLOCKED · " + Number(blockedEntry.hitCount || 1) + " 次命中") + '</title><text class="abg-node-label" x="8" y="-7">BLOCKED</text></g>');
      }
    }
    var centerTitle = mode === "actual" ? "REVIEW" : mode === "predicted" ? "PLAN" : "POLICY";
    var centerSubtitle = mode === "permission" ? (hasTaskBoundary ? "ORG / TASK" : "ORGANIZATION") : mode === "aggregate" ? "HIT ATOMS" : mode.toUpperCase();
    output.push('<circle cx="' + cx + '" cy="' + cy + '" r="24" fill="#f2faf8" stroke="#147f73" stroke-width="2"/><text x="' + cx + '" y="' + (cy - 2) + '" text-anchor="middle" fill="#173045" font-size="10" font-weight="700">' + centerTitle + '</text><text x="' + cx + '" y="' + (cy + 12) + '" text-anchor="middle" fill="#687587" font-size="9">' + centerSubtitle + '</text>');
    svg.setAttribute("viewBox", "0 0 " + width + " " + height);
    svg.innerHTML = '<g class="abg-layer">' + output.join("") + '</g>';
    var interactionItems = mode === "permission" ? definitions.map(function (atom) { return Object.assign({ atomId: atom.id, level: atom.baseLevel }, atom); }) : list.concat(blockedEntry ? [blockedEntry] : []);
    svg.querySelectorAll(".abg-node").forEach(function (node) {
      var item = interactionItems[Number(node.getAttribute("data-abg-index"))] || {};
      var atomId = item.atomId || item.id;
      if (atomId) node.setAttribute("data-abg-atom-id", String(atomId).toUpperCase());
    });
    abgSetAtomSelection(abgSelectedAtomId);
    abgApplyViewport(svg);
    abgAttachSvgInteractions(svg, interactionItems);
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
    panel.innerHTML = '<div class="panel-head"><div><h2>' + ABG_VIEW_TITLE + '</h2><p>聚合当前窗口已命中的行为原子；红色节点表示越过组织边界。</p></div><span class="badge info">ABCG AGGREGATE</span></div><div class="panel-body"><div class="abg-controls"><select class="select" id="abgBehaviorAgent"><option value="">所有 Agent</option></select><select class="select" id="abgBehaviorWindow"><option value="24">最近 24 小时</option><option value="168">最近 7 天</option></select><span class="small muted" id="abgBehaviorUpdated">等待数据</span></div><div class="abg-orbit-layout"><div><div class="abg-orbit-box"><svg id="abgBehaviorSvg" viewBox="0 0 520 300" role="img" aria-label="' + ABG_VIEW_TITLE + '"></svg></div><div class="abg-legend"><span><i style="background:#177f72"></i>组织边界内</span><span><i style="background:#c27600"></i>任务边界外</span><span><i style="background:#b42318"></i>组织边界外</span><span><i style="background:#2463c4"></i>策略空间</span></div></div><div class="abg-summary"><div class="abg-stat"><small>当前 Agent</small><strong id="abgBehaviorAgentName">全部 Agent</strong></div><div class="abg-stat"><small>行为事件</small><strong id="abgBehaviorEventTotal">0</strong></div><div class="abg-stat warn"><small>任务边界偏移</small><strong id="abgBehaviorTaskDrift">0</strong></div><div class="abg-stat danger"><small>组织边界越界</small><strong id="abgBehaviorOrgDrift">0</strong></div></div></div><div class="table-wrap" style="margin-top:14px"><table class="abg-matrix"><thead><tr><th>Agent</th><th>意图</th><th>计划</th><th>工具 / MCP</th><th>身份</th><th>数据</th><th>记忆</th><th>执行</th><th>总体</th></tr></thead><tbody id="abgBehaviorMatrix"></tbody></table></div></div>';
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

  function abgBuildCompleteHitSpace(data, chosen) {
    var catalog = Array.isArray(data.catalog) ? data.catalog : [];
    var catalogById = {};
    catalog.forEach(function (atom) { catalogById[String(atom.id || "").toUpperCase()] = atom; });
    var source = chosen
      ? Object.keys(chosen.atoms || {}).map(function (atomId) {
          return { atomId: atomId, hits: Number(chosen.atoms[atomId] || 0) };
        })
      : (Array.isArray(data.stats) ? data.stats : []).map(function (item) {
          return Object.assign({}, item, { atomId: item.atomId || item.id });
        });
    return source.filter(function (item) { return Number(item.hits || 0) > 0; }).map(function (item, index) {
      var id = String(item.atomId || "").toUpperCase();
      var atom = catalogById[id] || {};
      var organizationState = abgOrganizationAtomState(atom, data.boundary || {});
      var organizationRisk = Number(item.outOfOrganization || 0) > 0 || organizationState.scope === "organization";
      var taskRisk = !organizationRisk && Number(item.outOfTask || 0) > 0;
      return {
        atomId: id,
        domain: atom.domain || abgAtomDomain(id),
        level: atom.baseLevel || 1,
        requiredLevel: atom.baseLevel || 1,
        hits: Number(item.hits || 0),
        hitCount: Number(item.hits || 0),
        boundaryScope: organizationRisk ? "organization" : taskRisk ? "task" : "within",
        outOfOrganization: organizationRisk,
        outOfTask: taskRisk,
        verdict: Number(item.block || 0) > 0 || organizationRisk ? "block" : Number(item.alert || 0) > 0 || taskRisk ? "alert" : "allow",
        sequence: index + 1,
        timestamp: item.lastSeen || null
      };
    }).sort(function (a, b) {
      return String(a.domain).localeCompare(String(b.domain)) || Number(a.level) - Number(b.level) || String(a.atomId).localeCompare(String(b.atomId));
    });
  }

  function renderAbgBehavior() {
    var panel = ensureBehaviorOrbitPanel();
    if (!panel) return;
    ensureBoundaryStrip(panel);
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
    var behaviorBoundary = data.boundary || {};
    var behaviorOutsideCount = catalog.filter(function (atom) { return abgOrganizationAtomState(atom, behaviorBoundary).scope === "organization"; }).length;
    var behaviorBoundaryStrip = panel.querySelector("[data-abg-boundary-strip]");
    if (behaviorBoundaryStrip) {
      var behaviorSummary = behaviorBoundaryStrip.querySelector("[data-abg-boundary-summary]");
      var behaviorMeta = behaviorBoundaryStrip.querySelector("[data-abg-boundary-meta]");
      var behaviorState = behaviorBoundaryStrip.querySelector("[data-abg-boundary-state]");
      if (behaviorSummary) behaviorSummary.textContent = "\u4e0e\u7b56\u7565\u4e2d\u5fc3\u57fa\u7840\u7b56\u7565\u5df2\u7edf\u4e00";
      if (behaviorMeta) behaviorMeta.textContent = (behaviorBoundary.source || "policy.organizationBoundary") + " \u00b7 policy " + (behaviorBoundary.policyVersion || "-") + " \u00b7 revision " + (behaviorBoundary.policyRevision ?? "-") + " \u00b7 L0-L" + (behaviorBoundary.maxLevel ?? 3) + " \u00b7 \u7ec4\u7ec7\u8fb9\u754c\u5916 " + behaviorOutsideCount;
      if (behaviorState) { behaviorState.textContent = "\u5df2\u540c\u6b65"; behaviorState.className = "badge allow"; }
    }
    var hitSpace = abgBuildCompleteHitSpace(data, chosen);
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
    panel.innerHTML = '<div class="panel-head"><div><h2>' + ABG_VIEW_TITLE + '</h2><p>组织边界、任务边界、预测行为链和实际行为链保持同一坐标系展示。</p></div><span class="badge info">SESSION ORBIT</span></div><div class="panel-body"><div class="abg-orbit-tabs"><button class="active" data-abg-mode="permission">权限空间</button><button data-abg-mode="predicted">预测行为链</button><button data-abg-mode="actual">实际行为链</button></div><div class="abg-orbit-box"><svg id="abgSessionSvg" viewBox="0 0 520 300" role="img" aria-label="' + ABG_VIEW_TITLE + '"></svg></div><div class="abg-orbit-note" id="abgSessionNote">正在加载当前会话的组织边界、任务边界和实际行为证据。</div></div>';
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
    renderSessionTaskPolicy(abgSessionData);
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
    var requestSequence = ++abgSessionRequestSequence;
    var requestedSessionId = String(session.id);
    abgSessionData = null;
    var svg = panel.querySelector("#abgSessionSvg");
    if (svg) svg.innerHTML = '<text x="260" y="155" text-anchor="middle" fill="#687587" font-size="12">正在加载当前会话的任务权限边界...</text>';
    var note = panel.querySelector("#abgSessionNote");
    if (note) note.textContent = "正在根据当前会话重新计算最小权限策略边界。";
    api("/api/sessions/" + encodeURIComponent(requestedSessionId) + "/orbit").then(function (data) {
      if (requestSequence !== abgSessionRequestSequence) return;
      if (data && data.sessionId && String(data.sessionId) !== requestedSessionId) return;
      abgSessionData = data;
      if (["permission", "predicted", "actual"].indexOf(abgSessionMode) < 0) abgSessionMode = "permission";
      abgPlaybackIndex = 0;
      panel.querySelectorAll("[data-abg-mode]").forEach(function (button) { button.classList.toggle("active", button.getAttribute("data-abg-mode") === abgSessionMode); });
      abgRenderSessionOrbit(panel);
    }).catch(function (error) {
      if (requestSequence !== abgSessionRequestSequence) return;
      abgSessionData = { unavailable: true, message: "会话 Orbit 加载失败：" + (error.message || "API unavailable") };
      abgRenderSessionOrbit(panel);
    });
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
    panel.innerHTML = '<div class="panel-head"><div><h2>' + ABG_VIEW_TITLE + '</h2><p>权限空间由当前策略生成；格栅按行为域与 L0-L5 权限等级展示所有行为原子及命中状态。</p></div><span class="badge info">POLICY SPACE</span></div><div class="panel-body"><div class="abg-boundary-config"><div><strong>组织边界等级</strong><p class="small muted">每个领域的 L0-L5 是所有 Agent 和任务的全局上限，保存后进入策略签名、验证和回滚链。</p></div><div class="abg-boundary-levels">' + abgDomains.map(function (domain) { return '<label><span>' + escapeHtml(domain[1]) + '</span><input type="number" min="0" max="5" data-abg-domain-level="' + domain[0] + '"></label>'; }).join("") + '</div><div class="abg-boundary-actions"><span class="small muted" data-abg-boundary-status>当前配置未修改</span><button class="btn primary" data-abg-boundary-save>保存组织边界</button></div></div><div class="abg-catalog"><div><div class="abg-orbit-box"><svg id="abgPolicySvg" viewBox="0 0 520 300" role="img" aria-label="' + ABG_VIEW_TITLE + '"></svg></div><div class="abg-legend"><span><i style="background:#527184"></i>组织边界</span><span><i style="background:#b42318"></i>策略不允许</span><span><i style="background:#2463c4"></i>L0-L5 权限等级</span></div></div><div class="abg-lattice-side"><div class="abg-lattice-head"><div><strong>行为原子能力格栅</strong><p>按行为域、权限等级和策略授权状态查看完整能力空间。</p></div><span class="small muted" id="abgAtomCount"></span></div><div class="abg-lattice-toolbar"><button class="choice active" type="button" data-abg-lattice-filter="all">全部</button><button class="choice" type="button" data-abg-lattice-filter="enabled">策略允许</button><button class="choice" type="button" data-abg-lattice-filter="high">高风险</button><input class="input abg-lattice-filter" id="abgAtomSearch" placeholder="搜索行为原子或域名"></div><div class="abg-capability-grid-wrap"><div id="abgCapabilityGrid" class="abg-capability-grid"></div></div><div class="abg-lattice-footer"><div class="abg-lattice-legend"><span><i style="background:#147f73"></i>策略允许 / 权限空间内</span><span><i style="background:#c27600"></i>高风险</span><span><i style="background:#b42318"></i>策略不允许 / 权限空间外</span></div><span class="small muted">点击原子查看策略授权与命中详情</span></div><div class="abg-lattice-actions"><input class="input" id="abgAtomId" placeholder="例如 DATA.CUSTOM_EXPORT"><input class="input" id="abgAtomDescription" placeholder="行为原子说明"><input class="input" id="abgAtomLevel" type="number" min="0" max="5" value="3"><button class="btn primary" id="abgAtomAdd">新增</button></div><div id="abgLatticeDetail" class="abg-lattice-detail">选择一个行为原子查看当前权限等级、策略授权状态与命中统计。</div></div></div></div>';
    var obsoleteBoundary = panel.querySelector(".abg-boundary-config");
    if (obsoleteBoundary) obsoleteBoundary.remove();
    var panelHead = panel.querySelector(".panel-head");
    var latticeHead = panel.querySelector(".abg-lattice-head");
    var catalogLayout = panel.querySelector(".abg-catalog");
    var orbitPane = catalogLayout && catalogLayout.firstElementChild;
    var latticePane = catalogLayout && catalogLayout.querySelector(":scope > .abg-lattice-side");
    if (catalogLayout && orbitPane && latticePane) {
      catalogLayout.insertBefore(latticePane, orbitPane);
    }
    if (panelHead && latticeHead) {
      var orbitTitle = panelHead.firstElementChild;
      var latticeTitle = latticeHead.querySelector("div:first-child");
      var latticeCount = latticeHead.querySelector("#abgAtomCount");
      if (orbitTitle && latticeTitle) {
        var titleGrid = document.createElement("div");
        titleGrid.className = "abg-policy-head-grid";
        var latticeTitleInline = document.createElement("div");
        latticeTitleInline.className = "abg-lattice-head-inline";
        latticeTitleInline.appendChild(latticeTitle);
        if (latticeCount) latticeTitleInline.appendChild(latticeCount);
        panelHead.insertBefore(titleGrid, orbitTitle);
        titleGrid.appendChild(latticeTitleInline);
        titleGrid.appendChild(orbitTitle);
        latticeHead.remove();
        panelHead.style.display = "grid";
        panelHead.style.gridTemplateColumns = "minmax(0,1fr) auto";
        panelHead.style.alignItems = "start";
        var headerStyle = document.createElement("style");
        headerStyle.textContent = ".abg-policy-head-grid{display:grid;grid-template-columns:minmax(300px,.92fr) minmax(0,1.08fr);gap:24px;align-items:start;min-width:0}.abg-policy-head-grid>div{min-width:0}.abg-lattice-head-inline{display:flex;justify-content:space-between;align-items:flex-start;gap:10px;min-width:0}.abg-lattice-head-inline strong{display:block;font-size:14px;color:#173045}.abg-lattice-head-inline p{margin:3px 0 0;color:#687587;font-size:11px;line-height:1.45}.abg-lattice-head-inline #abgAtomCount{white-space:nowrap;padding-top:2px}@media(max-width:900px){.abg-policy-head-grid{grid-template-columns:1fr;gap:8px}.abg-lattice-head-inline{justify-content:flex-start}.abg-lattice-head-inline #abgAtomCount{margin-left:auto}}";
        panelHead.prepend(headerStyle);
        var latticeControlStyle = document.createElement("style");
        latticeControlStyle.textContent = ".abg-catalog{grid-template-columns:minmax(500px,.92fr) minmax(0,1.08fr)}.abg-lattice-detail-row{display:flex;align-items:center;justify-content:space-between;gap:12px}.abg-lattice-detail-copy{min-width:0;overflow-wrap:anywhere}.abg-lattice-detail-toggle{flex:0 0 auto;min-width:58px}.abg-lattice-detail-toggle.disable{background:#fff1f0;border-color:#e5aaa6;color:#b42318}.abg-lattice-detail-toggle.enable{background:#e5f5f2;border-color:#a9d8d0;color:#146f65}.abg-lattice-detail-toggle:disabled{opacity:.55;cursor:wait}@media(max-width:1120px){.abg-catalog{grid-template-columns:1fr}}";
         panelHead.appendChild(latticeControlStyle);
         var boundaryStyle = document.createElement("style");
         boundaryStyle.textContent = ".abg-boundary-strip{display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:8px 17px;border-bottom:1px solid #dbe7ea;background:#f7fbfb;font-size:11px}.abg-boundary-strip strong{color:#173045}.abg-boundary-strip [data-abg-boundary-summary]{color:#147f73}.abg-boundary-strip [data-abg-boundary-meta]{flex:1;min-width:220px}.abg-boundary-strip .badge{white-space:nowrap}";
         panelHead.appendChild(boundaryStyle);
       }
     }
     if (panelHead && !panel.querySelector("[data-abg-boundary-strip]")) panelHead.insertAdjacentHTML("afterend", '<div class="abg-boundary-strip" data-abg-boundary-strip><strong>\u7ec4\u7ec7\u6743\u9650\u8fb9\u754c</strong><span data-abg-boundary-summary>\u6b63\u5728\u540c\u6b65\u57fa\u7840\u7b56\u7565</span><span class="small muted" data-abg-boundary-meta></span><span class="badge allow" data-abg-boundary-state>\u5df2\u540c\u6b65</span></div>');
    panel.querySelector(".abg-orbit-box").insertAdjacentHTML("afterbegin", '<button class="btn abg-fullscreen" data-abg-fullscreen title="全屏查看组织权限空间">全屏</button>');
    panel.querySelector(".panel-body").insertAdjacentHTML("beforeend", '<div class="abg-node-detail">选择权限空间中的行为原子查看当前组织边界与命中状态。</div>');
    var versionPanel = page.querySelector(".version-row")?.closest(".panel");
    if (versionPanel) versionPanel.insertAdjacentElement("beforebegin", panel); else page.appendChild(panel);
    panel.querySelector("#abgAtomAdd").addEventListener("click", function () {
      var id = panel.querySelector("#abgAtomId").value.trim().toUpperCase();
      if (!/^[A-Z][A-Z0-9_-]*\.[A-Z][A-Z0-9_-]*$/.test(id)) { window.alert("行为原子格式应为 DOMAIN.NAME"); return; }
      api("/api/behavior-atoms", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: id, description: panel.querySelector("#abgAtomDescription").value.trim() || "自定义行为原子", baseLevel: Number(panel.querySelector("#abgAtomLevel").value || 3) }) }).then(refresh);
    });
    var boundarySave = panel.querySelector("[data-abg-boundary-save]");
    if (boundarySave) boundarySave.addEventListener("click", function () {
      var levels = {};
      panel.querySelectorAll("[data-abg-domain-level]").forEach(function (input) { levels[input.getAttribute("data-abg-domain-level")] = Math.max(0, Math.min(5, Number(input.value || 0))); });
      var button = panel.querySelector("[data-abg-boundary-save]");
      var status = panel.querySelector("[data-abg-boundary-status]");
      button.disabled = true;
      status.textContent = "正在验证并签名...";
      api("/api/policy", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ organizationBoundary: { levels: levels, maxLevel: Math.max.apply(null, Object.keys(levels).map(function (key) { return levels[key]; })), source: "policy.organizationBoundary.ui" } }) }).then(function () { status.textContent = "组织边界已保存并生效"; refresh(); }).catch(function (error) { status.textContent = "保存失败：" + (error.message || "API unavailable"); }).then(function () { button.disabled = false; });
    });
    panel.querySelector("#abgAtomSearch").addEventListener("input", function () { renderPolicyAbg(); });
    panel.querySelectorAll("[data-abg-lattice-filter]").forEach(function (button) {
      button.addEventListener("click", function () {
        panel.setAttribute("data-abg-lattice-filter", button.getAttribute("data-abg-lattice-filter"));
        panel.querySelectorAll("[data-abg-lattice-filter]").forEach(function (item) { item.classList.toggle("active", item === button); });
        renderPolicyAbg();
      });
    });
    var latticeToolbar = panel.querySelector(".abg-lattice-toolbar");
    if (latticeToolbar && !latticeToolbar.querySelector('[data-abg-lattice-filter="disabled"]')) {
      var conditionalFilter = document.createElement("button");
      conditionalFilter.type = "button";
      conditionalFilter.className = "choice";
      conditionalFilter.setAttribute("data-abg-lattice-filter", "conditional");
      conditionalFilter.textContent = "需审批";
      latticeToolbar.insertBefore(conditionalFilter, latticeToolbar.querySelector("input"));
      conditionalFilter.addEventListener("click", function () {
        panel.setAttribute("data-abg-lattice-filter", "conditional");
        panel.querySelectorAll("[data-abg-lattice-filter]").forEach(function (item) { item.classList.toggle("active", item === conditionalFilter); });
        renderPolicyAbg();
      });
      var disabledFilter = document.createElement("button");
      disabledFilter.type = "button";
      disabledFilter.className = "choice";
      disabledFilter.setAttribute("data-abg-lattice-filter", "disabled");
      disabledFilter.textContent = "\u7b56\u7565\u4e0d\u5141\u8bb8";
      latticeToolbar.insertBefore(disabledFilter, latticeToolbar.querySelector("input"));
      disabledFilter.addEventListener("click", function () {
        panel.setAttribute("data-abg-lattice-filter", "disabled");
        panel.querySelectorAll("[data-abg-lattice-filter]").forEach(function (item) { item.classList.toggle("active", item === disabledFilter); });
        renderPolicyAbg();
      });
    }
    return panel;
  }

  function renderAbgCapabilityGrid(panel, data, query) {
    var grid = panel.querySelector("#abgCapabilityGrid");
    if (!grid) return;
    var catalog = Array.isArray(data.catalog) ? data.catalog : [];
    var mode = panel.getAttribute("data-abg-lattice-filter") || "all";
    var boundary = data.boundary || {};
    var visible = catalog.filter(function (atom) {
      var id = String(atom.id || "").toLowerCase();
      var description = String(atom.description || "").toLowerCase();
      var domain = abgAtomDomain(atom.id);
      var stats = atom.stats || {};
       var organizationState = abgOrganizationAtomState(atom, boundary);
       var outside = organizationState.scope === "organization";
      if (mode === "enabled" && organizationState.scope !== "within") return false;
      if (mode === "conditional" && organizationState.scope !== "conditional") return false;
      if (mode === "disabled" && !outside) return false;
      if (mode === "high" && !atom.highRisk && !outside) return false;
      return !query || (id + " " + description + " " + domain).indexOf(String(query).toLowerCase()) >= 0;
    });
    var levels = [0, 1, 2, 3, 4, 5];
    var html = '<div class="abg-lattice-corner">行为域</div>' + levels.map(function (level) { return '<div class="abg-lattice-level">L' + level + '</div>'; }).join("");
    abgDomains.forEach(function (domain) {
      html += '<div class="abg-lattice-domain">' + escapeHtml(domain[0]) + '<small>' + escapeHtml(domain[1]) + '</small></div>';
      levels.forEach(function (level) {
        var atoms = visible.filter(function (atom) { return abgAtomDomain(atom.id) === domain[0] && abgClampLevel(atom.baseLevel, 3) === level; });
        html += '<div class="abg-lattice-cell' + (atoms.length ? "" : " empty") + '">' + atoms.map(function (atom) {
          var stats = atom.stats || {};
           var organizationState = abgOrganizationAtomState(atom, boundary);
           var outside = organizationState.scope === "organization";
          var atomClass = organizationState.scope === "conditional" ? "high" : outside ? "blocked" : "";
          var shortName = String(atom.id || "").split(".").slice(1).join(".") || atom.id;
          return '<button type="button" class="abg-lattice-atom ' + atomClass + '" data-abg-lattice-atom="' + escapeHtml(atom.id) + '" title="' + escapeHtml(atom.description || atom.id) + '"><span>' + escapeHtml(shortName) + '</span><em>' + escapeHtml(stats.hits || 0) + '</em></button>';
        }).join("") + '</div>';
      });
    });
    grid.innerHTML = html;
    grid.querySelectorAll("[data-abg-lattice-atom]").forEach(function (button) {
      button.addEventListener("click", function () {
        var atom = catalog.find(function (item) { return String(item.id).toUpperCase() === String(button.getAttribute("data-abg-lattice-atom")).toUpperCase(); });
        if (!atom) return;
        grid.querySelectorAll(".abg-lattice-atom.selected").forEach(function (item) { item.classList.remove("selected"); });
        button.classList.add("selected");
        var stats = atom.stats || {};
        var domain = abgAtomDomain(atom.id);
         var organizationState = abgOrganizationAtomState(atom, boundary);
         var outside = organizationState.scope === "organization";
        var detail = panel.querySelector("#abgLatticeDetail");
        if (detail) detail.innerHTML = '<b>' + escapeHtml(atom.id) + '</b> · ' + escapeHtml(atom.description || "行为原子") + '<br>权限等级 L' + escapeHtml(atom.baseLevel) + ' · ' + (outside ? '<span style="color:#b42318">越界 / 禁用</span>' : '<span style="color:#147f73">组织边界内</span>') + ' · 命中 ' + escapeHtml(stats.hits || 0) + '（允许 ' + escapeHtml(stats.allow || 0) + ' / 审查 ' + escapeHtml(stats.alert || 0) + ' / 阻断 ' + escapeHtml(stats.block || 0) + '）';
        if (detail) {
          var actionLabel = atom.enabled === false ? "\u542f\u7528" : "\u5173\u95ed";
          var actionClass = atom.enabled === false ? "enable" : "disable";
          detail.innerHTML = '<div class="abg-lattice-detail-row"><div class="abg-lattice-detail-copy"><b>' + escapeHtml(atom.id) + '</b> · ' + escapeHtml(atom.description || "\u884c\u4e3a\u539f\u5b50") + '<br>\u6743\u9650\u7b49\u7ea7 L' + escapeHtml(atom.baseLevel) + ' · ' + (outside ? '<span style="color:#b42318">\u8d8a\u754c / \u7981\u7528</span>' : '<span style="color:#147f73">\u7ec4\u7ec7\u8fb9\u754c\u5185</span>') + ' · \u547d\u4e2d ' + escapeHtml(stats.hits || 0) + '（\u5141\u8bb8 ' + escapeHtml(stats.allow || 0) + ' / \u5ba1\u67e5 ' + escapeHtml(stats.alert || 0) + ' / \u963b\u65ad ' + escapeHtml(stats.block || 0) + '）</div><button type="button" class="btn abg-lattice-detail-toggle ' + actionClass + '" data-abg-lattice-detail-toggle="' + escapeHtml(atom.id) + '">' + actionLabel + '</button></div>';
        }
        if (detail) {
          var detailBoundary = outside ? "\u8d8a\u754c / \u7981\u7528" : "\u7ec4\u7ec7\u8fb9\u754c\u5185";
          var detailDescription = atom.description || "\u884c\u4e3a\u539f\u5b50";
          var detailAction = atom.enabled === false ? "\u542f\u7528" : "\u5173\u95ed";
          var detailActionClass = atom.enabled === false ? "enable" : "disable";
          detail.innerHTML = '<div class="abg-lattice-detail-row"><div class="abg-lattice-detail-copy"><b>' + escapeHtml(atom.id) + '</b> · ' + escapeHtml(detailDescription) + '<br>L' + escapeHtml(atom.baseLevel) + ' · ' + detailBoundary + ' · hits ' + escapeHtml(stats.hits || 0) + ' (allow ' + escapeHtml(stats.allow || 0) + ' / alert ' + escapeHtml(stats.alert || 0) + ' / block ' + escapeHtml(stats.block || 0) + ')</div><button type="button" class="btn abg-lattice-detail-toggle ' + detailActionClass + '" data-abg-lattice-detail-toggle="' + escapeHtml(atom.id) + '">' + detailAction + '</button></div>';
        }
        renderAbgLatticeDetail(panel, atom, boundary, catalog);
        abgSetAtomSelection(atom.id);
      });
    });
    if (abgSelectedAtomId) {
      var selectedAtom = catalog.find(function (item) { return String(item.id || "").toUpperCase() === String(abgSelectedAtomId).toUpperCase(); });
      var selectedButton = Array.from(grid.querySelectorAll("[data-abg-lattice-atom]")).find(function (button) { return String(button.getAttribute("data-abg-lattice-atom") || "").toUpperCase() === String(abgSelectedAtomId).toUpperCase(); });
      if (selectedButton) selectedButton.classList.add("selected");
      if (selectedAtom) renderAbgLatticeDetail(panel, selectedAtom, boundary, catalog);
    }
    var filterCounts = {
      all: catalog.length,
      enabled: catalog.filter(function (atom) { return abgOrganizationAtomState(atom, data.boundary || {}).scope === "within"; }).length,
      conditional: catalog.filter(function (atom) { return abgOrganizationAtomState(atom, data.boundary || {}).scope === "conditional"; }).length,
      disabled: catalog.filter(function (atom) { return abgOrganizationAtomState(atom, data.boundary || {}).scope === "organization"; }).length
    };
    Object.keys(filterCounts).forEach(function (key) {
      var filterButton = panel.querySelector('[data-abg-lattice-filter="' + key + '"]');
      if (filterButton) filterButton.textContent = (key === "all" ? "全部" : key === "enabled" ? "策略允许" : key === "conditional" ? "需审批" : "策略不允许") + " (" + filterCounts[key] + ")";
    });
    var count = panel.querySelector("#abgAtomCount");
    if (count) count.textContent = "共 " + visible.length + " / " + catalog.length + " 个行为原子";
  }

  function renderPolicyAbg() {
    var panel = ensurePolicyAbgPanel();
    if (!panel) return;
    var data = state.behaviorAtoms || { catalog: [] };
    data.boundary = data.boundary || {};
    var boundaryCatalog = data.catalog || [];
    var organizationOutsideCount = boundaryCatalog.filter(function (atom) { return abgOrganizationAtomState(atom, data.boundary).scope === "organization"; }).length;
    var boundaryStrip = panel.querySelector("[data-abg-boundary-strip]");
    if (boundaryStrip) {
      var boundarySummary = boundaryStrip.querySelector("[data-abg-boundary-summary]");
      var boundaryMeta = boundaryStrip.querySelector("[data-abg-boundary-meta]");
      var boundaryState = boundaryStrip.querySelector("[data-abg-boundary-state]");
      if (boundarySummary) boundarySummary.textContent = "\u4e0e\u7b56\u7565\u4e2d\u5fc3\u57fa\u7840\u7b56\u7565\u5df2\u7edf\u4e00";
      if (boundaryMeta) boundaryMeta.textContent = (data.boundary.source || "policy.organizationBoundary") + " · policy " + (data.boundary.policyVersion || "-") + " · revision " + (data.boundary.policyRevision ?? "-") + " · L0-L" + (data.boundary.maxLevel ?? 3) + " · \u7ec4\u7ec7\u8fb9\u754c\u5916 " + organizationOutsideCount;
      if (boundaryState) { boundaryState.textContent = "\u5df2\u540c\u6b65"; boundaryState.className = "badge allow"; }
    }
    var boundaryLevels = data.boundary.levels || {};
    panel.querySelectorAll("[data-abg-domain-level]").forEach(function (input) { var domain = input.getAttribute("data-abg-domain-level"); input.value = String(boundaryLevels[domain] ?? data.boundary.maxLevel ?? 3); });
    var policyItems = (data.catalog || []).map(function (atom, index) {
      var stats = atom.stats || {};
       var organizationState = abgOrganizationAtomState(atom, data.boundary);
       var outside = organizationState.scope === "organization";
       return { atomId: atom.id, level: atom.baseLevel, requiredLevel: organizationState.requiredLevel || atom.baseLevel, hits: stats.hits || 0, boundaryScope: organizationState.scope, outOfOrganization: outside, organizationReason: organizationState.reason, verdict: outside ? "block" : "allow", sequence: index + 1, timestamp: stats.lastSeen };
    });
    abgRenderSvg(panel.querySelector("#abgPolicySvg"), policyItems, "permission", data.boundary || {}, data.catalog || []);
    var query = String(panel.querySelector("#abgAtomSearch")?.value || "").toLowerCase();
    var rows = (data.catalog || []).filter(function (atom) { return !query || String(atom.id + " " + atom.description + " " + atom.domain).toLowerCase().indexOf(query) >= 0; });
    renderAbgCapabilityGrid(panel, data, query);
    var atomTable = panel.querySelector("#abgAtomTable");
    if (atomTable) {
      atomTable.innerHTML = rows.map(function (atom) {
        var stats = atom.stats || {}; var stateLabel = atom.enabled === false ? "DISABLED" : atom.system ? "SYSTEM" : "CUSTOM";
        var action = atom.system ? "禁用" : "删除";
        return '<tr><td><span class="atom-id">' + escapeHtml(atom.id) + '</span><small>' + escapeHtml(atom.description || "") + '</small></td><td>L' + escapeHtml(atom.baseLevel) + '</td><td class="abg-hit ' + (stats.hits ? "danger" : "") + '">' + escapeHtml(stats.hits || 0) + '</td><td>' + escapeHtml((stats.allow || 0) + " / " + (stats.alert || 0) + " / " + (stats.block || 0)) + '</td><td>' + badge(stateLabel, atom.enabled === false ? "hold" : atom.highRisk ? "block" : "allow") + '</td><td><button class="btn" data-abg-atom-action="' + escapeHtml(atom.id) + '">' + action + '</button></td></tr>';
      }).join("") || '<tr><td colspan="6" class="empty">没有匹配的行为原子</td></tr>';
      panel.querySelectorAll("[data-abg-atom-action]").forEach(function (button) { button.addEventListener("click", function () { api("/api/behavior-atoms/" + encodeURIComponent(button.getAttribute("data-abg-atom-action")), { method: "DELETE" }).then(refresh); }); });
    }
  }

  function ensureBehaviorOperations() {
    var page = document.getElementById("page-behavior");
    var kpis = page && page.querySelector(".behavior-kpis");
    if (!kpis) return null;
    var ops = page.querySelector("[data-behavior-ops]");
    if (!ops) {
      kpis.insertAdjacentHTML("afterend", '<div class="behavior-ops" data-behavior-ops><section class="behavior-funnel"><div class="behavior-ops-head"><h3>行为处置漏斗</h3><span class="small muted">观测不等于执行</span></div><div class="behavior-funnel-grid"><div class="behavior-stage"><small>已观测</small><b data-behavior-observed>0</b></div><div class="behavior-stage"><small>策略允许</small><b data-behavior-allowed>0</b></div><div class="behavior-stage alert"><small>告警 / 审批</small><b data-behavior-alerted>0</b></div><div class="behavior-stage block"><small>已阻断</small><b data-behavior-blocked>0</b></div></div></section><section class="behavior-quality"><div class="behavior-ops-head"><h3>数据可靠性</h3><span class="badge neutral" data-behavior-quality-state>检查中</span></div><div class="quality-list"><div class="quality-item"><small>遥测新鲜度</small><b data-behavior-freshness>-</b></div><div class="quality-item"><small>Agent 归属率</small><b data-behavior-attribution>-</b></div><div class="quality-item"><small>采集完整性</small><b data-behavior-completeness>-</b></div></div></section></div>');
      ops = page.querySelector("[data-behavior-ops]");
    }
    return ops;
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
    var ops = ensureBehaviorOperations();
    if (ops) {
      var observed = Number(stats.total || state.events.length || 0);
      var atomData = state.behaviorAtoms || {};
      var mappingQuality = atomData.mappingQuality || {};
      var generatedAt = atomData.generatedAt ? new Date(atomData.generatedAt) : null;
      var ageSeconds = generatedAt && !Number.isNaN(generatedAt.getTime()) ? Math.max(0, Math.round((Date.now() - generatedAt.getTime()) / 1000)) : null;
      var attributed = state.events.filter(function (event) { return Boolean(eventAgentId(event) || event.sessionId || event.session_id); }).length;
      var attribution = Number.isFinite(Number(mappingQuality.attributionRate))
        ? Math.round(Number(mappingQuality.attributionRate) * 100)
        : (state.events.length ? Math.round(attributed * 100 / state.events.length) : 100);
      var mappingCoverage = Number.isFinite(Number(mappingQuality.mappingCoverage))
        ? Math.round(Number(mappingQuality.mappingCoverage) * 100)
        : 100;
      text("[data-behavior-observed]", observed, ops);
      text("[data-behavior-allowed]", Number(byVerdict.allow || 0), ops);
      text("[data-behavior-alerted]", Number(byVerdict.alert || byVerdict.hold || 0), ops);
      text("[data-behavior-blocked]", Number(byVerdict.block || 0), ops);
      text("[data-behavior-freshness]", ageSeconds === null ? "未知" : ageSeconds + "s", ops);
      text("[data-behavior-attribution]", attribution + "%", ops);
      text("[data-behavior-completeness]", atomData.sourceTruncated ? mappingCoverage + "% / 已截断" : mappingCoverage + "%", ops);
      var quality = ops.querySelector("[data-behavior-quality-state]");
      var healthy = ageSeconds !== null && ageSeconds < 30 && attribution >= 90 && mappingCoverage >= 95 && !atomData.sourceTruncated;
      if (quality) { quality.textContent = healthy ? "可信" : "需关注"; quality.className = "badge " + (healthy ? "allow" : "hold"); }
    }
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

  function renderPolicyRulesLegacy() {
    var panel = document.querySelector("#page-policy .policy-layout > .panel:first-child");
    if (!panel) return;
    var rules = Array.isArray(state.policy && state.policy.policyRules) ? state.policy.policyRules.slice() : [];
    rules.sort(function (a, b) { return Number(a.priority || 0) - Number(b.priority || 0); });
    var rows = rules.map(function (rule) {
      var atoms = Array.isArray(rule.atomIds) ? rule.atomIds : [];
      var action = String(rule.action || "block").toUpperCase();
      var actionClass = action === "ALLOW" ? "allow" : action === "BLOCK" || action === "DENY" ? "block" : "hold";
      return '<div class="policy-row" data-policy-rule="' + escapeHtml(rule.id) + '"><div><div class="policy-name">' + escapeHtml(rule.name || rule.id) + '</div><div class="policy-sub">' + escapeHtml(rule.description || atoms.join(", ")) + '</div><div class="small muted">' + escapeHtml(atoms.join(" · ") || "未关联行为原子") + '</div></div><div>' + badge(action, actionClass) + '</div><div>' + escapeHtml((rule.agentScope || ["*"]).join(", ")) + '</div><div class="small muted">P' + escapeHtml(rule.priority || 0) + ' · ' + (rule.enabled === false ? "已停用" : "生效") + '</div><div class="policy-rule-actions"><button class="btn" data-policy-edit="' + escapeHtml(rule.id) + '">编辑</button><button class="btn" data-policy-toggle="' + escapeHtml(rule.id) + '">' + (rule.enabled === false ? "启用" : "停用") + '</button><button class="btn danger" data-policy-delete="' + escapeHtml(rule.id) + '">删除</button></div></div>';
    }).join("");
    panel.innerHTML = '<div class="panel-head"><div><h2>策略列表</h2><p>策略是权限配置入口；关联行为原子将实时编译为组织权限边界。</p></div><button class="btn primary" id="policyRuleNew">新建策略</button></div><div id="policyRuleRows">' + (rows || '<div class="empty">暂无策略，请新建第一条权限策略。</div>') + '</div><div class="panel-body policy-rule-editor" id="policyRuleEditor"><input type="hidden" id="policyRuleId"><div class="form-grid"><div class="field"><label>策略名称</label><input class="input" id="policyRuleName"></div><div class="field"><label>优先级</label><input class="input" type="number" id="policyRulePriority" value="100"></div><div class="field"><label>动作</label><select class="select" id="policyRuleAction"><option value="allow">ALLOW</option><option value="require_approval">REQUIRE APPROVAL</option><option value="hold">HOLD</option><option value="block">BLOCK</option></select></div><div class="field"><label>Agent 作用域</label><input class="input" id="policyRuleScope" value="*" placeholder="* 或 codex,opencode"></div><div class="field full"><label>说明</label><input class="input" id="policyRuleDescription"></div><div class="field full"><label>关联行为原子</label><textarea class="textarea" id="policyRuleAtoms" placeholder="DATA.SOURCE_CODE_READ, EXEC.HTTP_CONNECT"></textarea></div></div><div class="policy-rule-editor-actions"><button class="btn primary" id="policyRuleSave">保存并生效</button><button class="btn" id="policyRuleCancel">清空</button><span class="small muted" id="policyRuleStatus">保存后将自动刷新 Policy Orbit。</span></div></div>';
    function fill(rule) {
      panel.querySelector("#policyRuleId").value = rule && rule.id || "";
      panel.querySelector("#policyRuleName").value = rule && rule.name || "";
      panel.querySelector("#policyRulePriority").value = rule && rule.priority || 100;
      panel.querySelector("#policyRuleAction").value = rule && rule.action || "allow";
      panel.querySelector("#policyRuleScope").value = rule && (rule.agentScope || ["*"]).join(",") || "*";
      panel.querySelector("#policyRuleDescription").value = rule && rule.description || "";
      panel.querySelector("#policyRuleAtoms").value = rule && (rule.atomIds || []).join(", ") || "";
    }
    panel.querySelector("#policyRuleNew").addEventListener("click", function () { fill(null); panel.querySelector("#policyRuleName").focus(); });
    panel.querySelector("#policyRuleCancel").addEventListener("click", function () { fill(null); });
    panel.querySelectorAll("[data-policy-edit]").forEach(function (button) { button.addEventListener("click", function () { fill(rules.find(function (rule) { return rule.id === button.getAttribute("data-policy-edit"); })); }); });
    function persist(nextRules, message) {
      var status = panel.querySelector("#policyRuleStatus"); status.textContent = "正在编译并应用策略…";
      api("/api/policy", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ policyRules: nextRules }) }).then(function () { status.textContent = message; return refresh(); }).catch(function (error) { status.textContent = "保存失败：" + (error.message || "API unavailable"); });
    }
    panel.querySelectorAll("[data-policy-toggle]").forEach(function (button) { button.addEventListener("click", function () { var id = button.getAttribute("data-policy-toggle"); persist(rules.map(function (rule) { return rule.id === id ? Object.assign({}, rule, { enabled: rule.enabled === false }) : rule; }), "策略状态已更新"); }); });
    panel.querySelectorAll("[data-policy-delete]").forEach(function (button) { button.addEventListener("click", function () { var id = button.getAttribute("data-policy-delete"); persist(rules.filter(function (rule) { return rule.id !== id; }), "策略已删除"); }); });
    panel.querySelector("#policyRuleSave").addEventListener("click", function () {
      var id = panel.querySelector("#policyRuleId").value.trim() || "policy-" + Date.now();
      var name = panel.querySelector("#policyRuleName").value.trim();
      if (!name) { panel.querySelector("#policyRuleStatus").textContent = "请输入策略名称"; return; }
      var next = { id: id, name: name, priority: Number(panel.querySelector("#policyRulePriority").value || 100), action: panel.querySelector("#policyRuleAction").value, agentScope: panel.querySelector("#policyRuleScope").value.split(",").map(function (value) { return value.trim(); }).filter(Boolean), description: panel.querySelector("#policyRuleDescription").value.trim(), atomIds: panel.querySelector("#policyRuleAtoms").value.split(/[,\n]/).map(function (value) { return value.trim().toUpperCase(); }).filter(Boolean), enabled: true, source: "administrator" };
      var found = false; var nextRules = rules.map(function (rule) { if (rule.id === id) { found = true; return next; } return rule; });
      if (!found) nextRules.push(next);
      persist(nextRules, "策略已保存，权限边界已刷新");
    });
  }

  function renderPolicyRules() {
    var panel = document.querySelector("#page-policy .policy-layout > .panel:first-child");
    if (!panel) return;
    if (panel.querySelector(".policy-modal-backdrop:not([hidden])")) return;
    var policy = state.policy || {};
    var baseline = policy.policyBaseline || policy.effectivePolicy && policy.effectivePolicy.baseline || {};
    var effective = policy.effectivePolicy || {};
    var authorization = effective.authorization || {
      allowedAtoms: policy.organizationBoundary && policy.organizationBoundary.allowedAtoms || [],
      conditionalAtoms: policy.organizationBoundary && policy.organizationBoundary.conditionalAtoms || [],
      deniedAtoms: policy.organizationBoundary && policy.organizationBoundary.deniedAtoms || []
    };
    var rules = Array.isArray(policy.policyRules) ? policy.policyRules.slice() : [];
    rules.sort(function (a, b) { return Number(a.priority || 0) - Number(b.priority || 0); });
    function groups(rule) {
      var configured = rule.authorization || {};
      if (configured.allow || configured.conditional || configured.deny) return {
        allow: configured.allow || [],
        conditional: configured.conditional || [],
        deny: configured.deny || []
      };
      var atoms = rule.atomIds || [];
      var action = String(rule.action || "block").toLowerCase();
      return action === "allow" ? { allow: atoms, conditional: [], deny: [] }
        : action === "hold" || action === "require_approval" ? { allow: [], conditional: atoms, deny: [] }
        : { allow: [], conditional: [], deny: atoms };
    }
    function atomChips(values, className) {
      return (values || []).map(function (id) { return '<span class="badge ' + className + '">' + escapeHtml(id) + '</span>'; }).join(" ");
    }
    var domainRows = (effective.domainStats || []).map(function (item) {
      return '<tr><td><b>' + escapeHtml(item.domain) + '</b></td><td>' + escapeHtml(item.allow) + '</td><td>' + escapeHtml(item.conditional) + '</td><td>' + escapeHtml(item.deny) + '</td><td>' + escapeHtml(item.total) + '</td></tr>';
    }).join("");
    var contributionByRule = {};
    (effective.ruleContributions || []).forEach(function (item) { contributionByRule[item.ruleId] = item; });
    var rows = rules.map(function (rule) {
      var configuredAuth = groups(rule);
      var contribution = contributionByRule[rule.id];
      var auth = contribution && contribution.atoms || configuredAuth;
      return '<div class="policy-row" data-policy-rule="' + escapeHtml(rule.id) + '"><div><div class="policy-name">' + escapeHtml(rule.name || rule.id) + '</div><div class="policy-sub">' + escapeHtml(rule.description || "未填写说明") + '</div><div class="small muted">作用域 ' + escapeHtml((rule.agentScope || ["*"]).join(", ")) + ' · P' + escapeHtml(rule.priority || 0) + '</div></div><div class="policy-rule-groups"><div><b>允许 ' + auth.allow.length + '</b> ' + atomChips(auth.allow, "allow") + '</div><div><b>需审批 ' + auth.conditional.length + '</b> ' + atomChips(auth.conditional, "hold") + '</div><div><b>不允许 ' + auth.deny.length + '</b> ' + atomChips(auth.deny, "block") + '</div></div><div>' + badge(rule.enabled === false ? "已停用" : "生效", rule.enabled === false ? "neutral" : "allow") + '</div><div class="policy-rule-actions"><button class="btn" data-policy-edit="' + escapeHtml(rule.id) + '">编辑</button><button class="btn" data-policy-toggle="' + escapeHtml(rule.id) + '">' + (rule.enabled === false ? "启用" : "停用") + '</button><button class="btn danger" data-policy-delete="' + escapeHtml(rule.id) + '">删除</button></div></div>';
    }).join("");
    var policyHits = Number(state.eventStats && state.eventStats.total || 0);
    var hitDetails = (state.eventStats && state.eventStats.byVerdict || []).map(function (item) {
      return '<tr><td>' + escapeHtml(String(item.verdict || "unknown").toUpperCase()) + '</td><td>' + escapeHtml(item.c || item.count || 0) + '</td></tr>';
    }).join("");
    panel.innerHTML =
      '<div class="panel-body"><div class="policy-overview-bar">' +
        '<button type="button" class="policy-overview-item" data-policy-open="baseline"><small>Baseline</small><strong>' + escapeHtml(baseline.name || "AIDR Organization Baseline") + '</strong><span>点击查看总体策略内容</span></button>' +
        '<div class="policy-overview-item"><small>策略版本</small><strong>' + escapeHtml(baseline.version || policy.version || "-") + '</strong><span>Revision R' + escapeHtml(baseline.revision || 0) + '</span></div>' +
        '<button type="button" class="policy-overview-item" data-policy-open="rules"><small>规则</small><strong>' + rules.length + '</strong><span>' + rules.filter(function (r) { return r.enabled !== false; }).length + ' 条生效 · 点击查看</span></button>' +
        '<button type="button" class="policy-overview-item" data-policy-open="hits"><small>策略命中</small><strong>' + escapeHtml(policyHits) + '</strong><span>最近采集窗口 · 点击查看</span></button>' +
        '<button class="btn primary policy-overview-action" id="policyRuleNew">新建规则</button>' +
      '</div></div>' +
      '<div class="policy-modal-backdrop" id="policyBaselineModal" hidden><section class="policy-modal" role="dialog" aria-modal="true" aria-labelledby="policyBaselineTitle"><div class="panel-head"><div><h2 id="policyBaselineTitle">Baseline 总体策略</h2><p>' + escapeHtml(baseline.id || "default-baseline") + ' · ' + escapeHtml(baseline.version || policy.version || "-") + ' · R' + escapeHtml(baseline.revision || 0) + '</p></div><button class="btn" type="button" data-policy-close="baseline">关闭</button></div><div class="policy-modal-body"><div class="policy-modal-summary"><div><small>允许</small><strong class="text-allow">' + authorization.allowedAtoms.length + '</strong></div><div><small>需审批</small><strong class="text-hold">' + authorization.conditionalAtoms.length + '</strong></div><div><small>不允许</small><strong class="text-block">' + authorization.deniedAtoms.length + '</strong></div></div><table class="table policy-domain-table"><thead><tr><th>行为域</th><th>允许</th><th>需审批</th><th>不允许</th><th>合计</th></tr></thead><tbody>' + (domainRows || '<tr><td colspan="5">尚无已编译规则</td></tr>') + '</tbody></table><h3>允许的行为原子</h3><div class="policy-atom-list">' + atomChips(authorization.allowedAtoms, "allow") + '</div><h3>需审批的行为原子</h3><div class="policy-atom-list">' + atomChips(authorization.conditionalAtoms, "hold") + '</div><h3>不允许的行为原子</h3><div class="policy-atom-list">' + atomChips(authorization.deniedAtoms, "block") + '</div></div></section></div>' +
      '<div class="policy-modal-backdrop" id="policyRulesModal" hidden><section class="policy-modal" role="dialog" aria-modal="true" aria-labelledby="policyRulesTitle"><div class="panel-head"><div><h2 id="policyRulesTitle">规则列表</h2><p>优先级数值越小越先决；同一行为原子采用首个生效规则的决策。</p></div><button class="btn" type="button" data-policy-close="rules">关闭</button></div><div id="policyRuleRows">' + (rows || '<div class="empty">暂无规则，请新建第一条权限规则。</div>') + '</div></section></div>' +
      '<div class="policy-modal-backdrop" id="policyHitsModal" hidden><section class="policy-modal" role="dialog" aria-modal="true" aria-labelledby="policyHitsTitle"><div class="panel-head"><div><h2 id="policyHitsTitle">策略命中详情</h2><p>当前事件采集窗口内的最终策略决策统计。</p></div><button class="btn" type="button" data-policy-close="hits">关闭</button></div><div class="policy-modal-body"><table class="table"><thead><tr><th>决策</th><th>命中次数</th></tr></thead><tbody>' + (hitDetails || '<tr><td colspan="2">当前窗口暂无策略命中</td></tr>') + '</tbody></table></div></section></div>' +
      '<div class="policy-modal-backdrop" id="policyRuleEditorModal" hidden><section class="policy-modal" role="dialog" aria-modal="true" aria-labelledby="policyRuleEditorTitle"><div class="panel-head"><div><h2 id="policyRuleEditorTitle">规则配置</h2><p>保存后立即重新编译 Baseline 与组织权限边界。</p></div><button class="btn" type="button" data-policy-close="editor">关闭</button></div><div class="policy-modal-body policy-rule-editor" id="policyRuleEditor"><input type="hidden" id="policyRuleId"><div class="form-grid">' +
        '<div class="field"><label>规则名称</label><input class="input" id="policyRuleName"></div><div class="field"><label>优先级</label><input class="input" type="number" id="policyRulePriority" value="100"></div>' +
        '<div class="field"><label>Agent 作用域</label><input class="input" id="policyRuleScope" value="*" placeholder="* 或 codex,opencode"></div><div class="field"><label>说明</label><input class="input" id="policyRuleDescription"></div>' +
        '<div class="field full"><label>允许的行为原子</label><textarea class="textarea" id="policyRuleAllow" placeholder="DATA.SOURCE_CODE_READ, DATA.DOCUMENT_READ"></textarea></div>' +
        '<div class="field full"><label>需要审批的行为原子</label><textarea class="textarea" id="policyRuleConditional" placeholder="EXEC.HTTP_CONNECT, TOOL.MCP_CONNECT"></textarea></div>' +
        '<div class="field full"><label>不允许的行为原子</label><textarea class="textarea" id="policyRuleDeny" placeholder="DATA.CREDENTIAL_READ, EXEC.SERVICE_CONTROL"></textarea></div>' +
      '</div><div class="policy-rule-editor-actions"><button class="btn primary" id="policyRuleSave">保存并编译</button><button class="btn" id="policyRuleCancel">清空</button><span class="small muted" id="policyRuleStatus">保存后将刷新有效策略与组织权限边界。</span></div></div></section></div>';
    function values(id) {
      return panel.querySelector(id).value.split(/[,\n]/).map(function (value) { return value.trim().toUpperCase(); }).filter(Boolean);
    }
    function fill(rule) {
      var auth = groups(rule || {});
      panel.querySelector("#policyRuleId").value = rule && rule.id || "";
      panel.querySelector("#policyRuleName").value = rule && rule.name || "";
      panel.querySelector("#policyRulePriority").value = rule && rule.priority || 100;
      panel.querySelector("#policyRuleScope").value = rule && (rule.agentScope || ["*"]).join(",") || "*";
      panel.querySelector("#policyRuleDescription").value = rule && rule.description || "";
      panel.querySelector("#policyRuleAllow").value = auth.allow.join(", ");
      panel.querySelector("#policyRuleConditional").value = auth.conditional.join(", ");
      panel.querySelector("#policyRuleDeny").value = auth.deny.join(", ");
    }
    function persist(nextRules, message) {
      var status = panel.querySelector("#policyRuleStatus");
      status.textContent = "正在编译并应用策略...";
      api("/api/policy", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ policyRules: nextRules }) })
        .then(function () { status.textContent = message; return refresh(); })
        .catch(function (error) { status.textContent = "保存失败：" + (error.message || "API unavailable"); });
    }
    var baselineModal = panel.querySelector("#policyBaselineModal");
    var rulesModal = panel.querySelector("#policyRulesModal");
    var hitsModal = panel.querySelector("#policyHitsModal");
    var editorModal = panel.querySelector("#policyRuleEditorModal");
    function openModal(modal) { if (modal) modal.hidden = false; }
    function closeModal(modal) { if (modal) modal.hidden = true; }
    function showRules() { openModal(rulesModal); }
    function showEditor(rule) { fill(rule || null); openModal(editorModal); if (!rule) panel.querySelector("#policyRuleName").focus(); }
    panel.querySelector("#policyRuleNew").addEventListener("click", function () { showEditor(null); });
    panel.querySelector("#policyRuleCancel").addEventListener("click", function () { fill(null); closeModal(editorModal); });
    panel.querySelector('[data-policy-open="baseline"]').addEventListener("click", function () { openModal(baselineModal); });
    panel.querySelector('[data-policy-open="rules"]').addEventListener("click", showRules);
    panel.querySelector('[data-policy-open="hits"]').addEventListener("click", function () { openModal(hitsModal); });
    panel.querySelector('[data-policy-close="baseline"]').addEventListener("click", function () { closeModal(baselineModal); });
    panel.querySelector('[data-policy-close="rules"]').addEventListener("click", function () { closeModal(rulesModal); });
    panel.querySelector('[data-policy-close="hits"]').addEventListener("click", function () { closeModal(hitsModal); });
    panel.querySelector('[data-policy-close="editor"]').addEventListener("click", function () { closeModal(editorModal); });
    panel.querySelectorAll(".policy-modal-backdrop").forEach(function (backdrop) {
      backdrop.addEventListener("click", function (event) { if (event.target === backdrop) closeModal(backdrop); });
    });
    panel.querySelectorAll("[data-policy-edit]").forEach(function (button) { button.addEventListener("click", function () { showEditor(rules.find(function (rule) { return rule.id === button.dataset.policyEdit; })); }); });
    panel.querySelectorAll("[data-policy-toggle]").forEach(function (button) { button.addEventListener("click", function () { var id = button.dataset.policyToggle; persist(rules.map(function (rule) { return rule.id === id ? Object.assign({}, rule, { enabled: rule.enabled === false }) : rule; }), "规则状态已更新"); }); });
    panel.querySelectorAll("[data-policy-delete]").forEach(function (button) { button.addEventListener("click", function () { var id = button.dataset.policyDelete; persist(rules.filter(function (rule) { return rule.id !== id; }), "规则已删除"); }); });
    panel.querySelector("#policyRuleSave").addEventListener("click", function () {
      var id = panel.querySelector("#policyRuleId").value.trim() || "policy-" + Date.now();
      var name = panel.querySelector("#policyRuleName").value.trim();
      if (!name) { panel.querySelector("#policyRuleStatus").textContent = "请输入规则名称"; return; }
      var authorization = { allow: values("#policyRuleAllow"), conditional: values("#policyRuleConditional"), deny: values("#policyRuleDeny") };
      var next = { id: id, name: name, priority: Number(panel.querySelector("#policyRulePriority").value || 100), agentScope: panel.querySelector("#policyRuleScope").value.split(",").map(function (value) { return value.trim(); }).filter(Boolean), description: panel.querySelector("#policyRuleDescription").value.trim(), authorization: authorization, atomIds: authorization.allow.concat(authorization.conditional, authorization.deny), enabled: true, source: "administrator" };
      var found = false;
      var nextRules = rules.map(function (rule) { if (rule.id === id) { found = true; return next; } return rule; });
      if (!found) nextRules.push(next);
      persist(nextRules, "规则已保存，有效策略与组织权限边界已刷新");
    });
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
    renderPolicyRules();
    var pageToolbar = page.querySelector(".page-head .toolbar");
    if (pageToolbar) pageToolbar.remove();
    var legacyMetrics = page.querySelector(":scope > .grid.grid-4");
    if (legacyMetrics) legacyMetrics.remove();
    var legacyMetricDetail = page.querySelector("#policyMetricDetail");
    if (legacyMetricDetail) legacyMetricDetail.remove();
    var versionHeading = Array.from(page.querySelectorAll(".panel-head h2")).find(function (heading) { return heading.textContent.trim() === "版本与回滚"; });
    if (versionHeading) versionHeading.closest(".panel").remove();
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
    var endpoint = status.endpoint || status;
    var version = endpoint.version || "unknown";
    var build = endpoint.build || {};
    var buildLabel = document.getElementById("endpointBuildLabel");
    if (buildLabel) buildLabel.textContent = "Endpoint " + version + " · policy 2.2.5";
    var systemVersion = document.getElementById("systemEndpointVersion");
    if (systemVersion) {
      systemVersion.textContent = "Endpoint " + version;
      systemVersion.title = "commit " + (build.gitCommit || "unknown") + (build.gitDirty ? " (dirty)" : "") + " · UI " + (build.uiRevision || "unknown");
    }
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
      api("/api/behavior-atoms?windowHours=24&pathLimit=1000&occurrenceLimit=1000&sourceLimit=5000"),
      api("/api/diagnostics/performance")
    ]).then(function (results) {
      var names = ["\u7cfb\u7edf\u72b6\u6001", "Agent \u53d1\u73b0", "\u4f1a\u8bdd", "\u884c\u4e3a\u4e8b\u4ef6", "\u4e8b\u4ef6\u7edf\u8ba1", "\u7b56\u7565", "\u672c\u5730\u8bed\u4e49\u6a21\u578b", "\u5916\u90e8\u8bed\u4e49\u6a21\u578b", "\u884c\u4e3a\u539f\u5b50", "\u6027\u80fd\u8bca\u65ad"];
      var errors = {};
      results.forEach(function (result, index) {
        if (result.status !== "fulfilled") errors[names[index]] = result.reason && result.reason.message || "unavailable";
      });
      if (results[0].status === "fulfilled") state.status = results[0].value;
      if (results[1].status === "fulfilled") state.agents = results[1].value.agents || [];
      if (results[2].status === "fulfilled") state.sessions = results[2].value.sessions || [];
      if (results[3].status === "fulfilled") state.events = results[3].value.events || [];
      if (results[4].status === "fulfilled") state.eventStats = results[4].value;
      if (results[5].status === "fulfilled") state.policy = results[5].value;
      if (results[6].status === "fulfilled") state.localSemantic = results[6].value;
      if (results[7].status === "fulfilled") state.remoteSemantic = results[7].value;
      if (results[8].status === "fulfilled") state.behaviorAtoms = results[8].value;
      if (results[9].status === "fulfilled") state.performance = results[9].value;
      state.dataErrors = errors;
      if (!Object.keys(errors).length) {
        state.lastSuccessfulRefresh = new Date().toISOString();
        state.hasSuccessfulDataset = true;
      }
      renderDataHealth(errors);
      renderOverview();
      renderAgents();
      renderSessions();
      renderBehavior();
      renderPolicy();
      renderSemantic();
      renderSystem();
    }).finally(function () { refreshInFlight = null; });
    return refreshInFlight;
  }

  window.refreshAidrData = refresh;
  window.aidrNavigate = navigate;
  ensureEndpointSelector();
  initialPage();
  document.getElementById("refreshBtn")?.addEventListener("click", refresh);
  document.querySelectorAll(".nav button").forEach(function (button) {
    button.addEventListener("click", function () { window.setTimeout(refresh, 0); });
  });
  refresh();
  window.setInterval(refresh, 15000);
})();
