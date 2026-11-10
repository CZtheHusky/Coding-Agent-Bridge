# ADR-019：Kimi 晚注册工具与真实用量

> Status: DECISION
> Date: 2026-11-10
> Decision: Accepted，修复额度恢复后真实测试发现的问题
> Baseline: a665ea2

## 证据

Kimi 2.3.3 在初始 /tools 枚举后才加载 MCP 工具及图片触发的 ReadMediaFile。仅枚举名称的 minimal 首轮仍向模型传入 208 个工具，续作 207 个；默认对照为 234 个。GET session 的 usage 是空索引占位值，真实 wire 及 turn.step.completed 有非零用量，不能将该 0 当作实际消耗。

## 决策

1. minimal 每次 prompt 继续枚举工具，并追加原生 MCP 名称模式 `mcp__*` 与已观察到的晚注册内置工具 `ReadMediaFile`。模式由原生会话 tool policy 执行，覆盖异步 MCP 注册；不等 MCP 连接稳定，不增加轮询、重试或全局配置修改。仍检查 OpenAPI；默认 profile 不受影响。未知未来内置工具须重新验证，不承诺所有未来版本。
2. 完成后从原生 snapshot.session.usage 读取会话累计用量，不能使用 GET session 的索引占位值。保留原生 input_tokens/output_tokens，cache_read_tokens 映射为 cached_input_tokens；前者是未命中缓存的输入，缓存读取单列，不相加伪装成原生报告值。不从日志驱动任务状态，不替换默认系统提示。
3. 验证必须检查实际原生 llm.tools_snapshot，不能仅用“无工具调用”证明工具面已精简。默认/精简对照分别记录非缓存输入、缓存读取及总预填（诊断时按原生分项求和），不把缓存命中差异写成上下文降幅。

## 验收

离线模拟 prompt 接受时才注册的 MCP 和图像工具、同 session 续作、默认兼容及索引 0 / snapshot 非零差异。实测两个环境四入口的原生附图、补图记忆、raw JSON、实际工具面和进程清理；真实对照只对已观察版本、模型和样本成立。
