# AIDR 2.0 — AI Agent 动态防御系统 设计说明书

> 版本: 2.0.0  
> 日期: 2026-07-12  
> 状态: 设计阶段

---

## 1. 愿景与定位

AIDR (AI Dynamic Response) 是一套面向 **AI Agent 操作系统的运行时安全防御系统**，对标业界最先进产品：

| 能力维度 | 对标产品 | AIDR 2.0 目标 |
|----------|----------|---------------|
| AI应用发现与风险评估 | Cisco AI Defense | Agent 会话感知、MCP工具谱系分析、提示词意图分类 |
| 内核级遥测与阻断 | Cisco Hypershield / Tetragon (eBPF) | Windows: ETW + minifilter + WFP; Linux: eBPF |
| 动态策略学习 | Cisco Secure Workload | 行为基线自动收敛、零信任微隔离策略生成 |
| 攻击链可视化 | CrowdStrike Falcon | Agent 行为图谱、攻击链回放、MITRE ATT&CK 映射 |
| 实时响应 | SentinelOne Singularity | 亚秒级进程终止、网络隔离、文件回滚 |
| AI原生 | — | 端到端 AI 驱动：LLM意图分析 → 策略生成 → 行为异常检测 |

### 核心创新

1. **Agent 会话感知**：不只是监控进程，而是理解 Agent 的"任务画像"（taskId、prompt、工具集、预期行为边界）
2. **意图-行为闭环**：用户 prompt → Agent 计划 → 实际执行行为 → 偏差检测 → 动态策略调整
3. **MCP/工具网关**：原生拦截所有 MCP tool call、插件调用、Shell 命令，形成完整调用链

---

## 2. 系统架构总览

```
┌──────────────────────────────────────────────────────────────────────┐
│                        AIDR 2.0 系统架构                              │
├──────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  ┌─────────────┐   ┌─────────────┐   ┌─────────────┐   ┌──────────┐│
│  │  AI Agent   │   │  AI Agent   │   │  AI Agent   │   │  .....   ││
│  │  (Codex)    │   │  (Copilot)  │   │  (Cline)    │   │          ││
│  └──────┬──────┘   └──────┬──────┘   └──────┬──────┘   └────┬─────┘│
│         │                 │                 │               │       │
│         └─────────────────┼─────────────────┼───────────────┘       │
│                           │                 │                        │
│              ┌────────────▼─────────────────▼───────────────┐       │
│              │         AIDR Agent (每台主机)                  │       │
│              │  ┌──────────────────────────────────────┐    │       │
│              │  │  传感器层 (Sensors)                    │    │       │
│              │  │  · 进程传感器 (ETW/WMI)               │    │       │
│              │  │  · 文件传感器 (minifilter/FSW)        │    │       │
│              │  │  · 网络传感器 (WFP/pcap)              │    │       │
│              │  │  · MCP 网关代理                       │    │       │
│              │  │  · 注册表/服务传感器                   │    │       │
│              │  │  · Shell 命令拦截器                    │    │       │
│              │  └──────────────────────────────────────┘    │       │
│              │  ┌──────────────────────────────────────┐    │       │
│              │  │  分析引擎层 (Analysis)                  │    │       │
│              │  │  · 规则引擎 (关键词/正则/路径/序列)    │    │       │
│              │  │  · LLM 意图分类器                      │    │       │
│              │  │  · 行为基线模型 (统计异常检测)         │    │       │
│              │  │  · 威胁情报匹配                        │    │       │
│              │  └──────────────────────────────────────┘    │       │
│              │  ┌──────────────────────────────────────┐    │       │
│              │  │  执行器层 (Enforcement)                │    │       │
│              │  │  · 进程终止/挂起                      │    │       │
│              │  │  · 文件访问拒绝                       │    │       │
│              │  │  · 网络连接阻断                       │    │       │
│              │  │  · 注册表写保护                       │    │       │
│              │  │  · Token/凭据访问拦截                 │    │       │
│              │  └──────────────────────────────────────┘    │       │
│              │  ┌──────────────────────────────────────┐    │       │
│              │  │  通信层 (Transport)                    │    │       │
│              │  │  · mTLS WebSocket 长连接              │    │       │
│              │  │  · 心跳 + 离线缓存                     │    │       │
│              │  │  · 策略热更新                          │    │       │
│              │  └──────────────────────────────────────┘    │       │
│              └──────────────────────────────────────────────┘       │
│                                  │                                   │
│                    mTLS WebSocket / REST                             │
│                                  │                                   │
│              ┌───────────────────▼──────────────────────┐           │
│              │       AIDR Server (管理中心)              │           │
│              │                                          │           │
│              │  ┌────────────────────────────────────┐  │           │
│              │  │  Agent 管理                        │  │           │
│              │  │  · 注册/认证/心跳                   │  │           │
│              │  │  · 策略分发                         │  │           │
│              │  │  · 版本管理/升级                    │  │           │
│              │  └────────────────────────────────────┘  │           │
│              │  ┌────────────────────────────────────┐  │           │
│              │  │  事件处理管道                       │  │           │
│              │  │  · 事件接收 → 归一化 → 富化         │  │           │
│              │  │  · 关联分析 (行为序列匹配)          │  │           │
│              │  │  · 告警聚合降噪                     │  │           │
│              │  └────────────────────────────────────┘  │           │
│              │  ┌────────────────────────────────────┐  │           │
│              │  │  智能分析                          │  │           │
│              │  │  · LLM 威胁研判                     │  │           │
│              │  │  · 行为图谱构建                     │  │           │
│              │  │  · 动态策略建议                     │  │           │
│              │  │  · MITRE ATT&CK 映射               │  │           │
│              │  └────────────────────────────────────┘  │           │
│              │  ┌────────────────────────────────────┐  │           │
│              │  │  存储层                            │  │           │
│              │  │  · PostgreSQL (事件/策略/配置)      │  │           │
│              │  │  · Redis (缓存/实时状态)            │  │           │
│              │  │  · MinIO (日志归档/取证)            │  │           │
│              │  └────────────────────────────────────┘  │           │
│              │  ┌────────────────────────────────────┐  │           │
│              │  │  Web Dashboard                     │  │           │
│              │  │  · 仪表盘 (概览/实时/统计)          │  │           │
│              │  │  · Agent 管理面板                   │  │           │
│              │  │  · 事件日志/搜索                    │  │           │
│              │  │  · 行为图谱可视化                   │  │           │
│              │  │  · 策略编辑器                       │  │           │
│              │  │  · 告警/报告                        │  │           │
│              │  └────────────────────────────────────┘  │           │
│              └──────────────────────────────────────────┘           │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
```

