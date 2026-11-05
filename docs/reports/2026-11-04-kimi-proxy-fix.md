# Kimi 代理继承修复与插件部署验证

> Status: RESEARCH
> Date: 2026-11-04
> Verified against: 2e14ea4a95e61876c68a59bd68baa08a6b3ae4f1 + 本次代理修复；独立部署构建仅包含本次修复
> Environment: 本机 Linux / Node 22.22.2 / Kimi 2.3.3；远端 Linux / Node 24.22.1 / Kimi 2.4.1；远端 Codex 0.164.0
> Privacy: 公开脱敏记录。主机名、账号目录、网络端点、凭据、任务/会话标识、进程标识与原始日志仅保存在私有验证材料中，不随仓库提交。

## 原因与修复

同一远端账号和 CLI：过滤代理时模型请求超时，保留终端代理后可返回。Bridge → detached worker 与 worker → Kimi 两处环境过滤均会丢失代理；实际远端 MCP 启动进程也没有标准代理变量。

增加独立的标准代理白名单，在真实 worker spawn 和 Kimi spawn 的 env 中原样传递 HTTP_PROXY、HTTPS_PROXY、ALL_PROXY、NO_PROXY 及小写形式。不扩大通用 OS/Bridge 配置白名单，因此不把含凭据的代理加入 systemd 参数；不转发任意 API key。依据见 [ADR-012 代理补充](../decisions/ADR-012-kimi-executor.md#代理环境补充2026-11-04)。

远端站点的私有启动器从已有代理配置提供标准代理变量，没有在插件包中加入凭据。源仓库仍使用通用 node 启动方式；私有启动器、真实代理值和站点入口配置不属于本次提交。

## 自动回归

- 独立修复候选：typecheck、build、validate:plugin 通过；完整测试 643 项，639 通过、0 失败、4 项跳过。
- 代理边界专项：24 项通过，无跳过；覆盖真实 detached worker、真实 Kimi fixture 子进程的大小写代理与 loopback bypass 传递、任意秘密过滤、代理不进入模型请求与公开结果；调度回归验证代理凭据不进入 systemd 参数。
- 4 项平台跳过：Windows startup hook、两项 Windows process-tree 语义、非 Linux 调度分支。未将跳过记为通过。

## 首轮安装后真实调用（直接 MCP）

首轮测试启动新 MCP 进程，使用安装目录 `.mcp.json`，调用公开 coding_agent_task/result/continue/status/events 工具。启动环境刻意排除所有代理变量，远端必须由配置的私有启动器提供代理。每轮使用独立工作目录，仅授权 proof.txt 写入与读取，没有向用户项目写入。

| 环境 | 运行时报告模型 / 档位 | 验证 |
|---|---|---|
| 本机 Kimi | kimi-code/k3.1-pro / 原生默认（未报告档位） | 文件写入/读回、同 session 续作；独立核对精确内容，cleanup verified |
| 远端 Kimi | kimi-code/k3-256k / 原生默认（未报告档位） | 文件写入/读回、同 session 续作；独立核对精确内容，cleanup verified |
| 本机 ZCode | GLM-5.3 / max | 文件写入/读回；独立核对精确内容，cleanup verified |
| 远端 ZCode | GLM-5.3 / max | 文件写入/读回；独立核对精确内容，cleanup verified |

安装后三个 bundle 与受测独立部署产物逐字节一致；原有 runtime-config.json 和 Codex config.toml 保留，两端 ZCode 配置仍为 yolo。独立 /proc 检查确认测试无存活 worker/runtime，远端测试任务记录未发现配置中的完整代理 URL。

## Desktop SSH 入口复核

用户随后反馈：另一台机器上的 Desktop 经 SSH 连接远端时，Kimi 仍失败。首轮只修改并测试了兼容入口 `.mcp.json`，遗漏了 Desktop 使用的便携入口 `mcp.json`。首轮结果只证明兼容入口的新进程可用，未覆盖用户实际使用的 Desktop 链路，这是部署与验证范围的遗漏。

本轮同步修正远端安装目录的两个入口，显式配置私有启动器和 KIMI_BRIDGE_EXECUTABLE。便携入口不能直接复制兼容入口的绝对 command：Agent Plugins 仅接受程序名或插件内 `./` 路径。初次补改使用绝对启动器路径时，独立 Codex 原生发现返回空工具列表，测试在提交 Kimi 任务前失败。最终便携配置以 `sh` 为 command，将私有启动器路径和 `./dist/bridge.mjs` 作为参数，cwd 为 `./`。原生发现随后返回正确 pluginId、connected 状态和 17 个工具。未将发现失败记为模型调用失败或通过。

观察版本为 Codex 0.164.0。验证环境对齐真实服务的 code_mode_host、apps 和 codex_apps_mcp_2026_07_28 设置。插件显示已安装不等于 MCP 已装配，须检查原生 mcpServerStatus/list 的 pluginId、连接状态和工具列表。

通过私有 SSH Unix socket 转发连接正在运行的 Desktop app-server。单独调用 config/mcpServer/reload 返回成功，但旧 Bridge 进程仍未变化，不能据此声称旧聊天已加载修复。在观测版本中，执行无编辑的 `config/batchWrite { edits: [], reloadUserConfig: false }` 清除插件加载缓存，再执行 config/mcpServer/reload 后，已有 Bridge 连接全部重建，逐进程检查确认标准代理变量和 KIMI_BRIDGE_EXECUTABLE 均已配置。用户 config.toml 与刷新前备份逐字节一致；远端 Codex 主服务保持运行，未终止用户终端 Kimi。

随后完成两组真实 Kimi 验证，模型事件均为 kimi-code/k3-256k、原生默认档位：

- 独立 Codex 服务原生加载插件，通过内存测试上下文调用 Bridge，完成文件写入/读回与同 session 续作。保存父子进程关系及代理变量名，不保存代理值；未调用 Codex 模型。
- 经用户已有聊天所用的真实 Desktop 服务连接调用 mcpServer/tool/call，完成文件创建/读回、同 session 覆盖文件/读回两轮。测试程序通过独立 SSH 读取文件，核对精确内容及 session 复用；Bridge 状态 cleanup verified，另查 /proc 确认测试 worker/runtime 已退出。未向已有聊天发送模型 prompt。

后一组证明原聊天所用的远端服务与 Bridge 连接可执行 Kimi；未操作另一台机器的 Desktop 界面。临时转发使用权限为 0600 的 Unix socket，未开放 TCP 端口，测试结束后已停止转发并删除 socket。

## 部署与回滚

两端安装缓存均替换三个受管理 bundle，并同步代理安全说明；版本仍为 1.2.7，尚未发布新版本。站点配置与源码包分开保存。回滚时恢复替换前的 bundle、站点入口配置和私有启动器备份；完整日志与备份仅保存在私有验证目录。

## 边界

- 验证覆盖上述 Linux/Kimi 版本的即时任务。预约 runner 仍清空宿主代理，本次不增加预约代理配置，也未实测 Kimi 预约唤醒。
- 仅替换磁盘文件不会自动更新已运行的 MCP 进程。首轮直接 MCP 验证不覆盖旧聊天；本轮另通过缓存刷新、逐进程检查与已有聊天连接调用确认现有 Desktop 服务已切换。无编辑刷新方式仅在观测 Codex 0.164.0 版本实测，不扩展为其他版本保证。
- 缓存热修复及远端 mcp.json / .mcp.json 站点配置可能被市场重新安装覆盖；私有配置未写入源仓库。
