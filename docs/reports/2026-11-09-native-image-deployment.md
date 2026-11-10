# 原生附图提交与安装验收

> Status: RESEARCH
> Date: 2026-11-09（按本机日期，执行跨 UTC 2026-11-10）
> Verified against: d1bf2fe7e7023bb74ec0abddbdad72ee1d84f43b
> Scope: 已提交并推送的功能与使用说明；Linux 本机和 SSH Linux 的实际安装入口。发布版本号仍为 1.2.7，未新建 release。

## 提交与安装

功能提交 `d1bf2fe` 已推送到配置的 origin/master。包含原生附件实现、先前 Claude 插件入口修复、超时说明，以及中英文主说明、插件 README、技能说明和接口合同。公开改动已扫描机器私有路径、主机标识和凭据模式，无命中。

从该提交重建共享核心与三个自包含 bundle，重建后 Git 无差异。已替换本机现有 Codex 插件，以及 SSH 主机的 Codex 插件、Claude 插件和独立 Claude Bridge 共享核心。没有本机 Claude 插件安装可替换，未额外创建安装。每个目标在替换前备份受管文件，安装后与部署包逐文件字节对比一致，插件随附说明与技能一并同步。

私有运行配置、代理启动入口、用户数据及任务记录保持不变，原有 yolo 模式保留。监督命令、单元/进程标识、日志、备份位置和原始结果仅保存在仓库外。没有强制终止用户已有 Codex/Claude 或旧 MCP 进程。

## 实际安装入口验收

通过各安装入口建立全新 MCP 连接，分别执行首条消息附 1 图、同 task/session 续作补 1 图。使用前轮生成的合成 PNG，独立比较打印码、颜色和数量，而非仅采信 completed。

| 入口 | schema 发现 | GLM-5.3-Flash / max | 会话与清理 |
|---|---|---|---|
| 本机 Codex 插件 | task / continue 均含 attachments | 首图与补图均正确 | 同 session，cleanup verified |
| SSH Codex 插件 | 同上 | 首图与补图均正确 | 同上 |
| SSH Claude 插件 | 同上 | 首图与补图均正确 | 同上 |
| SSH 独立 Claude Bridge | 同上 | 首图与补图均正确 | 同上 |

四入口共 8 次 ZCode attempt，均无可见工具调用；最终测试任务的 worker_pid 已清空，无本轮 worker 残留。两端 Claude 原生插件 strict 校验通过；SSH 的原生 `claude mcp list` 显示插件与独立 Bridge 两入口均 Connected。

本机测试由 systemd user 单元监督，远端测试使用独立 session 与文件日志。测试进程已退出；本机监督单元最终退出码为 1，原因是后续 Kimi 额度错误，不能把整个验收作业写成成功。

## Kimi 复测边界

- 本机插件与 SSH 独立 Claude Bridge 的 Kimi 首次尝试均明确返回 `kimi_usage_exhausted`。发现后停止 Kimi 调用、续作和重试，等待用户确认额度恢复；没有通过重试规避额度限制。
- SSH 两个插件入口的验收脚本环境缺少日常 PATH 中的 Kimi bin，首次尝试为 `spawn_failed`。只读核对现有 Claude MCP 进程的启动环境后，使用同一 PATH 运行 `kimi --version` 成功，版本 2.4.1。这是本次验收环境缺口，不据此改动生产配置；也没有将版本检查冒充模型调用成功。
- 上述 4 次 Kimi attempt 均已清理。本轮实际安装后的 Kimi 附图/补图完整验收未完成。前轮隔离副本中的 Kimi 原生附图、16 图批量、补图与会话复用证据仍见[功能实测报告](2026-11-09-native-image-attachments.md)，不能代替本次安装后实测。

## 回归与使用边界

- 功能最终全量回归为 656 项：652 通过、4 项平台限定跳过、0 失败；clean-entrypoints 6/6，typecheck/build/validate:plugin 通过。安装前再次 typecheck/build/validate:plugin，bundle 重建与提交一致。
- 三份使用说明中的 5 个完整附图 JSON 示例通过当前编译 schema 校验；Git diff 检查通过。此次收尾只增加部署记录，未改执行代码。
- GLM-5.3 普通版仅支持文本；原生多模态为 GLM-5.3-Flash/FlashX，本轮只实测 Flash。官方来源与图像识别/token 边界见[功能实测报告](2026-11-09-native-image-attachments.md)。
- 既有聊天的旧 MCP 连接不会因磁盘文件替换自动加载新 schema/skill；须重连 MCP 或开启新会话。新连接已验证，旧连接内的热更新未执行。
- 本轮未验证 Windows/macOS、未来预约图片执行、FlashX，或额度恢复后的 Kimi 安装复测；没有新建 release 或修改默认模型。
