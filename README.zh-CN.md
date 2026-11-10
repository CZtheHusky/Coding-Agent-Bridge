# Coding Agent Bridge

> Status: AUTHORITATIVE
> Last verified: 2026-11-10，Kimi API 模式、真实工具面/用量及四安装入口补测；OCR 两次失败与平台边界见实测报告。
> Prior verification: 2026-11-09，仅本次 ADR-018 接口与实现核对；回归和安装范围见本轮诊断报告。
> Last updated: 2026-11-10
> Prior verification: 2026-11-09，仅 API 模式参数、示例和系统提示/工具边界；实测及未运行范围见本轮数据任务修复报告，其余沿用历史记录。
> Verified against: 1878b33734b27070da14cd283b7a9e89acd94cae
> Prior verification: 2026-11-09，仅本次图片参数、示例、模型模态和 Linux 附图范围；其余内容未重新核对。
> Prior verified against: 7c1d6f2 + ADR-016 working tree；证据见附图实测记录。

**Coding Agent Bridge** 支持本机 ZCode / Kimi 后台编码任务。MCP server key 为 `coding_agent_bridge`，工具统一为 `coding_agent_*`。可选模型、查询进度、续作、处理审批和取消；ZCode 档位由 `coding_agent_model_catalog` 查询后传 `model.reasoning_level`，Kimi 支持 `kimi.model` 与可选 `kimi.reasoning_level`（原生 thinking；K3/K3.1 Pro 和标准模型当前支持 low/high/max，具体依模型而定）；省略时保留原生设置。环境支持时可一次预约并唤醒原 Codex 聊天验收，普通任务不会主动唤醒。升级后刷新工具列表，旧 `zcode_*` 名称不再注册；安装标识、路径、环境变量和任务数据名称保留。

Codex 插件与本地 MCP 服务，用于把明确授权的开发任务交给本机 ZCode Agent 执行。Codex 可查看进度、选择模型、审查改动并决定是否接收。

## 图片附件

`coding_agent_task` 支持 `attachments`，图片随同一条原生消息按数组顺序发送，不必逐张调用 Read。使用 **Bridge 所在机器**的可读绝对路径：SSH 任务需要远端路径，桌面本机路径不能直接传给远端。支持 PNG/JPEG/GIF/WebP 内容，不支持 URL 或内联 base64。

