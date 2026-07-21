# AIDR 可安装 PoC 交付说明

当前可安装版本位于：

```text
C:\Users\OseasyVM\Documents\AIDR\aidr-guardian-service
```

核心交付物：

```text
aidr-guardian-service\dist\AIDR.Guardian.Setup.exe
aidr-guardian-service\dist\AIDR.Guardian.exe
aidr-guardian-service\dist\policy.json
aidr-guardian-service\install.ps1
aidr-guardian-service\uninstall.ps1
```

推荐直接交付安装包：

```powershell
cd C:\Users\OseasyVM\Documents\AIDR\aidr-guardian-service
.\dist\AIDR.Guardian.Setup.exe install
```

卸载安装包注册的服务：

```powershell
.\dist\AIDR.Guardian.Setup.exe uninstall
```

## 直接运行

```powershell
cd C:\Users\OseasyVM\Documents\AIDR\aidr-guardian-service
.\dist\AIDR.Guardian.exe
```

打开控制台：

```text
http://127.0.0.1:8787
```

## 安装为本机 Web 防护服务

```powershell
cd C:\Users\OseasyVM\Documents\AIDR\aidr-guardian-service
powershell -ExecutionPolicy Bypass -File .\install.ps1
```

安装脚本会把 exe 和策略复制到：

```text
%LOCALAPPDATA%\AIDRGuardian
```

并创建计划任务：

```text
AIDR Guardian Web Service
```

该任务会在用户登录后启动本地 Web 防护服务。

## 卸载

```powershell
cd C:\Users\OseasyVM\Documents\AIDR\aidr-guardian-service
powershell -ExecutionPolicy Bypass -File .\uninstall.ps1
```

## 重新构建 exe

```powershell
cd C:\Users\OseasyVM\Documents\AIDR\aidr-guardian-service
npm.cmd install
npm.cmd run build:all
```

构建使用 Node.js SEA，把 Node runtime、服务端 API、Web 控制台前端打包到 `AIDR.Guardian.exe`。

## PoC 能力

- Web 控制台：策略、状态、事件流、攻击模拟、动态策略分析。
- API：`/api/status`、`/api/analyze`、`/api/simulate`、`/api/reload`。
- 文件监控：监控 `policy.json` 中配置的工作区。
- 进程监控：轮询 Codex/OpenAI 相关进程，命中高危命令模式时阻断。
- 策略执行：支持 allow、alert、block 事件。

## 生产化差距

这个版本已经是 exe/Web 服务形态，但仍是用户态 PoC。生产级 Windows Agent 应继续补齐：

- Windows Service 而非计划任务。
- minifilter 文件强阻断。
- WFP 网络强阻断。
- ETW Threat Intelligence 和 AMSI。
- 代码签名与防篡改。
- MCP Gateway 真实代理接入。
- 策略签名、远程管理和 SIEM/SOAR 对接。
