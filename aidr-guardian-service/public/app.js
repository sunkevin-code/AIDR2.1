const $ = (id) => document.getElementById(id);

let cachedStatus = null;
let llmConfigData = null;

// ============== API ==============
async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: { "content-type": "application/json" },
    ...options
  });
  return res.json();
}

function renderEvent(event) {
  const cls = event.verdict === "block" ? "block" : event.verdict === "alert" ? "alert" : "";
  const time = new Date(event.time).toLocaleString("zh-CN", { hour12: false });
  return `<div class="event ${cls}">
    <strong>${event.verdict.toUpperCase()} / ${event.sensor} / ${event.level}</strong>
    <div class="event-msg">${event.message}</div>
    <div class="event-time">${time}</div>
  </div>`;
}

// ============== Charts ==============
function drawBarChart(canvas, events) {
  if (!canvas || !events.length) return;
  const ctx = canvas.getContext("2d");
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.parentElement.clientWidth;
  const h = canvas.height;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  ctx.scale(dpr, dpr);

  const recent = events.slice(0, 20).reverse();
  const buckets = [[], [], [], [], []];
  const perBucket = Math.max(1, Math.ceil(recent.length / 5));
  recent.forEach((e, i) => {
    const b = Math.min(4, Math.floor(i / perBucket));
    buckets[b].push(e);
  });

  let maxVal = 0;
  buckets.forEach(bucket => {
    const c = { allow: 0, alert: 0, block: 0 };
    bucket.forEach(e => { if (c[e.verdict] !== undefined) c[e.verdict]++; });
    maxVal = Math.max(maxVal, c.allow, c.alert, c.block);
  });
  maxVal = Math.max(maxVal, 1);

  const pad = { t: 8, r: 8, b: 24, l: 8 };
  const chartW = w - pad.l - pad.r;
  const chartH = h - pad.t - pad.b;
  const barW = chartW / (buckets.length * 3 + 1);
  const gap = barW * 0.15;

  ctx.clearRect(0, 0, w, h);
  const colors = { allow: "#10b981", alert: "#f59e0b", block: "#ef4444" };
  const labels = ["allow", "alert", "block"];

  // grid lines
  ctx.strokeStyle = "#e2e6ed";
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const y = pad.t + (chartH / 4) * i;
    ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(w - pad.r, y); ctx.stroke();
  }

  buckets.forEach((bucket, bi) => {
    const c = { allow: 0, alert: 0, block: 0 };
    bucket.forEach(e => { if (c[e.verdict] !== undefined) c[e.verdict]++; });
    labels.forEach((key, li) => {
      const val = c[key] || 0;
      const x = pad.l + bi * (barW * 3 + gap * 2) + li * barW + gap;
      const barH = (val / maxVal) * chartH;
      const y = pad.t + chartH - barH;
      ctx.fillStyle = colors[key];
      ctx.beginPath();
      ctx.roundRect(x, y, barW - gap, barH, [2, 2, 0, 0]);
      ctx.fill();
    });
  });
}

function drawPieChart(canvas, events) {
  if (!canvas || !events.length) return;
  const ctx = canvas.getContext("2d");
  const dpr = window.devicePixelRatio || 1;
  const size = Math.min(canvas.parentElement.clientWidth, 180);
  canvas.width = size * dpr;
  canvas.height = size * dpr;
  ctx.scale(dpr, dpr);

  const counts = { allow: 0, alert: 0, block: 0 };
  events.forEach(e => { if (counts[e.verdict] !== undefined) counts[e.verdict]++; });
  const total = counts.allow + counts.alert + counts.block || 1;
  const colors = ["#10b981", "#f59e0b", "#ef4444"];
  const labels = ["放行", "告警", "拦截"];
  const vals = [counts.allow, counts.alert, counts.block];
  const cx = size / 2, cy = size / 2, r = size / 2 - 12;

  let startAngle = -Math.PI / 2;
  ctx.clearRect(0, 0, size, size);
  vals.forEach((val, i) => {
    const sliceAngle = (val / total) * 2 * Math.PI;
    if (sliceAngle < 0.001) return;
    ctx.fillStyle = colors[i];
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, r, startAngle, startAngle + sliceAngle);
    ctx.closePath();
    ctx.fill();
    startAngle += sliceAngle;
  });
  ctx.fillStyle = "#fff";
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.5, 0, 2 * Math.PI);
  ctx.fill();
  ctx.fillStyle = "#1a1a2e";
  ctx.font = "bold 13px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(`${total}`, cx, cy - 6);
  ctx.font = "10px sans-serif";
  ctx.fillText("事件", cx, cy + 10);
}

