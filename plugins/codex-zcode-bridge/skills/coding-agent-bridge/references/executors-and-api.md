# 执行器、图片与 API 模式

> Status: AUTHORITATIVE
> Last updated: 2026-11-10
> Last verified: 2026-11-10，仅核对 ADR-019 的 Kimi 晚注册工具和原生用量语义；实际安装范围见本轮测试记录。
> Prior verification: 2026-11-09，ADR-012/014/016/017 参数及未验证边界。
> Verified against: a665ea2 + ADR-019 working tree
> Prior verified against: 998670c

## 模型与执行

ZCode 从 `coding_agent_model_catalog` 复制 provider_id、model_id 及所选模型的 `reasoning_levels[].value`；不要猜档位。用户未指定时省略 model，沿用已配置默认。模型预检失败时依据 runtime 的 model_catalog 事件诊断，不猜 provider ID。`coding_agent_doctor` 和默认模型工具仅适用于 ZCode；unknown 不算通过。

Kimi 设 `executor: "kimi"`，可传 `kimi: { model, reasoning_level, permission_mode }`。model 是本地别名；省略使用会话或原生默认。reasoning_level 透传 thinking，支持值由模型决定；目录中没有 Kimi 模型查询工具。permission_mode 接受 manual/yolo/auto，默认 yolo。不要同时传 ZCode 的 model。需要已安装登录的 Kimi；自定义入口使用 KIMI_BRIDGE_EXECUTABLE，配置目录使用 KIMI_CODE_HOME。

两执行器复用同一套 status/events/feedback/result/continue/cancel/interaction_reply 工具。兼容字段 zcode_session_id、zcode_pid、zcode_output 在 Kimi 任务中承载 Kimi 证据。请求值不是运行确认值，不能用默认档位冒充实际值。

单次执行默认 60 分钟，timeout_ms 可设 60 秒至 4 小时；超时终止该次进程树，保留 attempt。默认最多 8 个 worker，仅非重叠目录可并行；多个宿主共享数据根时不要并行提交冲突任务。

## 原生附图

task 的 `attachments: [{ path: "/absolute/image.png" }]` 随原生消息按顺序发送。路径必须属于 Bridge 所在机器；SSH 需要远端路径。支持 PNG/JPEG/GIF/WebP，不接收 URL/base64。不要仅给图片路径并要求逐张 Read。

ZCode 必须选择有视觉能力的模型；GLM-5.3 普通版仅文本，Flash/FlashX 支持原生多模态。目录字段不能保证所有视觉能力，已验证范围以项目记录为准；不默默更换用户默认模型。

continue.attachments 只传本轮新图，复用原会话；请求重试保留 task_id/operation_id、路径及顺序。预约使用 task.attachments，原文件保留到执行时，Bridge 不保存图像快照。TASK_INVALID/SCHEDULE_INVALID/attachment_invalid 应检查文件，不能丢图后当作成功。

## API 模式的具体边界

API 模式是 raw + minimal 的组合名称，沿用异步任务工具，没有 mode 参数或独立 HTTP 接口。两选项可单独使用；普通编码缺省仍是 structured/default。续作沿用持久化模式，不相关请求用新 task/session。

raw 不要求 AgentReport；`zcode_output` 是捕获原文，`output_truncated` 标记截断，截断时 raw 失败。completed 只表示原生成功及清理验证，不证明数据正确，也不生成 acceptance_met。调用方验证 JSON、字段、顺序和数量。预约依赖 acceptance_met，因此拒绝 raw。

ZCode minimal 用原生空工具白名单、空 MCP 列表、关闭动态 workflow/off-peak 工具；新会话关闭标题生成。Kimi 在每次提交前核对安装版本的 OpenAPI，从会话工具目录枚举名称，并追加原生 `mcp__*` 模式与 `ReadMediaFile`，经原生 disabled_tools 禁用（包括异步注册的 MCP 和图片工具）；不支持时在模型请求前返回 session_profile_unsupported，不静默回退或改全局配置。Kimi 原生技能目录、基础上下文及未知未来内置工具仍由 runtime 决定。

两个执行器都保留默认系统提示，不发送自定义 agent/system_prompt 或私有模型请求。工作区说明、技能及历史仍可能增加输入上下文。ZCode 的 runtime_session_usage 是 observed_at 时的会话累计请求/错误数，不能当逐轮计费；普通 usage 缺失时写未报告，不填 0 或估算。Kimi 的 usage 是原生 snapshot 的会话累计：input_tokens 为非缓存输入，cached_input_tokens 为缓存读取，分别报告；不要仅比较非缓存输入就宣称上下文减少。主会话 token 只有宿主实际提供时才能报告。

功能实测与安装边界见仓库 docs/reports/2026-11-09-data-task-repair.md 及 2026-11-09-api-mode-deployment.md；这些记录不构成其他版本或额度恢复后的认证。
