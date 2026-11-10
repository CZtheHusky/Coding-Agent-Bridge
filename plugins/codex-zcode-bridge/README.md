# Coding Agent Bridge

> Status: AUTHORITATIVE
> Last verified: 2026-11-10，Kimi API 模式、真实工具面/用量及四安装入口补测；OCR 两次失败与平台边界见实测报告。
> Prior verification: 2026-11-09，仅本次 ADR-018 接口与实现核对；回归和安装范围见本轮诊断报告。
> Last updated: 2026-11-10
> Prior verification: 2026-11-09，仅 API 模式参数、示例和系统提示/工具边界；实测及未运行范围见本轮数据任务修复报告，其余沿用历史记录。
> Verified against: 1878b33734b27070da14cd283b7a9e89acd94cae
> Prior verification: 2026-11-09，仅图片参数、续作示例与模型模态；其余沿用原说明。
> Prior verified against: 7c1d6f2 + ADR-016 working tree。

**Coding Agent Bridge** 支持本机 ZCode / Kimi 后台编码任务。MCP server key 为 `coding_agent_bridge`，工具统一为 `coding_agent_*`。可选模型、查询进度、续作、处理审批和取消；ZCode 档位由 `coding_agent_model_catalog` 查询后传 `model.reasoning_level`，Kimi 支持 `kimi.model` 与可选 `kimi.reasoning_level`（原生 thinking；K3/K3.1 Pro 和标准模型当前支持 low/high/max，具体依模型而定）；省略时保留原生设置。环境支持时可一次预约并唤醒原 Codex 聊天验收，普通任务不会主动唤醒。升级后刷新工具列表，旧 `zcode_*` 名称不再注册；安装标识、路径、环境变量和任务数据名称保留。

把开发任务从 Codex 交给本机 ZCode 或 Kimi Agent，在 Codex 中跟进进度并审查实际改动。

## 使用前

需要 Node.js 22.18+、Git、已安装并登录所选执行器（ZCode 或 Kimi），以及支持插件 marketplace 的 Codex 或 Claude Code。

添加本项目 GitHub marketplace 并安装 **Coding Agent Bridge**：在 Codex 桌面应用中先用 CLI 注册 marketplace，再到 **Plugins Directory** 选择并安装；CLI 用户可直接按下方命令安装。之后开启新对话并检查、信任插件的 `SessionStart` hook。Windows 上 hook 会检查本机环境并报告配置问题。Marketplace 安装无需克隆源码或运行 `npm install`；Node.js 和所选执行器需另行安装。

Codex CLI 安装示例：

```sh
codex plugin marketplace add https://github.com/Sandyzzx/codex-zcode-bridge.git --ref master
codex plugin add codex-zcode-bridge@codex-zcode-bridge
```

Claude Code CLI 安装示例：

```sh
claude plugin marketplace add https://github.com/Sandyzzx/codex-zcode-bridge.git
claude plugin install codex-zcode-bridge@codex-zcode-bridge
```

## 派发任务

向 Codex 描述开发任务和验收条件。Codex 根据任务决定是否准备 worktree，并把任务交给所选执行器。未提供 worktree 时在项目目录执行；提供时在该 worktree 执行。完成后由 Codex 检查 diff 和验收结果。`completed` 不等于 Codex 已接受改动。

遇到安装或启动问题时，ZCode 可调用 MCP 工具 `coding_agent_doctor` 查看只读诊断；它不会启动 ZCode session。

可按任务选择 provider/model，也可配置用户默认模型。执行模式默认是 `yolo`，它会放行普通工具操作并使用当前操作系统账户权限。需要审批时，将 `ZCODE_BRIDGE_MODE` 设为 `build`；记录版本上已完成单次 43,014-byte Write 的真实审批往返实测。超过单事件行上限的大审批请求会以显式标记的预览事件交付，并附私有完整记录的 `full_request` 引用（路径、字节数、SHA256，按 `JSON.stringify(params)` 紧凑序列化计量）；预览不是全文，批准前需要全文时读引用记录。审批 params 完整保存上限为 1 MiB，超过时会收到含 actual/limit 与拆分建议的明确拒绝。worktree 不是沙箱。

可选浏览器宿主（ADR-007）：`ZCODE_BRIDGE_BROWSER_USE` 默认 `off`；设为 `headless` 后，任务内 ZCode 原生浏览器工具经 `interaction/browserList`/`interaction/browserExecute` 反向 RPC 使用 worker 托管的 headless Chromium/Edge（独立临时 profile，不下载浏览器、不连接用户窗口）。可选 `ZCODE_BRIDGE_BROWSER_EXECUTABLE` 指定系统浏览器绝对路径。插件包内 `worker/vendor/` 自带所需运行资源，不依赖 Codex 的 node_modules。真实模型链路验收与边界见 仓库中的 `../../docs/reports/2026-10-15-browser-and-transport-fixes.md`。

