// AIDR 2.0 Dashboard
var API = "http://127.0.0.1:8888";
var currentPage = "dashboard";

document.querySelectorAll(".nav-item").forEach(function(item) {
  item.addEventListener("click", function(e) {
    e.preventDefault();
    var page = item.getAttribute("data-page");
    showPage(page);
  });
});

function showPage(page) {
  currentPage = page;
  var items = document.querySelectorAll(".nav-item");
  for (var i = 0; i < items.length; i++) {
    if (items[i].getAttribute("data-page") === page) {
      items[i].classList.add("active");
    } else {
      items[i].classList.remove("active");
    }
  }
  var pages = document.querySelectorAll(".page");
  for (var i = 0; i < pages.length; i++) {
    pages[i].classList.remove("active");
  }
  var target = document.getElementById("page-" + page);
  if (target) target.classList.add("active");

  if (page === "dashboard") loadDashboard();
  else if (page === "agents") loadAgents();
  else if (page === "events") loadEvents();
  else if (page === "graph") initGraph();
  else if (page === "policies") loadPolicies();
  else if (page === "alerts") loadAlerts();
  else if (page === "reports") loadReports();
}

async function loadDashboard() {
  // Stats cards
  document.getElementById("dashboardStats").innerHTML = [
    '<div class="stat-card green"><div class="value">-</div><div class="label">Agents</div></div>',
    '<div class="stat-card purple"><div class="value">-</div><div class="label">Events</div></div>',
    '<div class="stat-card red"><div class="value">-</div><div class="label">Blocked</div></div>',
    '<div class="stat-card orange"><div class="value">-</div><div class="label">Alerts</div></div>'
  ].join("");

  try {
    var data = await (await fetch(API + "/api/v1/events/stats")).json();
    var agents = await (await fetch(API + "/api/v1/agents")).json();
    var blocked = 0, alerted = 0;
    if (data.byVerdict) {
      data.byVerdict.forEach(function(v) {
        if (v.verdict === "block") blocked = v.c;
        if (v.verdict === "alert") alerted = v.c;
      });
    }
    var cards = [
      ["Agents", (Array.isArray(agents) ? agents.length : 0), "green"],
      ["Events", data.total || 0, "purple"],
      ["Blocked", blocked, "red"],
      ["Alerts", alerted, "orange"]
    ];
    var html = "";
    for (var i = 0; i < cards.length; i++) {
      html += '<div class="stat-card ' + cards[i][2] + '"><div class="value">' + cards[i][1] + '</div><div class="label">' + cards[i][0] + '</div></div>';
    }
    document.getElementById("dashboardStats").innerHTML = html;

    // Events
    var events = await (await fetch(API + "/api/v1/events?limit=20")).json();
    var evtHtml = "";
    if (events.events) {
      for (var i = 0; i < events.events.length; i++) {
        var e = events.events[i];
        var time = (e.timestamp || "").slice(11, 19);
        evtHtml += '<div class="event-item"><span class="time">' + time + '</span><span class="category">[' + e.category + ']</span><span class="badge badge-' + e.verdict + '">' + e.verdict + '</span><span>' + (e.summary || "").slice(0, 80) + '</span></div>';
      }
    }
    document.getElementById("liveEvents").innerHTML = evtHtml || '<div class="dim">No events</div>';

    // Sessions
    var sessions = await (await fetch(API + "/api/v1/sessions")).json();
    var sessHtml = "";
    if (Array.isArray(sessions)) {
      for (var j = 0; j < Math.min(sessions.length, 10); j++) {
        var s = sessions[j];
        sessHtml += '<div class="event-item" style="border-left:3px solid #a371f7"><span class="time">' + (s.start_time || "").slice(11, 19) + '</span><span class="category">[Session]</span><span class="badge badge-info">active</span><span style="flex:1">' + (s.prompt || "").slice(0, 100) + '</span></div>';
      }
    }
    document.getElementById("liveSessions").innerHTML = sessHtml || '<div class="dim">No sessions</div>';
  } catch(e) {
    console.error(e);
  }
}

async function loadAgents() {
  var agents = await (await fetch(API + "/api/v1/agents")).json();
  if (!Array.isArray(agents)) agents = [];
  var html = '<table><thead><tr><th>ID</th><th>Type</th><th>Host</th><th>Status</th><th>Sensors</th><th>Last Seen</th></tr></thead><tbody>';
  for (var i = 0; i < agents.length; i++) {
    var a = agents[i];
    html += '<tr><td><code>' + (a.id || "").slice(0,12) + '</code></td><td>' + (a.agentType || "-") + '</td><td>' + (a.hostname || "-") + '</td><td><span class="badge ' + (a.status === "online" ? "badge-allow" : "badge-block") + '">' + (a.status || "offline") + '</span></td><td>' + ((a.sensors || []).join(", ") || "-") + '</td><td>' + (a.lastSeen || "").slice(0,19) + '</td></tr>';
  }
  html += '</tbody></table>';
  document.getElementById("agentList").innerHTML = html;
}

