# AIDR 防御系统设计说明

## 目标

AIDR 面向 AI Agent 的零信任最小权限控制。每个会话和任务都会先生成可解释的行为计划，再由策略引擎把计划转换为短时效、任务级、资源级权限，最后由主机、网络和 MCP/工具网关执行点进行实时监控、阻断、放行与告警。

## 参考业界方案

- Cisco AI Defense：强调 AI 应用、模型、提示词、Agent 工作流、MCP/工具调用的发现、风险评估与运行时保护。
- Cisco Hypershield / Isovalent Tetragon：强调 eBPF 级遥测、进程/网络/文件行为观测，以及靠近工作负载的分布式执行点。
- Cisco Secure Workload：强调从真实通信遥测中学习策略、微分段和零信任最小通信面。

## 架构分层

1. 会话与任务理解层：采集用户请求、系统上下文、工作区、MCP 工具、插件、身份、敏感资源清单，生成任务画像和行为链。
2. 动态策略自学习层：把任务画像转换为 Allow/Deny/Ask 策略，并从真实行为中持续收敛基线。
3. 实时执行层：Linux 生产版通过 eBPF/LSM 执行文件、进程、网络和 capability 策略；Windows MVP 使用 ETW/WMI/FileSystemWatcher/防火墙/进程终止等用户态机制。
4. 运营层：展示策略、风险分、实时事件、阻断原因、攻击链回放和审批。

## Windows PoC 边界

本仓库的 `windows-agent` 是可运行的 Windows 用户态 MVP。它可以安装到当前用户环境，监控指定工作区，发现越权文件访问、敏感文件触碰、异常子进程、网络外联意图和工具调用偏离，并对部分高风险进程进行终止。它不是内核级 EDR，也不能替代生产版 minifilter/WFP/eBPF 驱动。

生产化需要补齐：

- Windows minifilter 文件阻断。
- Windows Filtering Platform 网络阻断。
- ETW Threat Intelligence provider 和 AMSI 集成。
- 受保护服务和防篡改。
- MCP Gateway 的真实代理接入。
- 策略签名、远程管理和 SIEM/SOAR 对接。
