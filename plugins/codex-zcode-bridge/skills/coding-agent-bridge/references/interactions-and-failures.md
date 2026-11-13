# 交互与异常

> Status: AUTHORITATIVE
> Last updated: 2026-11-12
> Last verified: 2026-11-12，仅本次模型目录错误回传与 TMPDIR 提醒；其余沿用既有验证范围。
> Verified against: 3042a71 + 本次模型目录诊断 working tree

## 审批与问题

读取 interaction_requested 的方法、工具、理由、输入和选项，按当前用户已授予的权限判断。yolo 或 worktree 本身不构成授权；当前授权不足时才询问或拒绝，不重复索要已有授权。

preview=true 的 input_preview 不是全文。判断需要完整输入时读同 task/attempt 的 details.full_request；bytes/sha256 对应紧凑 JSON.stringify(params)，不是整个记录文件。Bridge 会在批准落盘前核验完整记录；缺失、损坏或改变会拒绝执行，必须如实报告，不能绕过记录检查。

用 coding_agent_interaction_reply 回复。AskUserQuestion 的 answers 必须以每个 questions[].question 的完整原文为键，以已有答案/用户选择为值；不能用 header 或选项标签作键。键错误时复制原问题文本修正同一请求。问题或计划超出现有授权、需要关键选择时交给用户；确定的事实与已授权事项可直接处理。回复后确认执行器继续或结束。

## 失败与恢复

- 先读 result.error_code、可选 provider_error 和必要事件，不只看 feedback 标签；retryable 不能覆盖额度/清理停止规则。回执/doctor.bridge 的 disk_status=changed 提示重连，unknown 不是已更新。启动失败时只有出现 session_ready 才能声称创建了 session；模型等元数据缺失就写未报告。
- invalid_agent_report：先检查 report_candidate、zcode_output 和实际工作。编码已完成时续作仅修复报告，不重做实现/测试；原文已有数据时先独立验证，避免无谓重做标注。缺少的决定字段不能凭空补 false。
- raw 输出截断：保留的文本不完整，不能当有效成功。内容安全拒绝 1301 不原样自动重试；未知错误需要原生诊断，不能推测成网络或限额。
- zcode_usage_exhausted / kimi_usage_exhausted：停止对应执行器调用、重试及续作，告知用户并等待确认恢复；普通限流不等于额度耗尽。
- cleanup_failed 是当时清理未能确认；后来 status.observation.cleanup=verified 是新增证据，历史失败仍保留。unknown/unverified 时不续作、不删除锁、不改历史状态、不向冲突目录重派。不能按锁年龄推定可删。
- observation.stalled 仅为提示；心跳只证明 worker 响应，activity/last_observed 不证明工具现在运行或测试通过。不得据此自动取消、重试或判死。

需要续作时复用同 task/session/目录并给出具体失败证据。接收 worktree 改动前保护已有用户改动、解决冲突并独立验收；Bridge 不自动合并、提交或删除 worktree。

汇报以用户所需结论为主，说明独立验证范围、未验证项和必要下一步；需要时附模型、usage 与证据链接，不强制长表。执行器自报、历史记录和独立实测必须区分，任务成功与清理未确认应分开说明。

## 临时目录路径过长

Observed ZCode Server 3.18.0（Linux）在 `TMPDIR` 下创建 `znr-<UUID>.sock`。Linux Unix socket 路径通常最多 107 字节；本版本追加的文件名和分隔符约占 46 字节，深层业务输出目录作为 TMPDIR 可能在创建 session 前报 `listen EINVAL`。长度按 UTF-8 字节计算，不按字符数计算。

启动任务或查询模型目录前，为 Bridge 进程选择调用者预期文件系统中的短临时目录；例如在数据盘根下创建短名称的独立目录，再设置 `TMPDIR` 启动 Bridge。修改父 shell 的变量不会改变已启动的 MCP 进程，需要重新连接。保持目录到相关任务结束后再清理，不能在仍有任务时删除。Bridge 保留脱敏后的具体路径与 stderr，但不会自动更换磁盘或重跑业务。`coding_agent_doctor` 的静态检查通过也不能证明 socket 可以创建；模型目录刷新失败应读该工具返回的错误原文。
