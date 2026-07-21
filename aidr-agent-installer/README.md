# AIDR Agent 常驻化安装包

本目录用于构建两个轻量级 Windows EXE：

- `dist/AIDR.Agent.Service.exe`：watchdog 常驻器，负责启动并守护 `aidr-agent/src/agent.js`。
- `dist/AIDR.Agent.Setup.exe`：安装/卸载器，负责复制 Agent、创建登录自启动计划任务、启动服务。

## 构建

```powershell
cd C:\Users\OseasyVM\Documents\AIDR\aidr-agent-installer
node .\build-agent-exes.js
```

## 安装

```powershell
.\dist\AIDR.Agent.Setup.exe install
```

默认安装到：

```text
%LOCALAPPDATA%\AIDRAgentService
```

安装后健康检查：

```text
http://127.0.0.1:8790/health
http://127.0.0.1:8787/api/status
```

安装器会执行：

- 复制 `AIDR.Agent.Service.exe` 到安装目录。
- 复制当前仓库的 `aidr-agent` 到安装目录。
- 创建 `run-service.cmd`。
- 创建登录自启动计划任务 `AIDR Agent Service`。
- 写入 HKCU Run 自启动兜底项。
- 立即启动 watchdog。

## 卸载

```powershell
.\dist\AIDR.Agent.Setup.exe uninstall
```

## 当前边界

这是第一步常驻化优化：解决 Agent 异常退出后无人拉起的问题。它仍依赖本机已安装 Node.js 来运行 `aidr-agent` 源码。下一步可以继续把 Agent 依赖整体打包，或改成原生 Windows Service。

## 验证结果

当前环境已验证：

- `AIDR.Agent.Setup.exe install` 可以完成安装。
- `AIDR.Agent.Service.exe` 可以启动 watchdog。
- `http://127.0.0.1:8790/health` 返回健康状态。
- `http://127.0.0.1:8787/api/status` 返回 Agent 状态。
