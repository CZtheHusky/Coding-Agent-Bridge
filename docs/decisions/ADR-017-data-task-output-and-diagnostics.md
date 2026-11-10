# ADR-017：数据任务输出、精简会话与失败诊断

> Status: DECISION
> Date: 2026-11-09

## 原因

标注任务的原始回答已在 `zcode_output` 保存，但固定 AgentReport 验证会将正常完成的数据回答判为失败；读取事件摘要还可能丢失或压缩数据。原生 ZCode 的内容安全拒绝被通用错误掩盖。同目录互斥和已启动 MCP 进程不会热更新的边界也没有在入口明确说明。

## 决定

面向使用者将 `report_mode: "raw"` + `session_profile: "minimal"` 组合称为 API 模式，保留两个正交选项与默认编码行为，不新增 mode 别名或 HTTP 服务。

1. 普通任务增加可选 `report_mode: "structured" | "raw"`，缺省保持 structured。raw 不追加报告合同、不解析 AgentReport；只有已确认原生成功、输出未截断且清理验证通过才为 completed。completed 只证明执行结束，不证明数据正确或主机验收通过。回答仍由 `zcode_output` 返回，失败也保留已捕获内容。`output_truncated` 显式标注捕获截断；raw 截断失败。续作沿用持久化模式。预约任务依赖 acceptance_met，拒绝 raw。
2. 两个执行器增加可选 `session_profile: "default" | "minimal"`，缺省不改变原生配置。ZCode minimal 在 create/resume 下发空工具白名单、空 MCP 服务器列表、关闭动态工作流与 off-peak 工具；仅 create 关闭标题生成。不替换官方系统提示，不把工具限制等同 OS 沙箱。Kimi minimal 使用原生 `/tools` 目录枚举工具名，通过 prompt 的 `disabled_tools` 在入队前禁用；先核对安装版本的 OpenAPI 支持，不支持则在模型请求前显式失败，不静默回退。每次续作重新枚举，不改全局配置、不发送 system_prompt、自定义 agent 或私有模型接口。Kimi 的技能目录、原生基础上下文及晚注册工具仍由运行时决定，不承诺与 ZCode 精简范围完全相同。须实测 token 差异，不承诺固定节省比例。
3. 原生 `session/usage` 的白名单数值以 `runtime_session_usage` 返回，注明会话累计范围，不能当作本轮或单次请求统计；不支持时缺省并记录可见事件。SQLite/原生日志只用于补充诊断，不驱动状态。
4. 原生失败只投影白名单错误字段和已识别原因的固定说明（未知原始消息不外发），不落盘完整 provider error、请求、响应或 headers。消息中的 URL、凭据和控制字符脱敏；额度耗尽的既有分类和停止策略优先，不新增自动重试。未知错误仍保留现有码。
5. 同目录及父子目录互斥保持不变；入口说明默认 8 worker 只适用于不重叠目录。升级文件后需要重连 MCP / 新会话，不自动终止现有进程。历史扫描先测量；无已观察 queued 任务的恢复周期省略第二次 pump 全扫描（新提交自行 pump，放弃的并发提交下一周期接管）。保留每周期状态与 cleanup 核对，不引入索引或清理策略。

## 验收

覆盖默认报告兼容、raw 数组/续作/失败/未知终态/截断、Kimi 离线协议、预约拒绝、脱敏及额度优先；实测 ZCode 默认/精简会话及会话统计，测量合成历史任务扫描，明确所有未运行项。
