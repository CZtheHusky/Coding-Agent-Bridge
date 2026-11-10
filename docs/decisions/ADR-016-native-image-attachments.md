# ADR-016：任务与续作直接附图

> Status: DECISION
> Date: 2026-11-09
> 授权：用户要求补齐 Bridge 附图，并核对 Kimi 的对应能力；在隔离副本实测，不替换正在运行的服务。

## Context

Bridge 原先只提交文字。图片路径进入 prompt 后，执行器需要另行调用工具读取，可能增加模型轮次。Observed：本机 ZCode 安装包及远端 Server 3.16.3 的 session/send 接受 image 附件（kind、filename、mimeType、sizeBytes、localPath）；Kimi Code 2.3.3 的 Server API 接受 content 中 type=image、source.kind=path，内部转换为 image_url。不能把 Kimi 内部 image_url 类型直接作为 REST content 提交。

## Decision

- TaskPackage 与 coding_agent_continue 增加可选 `attachments: Array<{ path: string }>`，仅支持执行 Bridge 的机器上可读的绝对图片路径，顺序保留。省略或空数组沿用文字流程。首版支持 PNG/JPEG/GIF/WebP，通过文件头确定 MIME，不接受远程 URL、任意 base64、PDF、音视频或额外字段。
- Manager 接收新请求时，在落盘/派发前检查附件；adapter 在启动执行器前再检查。缺失、不可读、非普通文件、无法识别的图片必须明确失败，不能悄悄丢图或降级为文字路径。新附件参与提交/续作的幂等身份；同一 operation_id 不得换图。
- start 只发送 TaskPackage.attachments；continue 只发送该次请求的 attachments，持久化在 continue.json 并随 worker 重建。保留原 session，不重复发送首轮或前次图片。自动续作不补图。prompt 标注本条消息的图片顺序和文件名，字节不进入 prompt、事件或新增日志。
- 预约沿用 TaskPackage，保存路径而非字节快照；接受预约时检查文件，实际派发和 adapter 启动前再次检查。原文件须保留到执行时；修改会影响后来读到的内容，删除会显式失败。不新增上传、归档、内容哈希或冻结文件功能。
- ZCode 使用原生 session/send.attachments；Kimi 使用原生 REST image/path content。由执行器在当前消息构造多模态输入，不要求模型另调 Read。保持现有登录、模型、权限、超时、结果及清理合同。
- Manager 校验错误为 TASK_INVALID，预约接受时为 SCHEDULE_INVALID；执行时文件失效为 attachment_invalid，沿现有失败和清理路径返回。执行器报告模型不支持图片或上游大小/数量限制时保留失败；执行器接受请求并输出报告也不等于识图成功，仍须独立验收。不假设所有模型支持视觉。

## Rationale

两种原生协议都支持本地路径，足以避免 MCP/RPC 内大段 base64 和额外读图轮次。不引入依赖或并行上传系统。路径保留与现有任务指令相同的宿主权限边界，allowed_paths/forbidden_paths 仍是写入指令，不能被描述为文件读取沙箱。

## Consequences

附件会交给执行器及其模型供应商，调用者须仅指定任务授权使用的图片；Bridge 私有任务记录保存路径，不新增图片字节存储。真实识图、批量图、续作补图和工具调用数分别验证；token 降幅需要同任务实测，不从减少轮次推算百分比。既有安装和运行中的 MCP 不自动更新。
