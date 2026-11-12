# GLM 111 条失败与错误回传修复

> Status: RESEARCH
> Date: 2026-11-11（用户当地日期；相关批次为次日 UTC）
> Baseline: e0a19e8 + ADR-021/022 working tree

## 已核实的失败

定向补标 111 条，两次尝试各分 30/30/30/21 条共 4 个任务，8 次均为 `zcode_nonzero_exit`，无 session_id、无实际选中模型记录、无 session/send/turn_started；在模型请求前失败。批次日志的退出码 0 表示脚本遍历结束，不能据此认定标注成功。

最初 Bridge 的事件只保留账号同步请求 `ZCode app-server exited (1)`，后续 session/create 再报 `ZCode app-server is closed before session/create`。原生 stderr 未写进结果或 stderr.log，worker-stderr 为空。该问题不能从旧任务目录恢复完整 stderr。

在原机、原安装的 Server 3.18.0、同一空工作区做不发送模型 prompt 的初始化对照：默认环境正常；长 TMPDIR 环境 stderr 为 `Error: listen EINVAL: invalid argument <TMPDIR>/znr-<UUID>.sock`，进程退出 1。同盘 67 字节 socket 路径绑定成功，130 字节长路径绑定失败；原批次派生 socket 路径为 123 字节。数据盘支持短 Unix socket，失败并非图片内容审核、模型额度或代理故障。原批次使用的 TMPDIR 太长是已复现的启动条件。

另见近期两条运行中 GLM 任务的通用 `ZCode turn failed` / 空 provider_error，属于另一条消息过滤路径。本轮没有找回它们被丢弃的原始 provider 文本，不把它们直接归因为长路径。

## 修复

- 保留首个 app-server 进程错误，附退出码、信号、有界脱敏 stderr；后续请求复用原原因。
- provider_error.message 保留原生错误用词；未知失败摘要包含该文本。脱敏、字段范围及较旧合同的替代说明见 ADR-022。
- 默认系统提示、模型、yolo、并发、代理、自动重试及清理优先级不变。
- 升级前记录不回填；未修改业务补标入口或重跑 111 条。调用方应先把 TMPDIR 改为同盘短路径，再决定补标。

## 验证与交付

专项离线回归 109/109 通过、0 跳过，含真实子进程/worker 落盘、账号同步后的首错、无 stderr 退出、显式截断、event/RPC 未知消息、凭据脱敏幂等、Kimi 结果、checkpoint 及 MCP schema。完整 Linux / Node 22 回归 713 项中 709 通过、4 项平台跳过、0 失败；typecheck、build、validate:plugin、clean-entrypoints（6/6）和 git diff --check 均通过。三份 tracked bundle 已同步重建。完整检查由独立 systemd user unit 托管，任务结束不依赖聊天/终端。

远端 Node 24 / 原生 Server 3.18.0 的新版隔离实例，经实际 MCP coding_agent_task/status/result/events 复现长 TMPDIR，结果直接含 `exited (1); stderr: Error: listen EINVAL …sock`；没有 session_id 或 turn_started、未调用模型，cleanup=verified。隔离核心与最终 dist/src 的全部文件逐字节相同。没有人为制造 provider 内容审核或额度失败；provider/Kimi 消息路径为离线协议验证。

首次远端探针把 timeout_ms 设成 30,000，低于既有最小 60,000，工具在提交前拒绝；修正探针参数后通过。此项是测试入口错误，不计为原生执行成功，不改业务超时合同。

本轮未提交、推送或替换生产安装；前轮 ADR-021 远端安装保持不变。当前修复仅在源码、同步构建产物及远端隔离实例验证，生产实例仍须更新文件并重连 MCP 后才能得到新诊断。111 条业务数据和已结束任务记录未改动。

公开记录省略主机名、私人绝对目录及任务/会话标识；原机受控复现及本机副本保留在本次诊断目录，未加入 Git。