async function loadEvents() {
  document.getElementById("eventList").innerHTML = "Loading...";
  try {
    var data = await (await fetch(API + "/api/v1/events?limit=50")).json();
    var events = data.events || [];
    var html = '<table><thead><tr><th>Time</th><th>Agent</th><th>Category</th><th>Severity</th><th>Verdict</th><th>Summary</th></tr></thead><tbody>';
    for (var i = 0; i < events.length; i++) {
      var e = events[i];
      html += '<tr><td>' + (e.timestamp || "").slice(0,19) + '</td><td><code>' + (e.agent_id || "").slice(0,8) + '</code></td><td>' + (e.category || "-") + '</td><td>' + (e.severity || "-") + '</td><td><span class="badge badge-' + (e.verdict || "allow") + '">' + (e.verdict || "allow") + '</span></td><td>' + (e.summary || "").slice(0,60) + '</td></tr>';
    }
    html += '</tbody></table>';
    document.getElementById("eventList").innerHTML = html;
  } catch(e) { document.getElementById("eventList").innerHTML = "Error loading events"; }
}

async function initGraph() {
  var container = document.getElementById("cyGraph");
  container.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text-dim)">Select a session to view graph</div>';
}

async function loadPolicies() {
  document.getElementById("policyList").innerHTML = "Loading...";
  try {
    var policies = await (await fetch(API + "/api/v1/policies")).json();
    if (!Array.isArray(policies)) policies = [];
    var html = '<table><thead><tr><th>Name</th><th>Scope</th><th>Enabled</th><th>Actions</th></tr></thead><tbody>';
    for (var i = 0; i < policies.length; i++) {
      var p = policies[i];
      html += '<tr><td>' + p.name + '</td><td>' + p.scope + '</td><td>' + (p.enabled ? "Yes" : "No") + '</td><td><button class="btn" onclick="deletePolicy(' + p.id + ')">Delete</button></td></tr>';
    }
    html += '</tbody></table>';
    document.getElementById("policyList").innerHTML = html;
  } catch(e) { document.getElementById("policyList").innerHTML = "Error"; }
}

async function loadAlerts() {
  document.getElementById("alertList").innerHTML = "Loading...";
  try {
    var alerts = await (await fetch(API + "/api/v1/alerts")).json();
    if (!Array.isArray(alerts)) alerts = [];
    var html = '<table><thead><tr><th>Title</th><th>Severity</th><th>Status</th><th>Time</th></tr></thead><tbody>';
    for (var i = 0; i < alerts.length; i++) {
      var a = alerts[i];
      html += '<tr><td>' + a.title + '</td><td>' + a.severity + '</td><td>' + a.status + '</td><td>' + (a.created_at || "").slice(0,19) + '</td></tr>';
    }
    html += '</tbody></table>';
    document.getElementById("alertList").innerHTML = html;
  } catch(e) { document.getElementById("alertList").innerHTML = "Error"; }
}

async function loadReports() {
  document.getElementById("reportContent").innerHTML = "Loading...";
  try {
    var data = await (await fetch(API + "/api/v1/events/stats")).json();
    document.getElementById("reportContent").innerHTML = '<h4>Daily Report</h4><p>Total events: ' + (data.total || 0) + '</p>';
  } catch(e) {}
}

async function deletePolicy(id) {
  await fetch(API + "/api/v1/policies/" + id, { method: "DELETE" });
  loadPolicies();
}

// Start
showPage("dashboard");

// ===== WebSocket + Auto-refresh =====
var wsClient = null;

function initWS() {
  try {
    wsClient = new WebSocket("ws://127.0.0.1:8888/ws/dashboard");
    wsClient.onopen = function() {
      console.log("Dashboard WS connected");
      document.getElementById("serverStatus").textContent = "connected";
      document.getElementById("serverStatus").className = "server-status connected";
    };
    wsClient.onmessage = function(e) {
      try {
        var msg = JSON.parse(e.data);
        if (msg.type === "session_update" || msg.type === "event_update") {
          if (currentPage === "dashboard") loadDashboard();
        }
        if (msg.type === "session_update" && currentPage === "dashboard") {
          // Also refresh sessions inline without full reload
          refreshSessions(msg.sessions);
        }
      } catch(ex) {}
    };
    wsClient.onclose = function() {
      document.getElementById("serverStatus").textContent = "offline";
      document.getElementById("serverStatus").className = "server-status";
      setTimeout(initWS, 3000);
    };
  } catch(e) { setTimeout(initWS, 5000); }
}

function refreshSessions(sessions) {
  if (!sessions || !sessions.length) return;
  var sessHtml = "";
  for (var j = 0; j < Math.min(sessions.length, 10); j++) {
    var s = sessions[j];
    sessHtml += '<div class="event-item" style="border-left:3px solid #a371f7"><span class="time">' + (s.start_time || "").slice(11, 19) + '</span><span class="category">[Session]</span><span class="badge badge-info">active</span><span style="flex:1">' + (s.prompt || "").slice(0, 100) + '</span></div>';
  }
  var el = document.getElementById("liveSessions");
  if (el) el.innerHTML = sessHtml || '<div class="dim">No sessions</div>';
}

// Start WS and polling
setTimeout(initWS, 2000);

// Poll sessions every 5 seconds for resilience
setInterval(function() {
  if (currentPage === "dashboard") {
    fetch(API + "/api/v1/sessions").then(function(r) { return r.json(); }).then(function(data) {
      if (Array.isArray(data)) refreshSessions(data);
    }).catch(function() {});
  }
}, 5000);

// Also refresh dashboard stats every 10s
setInterval(function() {
  if (currentPage === "dashboard") loadDashboard();
}, 10000);