---

## 3. 数据模型

### 3.1 Agent 事件 (Event)

```typescript
interface AidrEvent {
  id: string;                    // UUID
  agentId: string;               // Agent 唯一标识
  sessionId: string;             // Agent 会话 ID (对应 taskId)
  timestamp: string;             // ISO 8601 UTC
  
  // 事件分类
  category: "process" | "file" | "network" | "registry" | "mcp" 
           | "shell" | "identity" | "policy" | "system";
  
  // 事件等级
  severity: "info" | "low" | "medium" | "high" | "critical";
  
  // 判定结果
  verdict: "allow" | "alert" | "block" | "ask";
  
  // 事件详情
  summary: string;               // 人类可读描述
  detail: Record<string, any>;   // 结构化详情
  
  // 判定来源
  decisionSource: "rule_engine" | "llm" | "baseline" | "threat_intel" 
                 | "manual" | "policy";
  
  // 关联信息
  correlationId?: string;        // 关联事件组 ID
  parentEventId?: string;        // 父事件 ID
  taskImage?: string;            // Agent 任务画像快照
  
  // MITRE ATT&CK
  mitreTactic?: string;          // 战术
  mitreTechnique?: string;       // 技术 ID
}
```

### 3.2 Agent 任务画像 (TaskImage)

```typescript
interface TaskImage {
  taskId: string;
  agentId: string;
  agentType: string;             // "codex" | "copilot" | "cline" | ...
  
  // 用户上下文
  prompt: string;                // 用户原始请求
  promptDigest: string;          // LLM 提取的意图摘要
  
  // 任务边界
  expectedActions: string[];     // 预期操作类型
  declaredResources: {           // 声明的资源访问
    paths: string[];
    domains: string[];
    tools: string[];             // MCP 工具列表
    commands: string[];
  };
  
  // 风险评估
  riskScore: number;             // 0-100
  riskFactors: string[];         // 风险因子列表
  
  // 动态策略
  generatedPolicy: {
    allowWritePaths: string[];
    denyPaths: string[];
    denyCommands: string[];
    allowDomains: string[];
    maxProcessCount: number;
    ttlMinutes: number;
  };
  
  createdAt: string;
  expiresAt: string;
}
```

