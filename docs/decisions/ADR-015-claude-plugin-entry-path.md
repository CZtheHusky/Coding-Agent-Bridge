# ADR-015：Claude 插件入口使用宿主根目录变量

> Status: DECISION
> Date: 2026-11-08
> 授权：用户要求调查并修复远端 Claude 无法使用 Kimi / GLM 的问题。

## Context / 背景

Claude Code 2.1.312 实测把插件 `.mcp.json` 中的 `./dist/bridge.mjs` 解析到调用项目；`cwd: "."` 没有提供插件目录语义。可连接的另一份独立 Bridge 与失败的插件实例必须分别检查，连接成功不代表执行器可用。

## Decision / 决策

保留 Codex / portable MCP 配置不变。新增 `.claude-plugin/plugin.json`，通过同名 `mcpServers.coding_agent_bridge` 覆盖自动发现的 `.mcp.json` 条目；入口参数使用 `${CLAUDE_PLUGIN_ROOT}/dist/bridge.mjs`。工具、宿主 profile、任务存储、权限和执行器协议均不改变。

## Rationale / 理由

`${CLAUDE_PLUGIN_ROOT}` 是 Claude 官方支持的插件路径变量；独立声明避免将其传给不保证支持该变量的 Codex 入口，也避免绑定部署机器的绝对路径。

## Consequences / 影响

独立部署的 Claude host 需要单独升级共享核心；升级 CLI 或另一宿主的插件缓存不会替换它。代理继续遵守 ADR-012 的环境边界，不在仓库声明或命令参数中加入凭据。

## 验证标准

回归测试从不含 `dist/bridge.mjs` 的项目目录启动 Claude 声明的服务器，完成 MCP 初始化和工具发现；同时保留 Codex 的插件目录启动测试。校验器检查 Claude manifest 的版本与入口。真实环境分别验证 Kimi、GLM 文件写入/读取和同 session 续作，记录实际版本与未验证边界。

参考：[Claude 插件 MCP 声明、同名覆盖与变量展开](https://code.claude.com/docs/en/plugins/components#mcp-servers)。
