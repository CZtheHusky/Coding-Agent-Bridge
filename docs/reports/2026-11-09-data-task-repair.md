# API 模式：数据输出、工具精简与失败诊断修复

> Status: RESEARCH
> Date: 2026-11-09（测试日志使用 UTC 时部分为 2026-11-10）
> Verified against: 7d59bbfc22df4615f736e4169eaa4dae0674037d + ADR-017 working tree
> Scope: Linux 离线回归、隔离 MCP/worker 的真实 ZCode 测试、Kimi 原生 API 能力核对；不代表生产实例已更新。

## 反馈处理结果

| 问题 | 修改与验证 | 保留的边界 |
|---|---|---|
| 固定报告与数据输出冲突 | 普通任务显式选择 `report_mode: "raw"`，不再追加或解析 AgentReport；直接读取 `zcode_output`。失败也保留已捕获回答，截断显式失败。 | 默认仍是 structured；raw completed 只表示执行成功，调用方必须验证数据。预约依赖 `acceptance_met`，因此拒绝 raw。 |
| 快速失败只有通用退出错误 | 历史失败样本的原生证据为 1301 内容安全拒绝，非网络故障证据。现在投影已识别原因及白名单 code/status/retryable 字段，额度耗尽分类优先。 | 未将完整 provider error、headers、未知消息或请求体写入公开结果；未知失败仍可能需要原生日志诊断。本轮未主动制造真实内容安全/额度故障。 |
| 同工作区只有串行 | 工具描述、README、接口及 skill 明确同目录和父子目录互斥；默认 8 worker 只适用于不重叠目录。 | 保留防止并发改写同一工作区的原有互斥。 |
| 高输入 token | 两执行器均可选择 `session_profile: "minimal"`，只用原生工具配置精简，保留默认系统提示；ZCode 另返回可选会话累计请求/错误数。 | 非裸模型 API；仍有原生基础上下文、工作区上下文及会话历史。Kimi 的实际工具面/token 降幅未测。 |
| 已启动服务使用旧代码 | 工具描述及使用说明明确更新文件后重连 MCP 或新建宿主会话。 | 没有加入自动重启，不会中断已有 worker。 |
| 全部历史任务扫描 | 测量后，恢复周期未观察到 queued 时省略无效的第二次 pump 扫描；仍检查历史状态及未验证清理。 | 仍为 O(N)，没有新增索引、历史删除或跨周期缓存。 |

反馈方两个调用脚本已改为优先读取 `result.zcode_output`，兼容回退旧结果。对三条历史记录离线复测，分别解析出 30/30、30/30、10/10 条标签，涵盖 invalid_agent_report、报告后附数组和紧凑数据；未新发模型请求。调用脚本属于仓库外用户项目，本仓库不收录其数据或路径。

## 调用方式

API 模式是 raw + minimal 的组合名称，不新增 mode 字段或 HTTP 接口，仍通过异步任务工具执行。在现有 TaskPackage 中增加：

```json
{
  "report_mode": "raw",
  "session_profile": "minimal"
}
```

Kimi 另外设置 `executor: "kimi"`，其余任务字段和附件用法不变。两个选项彼此独立，续作沿用持久化值。新任务保留默认系统提示，不发送 system_prompt、自定义 agent 或私有模型请求。不相关的 API 请求各建新 task/session，以免无关历史累积。

ZCode minimal 在 create/resume 请求 `toolAllowlist: []`、`mcpServers: []`、`dynamicWorkflowEnabled: false`、`offPeakToolEnabled: false`；新建时另设 `titleGenerationEnabled: false`。Kimi 每次提交前核对已安装服务器的 OpenAPI，并从当前会话工具目录枚举名称，经原生 `disabled_tools` 下发；不支持时在模型 prompt 前失败，不静默回退，也不改全局配置。Kimi 技能目录、基础上下文及晚注册工具不在此处的保证范围。

`runtime_session_usage` 的计数为原生 ZCode 会话截至 `observed_at` 的累计值，可能包括辅助请求；不是逐轮计费统计。未复制原生 session/usage 中具有基线/累计混合语义的 token 字段。不支持时缺省并记录事件，不伪造 0。最终回答先 checkpoint，再请求辅助统计，避免统计失败丢失已完成输出。

## 真实 ZCode 对照