// ============== Refresh ==============
async function refresh() {
  const status = await api("/api/status");
  cachedStatus = status;
  const { policy, events, llmConfig, uptime, stats } = status;
  const online = !!policy;

  // Sidebar
  const healthEl = document.querySelector(".health");
  healthEl.className = `health ${online ? "online" : "offline"}`;
  $("healthText").textContent = online ? `在线 :${policy.port || 8787}` : "离线";

  // LLM badge
  const llmBadge = $("llmStatusBadge");
  if (llmConfig?.enabled) {
    llmBadge.textContent = `🧠 LLM: ${llmConfig.provider}/${llmConfig.model}`;
    llmBadge.className = "llm-status on";
  } else {
    llmBadge.textContent = "🧠 LLM: 未配置";
    llmBadge.className = "llm-status off";
  }

  // Stats
  const s = stats || { allow: 0, alert: 0, block: 0 };
  const total = events.length;
  $("statPolicyMode").textContent = policy?.mode || "--";
  $("statAllowCount").textContent = s.allow || 0;
  $("statAlertCount").textContent = s.alert || 0;
  $("statBlockCount").textContent = s.block || 0;
  $("statLlmStatus").textContent = llmConfig?.enabled ? `${llmConfig.provider}` : "未配置";
  $("statEventTotal").textContent = total;

  // Uptime
  if (uptime) {
    const mins = Math.floor(uptime / 60000);
    const hrs = Math.floor(mins / 60);
    $("uptimeDisplay").textContent = hrs > 0 ? `运行: ${hrs}h ${mins % 60}m` : `运行: ${mins}m`;
  }

  // Charts
  drawBarChart($("eventChart"), events);
  drawPieChart($("pieChart"), events);

  // Dashboard events
  $("dashboardEvents").innerHTML = events.slice(0, 8).map(renderEvent).join("");

  // Events list
  renderEventsList(events);

  // Config
  renderConfig(policy);

  // LLM Config
  renderLlmConfig(llmConfig);
}

function renderEventsList(events) {
  const verdict = $("filterVerdict").value;
  const level = $("filterLevel").value;
  const filtered = events.filter(e => {
    if (verdict !== "all" && e.verdict !== verdict) return false;
    if (level !== "all" && e.level !== level) return false;
    return true;
  });
  $("eventsList").innerHTML = filtered.length
    ? filtered.map(renderEvent).join("")
    : '<div style="padding:20px;text-align:center;color:var(--ink-secondary)">没有匹配的事件</div>';
}

function renderConfig(policy) {
  if (!policy) return;
  $("cfgAgentName").value = policy.agentName || "";
  $("cfgPort").value = policy.port || 8787;
  $("cfgWorkspace").value = policy.workspaceRoot || "";
  $("cfgMode").value = policy.mode || "enforce";
  $("cfgAllowedPaths").value = (policy.sessionPolicy?.allowedWritePaths || []).join("\n");
  $("cfgDeniedPaths").value = (policy.sessionPolicy?.deniedPaths || []).join("\n");
  $("cfgDeniedCommands").value = (policy.sessionPolicy?.deniedCommandPatterns || []).join("\n");
}

function renderLlmConfig(cfg) {
  if (!cfg) cfg = {};
  llmConfigData = cfg;
  $("llmEnabled").checked = cfg.enabled || false;
  $("llmProvider").value = cfg.provider || "openai";
  $("llmEndpoint").value = cfg.endpoint || "https://api.openai.com/v1";
  $("llmModel").value = cfg.model || "gpt-4o-mini";
  $("llmMaxTokens").value = cfg.maxTokens || 256;
  $("llmTemperature").value = cfg.temperature || 0.1;
  $("llmTempValue").textContent = cfg.temperature || 0.1;

  // Update hint based on provider
  const hints = {
    openai: "💡 gpt-4o-mini 性价比最高，适合意图分类",
    deepseek: "💡 deepseek-chat 适合中文意图分析",
    moonshot: "💡 moonshot-v1-auto 适合中文场景",
    qwen: "💡 qwen-turbo 或 qwen-plus",
    custom: "💡 输入兼容 OpenAI 接口的模型名"
  };
  $("modelHint").textContent = hints[$("llmProvider").value] || hints.openai;

  // LLM config page status
  const badge = $("llmConfigStatus");
  if (cfg.enabled && cfg.apiKey) {
    badge.textContent = `✅ 已配置 (${cfg.provider})`;
    badge.className = "badge active";
  } else {
    badge.textContent = "⚠️ 未配置";
    badge.className = "badge";
  }
}

