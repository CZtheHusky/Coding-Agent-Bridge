# API 模式提交与安装验收

> Status: RESEARCH
> Date: 2026-11-09（测试日志使用 UTC 2026-11-10）
> Verified against: 998670c454145b5cf2abab0891a509b6e4c28c3f
> Scope: 本机与 SSH Linux 已安装入口；代码和使用说明已推送，版本仍为 1.2.7，未创建 release。

## 交付

功能提交 `998670c` 已推送到 origin/master。API 模式是 `report_mode: "raw"` 与 `session_profile: "minimal"` 的组合名称，沿用原异步任务接口，没有新增 mode 字段或 HTTP 服务。中英文主说明、插件说明、工具描述及技能指引均包含用法与边界；七个完整 JSON 文档示例已通过当前 schema 校验。

已从该提交的构建产物替换本机 Codex 插件，以及 SSH 主机的 Codex 插件、Claude 插件和独立 Claude Bridge 共享核心，共四个入口。本机没有已安装 Claude 插件，未额外创建。各目标已在仓库外备份原文件，并与部署包逐文件比较一致；私有运行配置、代理入口及任务数据保持不变。没有强制终止用户现有 Codex、Claude 或旧 MCP 会话。

## 安装后真实执行

每个入口建立全新 MCP 连接，发现 API 模式描述以及 report_mode、session_profile、attachments 参数。使用合成双图，以 GLM-5.3-Flash / max 提交 raw/minimal 任务，独立比较原文 JSON 数组的图片代码、颜色及数量，再续作询问第一张图的代码，验证会话记忆。没有从事件摘要恢复答案。

| 入口 | 首轮输入 token | 续作输入 token | 数据与会话核对 | 清理 |
|---|---:|---:|---|---|
| 本机 Codex 插件 | 4,355 | 5,762 | 两次正确，同 session | verified |
| SSH Codex 插件 | 2,539 | 3,936 | 两次正确，同 session | verified |
| SSH Claude 插件 | 2,542 | 3,955 | 两次正确，同 session | verified |
| SSH 独立 Claude Bridge | 2,542 | 3,948 | 两次正确，同 session | verified |

四入口共八次 attempt 均 completed，原文未截断，未生成 acceptance_met 声明，也没有可见工具调用。会话请求计数随首轮/续作增长；计数为原生会话累计值，不用作逐轮计费。以上是安装验证，环境基础上下文不同；87.4% 的降幅仅属于[修复报告](2026-11-09-data-task-repair.md)中同环境配对实验，不外推到本机或其他任务。

本机测试受 systemd user 单元监督，SSH 测试受独立 tmux 会话监督；启动命令退出后继续运行并取得最终结果，原始命令、日志和备份位置仅保存在仓库外。安装测试程序已结束，各测试任务终态及 cleanup 均已核对。

两端原生 Claude 插件 strict 校验通过；SSH 的 `claude mcp list` 中插件与独立 Bridge 两入口均 Connected。该 CLI 健康检查与真实任务验收分开记录，Connected 本身不替代模型执行证据。

## 回归及未运行边界

- 最终命名和说明同步后，Linux / Node 22.22.2 全量回归 668 项：664 通过、4 项平台相关跳过、0 失败。跳过为 Windows startup hook、两项 Windows 真实进程树语义及 non-Linux 调度行为，没有计为通过。
- typecheck、build、validate:plugin、git diff --check 均通过，三份受版本管理的入口 bundle 与源码同步；clean-entrypoints 为 6/6。
- 用户确认 Kimi 额度尚未恢复，本轮未提交 Kimi 模型 prompt。Kimi 原生 API 能力核对及离线 raw/minimal 协议测试通过；真实执行、预填工具面及 token 降幅仍为 NOT RUN。
- 保留两个执行器原生默认系统提示；精简不承诺裸模型上下文或 OS 沙箱。工作区说明、原生技能和会话历史仍可能影响 token。
- 默认 structured/default 编码任务保持原有合同。raw 数据需调用方独立验收，截断会失败；预约目标仍要求 structured。
- 已运行的宿主连接不会因磁盘替换自动热更新，须重连 MCP 或开启新宿主会话。上述四个新连接已验证，既有聊天内热更新未执行。
- Windows/macOS、未来预约执行与额度恢复后的 Kimi 安装调用未在本轮重测。没有修改发布版本号、默认模型或用户持久化脚本。
