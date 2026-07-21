# AIDR Endpoint 2.2.5

`AIDR.Endpoint.exe` 是 Windows AIDR Endpoint 的单文件安装入口。EXE 内嵌用户态 Agent、Node.js SEA 运行时和运行依赖，目标机器运行时不需要另行安装 Node.js，也不需要携带 `aidr-agent` 目录。

## 安装与卸载

```powershell
.\dist\AIDR.Endpoint.exe install
.\dist\AIDR.Endpoint.exe status
.\dist\AIDR.Endpoint.exe ui
.\dist\AIDR.Endpoint.exe uninstall
```

安装后：

- 程序目录：`%LOCALAPPDATA%\AIDREndpoint`
- 持久策略：`%LOCALAPPDATA%\AIDREndpoint\data\policy.json`
- 控制台：`http://127.0.0.1:8791`
- 健康检查：`http://127.0.0.1:8790/health`
- Agent API：`http://127.0.0.1:8787`
- MCP Gateway：`127.0.0.1:9797`
- Codex Proxy：`127.0.0.1:15721`
- Codex Hook：`%USERPROFILE%\.codex\hooks.json`

安装器创建当前用户的 `AIDR Endpoint` 登录计划任务。升级使用版本化二进制和令牌认证的优雅关闭，避免覆盖正在运行的 Windows EXE。卸载会移除计划任务和 AIDR Hook，但保留日志与策略数据，便于审计。

安装后建议新建一个 Codex 任务，使 Codex 重新加载完整 Hook 配置。

## 防护链路

Endpoint 为 Codex 注册以下生命周期 Hook：

- `SessionStart`
- `UserPromptSubmit`
- `PreToolUse`
- `PermissionRequest`
- `PostToolUse`
- `Stop`

`UserPromptSubmit` 为每个会话生成短期最小权限策略，包括工作区、文件读写、Shell、网络、MCP 工具和敏感路径约束。`PreToolUse` 与 `PermissionRequest` 在执行前返回 allow 或 deny；`PostToolUse` 检查提示词注入和疑似凭据输出。

本地 API 使用随机令牌认证，Web UI 的修改请求使用进程级 CSRF 令牌。上传后台的 Prompt 和敏感字段默认只发送摘要、长度和 SHA-256，不上传原文；该行为可由策略显式调整。

## 构建与验证

```powershell
node .\aidr-endpoint\build-endpoint.js
npm.cmd test --prefix .\aidr-agent
node .\aidr-endpoint\test\uiTemplate.test.js
.\aidr-endpoint\dist\AIDR.Endpoint.exe self-test
```

构建环境需要 Node.js 和 `postject`。生成的运行产物为：

```text
aidr-endpoint\dist\AIDR.Endpoint.exe
```

## 当前边界

- 常驻层当前是用户级计划任务和 watchdog，不是 SCM 原生 Windows Service。
- 尚未提供经过 Microsoft 签名的 Minifilter/WFP 内核驱动；UI 会明确显示 `not_installed`。
- 文件、进程和 Shell 的部分遥测仍来自用户态传感器与日志分析，不能替代内核级强制控制。
- EXE 当前未使用正式代码签名证书。生产发布需要 EV/组织代码签名、驱动签名、升级包签名和防篡改机制。
- 本地规则引擎是确定性 PoC 分析器。生产版应增加模型分类、策略签名、租户控制面、离线策略缓存和回滚机制。
