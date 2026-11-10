# Claude Bridge 入口与 Kimi 代理修复

> Status: RESEARCH
> Last updated: 2026-11-08
> Last verified: 2026-11-08，远端实际 Claude MCP 健康检查、两入口模型调用、独立宿主同会话续作及本机回归。
> Verified against: 7c1d6f29418e50337f1e2fbe04d6c83daeb3b789 + 本次 Claude manifest、校验与测试；保留已有 prompt 改动。

## 结论与根因

1. `coding-agent-bridge` 已连接，但它使用独立安装的共享核心，缺少 11 月 4 日的代理继承修复。旧 detached worker 与 Kimi 子进程都没有传递标准代理环境。基线真实 Kimi 调用约 34 秒后以 `kimi_nonzero_exit` 失败，没有写出验收文件；升级核心及私有启动入口后调用通过。
2. `plugin:codex-zcode-bridge:coding_agent_bridge` 是另一实例，其 `.mcp.json` 把相对入口解析到了项目目录，报 `MODULE_NOT_FOUND`。新增 Claude 专用 manifest，使用官方 `${CLAUDE_PLUGIN_ROOT}` 变量覆盖同名服务器；Codex / portable 配置不变。真实 `claude mcp list` 显示两个实例均 Connected。
3. 未复现 GLM provider 不可用：基线独立宿主上的 GLM 已成功执行。失败的插件入口不能作为 GLM 模型故障证据；本次也没有修改登录或 provider 配置。

观测版本：两端 Claude Code 均为 2.1.312，本机 Codex CLI 0.166.0、远端 0.164.0，远端 Bridge 实际使用 Node 24.22.1，Kimi Code 2.4.1。非交互 SSH 的系统 Node 版本不同，不是此次 Claude 连接失败的依据。升级 CLI 不会自动替换独立部署的 Bridge 代码。

## 修复与验证

远端独立 Claude host 的编译核心、私有启动入口和已安装 Claude 插件的入口声明及三个 bundle 已更新，替换前保存私有备份。代理值仅保留在机器私有配置，不写进仓库、任务或命令参数。运行模式仍为 yolo。

| 检查项 | 结果 | 独立证据 |
|---|---|---|
| 原配置 Kimi 调用 | 失败，问题已复现 | `kimi_nonzero_exit`；未产生验收文件 |
| 原配置 GLM 调用 | 通过 | GLM-5.3 / max；实际文件内容核对 |
| 更新后独立宿主 Kimi 首次与续作 | 两次通过 | `kimi-code/k3-256k`；两次文件内容核对、attempt 递增、session 相同 |
| 更新后独立宿主 GLM 首次与续作 | 两次通过 | GLM-5.3 / max；两次文件内容核对、attempt 递增、session 相同 |
| 更新后插件 Kimi / GLM | 各一次通过 | 同一插件声明的入口启动，实际写入并读回文件；模型为上述两项 |
| 清理 | 通过 | 各受测 attempt 的 cleanup 均 verified；本次测试无残留 worker |
| 无标准代理的启动环境 | 通过 | 私有入口可补齐代理、bypass 与 Kimi 可执行路径；只输出布尔检查结果 |
| Typecheck / build / plugin 校验 / diff 检查 | 通过 | 本机实际执行 |
| 全量回归 | 645 项，641 通过，4 跳过，0 失败 | 跳过：Windows 启动 hook、两项 Windows 进程树、非 Linux 调度 |
| 干净安装入口检查 | 6 / 6 通过，0 跳过 | 包含编译入口与插件 bundle，不依赖开发安装路径 |

新增回归从不包含 `dist/bridge.mjs` 的项目目录启动 Claude 声明的服务器，验证 MCP 初始化及 task/continue 工具发现；真实 Claude CLI 的健康检查另外验证了宿主变量展开与同名覆盖。

一次独立宿主续作的检查程序在状态文件替换瞬间遇到 `FileNotFoundError`，当次检查中断；没有将它记成模型失败或静默忽略。修正检查程序后，重新通过 MCP 查询两项续作的最终状态、结果及 session，并独立核对文件，两项均为 attempt 2 completed、同 session、cleanup verified。未重新提交模型任务。

## 验收范围与后续

- Bridge 的 completed 只是执行终态；本次独立验收覆盖真实文件内容、同 session 续作与清理，不代表完整项目编码或所有审批分支认证。
- Kimi 未报告实际推理档位，其 usage 总 token 缺失；不把其输入/输出 0 解释成免费调用。GLM 报告 max。主会话 token 未取得：当前宿主未提供本次调用统计。
- 正在运行的用户 Claude 及其旧 Bridge 连接未强制重启。新连接已验证；既有会话需要重连 MCP 或重新打开 Claude 才能使用新部署。两个注册都保留，插件 skills/hooks 未禁用。用户既有聊天内刷新后的真实调用未运行。
- 原有 prompt 与 bundle 改动保留。本次未提交、未推送、未发布；从当前远端 Git 重新安装可能覆盖缓存补丁，源码发布后应从发布渠道升级。
- 原始日志、任务标识、机器路径及代理信息保存在仓库外的私有诊断记录中，本文不包含这些部署信息。

参考：[Claude 插件 MCP 入口、同名覆盖与路径变量](https://code.claude.com/docs/en/plugins/components#mcp-servers)。
