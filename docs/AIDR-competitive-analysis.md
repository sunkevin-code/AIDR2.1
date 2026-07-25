# AIDR 竞品分析 v2 — 2026-07-22

## 当前 AIDR 架构全景（最新源码）

```
AIDRAgent (545行, 30KB)
├── observability/
│   ├── auditLedger.js       ← 加密审计账本 (NEW)
│   ├── semanticFeedback.js   ← 语义反馈闭环 (NEW)
│   ├── asyncTelemetryQueue.js← 异步遥测队列 (NEW)
│   └── eventSchema.js        ← 标准化事件格式
├── engine/
│   ├── behaviorAtoms.js      ← ABCG v1 行为原子库: 9域 60+原子 (NEW)
│   ├── behaviorAtomSchema.js ← 原子定义模式 (NEW)
│   ├── decisionContract.js   ← 决策契约: SHA256签名+证据链 (NEW)
│   ├── intentEvidence.js     ← 意图证据: 6能力键+置信度 (NEW)
│   ├── sessionPolicyEngine.js← 会话策略引擎 (整合IdentityGraph)
│   ├── identityGraph.js      ← 身份图谱 (上周新增)
│   ├── behaviorDriftEngine.js← 行为偏移检测
│   ├── ruleEngine.js         ← 规则引擎
│   ├── threatDetectionEngine.js← 威胁检测
│   ├── llmClassifier.js      ← LLM语义分类
│   ├── localSemanticClassifier.js← 本地模型
│   └── hybridSemanticClassifier.js← 混合语义
├── sensors/    (7个传感器)
├── enforcement/enforcer.js
├── transport/client.js
└── adapters/   (Codex/OpenCode/Generic)
```

## vs 业界最先进产品

| 能力 | AIDR 最新 | Cisco AI Defense | Wiz AI-SPM | SentinelOne PurpleAI |
|------|----------|-----------------|------------|---------------------|
| **行为原子分解** | ✅ ABCG 60+原子 | ❌ 无 | ❌ 无 | ❌ 无 |
| **决策契约签名** | ✅ SHA256 + UUID | ❌ 活动日志 | ❌ | ✅ Storyline |
| **身份图谱** | ✅ Agent→身份→用户 | ✅ 应用拓扑 | ✅ 身份图 | ✅ 用户映射 |
| **本地离线** | ✅ 全本地 | ❌ 云依赖 | ❌ 云 | ❌ 部分离线 |
| **Agent适配器** | ✅ Codex/OpenCode | ❌ 自家平台 | ❌ | ❌ |
| **MCP拦截** | ✅ HTTP代理 | ✅ 深度检测 | ❌ | ❌ |
| **内核阻断** | ❌ 未实现 | ❌ | ❌ | ✅ minifilter |
| **实时策略下发** | ❌ 文件轮询 | ✅ API推送 | ✅ | ✅ |
| **可视化能力格栅** | ❌ (Demo阶段) | ❌ | ❌ | ❌ |
| **SIEM集成** | ❌ 无 | ✅ Splunk/XDR | ✅ | ✅ |

## 三条核心优化建议

### 1. ABCG 格栅可视化 → 行为页升级 (P0 · 2-3周)

`behaviorAtoms.js` 已定义完好的行为原子库，但缺少前端可视化。将其映射为交互式拓扑图可实现业界唯一的"AI Agent 能力格栅"控制台：

```
ABCG 9域 → 当前UI
INTENT  ──┐
PLAN    ──┤
AGENT   ──┤
MODEL   ──┤
TOOL    ──┼── 能力格栅拓扑图 ← 尚无
AUTH    ──┤
DATA    ──┤
MEMORY  ──┤
EXEC    ──┘
```

建议：用Demo aidr-capability-lattice.html为蓝本集成到endpoint.js中，仅需将NODES数据源从静态定义替换为`behaviorAtoms.js`的`DOMAINS`导出。

### 2. DecisionContract 闭环 → 可审计证据工作流 (P0 · 1-2周)

`decisionContract.js`已生成签名决策，但缺少：
- 前端决策契约展示组件
- 策略回滚时的契约验证
- 向外部系统导出契约的API

建议：在策略页加入"决策契约"标签页，展示每次hook决策的完整SHA256证据链。

### 3. 实时策略推送 + SIEM集成 (P1 · 3-4周)

| 缺失能力 | 实现路径 |
|---------|---------|
| 实时策略下发 | WebSocket替代文件轮询 |
| SIEM集成 | CEF/Syslog格式化输出 |
| 告警工作流 | 确认-调查-关闭状态机 |
| 外部集成API | RESTful webhook |

## 竞争力总结

**AIDR的独特壁垒**，目前没有产品同时具备：
1. 行为原子分解(ABCG) — 业界唯一
2. 决策契约签名 — 业界唯一
3. 身份图谱+全离线 — 组合唯一
4. Agent适配器体系 — 独特架构

**最急缺的**，都是UI/集成层问题：
1. ABCG可视化 → 已交付Demo，待集成
2. 决策契约展示 → 1-2周
3. SIEM/webhook集成 → 3-4周

这三项完成后，AIDR将成为业界最完备的AI Agent运行时防护产品。