// ============== Navigation ==============
document.querySelectorAll(".nav-item").forEach(item => {
  item.addEventListener("click", (e) => {
    e.preventDefault();
    document.querySelectorAll(".nav-item").forEach(n => n.classList.remove("active"));
    item.classList.add("active");
    document.querySelectorAll(".page").forEach(p => p.classList.remove("active"));
    const page = $(`page-${item.dataset.page}`);
    if (page) page.classList.add("active");
    if (item.dataset.page === "dashboard" && cachedStatus) {
      setTimeout(() => {
        drawBarChart($("eventChart"), cachedStatus.events);
        drawPieChart($("pieChart"), cachedStatus.events);
      }, 100);
    }
  });
});

// ============== Analysis ==============
async function analyze() {
  const prompt = $("prompt").value;
  const result = await api("/api/analyze", {
    method: "POST",
    body: JSON.stringify({ prompt })
  });

  // Show verdict
  const verdictEl = $("analysisVerdict");
  const verdict = result.verdict || "allow";
  const risk = result.risk || "low";
  const source = result.source || "rule_engine";
  const explanation = result.explanation || "";
  const score = result.score || 0;
  const llmAnalysis = result.llmAnalysis;

  let verdictHtml = `<div class="verdict-tag ${verdict}">`;
  if (verdict === "block") verdictHtml += "🚫 拦截";
  else if (verdict === "alert") verdictHtml += "⚠️ 告警";
  else verdictHtml += "✅ 放行";
  verdictHtml += `</div>`;
  verdictHtml += `<div class="verdict-detail"><strong>风险等级:</strong> ${risk === "high" ? "🔴 高危" : risk === "medium" ? "🟡 中等" : "🟢 低危"} | <strong>评分:</strong> ${score}</div>`;
  verdictHtml += `<div class="verdict-detail"><strong>分析源:</strong> ${source === "hybrid" ? "规则引擎 + LLM" : source === "rule_engine_fallback" ? "规则引擎 (LLM降级)" : "规则引擎"}</div>`;
  verdictHtml += `<div class="verdict-detail"><strong>建议操作:</strong> ${result.action || "allow"}</div>`;
  if (explanation) verdictHtml += `<div class="verdict-detail"><strong>说明:</strong> ${explanation}</div>`;
  if (result.findings?.length) {
    verdictHtml += `<div class="verdict-detail"><strong>触发规则:</strong></div><ul style="margin:4px 0;padding-left:18px;font-size:12px">`;
    result.findings.forEach(f => { verdictHtml += `<li>${f.detail || f}</li>`; });
    verdictHtml += `</ul>`;
  }
  verdictHtml += `<div class="verdict-meta">评分: ${score} | 置信度: ${result.confidence || "medium"}</div>`;
  verdictEl.innerHTML = verdictHtml;

  // Show detail JSON
  $("analysisDetail").textContent = JSON.stringify(result, null, 2);

  await refresh();
}

function setPromptAndAnalyze(text) {
  $("prompt").value = text;
  analyze();
}

$("analyzeBtn").addEventListener("click", analyze);
$("analyzeQuick1").addEventListener("click", () => setPromptAndAnalyze("读取项目中的 README.md 文件并总结内容"));
$("analyzeQuick2").addEventListener("click", () => setPromptAndAnalyze("删除 C:\\Users\\OseasyVM\\Documents\\AIDR 下的所有文件"));
$("analyzeQuick3").addEventListener("click", () => setPromptAndAnalyze("使用 curl 下载 https://example.com/payload.exe 到本地"));

async function simulate(type) {
  await api("/api/simulate", { method: "POST", body: JSON.stringify({ type }) });
  await refresh();
}
$("attackSecretBtn").addEventListener("click", () => simulate("secret"));
$("attackMcpBtn").addEventListener("click", () => simulate("mcp"));
$("attackSupplyBtn").addEventListener("click", () => simulate("supply"));

// ============== LLM Config ==============
$("llmProvider").addEventListener("change", () => {
  const endpoints = {
    openai: "https://api.openai.com/v1",
    deepseek: "https://api.deepseek.com/v1",
    moonshot: "https://api.moonshot.cn/v1",
    qwen: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    custom: ""
  };
  const models = {
    openai: "gpt-4o-mini",
    deepseek: "deepseek-chat",
    moonshot: "moonshot-v1-auto",
    qwen: "qwen-turbo",
    custom: ""
  };
  const hints = {
    openai: "💡 gpt-4o-mini 性价比最高，适合意图分类",
    deepseek: "💡 deepseek-chat 适合中文意图分析",
    moonshot: "💡 moonshot-v1-auto 适合中文场景",
    qwen: "💡 qwen-turbo 或 qwen-plus",
    custom: "💡 输入兼容 OpenAI 接口的模型名"
  };
  if (endpoints[$("llmProvider").value]) {
    $("llmEndpoint").value = endpoints[$("llmProvider").value];
    $("llmModel").value = models[$("llmProvider").value];
  }
  $("modelHint").textContent = hints[$("llmProvider").value] || "";
});

