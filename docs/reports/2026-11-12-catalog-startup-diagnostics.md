# 模型目录启动错误回传与 TMPDIR 提醒

> Status: AUTHORITATIVE（仅本次修复和验证记录）
> Last updated: 2026-11-12
> Last verified: 2026-11-12，Linux 回归、远端真实原生初始化对照及两端四入口安装检查；不含模型推理。
> Verified against: 3042a71 + 本次修复源码及同版构建产物（提交前验收快照）；未创建版本发布。

## 原因与修复

模型目录的独立 app-server 客户端收集了 stderr，却在进程关闭时只返回退出码；RPC 错误也只保留数字 code。因此同一 Unix socket 路径故障，在任务接口与模型目录接口得到不同诊断。按 ADR-022 补齐该分支：保留首个进程失败、退出码/信号、有界脱敏 stderr，后续 closed 请求保留首因；RPC 文本复用既有字段投影与脱敏规则，不复制私有 metadata 或原始协议对象。没有 stderr 时明确说明，超出上限明确截断。错误码与既有一次目录刷新重试不变。

调用者现在可从 `coding_agent_model_catalog` 工具说明、skill 的一条简短提醒及异常参考、中英文 README 和 ZCODE_RUNTIME 中看到路径限制。Observed ZCode Server 3.18.0（Linux）追加的 `/znr-<UUID>.sock` 约占 46 字节；Unix socket 完整路径通常最多 107 字节，按 UTF-8 字节而非字符数计算。提醒调用者在预期文件系统选短 TMPDIR，重新连接 MCP 后使用，并保留目录到相关任务结束。Bridge 不替调用者更换临时目录、修改 provider 或重跑业务。

## 验证

新增测试在旧实现上失败，修复后通过：普通初始化与账号同步路径均保留 listen EINVAL、实际路径和退出码，凭据/URL/控制字符被移除；空 stderr、超长 stderr、RPC 嵌套消息及私有 metadata 排除均覆盖。日志还验证目录刷新只进行既有两次尝试、不发送 session/send。

- `npm run typecheck`、`npm run build`、`npm run validate:plugin`、skill quick_validate、`git diff --check` 通过。
- `npm test`：719 项，715 通过，0 失败，4 跳过。跳过项为 Windows 启动 hook、两个 Windows 真实进程树子测试及非 Linux 调度行为；未宣称这些平台已运行。
- `npm run test:clean-entrypoints`：6/6 通过。
- 全量测试由独立 systemd 用户服务监督，退出码 0；本轮不依赖 PTY 存续。

远端使用原安装的 ZCode Server 3.18.0，在相同配置及同一数据盘比较，仅切换 TMPDIR；从真实 MCP 工具读取结果，使用新工作区避免 24 小时目录缓存绕过初始化：

| 候选入口 | TMPDIR / socket 字节数 | 结果 |
| --- | --- | --- |
| Codex 插件 | 96 / 142 | ZCODE_NONZERO_EXIT；退出码 1、原生 listen EINVAL、socket 路径及 TMPDIR 处理提示均可见 |
| Codex 插件 | 31 / 77 | catalog refreshed，返回 3 个模型 |
| 独立 Claude 核心 | 96 / 142 | 同上，原生错误与路径提示可见 |
| 独立 Claude 核心 | 31 / 77 | catalog refreshed，返回 3 个模型 |

初版测试探针错误地把任务库内部元数据视作任务，首个长路径断言已通过但探针随后退出；改为检查实际 task.json 后完整对照通过。本机安装探针最初假定配置必须显式设置 Node，修正为沿用现有 Node 自动发现后通过。这两项是探针问题，不计作 Bridge 故障或通过的完整验收。

## 安装与边界

已逐文件备份并原子替换本机 Codex 插件、远端 Codex / Claude 插件及供业务脚本使用的独立核心。每份插件仅四个文件实际变化：Bridge bundle、插件说明、skill 与异常参考；核心仅 model-settings.js 和 server.js 变化，其余构建文件逐字节一致。三个受跟踪 bundle 均已重新构建，只有 Bridge bundle 内容改变。

安装后四入口均重新启动隔离 MCP 连接，工具描述可见路径提醒，doctor 的 disk_status=same、reconnect_required=false，目录刷新成功。本机返回 6 个模型，远端三个入口分别返回 3 个模型；原生 deferred session 已关闭，未提交编码任务或模型推理。保留原运行配置、代理、凭据、并发设置和 yolo 模式；未终止正在运行的宿主/任务。已有连接仍加载旧代码，须重连 MCP 或开启新宿主会话。

本轮未重跑原业务批次，未改历史任务，也未验证完整编码或图像推理。上述验收在提交前完成，最初安装标记记录 base_commit 与 uncommitted=true。后续提交、推送及安装状态以 Git 记录和对应部署记录为准，不将提交前构建冒充新版本发布。
