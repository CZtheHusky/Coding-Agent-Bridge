---
name: coding-agent-bridge
description: 通过 Coding Agent Bridge 委派本机 ZCode 或 Kimi 任务，跟进、续作并独立验收；支持数据/API 模式及受环境限制的预约唤醒。
---

# Coding Agent Bridge

> Status: AUTHORITATIVE
> Last updated: 2026-11-12
> Last verified: 2026-11-12，仅本次模型目录错误回传与 TMPDIR 提醒；其余沿用既有验证范围。
> Verified against: 3042a71 + 本次模型目录诊断 working tree

## 常用流程

1. 用 `coding_agent_task` 提交明确任务。`workspace` 是项目根；可选 `worktree_path` 必须是宿主已准备的目录，Bridge 不创建、合并或删除 worktree。同目录及父子目录串行，不要让宿主与执行器同时改同一执行目录。
2. 写清目标、要求、允许/禁止路径、验收条件和适用测试，只传必要 context。默认 ZCode；Kimi 设 `executor: "kimi"`。指定 ZCode 模型/档位时先查 `coding_agent_model_catalog` 并复制实际值；Kimi 用 `kimi.model` / `kimi.reasoning_level`，不能混用 ZCode 的 model 字段。
3. receipt 不是完成。用 `coding_agent_events` 增量读取（保存 next_seq），必要时查 status/feedback；遵守当前任务的监控间隔，只报告有意义的变化。普通任务不自动唤醒聊天。实际模型/档位只认 runtime 确认值，缺失则写未报告。
4. 终态读 `coding_agent_result`，独立检查实际 diff/文件和适用测试。未达标用 `coding_agent_continue` 给具体反馈，保留同 task、session 和目录；取消用 `coding_agent_cancel` 并核对清理。completed 不等于验收通过；接收、提交和推送遵守用户授权。

## API 模式

- 数据任务设 `report_mode: "raw", session_profile: "minimal"`；Kimi 另设 executor。文字和图片随任务传入，不能依赖已禁用的读文件、终端等工具；需要工具时保留 default profile。
- 从 `result.zcode_output` 读原文并验证格式、条目数、顺序和字段，不拼事件摘要。输出截断会失败；预约不支持 raw。不相关请求各建新任务，需要历史才 continue。
- 两执行器均保留原生默认系统提示；工具精简不保证裸模型上下文或固定 token 降幅。

## 必须保留的边界

- `allowed_paths`、worktree 和工具禁用都不是 OS 沙箱；默认 yolo 不代表所有请求已授权。审批/问题按已有授权处理，需要新授权或关键决定时才询问用户；不能把有界预览当完整输入。
- `zcode_usage_exhausted` / `kimi_usage_exhausted`：停止该执行器的自动调用、重试和续作，告知用户并等待确认额度恢复。失败先核对 error_code；cleanup 未确认时不得续作、删锁或重派冲突目录。
- 不把凭据、代理秘密或 App pipe 写进任务、日志或仓库；不要为方便更改 provider 配置。汇报区分独立实测、执行器自报和未验证，不估算缺失 token。
- Linux 的 ZCode 使用短 `TMPDIR`；路径过长可在启动时触发 socket `listen EINVAL`。优先在调用者指定的数据盘选短目录，详见[交互与异常](references/interactions-and-failures.md#临时目录路径过长)。
- 升级文件后需重连 MCP 或开启新宿主会话，已有连接不会热加载新代码/技能。

## 只在需要时读取

- 选择 Kimi 模型、附图或排查 API 精简能力：[执行器与数据任务](references/executors-and-api.md)。
- 遇到审批/提问、报告无效、未知状态或清理故障：[交互与异常](references/interactions-and-failures.md)。
- 用户要求跨轮持续委派、预约启动或处理唤醒：[持续任务与调度](references/scheduling.md)，执行前先读。
