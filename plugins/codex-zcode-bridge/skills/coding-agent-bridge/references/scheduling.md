# 持续委派与预约调度

> Status: AUTHORITATIVE
> Last updated: 2026-11-09
> Last verified: 2026-11-09，按既有 ADR-010 调度/验收合同整理；未新增运行认证。
> Verified against: 998670c

## 当前聊天持续委派

用户明确要求跨轮持续推进（如持续做到完成或叫停）时，在首次派发前创建当前线程 Goal，写明授权目标、独立验收、接收条件及停止条件；不推断额外授权，不自行设 token budget。单次任务不创建 Goal。宿主没有 Goal 工具时明确说明，不能声称已启用持久续行。

Goal 保持活动直至所有必要任务终态、独立验证完成且授权改动已接收；Bridge completed 或 worker 自报不能替代验收。跨轮时说明仍在运行的任务并保持 Goal，不把中间状态当最终结果。用户叫停时遵从。

## 预约启动

用户要求未来开始并持续到验收通过时，用 coding_agent_schedule，不用当前轮等待、Goal 轮询或另建周期自动化代替持久调度。一次预约对应一个目标与 task_id，不定期创建新任务；task 必须 structured，raw 不支持。

1. 准备完整任务和现有执行目录；start_at 使用带秒和时区的绝对 ISO 8601 时间。时间实质不明确时先澄清。
2. thread_id 必须是当前宿主提供的原聊天 UUID（有时为 CODEX_THREAD_ID），不能从别的进程、聊天或 task_id 猜测。缺失则停止预约并说明；App pipe 与秘密不放进任务。
3. 提交 coding_agent_schedule({ task, start_at, thread_id })，核对回执开始时间、目标聊天、监督 unit 和 log_path。当前监督仅支持 Linux user systemd（254+，支持 --expand-environment=no）及 Codex App pipe；不支持时如实报告，不用无监管后台进程假装替代。
4. 回执丢失按相同 task_id 和相同完整请求查询/重试；收到预约回执即可确认并结束当前轮，等待调度唤醒，不套用普通立即任务的跟进流程。

## 静默推进与独立验收

正常运行及 completed + acceptance_met=false 由调度器静默复用同 session 续作，不向用户反复报告。acceptance_met 是执行器自评，非宿主验收；timeout 只有 session 已保存且 cleanup verified 才自动续作。

收到唤醒先用 coding_agent_schedule_status 核对 event ID、attempt、attention 和 attempt_under_review，再读取 task 状态/结果及必要事件。通知至少一次交付；已处理、已取消/接受或旧 attempt 只核对，不重复验收或续作。App 送达不等于完成。

仅 awaiting_review 时独立审查 diff、实际文件、测试和授权接收；通过后对当前 attempt 调用 coding_agent_schedule_review({ task_id, attempt, accepted: true })，确认 accepted 再通知用户。未通过则 accepted=false 并给出具体证据/期望，由调度器同 session 继续；不改用新 task 或普通 continue 替代 review。

权限/输入、needs_master_decision、缺失/无效自评、失败、额度耗尽、cleanup 未确认先交给宿主判断。依据已有授权处理确定事项，需要新增授权、关键决定或用户处理时才通知。不得盲目批准、伪造 review 或无限重试；额度耗尽等待用户确认恢复，cleanup 未确认不能续作。正常返工保持安静。

取消预约使用 coding_agent_schedule_cancel，确认停止意图及执行清理；仅 cancel 普通任务不能关闭预约目标。cancel_failed 时核对 failed/cancel_requested 及自动重试已暂停，报告具体失败，不冒充取消成功。

## 已知运行边界

App 唤醒适配依赖记录版本的 Linux App 内部接口，非跨版本保证。Kimi 预约唤醒全链路未实测；Windows/macOS、注销/关机/App 关闭及跨宿主行为不作保证。独立历史消息送达与新版空闲聊天唤醒认证不能混为一谈；当前状态见仓库 PROJECT_STATE 与调度实测报告。不要将本机制扩展为周期自动化，也不要未经授权修改 provider、安装、提交或发布。
