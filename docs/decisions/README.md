# 决策记录 / Decisions

> Status: AUTHORITATIVE（仅指本索引）
> Last updated: 2026-11-11
> Last verified: 2026-11-11，ADR-022 错误文本与启动 stderr 回归；原生验证和两端安装范围见[诊断报告](../reports/2026-11-11-error-propagation.md)。
> Prior verification: 2026-11-11，仅新增 ADR-021 决策路由；其余保留历史范围。
> Prior verification: 2026-11-09，仅核对 ADR-017/018 决策路由；ADR-016/ADR-015 沿用此前核对，其余范围不变。
> Verified against: 122d9b7

本目录保存已批准的架构决策和带日期的决策记录。决策回答"为什么这样定"，当前实现仍以 `ARCHITECTURE.md` / `INTERFACES.md` 为准。

## 现有记录

| 文档 | 状态 | 说明 |
|---|---|---|
| [roadmap-decisions-2026-09-27.md](roadmap-decisions-2026-09-27.md) | DECISION | 2026-09-27 的路线图与决策讨论。仍然成立的结论需要提炼进 `ARCHITECTURE.md` / `INTERFACES.md`；本文本身不是当前事实来源。 |
| [reliability-repair-plan-v2-2026-10-03.md](reliability-repair-plan-v2-2026-10-03.md) | DECISION | Bridge 可靠性修复计划。A/B 主要改动已实现；C/D 与宿主启动核验仍有未完成项。 |
| [ADR-005](ADR-005-long-session-reliability.md) | Accepted | 长会话 Windows 清理验证、原子锁释放、报告续作与 catalog provider 兼容；历史记录保持不变。 |
| [ADR-006](ADR-006-provider-quota-failure-diagnostics.md) | Accepted | 仅对白名单 provider 错误字段分类明确的用量额度耗尽；不公开原始 RPC 错误。 |

## ADR 索引

| ADR | 状态 | 主题 |
|---|---|---|
| [ADR-001](ADR-001-appserver-as-production-execution-path.md) | Accepted | 生产执行路径使用 ZCode app-server |
| [ADR-002](ADR-002-manager-owns-task-lifecycle.md) | Accepted | Manager 独占任务生命周期，worker 通过 attempt claim 入场 |
| [ADR-003](ADR-003-execution-directory-prepared-by-host.md) | Accepted | 执行目录由调用宿主准备，Bridge 不创建也不删除 |
| [ADR-004](ADR-004-separate-control-state-and-observation.md) | Accepted | 分离运行时控制、权威状态与补充观察；Desktop 索引是登记过的集成例外 |

ADR-001 到 ADR-003 只搬运权威文档里已经写明的结论。ADR-004 原先没有明文记录，只有 bridge 之外的设计讨论，因此先以 Proposed 记录；2026-10-07 由 Master 明确按"强化版 A"接受，原则冻结，未因此增加任何读取 ZCode 本地材料的代码。

## 本分支待维护者审查的实现

- [ADR-007](ADR-007-browser-host-rpc.md)：可选headless浏览器宿主；默认关闭，限定版本实测。
- [ADR-008](ADR-008-session-frames-and-large-interactions.md)：会话帧与大审批输入；独立资源边界及可恢复错误。
- [ADR-009](ADR-009-windows-identity-bound-tree-termination.md)：Windows 进程树身份绑定归属与终止；句柄事务、零容差区间归属、单调失败锁存与有界传输。
- [ADR-010](ADR-010-scheduled-zcode-and-codex-wakeup.md)：一次预约目标、systemd user 监督、静默同 session 续作和原 Codex 聊天独立验收；App 内部 pipe 历史空闲唤醒、当前真实消息送达与空闲新轮次未验证范围分开记录。

- [ADR-011](ADR-011-provider-quota-diagnostic-coverage.md)：补齐额度诊断字段与 RPC 错误路径；数字业务码限定 provider 范围，Codex 内置审批不伪装为外部审查 API。

## 命名

新决策使用 `ADR-NNN-<slug>.md`，正文至少包含 Status、Date、Context、Decision、Rationale、Consequences。

- [ADR-013](ADR-013-coding-agent-bridge-discovery.md)：Coding Agent Bridge 展示名、coding_agent_* 工具与能力说明；安装及数据身份保留。

- [ADR-014](ADR-014-kimi-reasoning-level.md)：Kimi reasoning_level 透传原生 thinking，按模型支持档位并保留省略默认。

- [ADR-015](ADR-015-claude-plugin-entry-path.md)：Claude 独立 manifest 使用宿主插件根目录变量，保留 Codex 入口，并分别升级独立部署。

- [ADR-016](ADR-016-native-image-attachments.md)：任务与续作的原生图片附件，ZCode/Kimi 字段、持久化和失败边界。

- [ADR-017：API 模式、数据输出与诊断](ADR-017-data-task-output-and-diagnostics.md)：raw/minimal 组合、保留原生系统提示、失败诊断及扫描边界。

- [ADR-018：结果诊断与运行构建](ADR-018-result-diagnostics-and-running-build.md)：结构化 provider_error、同版执行文件变化观察与重连提示。

- [ADR-019：Kimi 晚注册工具与真实用量](ADR-019-kimi-late-tools-and-usage.md)：原生 MCP 名称模式覆盖异步工具注册，snapshot 提供会话累计用量。

- [ADR-020：活动调度索引与显式数据目录](ADR-020-scheduling-index-and-data-root.md)：写前登记、锁内验证撤销、一次迁移及 DATA_DIR 单项覆盖；同库 Manager 须统一升级。

- [ADR-021：ZCode Server runtime 自动发现](ADR-021-zcode-server-runtime-discovery.md)：跟随官方 current.json，保留显式固定入口与两宿主独立配置。

- [ADR-022：错误原文与进程退出诊断](ADR-022-error-text-and-process-exit-diagnostics.md)：脱敏消息、启动 stderr 与首个退出原因保留。