## 图片附件

在 `coding_agent_task` 中传 `attachments: [{ "path": "/absolute/images/01.png" }]`，ZCode/Kimi 会随首条消息收到原生图片，顺序同数组。使用 Bridge 所在机器的可读绝对路径；SSH 必须用远端路径。支持 PNG/JPEG/GIF/WebP 内容，不接收 URL 或内联 base64。

[GLM-5.3 普通版仅支持文本](https://docs.bigmodel.cn/cn/guide/models/text/glm-5.3)，不具备原生多模态能力；Bridge 传图不会为模型增加视觉能力。[GLM-5.3-Flash/FlashX 是原生多模态模型](https://docs.bigmodel.cn/cn/guide/models/vlm/glm-5.3-flash)。本轮实际验证了 GLM-5.3-Flash 与 Kimi 的原生附图、补图和同会话续作，未实测 FlashX；没有自动更换默认模型。

执行结束后可用 `coding_agent_continue` 补图：

```json
{
  "task_id": "image-review-001",
  "operation_id": "add-image-03",
  "feedback": "Compare this new image with the earlier two.",
  "attachments": [{ "path": "/absolute/images/03.png" }]
}
```

只附本轮新图，复用原 task_id、执行器和 session；重试保留原 operation_id、路径和顺序。预约使用 `task.attachments`，原图保留到执行时，Bridge 不保存快照。无效请求返回 TASK_INVALID / SCHEDULE_INVALID，执行时丢图返回 attachment_invalid；模型限制、识别正确率和 token 消耗需另行验收。

升级后刷新或重连 MCP，以加载新增参数与技能说明。完整提交示例与验证范围见仓库中的 `README.zh-CN.md`「图片附件」及 `docs/reports/2026-11-09-native-image-attachments.md`。

技能名为 `coding-agent-bridge`，入口文件位于 `skills/coding-agent-bridge/SKILL.md`。详细规则在同目录 references 中，按需读取。升级后重连 MCP 或开启新宿主会话以刷新技能。

失败结果可带脱敏的 `provider_error`；仍以顶层 error_code 处理额度和清理阻塞，不据 retryable 自动重试。回执/doctor 的 `bridge` 显示版本和构建观察；disk_status=changed 提示重连，unknown 表示无法确认，不自动重启。首次升级前的旧进程仍需手动重连。

## API 模式

分类、抽取或标注任务可在现有任务中设置：

```json
{
  "report_mode": "raw",
  "session_profile": "minimal"
}
```

这是两个现有选项的组合名称，不是新增 HTTP 接口或 `mode` 参数。Kimi 另传 `"executor": "kimi"`，省略则为 ZCode。仍需通常的 TaskPackage 字段；文字和图片应随任务传入，精简会话无法依赖读文件、终端等禁用工具，需要工具时保留 default profile。

两个执行器均保留默认系统提示，不改全局配置。ZCode 精简工具、MCP、workflow 和新会话标题；Kimi 通过原生 disabled_tools 禁用当前注册工具，并追加 `mcp__*` 与 `ReadMediaFile` 覆盖异步 MCP/图片工具注册，不支持时在模型 prompt 前明确失败。原生基础上下文和技能目录仍可能存在，不承诺裸模型开销。

读取 `coding_agent_result.zcode_output` 并独立验收数据，不从事件摘要拼接。raw 完成不等于数据正确，输出截断会失败；预约不支持 raw。续作沿用模式，不相关请求各建新任务。同目录及父子目录串行；更新后须重连 MCP 或开启新宿主会话。

ZCode 双图实测输入 20,119 → 2,536 token（本样本减少 87.4%），Kimi 双图总预填（含缓存读取）本机 65,211 → 3,111、远端 14,056 → 3,332，四入口实际工具数均为 0；另有两次远端 OCR 数据失败，不能承诺准确率不变。Kimi usage 为会话累计，非缓存输入与缓存读取分列。完整示例、验证及边界见源码仓库 `README.zh-CN.md`「API 模式」和 `docs/reports/2026-11-09-data-task-repair.md`，Kimi 实测及边界见 `docs/reports/2026-11-10-kimi-api-live-validation.md`。

## 安全边界

ZCode 以当前操作系统用户权限运行。Git worktree 不是 OS 沙箱；`allowed_paths` 和 `forbidden_paths` 是任务指令，不能强制限制文件或命令访问。任务 prompt、日志、可见模型输出和结果会保存在本机 `.codex/codex-zcode-bridge/` 目录。派发前请检查任务可见的工作区内容。

Marketplace 用户配置自定义 ZCode 路径或默认模型的说明见[中文安装指南](https://github.com/Sandyzzx/codex-zcode-bridge/blob/master/README.zh-CN.md#安装)。
