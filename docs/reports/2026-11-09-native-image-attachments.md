# 原生图片附件实现与实测

> Status: RESEARCH
> Date: 2026-11-09（测试跨 UTC 2026-11-10，按本机日期记录）
> Baseline: 7c1d6f29418e50337f1e2fbe04d6c83daeb3b789 + 既有未提交修复 + ADR-016 working tree
> Scope: 初始功能验收使用 Linux 本机及 SSH Linux 隔离副本，当时未安装、重启、提交或发布；后续已提交推送并替换安装，见[安装验收记录](2026-11-09-native-image-deployment.md)。

## 实现

`coding_agent_task`、`coding_agent_continue` 以及 `coding_agent_schedule.task` 支持 `attachments: [{ path: "/absolute/image.png" }]`。PNG/JPEG/GIF/WebP 按文件头识别，使用执行 Bridge 的机器上的绝对路径。SSH 文件须在远端。只保存路径，不保存图像快照；延期执行前不得删除原文件。

ZCode 把本轮图片放入 `session/send.attachments`，字段为 kind=image、filename、mimeType、sizeBytes、localPath。Kimi 的 Server API 使用 `content` 中 type=image、source.kind=path、name，内部才转换为 image_url；不直接提交内部 image_url 类型。没有新增读图工具或运行时依赖。

续作只发本轮新图，保留原 session，既有 task.attachments 不重复发送。continue.json 保存新增图片，重建 worker 可恢复；operation_id 的幂等输入包含附件顺序和路径。接受请求前校验，adapter 启动前复查，不能默默丢图。无效输入为 TASK_INVALID / SCHEDULE_INVALID，执行时文件失效为 attachment_invalid。

## 独立验收方法

生成 18 张 640×360 合成 PNG，包含随机五位码、红/绿/蓝方块及 1–4 个方块。图片文件名只有序号，目标答案保存在任务工作区之外，不写入 prompt。要求直接读取原生图片，在 JSON report.summary 中返回 `code:color:count`，并要求不调用工具。

首轮批量 16 图，续作补 2 图，再发不附图的会话回忆问题。SSH 路径另验证真实 MCP → detached worker → 执行器 → 持久结果，包括 2 图、新补 1 图、无图回忆三轮；再各开一个全新任务附 16 图。由主 Agent 用本地目标答案逐项精确比较，执行器自报 completed 不作为识别正确证据。

本机通过 systemd user 单元监督，SSH 用独立 session、无终端 stdin、文件日志托管，并在原启动连接退出后验证父进程为 PID 1。所有测试任务已终态；SSH 任务 observation.cleanup=verified。私有启动命令、监督 ID、模型会话、原始事件和目标答案保存在仓库外，不提交机器配置、登录或代理凭据。

## 真实结果

| 环境 / 实际模型 | 首轮批量结果 | 补图 / 会话回忆 | 可见工具调用 |
|---|---|---|---|
| 本机 ZCode / GLM-5.3，max | 未通过：16 图均未返回可核验识别值 | 补 2 图仍未识别；回忆无已读值 | 0 |
| 本机 ZCode / GLM-5.3-Flash，max | 16/16 完全正确 | 2/2 正确；回忆正确，同 session | 0 |
| 本机 Kimi 2.3.3 / kimi-code/k3.1-pro | 15/16 完全正确；一图 M 被识别为 W，颜色及数量全部正确 | 2/2 正确；回忆正确，同 session | 0 |
| SSH ZCode Server 3.16.3 / GLM-5.3-Flash，max | 另一次独立批量 16/16 正确 | MCP 三轮：2/2、新补 1/1、回忆均正确，同 session | 0 |
| SSH Kimi 2.4.1 / kimi-code/k3-256k | 另一次独立批量 16/16 正确 | MCP 三轮：首批 2/2；新补 1 图字码有误，颜色/数量正确；回忆正确，同 session | 0 |

官方模型能力说明与用户提供的信息一致：[GLM-5.3 普通版仅处理文本](https://docs.bigmodel.cn/cn/guide/models/text/glm-5.3)，[GLM-5.3-Flash/FlashX 原生支持多模态](https://docs.bigmodel.cn/cn/guide/models/vlm/glm-5.3-flash)（2026-11-09 核对）。本次普通版未识图符合其能力边界，不应表述为 Bridge 传图故障；FlashX 本轮未测试。传输协议接收附件、执行器 completed、模型具备视觉能力、识别准确是四件不同的事。本次没有自动更换用户默认模型，也未为文本模型配置额外视觉 MCP 工具。

这些结果证明两种执行器的原生传图、批量顺序、补图和会话复用链路可用，不证明 OCR/视觉模型永远准确。

### Token 与耗时

- SSH GLM-5.3-Flash 的 16 图批量：input=25,220、output=762、total=25,982；worker execution 约 24.9 秒、turn 约 16.1 秒。一条提交中处理全部图片，没有逐图 Read。
- SSH 同模型较早的 2 图任务：input=20,468、output=194、total=20,662。它与批量任务是不同 session，不能作为严格成本消融或承诺固定每图价格。
- 本机 Flash 的 16 图任务：input=266,511、output=696、total=267,207，约 51.8 秒。不同宿主已有上下文与配置不同，不能把 SSH 的数字泛化到全部安装。
- 本机普通 GLM-5.3 的 16 图任务仍消耗 input=263,599、output=4,884，却未识别成功。直接附图本身不能保证节省或为模型增加视觉能力。
- Kimi 当前 Server API 返回的会话 input/output 为 0，无法据此核算真实 token；本次不把它解释为零消耗。

没有复跑用户已有的大上下文逐图 Read 任务，因此不声称已实测相对旧任务降低多少百分比。实际标注数据、原有长 session、其它模型和图片尺寸需另测。

## 回归与边界

- 最终全量：656 项，652 passed、4 skipped、0 failed；跳过 Windows startup hook、两项 Windows 进程树子用例，以及 non-Linux 调度分支，均为平台限定。
- 附件专项的前轮 84/84 通过；随后补充两项真实 worker 回归：Manager 接受任务后原图被删除，两种执行器均持久化 failed/attachment_invalid 并释放 worker。
- typecheck、build、validate:plugin 和 clean-entrypoints（6/6）通过。三个自包含 bundle 已重建。
- 覆盖 strict schema、非法/相对/URL/额外字段、MIME 文件头、16 图顺序、无效图片不落盘/派发、丢回执幂等、换图冲突、continue.json 恢复、仅新图续作、删除后 worker 错误持久化、预约 spec 重建与派发保留附件、两端原生字段及不新增图片字节日志。
- 首轮在受限沙箱内两组进程/loopback 测试失败；移到允许 loopback 与进程检查的隔离环境后重新跑过。首次完整回归暴露 ZCode fake runtime 未实现 session/setMode 的测试夹具缺口，补齐后专项与最终全量通过；失败记录保留在私有证据中。
- 预约图片仅验证 schema、持久化和派发传播，没有建立真实未来预约或重复声称已完成定时图片全链路。Windows/macOS 本轮未实测。
- JPEG/GIF/WebP 的类型识别与原生字段走离线回归；真实视觉测试仅使用 PNG。损坏图片只做文件头预检，完整解码和模型/供应商限制由执行器处理。