### 3.3 策略 (Policy)

```typescript
interface Policy {
  id: string;
  name: string;
  version: string;
  
  // 策略范围
  scope: "global" | "agent" | "session";
  targetAgents?: string[];       // 适用的 Agent ID 列表
  targetAgentTypes?: string[];   // 适用的 Agent 类型
  
  // 策略规则
  rules: PolicyRule[];
  
  // 优先级与冲突解决
  priority: number;              // 数字越大优先级越高
  mergeStrategy: "override" | "union" | "intersect";
  
  // 生命周期
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

interface PolicyRule {
  id: string;
  type: "forbid" | "allow" | "alert" | "rate_limit" | "require_approval";
  
  // 匹配条件
  conditions: {
    eventCategory?: string[];
    pathPattern?: string;        // glob 模式
    commandPattern?: string;     // 正则
    domainPattern?: string;
    processName?: string;
    registryKey?: string;
    mcpTool?: string;
    severityAbove?: string;
    riskScoreAbove?: number;
  };
  
  // 响应动作
  action: {
    type: "block" | "terminate" | "suspend" | "isolate" | "quarantine" | "alert_only";
    message?: string;            // 阻断说明
  };
}
```

### 3.4 行为图谱 (Behavior Graph)

```typescript
interface BehaviorGraph {
  sessionId: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
}

interface GraphNode {
  id: string;
  type: "prompt" | "plan_step" | "process" | "file" | "network" | "mcp_call" | "decision";
  label: string;
  timestamp: string;
  properties: Record<string, any>;
  risk?: "safe" | "suspicious" | "malicious";
}

interface GraphEdge {
  source: string;
  target: string;
  type: "prompted" | "spawned" | "accessed" | "called" | "connected_to" | "led_to";
  label?: string;
}
```

---

## 4. Agent 端模块设计

### 4.1 传感器体系

```
传感器体系
├── ProcessSensor (进程传感器)
│   ├── ETW Win32_ProcessStartTrace (实时)
│   ├── WMI Win32_Process (轮询补充)
│   └── Shell 命令拦截 (PowerShell profile / cmd autorun)
├── FileSensor (文件传感器)
│   ├── FileSystemWatcher (.NET 用户态)
│   ├── ETW Microsoft-Windows-Kernel-File (内核事件)
│   └── 敏感路径强化监控 (ssh/aws/key/credential)
├── NetworkSensor (网络传感器)
│   ├── ETW Microsoft-Windows-Kernel-Network
│   ├── DNS 查询拦截
│   └── 外连 IP/域名信誉检查
├── McpGateway (MCP 网关)
│   ├── 本地代理拦截所有 MCP tool/资源调用
│   ├── 参数检查 (路径/命令/域名)
│   └── 调用频率限制
├── RegistrySensor (注册表传感器)
│   ├── 自启动项监控
│   ├── 服务注册监控
│   └── WMI 事件订阅监控
└── IdentitySensor (身份传感器)
    ├── Token 使用检测
    ├── 凭据文件访问
    └── 敏感环境变量读取
```

### 4.2 分析引擎管线

```
事件 → 预处理 → 规则匹配 → LLM分类 → 基线对比 → 决策 → 执行

1. 预处理: 归一化事件格式、提取关键字段、去重
2. 规则匹配: 多层级规则 (关键词→正则→路径→序列→统计)
3. LLM 分类: 不确定事件送 LLM 研判 (本地小模型或远端大模型)
4. 基线对比: 与历史行为基线比较，检测偏差
5. 最终决策: 融合所有分析结果 → allow/alert/block/ask
```

### 4.3 执行器能力矩阵

```typescript
const enforcementCapabilities = {
  process: {
    terminate: "立即终止进程树",
    suspend: "挂起进程 (可恢复)",
    deny_create: "阻止子进程创建"
  },
  file: {
    deny_read: "拒绝读取",
    deny_write: "拒绝写入",
    deny_delete: "拒绝删除",
    quarantine: "隔离文件到安全区"
  },
  network: {
    block_ip: "IP 级阻断",
    block_domain: "域名级阻断",
    block_port: "端口级阻断",
    isolate_host: "主机网络隔离"
  },
  registry: {
    deny_write: "拒绝写入",
    rollback: "回滚修改"
  }
};
```