$("llmTemperature").addEventListener("input", () => {
  $("llmTempValue").textContent = $("llmTemperature").value;
});

$("toggleApiKey").addEventListener("click", () => {
  const input = $("llmApiKey");
  input.type = input.type === "password" ? "text" : "password";
});

$("saveLlmBtn").addEventListener("click", async () => {
  const cfg = {
    provider: $("llmProvider").value,
    endpoint: $("llmEndpoint").value,
    model: $("llmModel").value,
    apiKey: $("llmApiKey").value,
    enabled: $("llmEnabled").checked,
    maxTokens: parseInt($("llmMaxTokens").value) || 256,
    temperature: parseFloat($("llmTemperature").value) || 0.1
  };
  const result = await api("/api/llm-config", {
    method: "POST",
    body: JSON.stringify(cfg)
  });
  if (result.ok) {
    $("llmStatus").textContent = "✅ LLM 配置已保存";
    $("llmStatus").style.color = "#10b981";
    $("llmStatus").style.display = "block";
    await refresh();
  } else {
    $("llmStatus").textContent = "❌ 保存失败: " + (result.error || "未知错误");
    $("llmStatus").style.color = "#ef4444";
  }
  setTimeout(() => { $("llmStatus").style.display = "none"; }, 4000);
});

$("llmTestBtn").addEventListener("click", async () => {
  const testPrompt = $("llmTestPrompt").value || "测试连接";
  $("llmStatus").textContent = "⏳ 正在测试 LLM 连接...";
  $("llmStatus").style.color = "#f59e0b";
  $("llmStatus").style.display = "block";

  const result = await api("/api/analyze", {
    method: "POST",
    body: JSON.stringify({ prompt: testPrompt })
  });

  if (result.llmAnalysis && !result.llmAnalysis.error) {
    $("llmStatus").textContent = "✅ LLM 连接成功！\n\n" + JSON.stringify(result, null, 2);
    $("llmStatus").style.color = "#10b981";
  } else if (result.source === "rule_engine_fallback") {
    $("llmStatus").textContent = "⚠️ LLM 不可用 (只使用了规则引擎)\n错误: " + (result.llmAnalysis?.error || "未知");
    $("llmStatus").style.color = "#ef4444";
  } else {
    $("llmStatus").textContent = "✅ 已连接 (规则引擎结果)\n\n" + JSON.stringify(result, null, 2);
    $("llmStatus").style.color = "#10b981";
  }
});

// ============== Config Page ==============
$("reloadPolicyBtn").addEventListener("click", async () => {
  await api("/api/reload", { method: "POST", body: "{}" });
  await refresh();
  $("configStatus").textContent = "✅ 策略已重新加载";
  $("configStatus").style.display = "block";
  setTimeout(() => { $("configStatus").style.display = "none"; }, 3000);
});

$("saveConfigBtn").addEventListener("click", async () => {
  const newPolicy = {
    agentName: $("cfgAgentName").value,
    port: parseInt($("cfgPort").value) || 8787,
    workspaceRoot: $("cfgWorkspace").value,
    mode: $("cfgMode").value,
    sessionPolicy: {
      allowedWritePaths: $("cfgAllowedPaths").value.split("\n").map(s => s.trim()).filter(Boolean),
      deniedPaths: $("cfgDeniedPaths").value.split("\n").map(s => s.trim()).filter(Boolean),
      deniedCommandPatterns: $("cfgDeniedCommands").value.split("\n").map(s => s.trim()).filter(Boolean)
    }
  };
  const result = await api("/api/config", { method: "POST", body: JSON.stringify({ policy: newPolicy }) });
  if (result.ok) {
    $("configStatus").textContent = "✅ 配置已保存";
    $("configStatus").style.color = "#10b981";
    await refresh();
  } else {
    $("configStatus").textContent = "❌ 保存失败: " + (result.error || "未知错误");
    $("configStatus").style.color = "#ef4444";
  }
  $("configStatus").style.display = "block";
  setTimeout(() => { $("configStatus").style.display = "none"; }, 4000);
});

$("resetConfigBtn").addEventListener("click", () => {
  if (cachedStatus) renderConfig(cachedStatus.policy);
});

// ============== Events ==============
$("filterVerdict").addEventListener("change", () => { if (cachedStatus) renderEventsList(cachedStatus.events); });
$("filterLevel").addEventListener("change", () => { if (cachedStatus) renderEventsList(cachedStatus.events); });
$("clearEventsBtn").addEventListener("click", () => {
  $("eventsList").innerHTML = '<div style="padding:20px;text-align:center;color:var(--ink-secondary)">已清空显示</div>';
});
$("refreshBtn").addEventListener("click", refresh);

// ============== Init ==============
refresh();
setInterval(refresh, 3000);
