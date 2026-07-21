# AIDR Guardian — AI Agent 安全监控服务

> **AIDR (AI Defense & Risk) Guardian** 是一个 Windows 本地安全监控代理，用于监控 AI Agent (如 Codex、OpenAI) 的行为，提供策略执行、文件监控、进程监控和动态风险分析。

---

## ✨ 功能特性

| 功能 | 说明 |
|------|------|
| 📊 **Dashboard** | 实时状态面板，事件趋势图 (柱状图/饼图) |
| 📋 **事件日志** | 完整事件列表，支持按类型/级别筛选 |
| 🔍 **策略分析** | 动态分析任务意图，生成安全策略 |
| ⚙️ **配置页面** | 浏览器中直接修改策略、路径、命令规则 |
| 🛡️ **进程监控** | 实时检测 AI Agent 相关进程 (aidr/codex/openai) |
| 📁 **文件监控** | 监控工作区文件变更，识别敏感路径访问 |
| 🚫 **命令拦截** | 阻止危险命令模式 (外传、删除、编码执行等) |
| 🎭 **攻击模拟** | 一键模拟密钥外传、MCP 越权、供应链攻击 |

## 🚀 快速开始

### 1. 构建

```powershell
cd aidr-guardian-service
npm install
npm run build:exe
```

### 2. 直接运行

```powershell
.\dist\AIDR.Guardian.exe
# 打开 http://127.0.0.1:8787
```

### 3. 安装为系统服务

```powershell
# 安装（创建计划任务，开机自启）
powershell -ExecutionPolicy Bypass -File .\install.ps1

# 卸载
powershell -ExecutionPolicy Bypass -File .\uninstall.ps1
```

### 4. 构建安装包 (Setup.exe)

```powershell
npm run build:setup
# 生成 dist\AIDR.Guardian.Setup.exe
```

## 🖥️ 控制台界面

访问 `http://127.0.0.1:8787` 打开 Web 控制台：

- **Dashboard** — 查看实时统计数据、事件趋势图表
- **事件日志** — 浏览所有安全事件，支持筛选
- **策略分析** — 输入任务描述，AI 自动分析风险并生成策略
- **配置** — 在线修改 Agent 名称、端口、策略模式、允许/禁止路径等

## 📁 文件结构

```
aidr-guardian-service/
├── aidr-service.js      # 后端服务 (Node.js)
├── build-exe.js         # SEA 单文件 exe 构建脚本
├── build-setup.js       # 安装包构建脚本
├── setup-installer.js   # 安装程序逻辑
├── policy.json          # 安全策略配置文件
├── install.ps1          # 安装脚本
├── uninstall.ps1        # 卸载脚本
├── public/
│   ├── index.html       # 前端页面 (Dashboard + 配置)
│   ├── app.js           # 前端交互逻辑 (含图表)
│   └── styles.css       # 前端样式
├── dist/                # 构建输出
└── logs/                # 事件日志
```

## ⚙️ 策略配置

`policy.json` 主要配置项：

```json
{
  "mode": "enforce",              // enforce | monitor | disabled
  "agentName": "AIDR Agent",      // 监控的 Agent 名称
  "port": 8787,                   // Web 控制台端口
  "sessionPolicy": {
    "allowedWritePaths": [...],    // 允许写入的路径 (通配符)
    "deniedPaths": [...],          // 禁止访问的敏感路径
    "deniedCommandPatterns": [...],// 禁止的命令模式
    "blockedProcessAction": "kill" // 拦截时操作 (kill | none)
  }
}
```

> 也可以在 Web 控制台的"配置"页面中直接修改并保存。

## 🔒 安全说明

当前版本为用户态 MVP，适合 PoC 和开发环境。生产环境应补充：

- **minifilter** 驱动级文件监控
- **ETW** 威胁情报
- **AMSI** 脚本扫描
- **驱动签名** 和服务加固

## 📄 许可

MIT License — 仅供安全研究和教育用途。
