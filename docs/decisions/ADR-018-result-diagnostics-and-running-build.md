# ADR-018：结果错误诊断与运行构建识别

> Status: DECISION
> Date: 2026-11-09（客户端日期；部分测试记录为次日 UTC）
> Decision: Accepted，按用户要求补齐反馈中的可观测性缺口
> Baseline: 2318201

## 问题

新版失败事件已包含提供方 1301、HTTP 400 和 retryable=false，但结果只有文字摘要，调用方仍需解析事件。另有长期运行的 MCP 进程继续提供旧参数；安装版本相同（例如 1.2.7）的不同构建无法靠版本号区分。

## 决策

1. TaskResult 增加可选 `provider_error`，沿用 ADR-017 的白名单投影：code/type、数值 status/statusCode/retryAfter/retry_after、布尔 retryable 与固定 content_filter 分类。未知消息、headers、URL、请求体和私有 metadata 不外发。诊断从原生失败经适配器、worker、结果及已有 checkpoint 恢复传递；没有证据时缺省，不从通用退出码推断。
2. 原有顶层 error_code、额度优先、清理优先、任务状态和重试策略不变。cleanup_failed 可以保留提供方诊断作为原因证据，但不能据此绕过清理阻塞。Kimi 仅在原生提供可投影的字段时附加诊断。
3. MCP 的 task/continue 回执与 doctor 增加 `bridge`：核心 version、started_at、running_build_id、disk_build_id、disk_status（same/changed/unknown）与 reconnect_required（布尔或 null）。不改变 manager 落盘的幂等回执；每次 MCP 响应附加当前服务器观察。
4. 构建 ID 是启动时执行分发文件内容的 SHA-256；插件覆盖 bridge/worker/schedule bundle，编译 core 覆盖 dist/src 的 JS/CJS 文件。相对路径参与摘要，绝对路径不输出。同版构建更新是这里使用指纹的具体原因；它只用于观察，不是安全门禁、版本新旧排序或任务验收。
5. 指纹读取失败或必要入口缺失时返回 unknown；编译树的文件增删视为内容变化。不把未知写成无更新，不阻断任务或重启进程。不热加载，不终止已有任务，不发送未经验证的 tools/list_changed。仅安装本功能后的进程能识别后续磁盘变化；更旧进程仍须首次重连。

## 验收

离线覆盖 event/RPC 失败诊断的结果落盘与脱敏、额度及 cleanup 优先、checkpoint 恢复、默认兼容；同版本进程下替换文件能观察 changed，新进程能观察 same，缺文件为 unknown，文件时间变化但内容不变不误报。MCP 协议及实际安装入口执行 doctor 验证；不主动制造内容安全拒绝或额外消耗未恢复额度。
