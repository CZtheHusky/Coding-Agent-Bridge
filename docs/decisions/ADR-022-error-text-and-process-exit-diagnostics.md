# ADR-022：错误原文与进程退出诊断

> Status: DECISION
> Date: 2026-11-11（用户当地日期）
> Decision: Accepted，用户要求查清 GLM 111 条失败并保留具体错误
> Baseline: e0a19e8 + ADR-021 working tree

## Context

定向补标的两次尝试各有 4 个任务，在模型会话创建前退出。ZCode stderr 实际报告 Unix socket 的 listen EINVAL；Bridge 虽缓存 stderr，却只返回通用退出消息。可选的账号同步请求失败后，后续 session/create 又把原退出原因覆盖为 closed before。另一路 provider 失败只允许数字和分类字段，未知错误消息被完全丢弃。

## Decision

1. 保留 app-server 首个进程退出或启动错误，包含实际退出码、信号及有界脱敏 stderr；后续 RPC 请求返回同一原因，不覆盖成连接已关闭。协议错误、取消、超时和清理失败的优先级保持不变。不公开原始协议帧或环境。
2. `provider_error` 增加可选 `message`。只从错误消息字段及既有 error/cause/data/detail/attribution 包装路径提取文本，不复制 headers、stack、metadata、请求体或完整对象。保留原错误用词，清除终端控制字符，脱敏 URL、认证头、Cookie、密钥和密码赋值、常见令牌及 PEM 私钥；最多 4,000 字符，超出时带明确截断标记。
3. 未识别的 provider 失败摘要包含脱敏消息；已识别的额度耗尽及内容审核仍保留固定行动说明，同时在 provider_error.message 保存诊断。结构化错误随现有 worker、checkpoint、结果和 MCP schema 传递；没有文本则不虚构。旧字段和错误码兼容，重试策略不变。
4. 部署验收另发现 Kimi 非 BridgeError 的普通异常会丢失消息。此类异常沿用同一 provider_error 投影保留 message/cause 文本，摘要含脱敏原因；取消、任务超时、已分类错误及清理优先级保持不变。不记录 Kimi 含本地认证令牌的启动 banner，不修改原生系统提示、HTTP 超时或自动重试。
5. 这条较新的决定替代 ADR-017/018 的“未知错误消息一律不外发”限制。保留默认官方系统提示，不替调用者改临时目录，不自动重跑业务批次，也不改变已结束任务记录。

## 补充范围（2026-11-12）

模型目录使用独立 app-server 客户端，同样适用上述退出诊断、首因保留和 RPC 消息脱敏规则；不能只在任务执行 adapter 中实现。调用者在工具说明与 skill 异常参考中应能看到长 TMPDIR 的 socket 路径限制，修正路径后自行决定重试，不由 Bridge 自动迁移目录。

## Rationale

未知错误是诊断所必需的证据；把所有消息抹成通用失败会导致盲目重试。字段投影、凭据脱敏及长度边界足以约束公开诊断，不应靠丢弃错误原因解决问题。

## Consequences

错误消息中的非秘密路径和请求标识可供调用者定位。文本脱敏针对已定义的凭据形式，不能宣称识别任意自由文本中的所有敏感内容。历史已丢失的 stderr 无法从 Bridge 记录还原，只能使用受控复现补证。运行中的 MCP 仍须重连才能加载新版；本决定不授权重跑 111 条标注。

## 验收

用真实子进程模拟启动 stderr/退出、账号同步后续请求和无 stderr 退出；覆盖 event/RPC 未知消息、凭据脱敏、显式截断、额度/清理优先级、worker 落盘与 checkpoint/MCP 传递。远端用原安装的 ZCode 做无模型初始化对照：同盘短 socket 路径正常，长 TMPDIR 可重现 listen EINVAL；不制造内容审核拒绝或批量重试。