[GLM-5.3 普通版仅支持文本](https://docs.bigmodel.cn/cn/guide/models/text/glm-5.3)，不具备原生多模态能力；Bridge 传图不会为模型增加视觉能力。[GLM-5.3-Flash/FlashX 是原生多模态模型](https://docs.bigmodel.cn/cn/guide/models/vlm/glm-5.3-flash)。本轮实际验证了 GLM-5.3-Flash 与 Kimi 的原生附图、补图和同会话续作，未实测 FlashX；没有自动更换默认模型。

先通过 `coding_agent_model_catalog` 查询 ZCode 的视觉模型并为下例补上相应 `model`；使用 Kimi 时增加 `"executor": "kimi"`。提交 `coding_agent_task`：

```json
{
  "task_id": "image-review-001",
  "workspace": "/absolute/project",
  "objective": "Read the attached images in order and report the differences.",
  "requirements": [],
  "allowed_paths": [],
  "forbidden_paths": [],
  "acceptance_criteria": ["Describe every image accurately"],
  "test_commands": [],
  "attachments": [
    { "path": "/absolute/images/01.png" },
    { "path": "/absolute/images/02.png" }
  ]
}
```

本次执行结束后，可通过 `coding_agent_continue` 只追加新图片：

```json
{
  "task_id": "image-review-001",
  "operation_id": "add-image-03",
  "feedback": "Compare this new image with the earlier two.",
  "attachments": [{ "path": "/absolute/images/03.png" }]
}
```

续作保留原执行器和 session，先前图片保留在会话历史中，不要重复附上。重试同一请求应保持相同 task_id / operation_id、路径及数组顺序。预约使用 `coding_agent_schedule.task.attachments`；Bridge 只保存路径，不复制图像，原文件须保留到执行时。

无效输入返回 `TASK_INVALID` / `SCHEDULE_INVALID`，执行前文件失效返回 `attachment_invalid`，不能把丢图当作成功。模型和供应商自身的图片限制仍适用；识别正确率和 token 降幅需要实际验收。升级后刷新或重连 MCP，加载新增参数及技能说明。详见[接口合同](docs/INTERFACES.md#图片附件adr-016)与[实测记录](docs/reports/2026-11-09-native-image-attachments.md)。

技能名为 `coding-agent-bridge`；主文件仅保留日常委派与关键边界，预约、交互和执行器细节按需读取参考文件。

## API 模式

分类、抽取、标注等只需要模型回答时，在现有 TaskPackage 中设置：

```json
{
  "report_mode": "raw",
  "session_profile": "minimal"
}
```

API 模式是上述两个选项的组合名称，没有新增 `mode` 参数或 HTTP 接口，仍通过 Bridge 的异步任务工具执行。Kimi 增加 `"executor": "kimi"`，省略则使用 ZCode。完整文字任务示例：

```json
{
  "task_id": "api-classify-001",
  "executor": "kimi",
  "workspace": "/absolute/project",
  "report_mode": "raw",
  "session_profile": "minimal",
  "objective": "Classify apple and carrot as fruit or vegetable. Return only a JSON array of two category strings in input order.",
  "requirements": [],
  "allowed_paths": [],
  "forbidden_paths": [],
  "acceptance_criteria": ["Valid JSON array with two correct categories in order"],
  "test_commands": []
}
```

所需文字直接放进任务，图片通过 `attachments` 附上；不能要求精简会话依赖读文件、终端、浏览器等已禁用工具。需要这些工具时保留 `session_profile: "default"`。两个选项也可单独使用；普通编码任务缺省仍为 structured/default。

终态从 `coding_agent_result.zcode_output` 读取原文，独立验证 JSON、字段、顺序和条目数；不要从事件摘要拼数据。`completed` 只表示执行结束，`output_truncated: true` 表示捕获不完整，raw 会显式失败。预约任务依赖 `acceptance_met`，不支持 raw。续作保留原模式和 session；不相关的 API 请求各建新任务，避免历史累积。

**两个执行器均保留原生默认系统提示**，不改全局配置。ZCode 使用原生工具/MCP/workflow 开关；Kimi 用原生 `disabled_tools` 禁用当前注册工具，并追加 `mcp__*` 和 `ReadMediaFile` 覆盖异步注册，每次续作重新枚举，不支持的 API 版本在模型请求前报 `session_profile_unsupported`，不会静默回退。原生技能目录、工作区说明及基础上下文仍可能存在，工具精简不等于 OS 沙箱。

ZCode 3.16.3 / GLM-5.3-Flash 双图对照输入为 20,119 → 2,536 token，本样本减少 87.4%，答案及同 session 续作通过；不承诺固定降幅。Kimi 双图样本总预填（含缓存读取）本机 65,211 → 3,111、远端 14,056 → 3,332，分别减少约 95.2% / 76.3%；四入口实际工具数均为 0。远端两次 OCR 字符识别失败已保留，不能据此保证精简无损。Kimi usage 是会话累计，input_tokens 为非缓存输入，cached_input_tokens 为缓存读取，不能只比较前者。详见[Kimi 实测](docs/reports/2026-11-10-kimi-api-live-validation.md)。`runtime_session_usage` 是 ZCode 会话累计请求/错误计数，不是逐轮计费。

同目录及父子目录任务串行，8 worker 仅适用于不重叠目录。更新后重连 MCP 或开启新宿主会话；正在运行的服务不会热加载新参数。详见[接口合同](docs/INTERFACES.md#数据任务与精简会话adr-017)与[测试报告](docs/reports/2026-11-09-data-task-repair.md)。

失败结果的 `provider_error` 提供脱敏后的原生错误码、HTTP 状态和重试提示等实际证据；未知字段缺省。顶层 `error_code` 仍决定额度耗尽和清理阻塞，不因 retryable=true 自动重试。提交/续作回执及 doctor 的 `bridge` 显示运行版本与构建指纹；`disk_status: "changed"` 表示执行文件已变化，需重连，unknown 表示未能确认。首次升级前的旧进程仍须手动重连。详见 [ADR-018](docs/decisions/ADR-018-result-diagnostics-and-running-build.md)。

## 功能

- 在 Codex 中派发、跟踪、续作和取消 ZCode 任务。
- 支持多个项目任务并行；共享执行目录的任务会排队。
- 按任务指定 ZCode provider/model；也可配置用户默认模型。
- 运行开始时报告项目目录、实际执行目录、ZCode session、runtime 报告的模型和执行模式。
- ZCode Desktop 任务按 Codex 项目目录归类；索引同步失败不会中断任务。

## 安装

需要 Node.js 22.18+、Git、已安装并登录的 ZCode，以及支持插件 marketplace 的 Codex 或 Claude Code。Windows 和 Linux 已有记录范围内的真实执行测试；本次 Linux 原生附图实测见上方报告，macOS 尚未验证。

### Codex CLI 安装

添加 GitHub marketplace 并安装插件：

```sh
codex plugin marketplace add https://github.com/Sandyzzx/codex-zcode-bridge.git --ref master
codex plugin add codex-zcode-bridge@codex-zcode-bridge
```

### Claude Code CLI 安装

添加同一个 GitHub marketplace 并安装插件：

```sh
claude plugin marketplace add https://github.com/Sandyzzx/codex-zcode-bridge.git
claude plugin install codex-zcode-bridge@codex-zcode-bridge
```

### Codex 桌面应用安装

先运行上面的第一条 CLI 命令注册 GitHub marketplace；然后在 Codex 的 **Plugins Directory** 中选择该 marketplace，安装 **Coding Agent Bridge**。

### 首次启动

安装后开启新对话，并检查、信任插件的 `SessionStart` hook。Windows 上 hook 会自动发现并验证 Node.js、ZCode runtime、provider 配置和数据目录，将设置保存到 `%USERPROFILE%\.codex\codex-zcode-bridge\runtime-config.json`。它不会写入 Windows 用户环境变量或复制 provider 凭据。标准安装不需要克隆仓库或运行 `npm install`；Marketplace 不会代为安装 Node.js 或 ZCode。

如需自定义设置，直接编辑 `%USERPROFILE%\.codex\codex-zcode-bridge\runtime-config.json`。在 macOS/Linux 上对应 `~/.codex/codex-zcode-bridge/runtime-config.json`。Windows 首次启动时 hook 会创建该文件；其他平台如文件不存在，可自行创建。保留自动发现的路径字段，只修改需要覆盖的值：

- `ZCODE_BRIDGE_NODE`：Node.js 可执行文件的绝对路径（仅当 `node` 不在 PATH 中时需要）。
- `ZCODE_BRIDGE_ZCODE_CJS`：ZCode runtime 的绝对路径。
- `ZCODE_BUILTIN_PROVIDER_CONFIG_FILE` 与 `ZCODE_PERSONAL_PROVIDER_CONFIG_FILE`：builtin 和个人 provider 配置文件的绝对路径。
- `ZCODE_HOME`：实际 `.zcode` 数据目录的绝对路径。
- `ZCODE_BRIDGE_DATA_DIR`：Bridge 任务数据目录的绝对路径。
- `ZCODE_BRIDGE_DEFAULT_PROVIDER_ID` 与 `ZCODE_BRIDGE_DEFAULT_MODEL_ID`：默认 provider 和 model ID，必须成对填写。
- `ZCODE_BRIDGE_MODE`：初始执行模式，可设为 `plan`、`build`、`edit` 或 `yolo`，默认 `yolo`。`yolo` 会放行普通工具操作并使用当前操作系统账户权限；如需 ZCode 的审批规则，可设为 `build`。
- `ZCODE_BRIDGE_MAX_CONCURRENT_WORKERS`：同一数据目录内的调度并行上限，范围 1–8，默认 8；多个 Bridge 进程应使用一致设置，重叠执行路径串行。
- `ZCODE_BRIDGE_BROWSER_USE`：可选 headless 浏览器宿主，默认 `off`；设为 `headless` 后 worker 以 managed CDP 后端响应 ZCode 原生浏览器工具的 `interaction/browserList`/`interaction/browserExecute` 反向 RPC，使用独立临时 profile 启动已安装的系统 Chromium/Edge（不下载浏览器，也不连接用户已有窗口）。可选 `ZCODE_BRIDGE_BROWSER_EXECUTABLE` 指定绝对路径。该宿主上的原生浏览器模型链路已在记录的 Windows/ZCode 版本上验证，范围与限制见 `docs/reports/2026-10-15-browser-and-transport-fixes.md`。
- `ZCODE_BRIDGE_TIMEOUT_MS`：未在任务中指定 `timeout_ms` 时使用的单次执行时限，单位毫秒，范围 60,000–14,400,000；默认 3,600,000（60 分钟）。

`coding_agent_task` 调用超时或回执丢失时，使用原 `task_id` 查询或重试；相同内容会重放原回执，不同内容会被拒绝。可重试的 `coding_agent_continue` 调用应传入稳定的 `operation_id`，避免回执丢失后重复增加 attempt。

保存为有效 JSON 后，新启动的 Bridge 会读取配置文件；它优先于旧环境变量设置。`ZCODE_HOME` 应指向 `.zcode` 目录，个人 provider 配置文件需位于该目录下的 `v2/provider_config.json`。Provider/model ID 请从 ZCode 配置中复制，不要改写 ZCode 的 provider 文件。

Codex 的 marketplace 安装说明见[OpenAI 官方插件文档](https://developers.openai.com/plugins/build/plugins)。

## 使用

描述要完成的开发任务，并说明验收条件。Codex 会按需要准备 worktree，再将任务交给 ZCode；如指定 worktree，任务在该目录执行，否则直接在项目目录执行。ZCode 不会自动获得 Codex 的完整对话，因此需要的项目决定和约束应由 Codex 随任务提供。

ZCode session 标题根据首条任务 prompt 生成。Bridge 会将 `TASK ID` 放在 prompt 首行，但标题可能还包含后续 prompt 文本。

任务完成后，Codex 应检查实际 diff 并独立运行验收。`completed` 只表示 ZCode 已报告执行结束，不代表改动已通过 Codex 审查。若任务遇到未解决且会影响重要行为的决定，ZCode 会请求 Codex 指示后再继续。

ZCode Desktop 的 Workspace 视图按 Codex 项目目录查找任务。

遇到安装或启动问题时，调用 MCP 工具 `coding_agent_doctor` 获取只读诊断。它不会启动 ZCode 会话，也不做真实权限审批；审批链路只能由实际任务验证（记录版本上已完成单次 43,014-byte Write 的真实审批往返实测）。

## 已知问题

- ZCode Desktop 侧栏可能不会立即刷新并显示新会话。Bridge 会尽力同步本机任务索引，列表刷新时机由 Desktop 决定。
- 目前无法通过 Bridge 使用 ZCode Start Plan。
- worker 有 10 秒冷启动宽限期；未起步的 worker 最多重拉一次，已抢占执行权的 attempt 不重复执行。同一数据目录内跨进程调度互斥；不同数据目录之间不共享锁，应避免提交重叠目录的任务。
- 运行时清理未验证的任务保留目录占用并拒绝续跑，可再次调用 `coding_agent_cancel` 验证清理后释放。损坏任务记录会报告诊断并保留可确定的目录占用；执行范围无法确定时暂停新调度。

## 安全与限制

- 默认执行模式为 `yolo`。它会放行普通工具操作，并以当前操作系统账户权限运行；worktree 不是沙箱。如需 ZCode 的审批规则，将配置文件中的 `ZCODE_BRIDGE_MODE` 设为 `build`。真实权限审批往返已在记录的 Windows/ZCode 版本实测（单次 43,014-byte Write 走完整持久化与回复链路，文件字节/SHA256 与批准内容一致）；其他审批组合未据此认证。审批记录的完整性哈希用于发现损坏与意外改动，不是对同 OS 账户恶意篡改的安全隔离。
- Git worktree 只隔离工作目录，不是操作系统沙箱；`allowed_paths` 和 `forbidden_paths` 是任务约束说明，不能阻止进程访问其他文件或执行命令。
- 是否创建 worktree 由 Codex 根据任务决定；Bridge 使用传入的项目目录和可选 worktree 路径，不替用户创建或删除 worktree。
- 并行任务会增加本机资源占用和 provider 并发使用。
- Bridge 将 prompt、状态、日志、可见模型输出、事件和结果保存在本机 `~/.codex/codex-zcode-bridge/`（Windows 为 `%USERPROFILE%\.codex\codex-zcode-bridge\`）；等待审批时还会保存必要的工具输入。请勿在任务或工作区中放入不应发送给所选模型服务或持久化到本机的数据。
- Bridge 使用本机 ZCode app-server；交互请求是否出现及协议字段受已安装的 ZCode 版本影响。Bridge 会通过 `interaction_requested` 事件将权限或用户输入请求交给 Codex，再用 `coding_agent_interaction_reply` 回答。超过单事件行上限的大请求以显式标记的预览发布，并附私有完整记录的 `full_request` 引用（路径、字节数、SHA256，按 `JSON.stringify(params)` 紧凑序列化计量）；预览不是全文，需要全文时读引用记录。AskUserQuestion 的 `answers` 以每个问题的完整 `question` 文本为键、答案为值，不能用表头或选项标签作键。权限请求只应在用户明确授权后放行。

## 源码构建

共享核心与其他宿主的接入方式见 [SHARED_CORE.md](docs/SHARED_CORE.md)，当前架构及契约见 [ARCHITECTURE.md](docs/ARCHITECTURE.md) 和 [INTERFACES.md](docs/INTERFACES.md)。`npm test` 使用临时用户目录和假运行时，包含 60 秒真实 worker 超时回归；不会调用真实模型或写入真实 Desktop 数据库。任务 prompt 超限会明确拒绝，不截掉安全约束；存在但损坏的运行配置也会明确报错。实验 `coding_agent_progress_probe` 默认不注册。

仓库保留 TypeScript 源码供审查和自行构建。需要 Node.js 22.18+，运行：

```sh
npm ci
npm run build
```

## 致谢与许可证

进程管理部分参考并改编自 [cc-plugin-codex](https://github.com/hex1n/cc-plugin-codex)；ZCode Desktop 任务索引部分参考并改编自 [zcode-acp](https://github.com/william0wang/zcode-acp)。感谢 [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk)、[Zod](https://github.com/colinhacks/zod) 和 ZCode 项目。来源与版权说明见 [NOTICE](NOTICE)。

本项目采用 [Apache License 2.0](LICENSE)。第三方组件仍受其各自许可证约束。



## Kimi 执行器

现有 `coding_agent_task` 增加 `executor: "kimi"`；省略仍为 ZCode。`kimi.model` 是 Kimi 本地模型别名；`kimi.permission_mode` 可为 manual/yolo/auto，默认 yolo。查询、事件、结果、续作、交互回复、取消和预约工具复用现有 coding_agent_* 名称。续作复用原 Kimi session，不可更换执行器。ZCode doctor/模型目录/默认模型工具仍只适用于 ZCode。

需要已登录的 Kimi Code CLI 2.3.3（Node >=22.19）。可通过 `KIMI_BRIDGE_EXECUTABLE` 指定命令或 CLI JavaScript 入口，`KIMI_CODE_HOME` 指定配置与会话目录。完整示例与限制见 [English README](README.md#kimi-code-support)、[ADR-012](docs/decisions/ADR-012-kimi-executor.md) 与[验证报告](docs/reports/2026-10-28-kimi-validation.md)。
