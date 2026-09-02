// Auto-generated from aidr-agent/src/engine/behaviorAtoms.js buildCatalog({})
// 行为原子完整目录（与 agent 端一致，123 个）：DOMAINS + REFINED_ATOMS
"use strict";
module.exports = [
  {
    "id": "INTENT.RECEIVE",
    "domain": "INTENT",
    "domainLabel": "意图",
    "name": "RECEIVE",
    "baseLevel": 0,
    "highRisk": false,
    "description": "意图：RECEIVE"
  },
  {
    "id": "INTENT.INTERPRET",
    "domain": "INTENT",
    "domainLabel": "意图",
    "name": "INTERPRET",
    "baseLevel": 0,
    "highRisk": false,
    "description": "意图：INTERPRET"
  },
  {
    "id": "INTENT.GENERAL_TASK",
    "domain": "INTENT",
    "domainLabel": "意图",
    "name": "GENERAL_TASK",
    "baseLevel": 0,
    "highRisk": false,
    "description": "意图：GENERAL_TASK"
  },
  {
    "id": "INTENT.READ_TASK",
    "domain": "INTENT",
    "domainLabel": "意图",
    "name": "READ_TASK",
    "baseLevel": 1,
    "highRisk": false,
    "description": "意图：READ_TASK"
  },
  {
    "id": "INTENT.WRITE_TASK",
    "domain": "INTENT",
    "domainLabel": "意图",
    "name": "WRITE_TASK",
    "baseLevel": 2,
    "highRisk": false,
    "description": "意图：WRITE_TASK"
  },
  {
    "id": "INTENT.EXECUTE_TASK",
    "domain": "INTENT",
    "domainLabel": "意图",
    "name": "EXECUTE_TASK",
    "baseLevel": 3,
    "highRisk": false,
    "description": "意图：EXECUTE_TASK"
  },
  {
    "id": "INTENT.NETWORK_TASK",
    "domain": "INTENT",
    "domainLabel": "意图",
    "name": "NETWORK_TASK",
    "baseLevel": 3,
    "highRisk": false,
    "description": "意图：NETWORK_TASK"
  },
  {
    "id": "INTENT.PUBLISH_TASK",
    "domain": "INTENT",
    "domainLabel": "意图",
    "name": "PUBLISH_TASK",
    "baseLevel": 4,
    "highRisk": false,
    "description": "意图：PUBLISH_TASK"
  },
  {
    "id": "INTENT.CREDENTIAL_TASK",
    "domain": "INTENT",
    "domainLabel": "意图",
    "name": "CREDENTIAL_TASK",
    "baseLevel": 4,
    "highRisk": false,
    "description": "意图：CREDENTIAL_TASK"
  },
  {
    "id": "INTENT.ADMIN_TASK",
    "domain": "INTENT",
    "domainLabel": "意图",
    "name": "ADMIN_TASK",
    "baseLevel": 5,
    "highRisk": false,
    "description": "意图：ADMIN_TASK"
  },
  {
    "id": "INTENT.INFER",
    "domain": "INTENT",
    "domainLabel": "意图",
    "name": "INFER",
    "baseLevel": 1,
    "highRisk": false,
    "description": "意图：INFER"
  },
  {
    "id": "INTENT.CLARIFY",
    "domain": "INTENT",
    "domainLabel": "意图",
    "name": "CLARIFY",
    "baseLevel": 0,
    "highRisk": false,
    "description": "意图：CLARIFY"
  },
  {
    "id": "INTENT.CONFIRM",
    "domain": "INTENT",
    "domainLabel": "意图",
    "name": "CONFIRM",
    "baseLevel": 0,
    "highRisk": false,
    "description": "意图：CONFIRM"
  },
  {
    "id": "INTENT.MODIFY",
    "domain": "INTENT",
    "domainLabel": "意图",
    "name": "MODIFY",
    "baseLevel": 2,
    "highRisk": true,
    "description": "意图：MODIFY"
  },
  {
    "id": "INTENT.DELEGATE",
    "domain": "INTENT",
    "domainLabel": "意图",
    "name": "DELEGATE",
    "baseLevel": 3,
    "highRisk": true,
    "description": "意图：DELEGATE"
  },
  {
    "id": "INTENT.TERMINATE",
    "domain": "INTENT",
    "domainLabel": "意图",
    "name": "TERMINATE",
    "baseLevel": 0,
    "highRisk": false,
    "description": "意图：TERMINATE"
  },
  {
    "id": "PLAN.CREATE",
    "domain": "PLAN",
    "domainLabel": "计划",
    "name": "CREATE",
    "baseLevel": 0,
    "highRisk": false,
    "description": "计划：CREATE"
  },
  {
    "id": "PLAN.DECOMPOSE",
    "domain": "PLAN",
    "domainLabel": "计划",
    "name": "DECOMPOSE",
    "baseLevel": 0,
    "highRisk": false,
    "description": "计划：DECOMPOSE"
  },
  {
    "id": "PLAN.SELECT",
    "domain": "PLAN",
    "domainLabel": "计划",
    "name": "SELECT",
    "baseLevel": 0,
    "highRisk": false,
    "description": "计划：SELECT"
  },
  {
    "id": "PLAN.MODIFY",
    "domain": "PLAN",
    "domainLabel": "计划",
    "name": "MODIFY",
    "baseLevel": 1,
    "highRisk": false,
    "description": "计划：MODIFY"
  },
  {
    "id": "PLAN.RETRY",
    "domain": "PLAN",
    "domainLabel": "计划",
    "name": "RETRY",
    "baseLevel": 1,
    "highRisk": false,
    "description": "计划：RETRY"
  },
  {
    "id": "PLAN.FALLBACK",
    "domain": "PLAN",
    "domainLabel": "计划",
    "name": "FALLBACK",
    "baseLevel": 2,
    "highRisk": true,
    "description": "计划：FALLBACK"
  },
  {
    "id": "PLAN.VALIDATE",
    "domain": "PLAN",
    "domainLabel": "计划",
    "name": "VALIDATE",
    "baseLevel": 0,
    "highRisk": false,
    "description": "计划：VALIDATE"
  },
  {
    "id": "PLAN.COMPLETE",
    "domain": "PLAN",
    "domainLabel": "计划",
    "name": "COMPLETE",
    "baseLevel": 0,
    "highRisk": false,
    "description": "计划：COMPLETE"
  },
  {
    "id": "AGENT.CREATE",
    "domain": "AGENT",
    "domainLabel": "Agent",
    "name": "CREATE",
    "baseLevel": 3,
    "highRisk": false,
    "description": "Agent：CREATE"
  },
  {
    "id": "AGENT.CONFIGURE",
    "domain": "AGENT",
    "domainLabel": "Agent",
    "name": "CONFIGURE",
    "baseLevel": 4,
    "highRisk": true,
    "description": "Agent：CONFIGURE"
  },
  {
    "id": "AGENT.START",
    "domain": "AGENT",
    "domainLabel": "Agent",
    "name": "START",
    "baseLevel": 3,
    "highRisk": false,
    "description": "Agent：START"
  },
  {
    "id": "AGENT.STOP",
    "domain": "AGENT",
    "domainLabel": "Agent",
    "name": "STOP",
    "baseLevel": 3,
    "highRisk": false,
    "description": "Agent：STOP"
  },
  {
    "id": "AGENT.DELEGATE",
    "domain": "AGENT",
    "domainLabel": "Agent",
    "name": "DELEGATE",
    "baseLevel": 3,
    "highRisk": false,
    "description": "Agent：DELEGATE"
  },
  {
    "id": "AGENT.COMMUNICATE",
    "domain": "AGENT",
    "domainLabel": "Agent",
    "name": "COMMUNICATE",
    "baseLevel": 2,
    "highRisk": false,
    "description": "Agent：COMMUNICATE"
  },
  {
    "id": "AGENT.SHARE_CONTEXT",
    "domain": "AGENT",
    "domainLabel": "Agent",
    "name": "SHARE_CONTEXT",
    "baseLevel": 3,
    "highRisk": true,
    "description": "Agent：SHARE_CONTEXT"
  },
  {
    "id": "AGENT.AGGREGATE",
    "domain": "AGENT",
    "domainLabel": "Agent",
    "name": "AGGREGATE",
    "baseLevel": 1,
    "highRisk": false,
    "description": "Agent：AGGREGATE"
  },
  {
    "id": "MODEL.INVOKE",
    "domain": "MODEL",
    "domainLabel": "模型",
    "name": "INVOKE",
    "baseLevel": 3,
    "highRisk": false,
    "description": "模型：INVOKE"
  },
  {
    "id": "MODEL.SWITCH",
    "domain": "MODEL",
    "domainLabel": "模型",
    "name": "SWITCH",
    "baseLevel": 3,
    "highRisk": true,
    "description": "模型：SWITCH"
  },
  {
    "id": "MODEL.SEND_CONTEXT",
    "domain": "MODEL",
    "domainLabel": "模型",
    "name": "SEND_CONTEXT",
    "baseLevel": 3,
    "highRisk": true,
    "description": "向模型发送 Prompt、文件或工具结果"
  },
  {
    "id": "MODEL.RECEIVE_OUTPUT",
    "domain": "MODEL",
    "domainLabel": "模型",
    "name": "RECEIVE_OUTPUT",
    "baseLevel": 0,
    "highRisk": false,
    "description": "模型：RECEIVE_OUTPUT"
  },
  {
    "id": "MODEL.VALIDATE_OUTPUT",
    "domain": "MODEL",
    "domainLabel": "模型",
    "name": "VALIDATE_OUTPUT",
    "baseLevel": 0,
    "highRisk": false,
    "description": "模型：VALIDATE_OUTPUT"
  },
  {
    "id": "MODEL.CACHE",
    "domain": "MODEL",
    "domainLabel": "模型",
    "name": "CACHE",
    "baseLevel": 2,
    "highRisk": false,
    "description": "模型：CACHE"
  },
  {
    "id": "TOOL.DISCOVER",
    "domain": "TOOL",
    "domainLabel": "工具 / MCP",
    "name": "DISCOVER",
    "baseLevel": 1,
    "highRisk": false,
    "description": "工具 / MCP：DISCOVER"
  },
  {
    "id": "TOOL.CONNECT",
    "domain": "TOOL",
    "domainLabel": "工具 / MCP",
    "name": "CONNECT",
    "baseLevel": 3,
    "highRisk": false,
    "description": "工具 / MCP：CONNECT"
  },
  {
    "id": "TOOL.MCP_CONNECT",
    "domain": "TOOL",
    "domainLabel": "工具 / MCP",
    "name": "MCP_CONNECT",
    "baseLevel": 3,
    "highRisk": true,
    "description": "工具 / MCP：MCP_CONNECT"
  },
  {
    "id": "TOOL.API_REQUEST",
    "domain": "TOOL",
    "domainLabel": "工具 / MCP",
    "name": "API_REQUEST",
    "baseLevel": 3,
    "highRisk": true,
    "description": "工具 / MCP：API_REQUEST"
  },
  {
    "id": "TOOL.WEB_FETCH",
    "domain": "TOOL",
    "domainLabel": "工具 / MCP",
    "name": "WEB_FETCH",
    "baseLevel": 3,
    "highRisk": true,
    "description": "工具 / MCP：WEB_FETCH"
  },
  {
    "id": "TOOL.REGISTER",
    "domain": "TOOL",
    "domainLabel": "工具 / MCP",
    "name": "REGISTER",
    "baseLevel": 4,
    "highRisk": true,
    "description": "工具 / MCP：REGISTER"
  },
  {
    "id": "TOOL.CONFIGURE",
    "domain": "TOOL",
    "domainLabel": "工具 / MCP",
    "name": "CONFIGURE",
    "baseLevel": 4,
    "highRisk": true,
    "description": "工具 / MCP：CONFIGURE"
  },
  {
    "id": "TOOL.INVOKE",
    "domain": "TOOL",
    "domainLabel": "工具 / MCP",
    "name": "INVOKE",
    "baseLevel": 3,
    "highRisk": false,
    "description": "工具 / MCP：INVOKE"
  },
  {
    "id": "TOOL.RECEIVE_RESULT",
    "domain": "TOOL",
    "domainLabel": "工具 / MCP",
    "name": "RECEIVE_RESULT",
    "baseLevel": 1,
    "highRisk": false,
    "description": "工具 / MCP：RECEIVE_RESULT"
  },
  {
    "id": "TOOL.CHAIN",
    "domain": "TOOL",
    "domainLabel": "工具 / MCP",
    "name": "CHAIN",
    "baseLevel": 3,
    "highRisk": true,
    "description": "工具 / MCP：CHAIN"
  },
  {
    "id": "TOOL.DISCONNECT",
    "domain": "TOOL",
    "domainLabel": "工具 / MCP",
    "name": "DISCONNECT",
    "baseLevel": 3,
    "highRisk": false,
    "description": "工具 / MCP：DISCONNECT"
  },
  {
    "id": "TOOL.HTTP_API_CONNECT",
    "domain": "TOOL",
    "domainLabel": "工具 / MCP",
    "name": "HTTP_API_CONNECT",
    "baseLevel": 3,
    "highRisk": true,
    "description": "工具 / MCP：HTTP_API_CONNECT"
  },
  {
    "id": "TOOL.DATABASE_CONNECT",
    "domain": "TOOL",
    "domainLabel": "工具 / MCP",
    "name": "DATABASE_CONNECT",
    "baseLevel": 3,
    "highRisk": true,
    "description": "工具 / MCP：DATABASE_CONNECT"
  },
  {
    "id": "TOOL.BROWSER_CONNECT",
    "domain": "TOOL",
    "domainLabel": "工具 / MCP",
    "name": "BROWSER_CONNECT",
    "baseLevel": 3,
    "highRisk": true,
    "description": "工具 / MCP：BROWSER_CONNECT"
  },
  {
    "id": "TOOL.CLOUD_SERVICE_CONNECT",
    "domain": "TOOL",
    "domainLabel": "工具 / MCP",
    "name": "CLOUD_SERVICE_CONNECT",
    "baseLevel": 4,
    "highRisk": true,
    "description": "工具 / MCP：CLOUD_SERVICE_CONNECT"
  },
  {
    "id": "AUTH.IDENTITY_AUTHENTICATE",
    "domain": "AUTH",
    "domainLabel": "身份 / 凭据",
    "name": "IDENTITY_AUTHENTICATE",
    "baseLevel": 1,
    "highRisk": false,
    "description": "身份 / 凭据：IDENTITY_AUTHENTICATE"
  },
  {
    "id": "AUTH.IDENTITY_IMPERSONATE",
    "domain": "AUTH",
    "domainLabel": "身份 / 凭据",
    "name": "IDENTITY_IMPERSONATE",
    "baseLevel": 4,
    "highRisk": true,
    "description": "身份 / 凭据：IDENTITY_IMPERSONATE"
  },
  {
    "id": "AUTH.CREDENTIAL_DISCOVER",
    "domain": "AUTH",
    "domainLabel": "身份 / 凭据",
    "name": "CREDENTIAL_DISCOVER",
    "baseLevel": 2,
    "highRisk": true,
    "description": "身份 / 凭据：CREDENTIAL_DISCOVER"
  },
  {
    "id": "AUTH.CREDENTIAL_ACQUIRE",
    "domain": "AUTH",
    "domainLabel": "身份 / 凭据",
    "name": "CREDENTIAL_ACQUIRE",
    "baseLevel": 4,
    "highRisk": true,
    "description": "身份 / 凭据：CREDENTIAL_ACQUIRE"
  },
  {
    "id": "AUTH.CREDENTIAL_USE",
    "domain": "AUTH",
    "domainLabel": "身份 / 凭据",
    "name": "CREDENTIAL_USE",
    "baseLevel": 3,
    "highRisk": false,
    "description": "身份 / 凭据：CREDENTIAL_USE"
  },
  {
    "id": "AUTH.CREDENTIAL_TRANSFER",
    "domain": "AUTH",
    "domainLabel": "身份 / 凭据",
    "name": "CREDENTIAL_TRANSFER",
    "baseLevel": 5,
    "highRisk": true,
    "description": "身份 / 凭据：CREDENTIAL_TRANSFER"
  },
  {
    "id": "AUTH.CREDENTIAL_REVOKE",
    "domain": "AUTH",
    "domainLabel": "身份 / 凭据",
    "name": "CREDENTIAL_REVOKE",
    "baseLevel": 4,
    "highRisk": true,
    "description": "身份 / 凭据：CREDENTIAL_REVOKE"
  },
  {
    "id": "AUTH.PERMISSION_CHECK",
    "domain": "AUTH",
    "domainLabel": "身份 / 凭据",
    "name": "PERMISSION_CHECK",
    "baseLevel": 1,
    "highRisk": false,
    "description": "身份 / 凭据：PERMISSION_CHECK"
  },
  {
    "id": "AUTH.PERMISSION_REQUEST",
    "domain": "AUTH",
    "domainLabel": "身份 / 凭据",
    "name": "PERMISSION_REQUEST",
    "baseLevel": 4,
    "highRisk": true,
    "description": "身份 / 凭据：PERMISSION_REQUEST"
  },
  {
    "id": "AUTH.PERMISSION_MODIFY",
    "domain": "AUTH",
    "domainLabel": "身份 / 凭据",
    "name": "PERMISSION_MODIFY",
    "baseLevel": 5,
    "highRisk": true,
    "description": "身份 / 凭据：PERMISSION_MODIFY"
  },
  {
    "id": "DATA.RESOURCE_DISCOVER",
    "domain": "DATA",
    "domainLabel": "数据",
    "name": "RESOURCE_DISCOVER",
    "baseLevel": 1,
    "highRisk": false,
    "description": "数据：RESOURCE_DISCOVER"
  },
  {
    "id": "DATA.RESOURCE_CREATE",
    "domain": "DATA",
    "domainLabel": "数据",
    "name": "RESOURCE_CREATE",
    "baseLevel": 2,
    "highRisk": false,
    "description": "数据：RESOURCE_CREATE"
  },
  {
    "id": "DATA.DATA_READ",
    "domain": "DATA",
    "domainLabel": "数据",
    "name": "DATA_READ",
    "baseLevel": 1,
    "highRisk": false,
    "description": "数据：DATA_READ"
  },
  {
    "id": "DATA.FILE_READ",
    "domain": "DATA",
    "domainLabel": "数据",
    "name": "FILE_READ",
    "baseLevel": 1,
    "highRisk": false,
    "description": "数据：FILE_READ"
  },
  {
    "id": "DATA.CONFIG_READ",
    "domain": "DATA",
    "domainLabel": "数据",
    "name": "CONFIG_READ",
    "baseLevel": 2,
    "highRisk": false,
    "description": "数据：CONFIG_READ"
  },
  {
    "id": "DATA.ENVIRONMENT_READ",
    "domain": "DATA",
    "domainLabel": "数据",
    "name": "ENVIRONMENT_READ",
    "baseLevel": 3,
    "highRisk": false,
    "description": "数据：ENVIRONMENT_READ"
  },
  {
    "id": "DATA.AGENT_CONFIG_READ",
    "domain": "DATA",
    "domainLabel": "数据",
    "name": "AGENT_CONFIG_READ",
    "baseLevel": 2,
    "highRisk": false,
    "description": "数据：AGENT_CONFIG_READ"
  },
  {
    "id": "DATA.SYSTEM_CONFIG_READ",
    "domain": "DATA",
    "domainLabel": "数据",
    "name": "SYSTEM_CONFIG_READ",
    "baseLevel": 3,
    "highRisk": false,
    "description": "数据：SYSTEM_CONFIG_READ"
  },
  {
    "id": "DATA.APP_CONFIG_READ",
    "domain": "DATA",
    "domainLabel": "数据",
    "name": "APP_CONFIG_READ",
    "baseLevel": 2,
    "highRisk": false,
    "description": "数据：APP_CONFIG_READ"
  },
  {
    "id": "DATA.SOURCE_CODE_READ",
    "domain": "DATA",
    "domainLabel": "数据",
    "name": "SOURCE_CODE_READ",
    "baseLevel": 1,
    "highRisk": false,
    "description": "数据：SOURCE_CODE_READ"
  },
  {
    "id": "DATA.DOCUMENT_READ",
    "domain": "DATA",
    "domainLabel": "数据",
    "name": "DOCUMENT_READ",
    "baseLevel": 1,
    "highRisk": false,
    "description": "数据：DOCUMENT_READ"
  },
  {
    "id": "DATA.DATABASE_READ",
    "domain": "DATA",
    "domainLabel": "数据",
    "name": "DATABASE_READ",
    "baseLevel": 2,
    "highRisk": false,
    "description": "数据：DATABASE_READ"
  },
  {
    "id": "DATA.CREDENTIAL_READ",
    "domain": "DATA",
    "domainLabel": "数据",
    "name": "CREDENTIAL_READ",
    "baseLevel": 3,
    "highRisk": true,
    "description": "数据：CREDENTIAL_READ"
  },
  {
    "id": "DATA.DATA_WRITE",
    "domain": "DATA",
    "domainLabel": "数据",
    "name": "DATA_WRITE",
    "baseLevel": 2,
    "highRisk": false,
    "description": "数据：DATA_WRITE"
  },
  {
    "id": "DATA.DATA_MODIFY",
    "domain": "DATA",
    "domainLabel": "数据",
    "name": "DATA_MODIFY",
    "baseLevel": 2,
    "highRisk": false,
    "description": "数据：DATA_MODIFY"
  },
  {
    "id": "DATA.DATA_TRANSFORM",
    "domain": "DATA",
    "domainLabel": "数据",
    "name": "DATA_TRANSFORM",
    "baseLevel": 2,
    "highRisk": false,
    "description": "数据：DATA_TRANSFORM"
  },
  {
    "id": "DATA.DATA_TRANSFER",
    "domain": "DATA",
    "domainLabel": "数据",
    "name": "DATA_TRANSFER",
    "baseLevel": 3,
    "highRisk": true,
    "description": "数据：DATA_TRANSFER"
  },
  {
    "id": "DATA.DATA_PUBLISH",
    "domain": "DATA",
    "domainLabel": "数据",
    "name": "DATA_PUBLISH",
    "baseLevel": 5,
    "highRisk": true,
    "description": "数据：DATA_PUBLISH"
  },
  {
    "id": "DATA.RESOURCE_DELETE",
    "domain": "DATA",
    "domainLabel": "数据",
    "name": "RESOURCE_DELETE",
    "baseLevel": 5,
    "highRisk": true,
    "description": "数据：RESOURCE_DELETE"
  },
  {
    "id": "DATA.RESOURCE_PERMISSION_CHANGE",
    "domain": "DATA",
    "domainLabel": "数据",
    "name": "RESOURCE_PERMISSION_CHANGE",
    "baseLevel": 5,
    "highRisk": true,
    "description": "数据：RESOURCE_PERMISSION_CHANGE"
  },
  {
    "id": "DATA.CLIPBOARD_READ",
    "domain": "DATA",
    "domainLabel": "数据",
    "name": "CLIPBOARD_READ",
    "baseLevel": 3,
    "highRisk": true,
    "description": "数据：CLIPBOARD_READ"
  },
  {
    "id": "MEMORY.MEMORY_READ",
    "domain": "MEMORY",
    "domainLabel": "记忆",
    "name": "MEMORY_READ",
    "baseLevel": 1,
    "highRisk": false,
    "description": "记忆：MEMORY_READ"
  },
  {
    "id": "MEMORY.MEMORY_WRITE",
    "domain": "MEMORY",
    "domainLabel": "记忆",
    "name": "MEMORY_WRITE",
    "baseLevel": 2,
    "highRisk": false,
    "description": "记忆：MEMORY_WRITE"
  },
  {
    "id": "MEMORY.MEMORY_MODIFY",
    "domain": "MEMORY",
    "domainLabel": "记忆",
    "name": "MEMORY_MODIFY",
    "baseLevel": 2,
    "highRisk": false,
    "description": "记忆：MEMORY_MODIFY"
  },
  {
    "id": "MEMORY.MEMORY_SHARE",
    "domain": "MEMORY",
    "domainLabel": "记忆",
    "name": "MEMORY_SHARE",
    "baseLevel": 3,
    "highRisk": true,
    "description": "记忆：MEMORY_SHARE"
  },
  {
    "id": "MEMORY.MEMORY_DELETE",
    "domain": "MEMORY",
    "domainLabel": "记忆",
    "name": "MEMORY_DELETE",
    "baseLevel": 4,
    "highRisk": true,
    "description": "记忆：MEMORY_DELETE"
  },
  {
    "id": "MEMORY.MEMORY_RESTORE",
    "domain": "MEMORY",
    "domainLabel": "记忆",
    "name": "MEMORY_RESTORE",
    "baseLevel": 2,
    "highRisk": false,
    "description": "记忆：MEMORY_RESTORE"
  },
  {
    "id": "EXEC.CODE_GENERATE",
    "domain": "EXEC",
    "domainLabel": "执行 / 系统",
    "name": "CODE_GENERATE",
    "baseLevel": 2,
    "highRisk": false,
    "description": "执行 / 系统：CODE_GENERATE"
  },
  {
    "id": "EXEC.CODE_EXECUTE",
    "domain": "EXEC",
    "domainLabel": "执行 / 系统",
    "name": "CODE_EXECUTE",
    "baseLevel": 3,
    "highRisk": false,
    "description": "执行 / 系统：CODE_EXECUTE"
  },
  {
    "id": "EXEC.PROGRAM_EXECUTE",
    "domain": "EXEC",
    "domainLabel": "执行 / 系统",
    "name": "PROGRAM_EXECUTE",
    "baseLevel": 3,
    "highRisk": false,
    "description": "执行 / 系统：PROGRAM_EXECUTE"
  },
  {
    "id": "EXEC.SHELL_COMMAND",
    "domain": "EXEC",
    "domainLabel": "执行 / 系统",
    "name": "SHELL_COMMAND",
    "baseLevel": 3,
    "highRisk": false,
    "description": "执行 / 系统：SHELL_COMMAND"
  },
  {
    "id": "EXEC.TEST_EXECUTE",
    "domain": "EXEC",
    "domainLabel": "执行 / 系统",
    "name": "TEST_EXECUTE",
    "baseLevel": 2,
    "highRisk": false,
    "description": "执行 / 系统：TEST_EXECUTE"
  },
  {
    "id": "EXEC.BUILD_EXECUTE",
    "domain": "EXEC",
    "domainLabel": "执行 / 系统",
    "name": "BUILD_EXECUTE",
    "baseLevel": 2,
    "highRisk": false,
    "description": "执行 / 系统：BUILD_EXECUTE"
  },
  {
    "id": "EXEC.PACKAGE_OPERATION",
    "domain": "EXEC",
    "domainLabel": "执行 / 系统",
    "name": "PACKAGE_OPERATION",
    "baseLevel": 3,
    "highRisk": false,
    "description": "执行 / 系统：PACKAGE_OPERATION"
  },
  {
    "id": "EXEC.DOWNLOAD_EXECUTE",
    "domain": "EXEC",
    "domainLabel": "执行 / 系统",
    "name": "DOWNLOAD_EXECUTE",
    "baseLevel": 4,
    "highRisk": false,
    "description": "执行 / 系统：DOWNLOAD_EXECUTE"
  },
  {
    "id": "EXEC.PROCESS_CREATE",
    "domain": "EXEC",
    "domainLabel": "执行 / 系统",
    "name": "PROCESS_CREATE",
    "baseLevel": 3,
    "highRisk": false,
    "description": "执行 / 系统：PROCESS_CREATE"
  },
  {
    "id": "EXEC.PROGRAM_PROCESS_CREATE",
    "domain": "EXEC",
    "domainLabel": "执行 / 系统",
    "name": "PROGRAM_PROCESS_CREATE",
    "baseLevel": 3,
    "highRisk": false,
    "description": "执行 / 系统：PROGRAM_PROCESS_CREATE"
  },
  {
    "id": "EXEC.SHELL_PROCESS_CREATE",
    "domain": "EXEC",
    "domainLabel": "执行 / 系统",
    "name": "SHELL_PROCESS_CREATE",
    "baseLevel": 3,
    "highRisk": false,
    "description": "执行 / 系统：SHELL_PROCESS_CREATE"
  },
  {
    "id": "EXEC.BROWSER_PROCESS_CREATE",
    "domain": "EXEC",
    "domainLabel": "执行 / 系统",
    "name": "BROWSER_PROCESS_CREATE",
    "baseLevel": 3,
    "highRisk": false,
    "description": "执行 / 系统：BROWSER_PROCESS_CREATE"
  },
  {
    "id": "EXEC.TOOL_PROCESS_CREATE",
    "domain": "EXEC",
    "domainLabel": "执行 / 系统",
    "name": "TOOL_PROCESS_CREATE",
    "baseLevel": 3,
    "highRisk": false,
    "description": "执行 / 系统：TOOL_PROCESS_CREATE"
  },
  {
    "id": "EXEC.PROCESS_CONTROL",
    "domain": "EXEC",
    "domainLabel": "执行 / 系统",
    "name": "PROCESS_CONTROL",
    "baseLevel": 4,
    "highRisk": true,
    "description": "执行 / 系统：PROCESS_CONTROL"
  },
  {
    "id": "EXEC.SERVICE_START",
    "domain": "EXEC",
    "domainLabel": "执行 / 系统",
    "name": "SERVICE_START",
    "baseLevel": 2,
    "highRisk": false,
    "description": "执行 / 系统：SERVICE_START"
  },
  {
    "id": "EXEC.SYSTEM_EVENT",
    "domain": "EXEC",
    "domainLabel": "执行 / 系统",
    "name": "SYSTEM_EVENT",
    "baseLevel": 1,
    "highRisk": false,
    "description": "执行 / 系统：SYSTEM_EVENT"
  },
  {
    "id": "EXEC.SYSTEM_CONFIGURE",
    "domain": "EXEC",
    "domainLabel": "执行 / 系统",
    "name": "SYSTEM_CONFIGURE",
    "baseLevel": 4,
    "highRisk": true,
    "description": "执行 / 系统：SYSTEM_CONFIGURE"
  },
  {
    "id": "EXEC.SYSTEM_PRIVILEGE_CHANGE",
    "domain": "EXEC",
    "domainLabel": "执行 / 系统",
    "name": "SYSTEM_PRIVILEGE_CHANGE",
    "baseLevel": 5,
    "highRisk": true,
    "description": "执行 / 系统：SYSTEM_PRIVILEGE_CHANGE"
  },
  {
    "id": "EXEC.SYSTEM_RESOURCE_CONSUME",
    "domain": "EXEC",
    "domainLabel": "执行 / 系统",
    "name": "SYSTEM_RESOURCE_CONSUME",
    "baseLevel": 2,
    "highRisk": false,
    "description": "执行 / 系统：SYSTEM_RESOURCE_CONSUME"
  },
  {
    "id": "EXEC.SYSTEM_CALL",
    "domain": "EXEC",
    "domainLabel": "执行 / 系统",
    "name": "SYSTEM_CALL",
    "baseLevel": 3,
    "highRisk": false,
    "description": "执行 / 系统：SYSTEM_CALL"
  },
  {
    "id": "EXEC.NETWORK_CONNECT",
    "domain": "EXEC",
    "domainLabel": "执行 / 系统",
    "name": "NETWORK_CONNECT",
    "baseLevel": 3,
    "highRisk": false,
    "description": "执行 / 系统：NETWORK_CONNECT"
  },
  {
    "id": "EXEC.TLS_CONNECT",
    "domain": "EXEC",
    "domainLabel": "执行 / 系统",
    "name": "TLS_CONNECT",
    "baseLevel": 3,
    "highRisk": false,
    "description": "执行 / 系统：TLS_CONNECT"
  },
  {
    "id": "EXEC.HTTP_CONNECT",
    "domain": "EXEC",
    "domainLabel": "执行 / 系统",
    "name": "HTTP_CONNECT",
    "baseLevel": 2,
    "highRisk": false,
    "description": "执行 / 系统：HTTP_CONNECT"
  },
  {
    "id": "EXEC.REMOTE_ACCESS_CONNECT",
    "domain": "EXEC",
    "domainLabel": "执行 / 系统",
    "name": "REMOTE_ACCESS_CONNECT",
    "baseLevel": 4,
    "highRisk": false,
    "description": "执行 / 系统：REMOTE_ACCESS_CONNECT"
  },
  {
    "id": "EXEC.DATABASE_CONNECT",
    "domain": "EXEC",
    "domainLabel": "执行 / 系统",
    "name": "DATABASE_CONNECT",
    "baseLevel": 3,
    "highRisk": false,
    "description": "执行 / 系统：DATABASE_CONNECT"
  },
  {
    "id": "EXEC.MESSAGE_SERVICE_CONNECT",
    "domain": "EXEC",
    "domainLabel": "执行 / 系统",
    "name": "MESSAGE_SERVICE_CONNECT",
    "baseLevel": 3,
    "highRisk": false,
    "description": "执行 / 系统：MESSAGE_SERVICE_CONNECT"
  },
  {
    "id": "EXEC.NETWORK_LISTEN",
    "domain": "EXEC",
    "domainLabel": "执行 / 系统",
    "name": "NETWORK_LISTEN",
    "baseLevel": 4,
    "highRisk": false,
    "description": "执行 / 系统：NETWORK_LISTEN"
  },
  {
    "id": "EXEC.NETWORK_SEND",
    "domain": "EXEC",
    "domainLabel": "执行 / 系统",
    "name": "NETWORK_SEND",
    "baseLevel": 3,
    "highRisk": false,
    "description": "执行 / 系统：NETWORK_SEND"
  },
  {
    "id": "EXEC.NETWORK_RECEIVE",
    "domain": "EXEC",
    "domainLabel": "执行 / 系统",
    "name": "NETWORK_RECEIVE",
    "baseLevel": 1,
    "highRisk": false,
    "description": "执行 / 系统：NETWORK_RECEIVE"
  },
  {
    "id": "EXEC.DNS_QUERY",
    "domain": "EXEC",
    "domainLabel": "执行 / 系统",
    "name": "DNS_QUERY",
    "baseLevel": 1,
    "highRisk": false,
    "description": "执行 / 系统：DNS_QUERY"
  },
  {
    "id": "EXEC.SCRIPT_EXECUTE",
    "domain": "EXEC",
    "domainLabel": "执行 / 系统",
    "name": "SCRIPT_EXECUTE",
    "baseLevel": 3,
    "highRisk": false,
    "description": "执行 / 系统：SCRIPT_EXECUTE"
  },
  {
    "id": "EXEC.REGISTRY_MODIFY",
    "domain": "EXEC",
    "domainLabel": "执行 / 系统",
    "name": "REGISTRY_MODIFY",
    "baseLevel": 4,
    "highRisk": true,
    "description": "执行 / 系统：REGISTRY_MODIFY"
  },
  {
    "id": "EXEC.SERVICE_CONTROL",
    "domain": "EXEC",
    "domainLabel": "执行 / 系统",
    "name": "SERVICE_CONTROL",
    "baseLevel": 4,
    "highRisk": true,
    "description": "执行 / 系统：SERVICE_CONTROL"
  }
];