Observed ZCode 3.16.3、GLM-5.3-Flash、max，隔离数据根与合成图片，默认/精简组使用相同两图和任务文字，均为 raw。完整链路为 MCP 提交、独立 worker、原生 app-server、结果 schema 验证及独立答案核对。

| 调用 | 输入 token | 输出 token | 主模型请求 | 数据核对 |
|---|---:|---:|---:|---|
| default，新会话 | 20,119 | 127 | 1 | 通过 |
| minimal，新会话 | 2,536 | 119 | 1 | 通过 |
| minimal，原会话续作 | 3,950 | 55 | 1 | 通过，复用同一 session |

两组首轮输入相差 87.4%，仅为该样本的实测，不是固定节省比例。原生日志显示默认组注册 60 个 MCP 工具，精简组为 0；各次主请求无重试或工具调用。原生会话累计请求数在精简首轮/续作后分别为 1/2，与补充原生证据一致。

最终源码冻结并重建后，另用最终打包产物跑一次新建 minimal/raw 双图任务：completed、数据正确、输入 2,545 token、会话请求数 1、错误数 0、`output_truncated: false`，最终公开结果含 `observed_at`。该次是打包集成检查，不作为替代配对对照。

## Kimi 核对及未运行项

Observed SSH 远端 Kimi 2.4.1：只启动认证 loopback 原生服务器，读取 OpenAPI 和会话工具目录，确认 prompt 的 `disabled_tools` 为字符串数组，并有 26 个具名工具。自行创建的空探针会话已归档，探针服务器已退出，未提交模型 prompt。

离线协议测试覆盖 raw 原文、禁用当前工具、默认不覆盖、续作重新枚举、无系统提示/自定义 agent 字段、不支持版本在提交前失败，以及正常完成/故障/清理规则。原生 API 依据为 [Kimi Server API](https://github.com/MoonshotAI/kimi-code/blob/main/docs/en/reference/server-api.md)，最终以实际安装版本的 schema 为准。

用户已确认 Kimi 额度尚未恢复，遵守既有停止约定：Kimi 真实模型执行、实际预填工具面和 token 降幅均 **NOT RUN**，不以 API 能力检查或 fixture 结果替代模型实测。未调整官方系统提示，也未通过修改默认 agent 绕过该限制。

## 历史扫描测量

Linux 本机临时目录、无模型请求，合成已完成任务的空队列恢复，每组重复三次：

| 历史任务数 | 修改前状态读取次数/轮 | 修改后状态读取次数/轮 | 修改前耗时范围 | 修改后耗时范围 |
|---|---:|---:|---:|---:|
| 100 | 200 | 100 | 4.91–7.51 ms | 2.61–4.69 ms |
| 1,000 | 2,000 | 1,000 | 44.35–50.61 ms | 23.42–30.07 ms |
| 10,000 | 20,000 | 10,000 | 437.24–501.12 ms | 214.27–265.82 ms |

测试同时验证下一次恢复仍能发现另一个宿主遗留的 queued 任务。以上是本机合成数据，不代表远端磁盘、忙队列或其它硬件的时延保证。

## 最终回归

冻结源码在 Linux / Node 22.22.2 上：

- `npm run typecheck`：通过。
- `npm test`：668 项，664 通过、0 失败、4 跳过。跳过为 Windows startup hook、两项 Windows 真实进程树语义、non-Linux 调度行为；未计为通过。
- `npm run test:clean-entrypoints`：6/6，通过。
- `npm run build`、`npm run validate:plugin`：通过，三份受版本管理的入口 bundle 已同步。
- `git diff --check`：同步回主仓库后通过；主仓库的 typecheck/build/validate:plugin 亦通过。

新增回归覆盖 raw 不伪造报告/验收、错误/未知终态/超时/取消/截断不得完成、清理失败优先、checkpoint 截断恢复、先落盘后取统计、错误脱敏/额度优先、调度拒绝 raw、共享 core 参数验证及扫描优化。首次受限沙箱中的部分原生进程/loopback 测试未能运行，改在允许这些本机操作的隔离测试环境完整执行后取得上述结果；不将原失败计为通过。

## 提交与安装后核对

功能提交 998670c 已推送，随后完成两端四入口安装和八次真实 ZCode 执行，详见[安装验收](2026-11-09-api-mode-deployment.md)。用户确认 Kimi 额度尚未恢复，真实模型/token 验证继续保留 NOT RUN。
