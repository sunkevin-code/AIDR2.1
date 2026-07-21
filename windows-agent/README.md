# AIDR Guardian for Windows

这是一个可运行的 Windows 用户态 PoC，用来保护当前工作区内的 AI Agent 行为。它实现了三件事：

- 读取 `policy.json` 中的任务级最小权限策略。
- 监控当前工作区文件变更和 Agent 相关子进程。
- 对命中高危命令模式的 Agent 子进程进行告警和终止，对敏感路径触碰进行告警。

## 快速运行

在 PowerShell 中执行一次自检：

```powershell
powershell -ExecutionPolicy Bypass -File .\AidrGuardian.ps1 -Once
```

安装为当前用户登录后自启动的计划任务：

```powershell
powershell -ExecutionPolicy Bypass -File .\install.ps1
```

卸载：

```powershell
powershell -ExecutionPolicy Bypass -File .\uninstall.ps1
```

查看日志：

```powershell
Get-Content .\logs\aidr-events.jsonl -Tail 20
```

## 当前能力边界

这个 PoC 采用用户态机制，适合本机演示和最小可用防护：

- 文件层：`FileSystemWatcher` 发现工作区文件创建、修改、删除、重命名。
- 进程层：`Win32_ProcessStartTrace` 监听新进程，并对命中危险命令的 Agent 相关子进程执行 `Stop-Process`。
- 策略层：JSON 策略支持路径 allow/deny、命令 deny pattern、模式 `enforce`。

它不能做到内核级“先阻断再发生”的文件拦截。生产版 Windows 需要 minifilter、WFP、ETW Threat Intelligence、AMSI 和防篡改服务；Linux 生产版可使用 eBPF/LSM、Cilium/Tetragon 或 Falco 类执行点。