### 4.4 通信协议

```
Agent ←→ Server 通信:
  - 传输: mTLS WebSocket (实时事件) + HTTPS REST (配置/策略)
  - 认证: Agent 注册证书 + HMAC 签名
  - 心跳: 每 10s 发送心跳 (含系统状态快照)
  - 离线: 本地 SQLite 缓冲事件，恢复后批量上传
  - 策略: 服务端推送策略更新，Agent 本地缓存
```

---

## 5. 服务端模块设计

### 5.1 API 端点

```
Agent 管理:
  POST   /api/v1/agents/register        Agent 注册
  POST   /api/v1/agents/heartbeat       Agent 心跳
  GET    /api/v1/agents                  Agent 列表
  GET    /api/v1/agents/:id              Agent 详情
  POST   /api/v1/agents/:id/policy       下发策略给 Agent

事件管理:
  POST   /api/v1/events                  批量上传事件
  GET    /api/v1/events                  事件查询 (分页/过滤/搜索)
  GET    /api/v1/events/:id              事件详情
  GET    /api/v1/events/stats            事件统计

会话管理:
  POST   /api/v1/sessions/start          开始会话 (创建 TaskImage)
  PUT    /api/v1/sessions/:id            更新会话状态
  GET    /api/v1/sessions/:id            会话详情 (含行为图谱)

图谱:
  GET    /api/v1/graph/:sessionId        行为图谱数据

策略:
  POST   /api/v1/policies                创建策略
  GET    /api/v1/policies                策略列表
  PUT    /api/v1/policies/:id            更新策略
  DELETE /api/v1/policies/:id            删除策略
  POST   /api/v1/policies/suggest        基于历史数据建议策略

告警:
  GET    /api/v1/alerts                  告警列表
  PUT    /api/v1/alerts/:id/resolve      解决告警

意图分析:
  POST   /api/v1/intent/analyze          意图分析 (prompt → 风险评估)
  POST   /api/v1/intent/simulate         模拟 Agent 行为 (生成预期事件链)
```

### 5.2 Dashboard 页面结构

```
Dashboard 页面树:
├── 📊 总览仪表盘 (Agent状态/实时事件流/风险趋势/Top告警)
├── 🖥️ Agent 管理 (列表/详情/分组/策略下发)
├── 📋 事件中心 (搜索/过滤/详情/导出)
├── 🔍 行为图谱 (会话选择/力导向图/时序播放/MITRE映射)
├── 🧠 意图分析 (Prompt分析/行为链模拟/偏差展示)
├── ⚙️ 策略管理 (列表/编辑器/AI建议/生效范围)
├── 🔔 告警中心 (列表/详情/处置)
└── 📈 报告 (日报/周报/合规报告)
```

---

## 6. 技术栈

| 组件 | 技术选型 | 说明 |
|------|----------|------|
| **Agent 核心** | Node.js 22+ | 复用现有代码，跨平台 |
| **Agent 系统集成** | PowerShell + C# Native | Windows 深度集成 |
| **Server 后端** | Node.js (Express) | 统一技术栈 |
| **数据库** | SQLite (嵌入式) / PostgreSQL (生产) | 灵活切换 |
| **实时状态** | 内存 + JSON 文件 | 轻量化 |
| **前端** | Vanilla JS + Chart.js (现有升级) | 渐进增强 |
| **图谱可视化** | Cytoscape.js | 行为图谱渲染 |
| **LLM 集成** | OpenAI / DeepSeek / Ollama | 多后端支持 |
| **通信** | WebSocket + HTTPS | 实时双向 |

---

## 7. 实现路线

### Phase 1: 核心基础 ✅
- Agent 基本传感器 (进程/文件)
- 规则引擎 + LLM 意图分析
- Web Console (单机版)
- 策略配置

### Phase 2: Agent 增强 (本期)
- 网络传感器 (ETW 网络事件)
- MCP 网关代理
- 注册表传感器
- Shell 命令拦截增强
- 离线缓存 + Agent-Server 通信

### Phase 3: 服务平台 (本期)
- Server REST API + WebSocket
- SQLite/PostgreSQL 事件存储
- Dashboard v2 (行为图谱 + MITRE映射)
- 动态策略引擎
- 告警管理

### Phase 4: 智能增强 (后续)
- 行为基线自动学习
- 威胁情报集成
- 分布式部署
- 合规报告
