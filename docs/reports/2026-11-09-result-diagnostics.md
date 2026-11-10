# 结果诊断与运行构建识别

> Status: RESEARCH
> Date: 2026-11-09（客户端日期；实际测试日志为 2026-11-10 UTC）
> Verified against: 2318201 + ADR-018 working tree
> Scope: Linux / Node 22.22.2，原生协议 fixture、MCP、worker/manager 恢复与打包检查；真实提供方拒绝未主动制造。

## 完成的修改

- TaskResult.provider_error 保留原生白名单 code/type、数值 HTTP 状态/重试间隔、retryable 与固定 content_filter 分类。没有证据时缺省；原始 provider 消息、headers、URL、请求体和私有 metadata 不外发。
- ZCode event/RPC 的失败经 BridgeError 进入 worker 及持久结果；Kimi 保留原生 turn.error 中实际可投影的字段。已有 outcome checkpoint 同样保留和恢复诊断。顶层额度耗尽、取消/超时与清理失败规则保持，retryable 不能单独触发重试或绕过清理占用。
- MCP task/continue 回执和 doctor 增加 bridge：version、started_at、running_build_id、disk_build_id、disk_status、reconnect_required。manager 的幂等回执不变。启动日志只记录版本/指纹/时间。
- 同版本的执行文件替换返回 changed 并提示重连；必要入口不可读或基线缺失返回 unknown/null，不把未知写成无更新。内容指纹覆盖插件三入口或编译 core 的 JS/CJS 树，不输出安装路径，不排序版本，不作为安全门禁。
- 更新 README、接口、宿主组合说明及按需技能参考；主 SKILL.md 仍为 37 行。未改默认系统提示、工作区互斥、扫描策略或 provider/代理配置。

## 验证

针对性回归 90/90，通过。主仓库最终检查：typecheck、build、validate:plugin、git diff --check 通过；完整 674 项中 670 通过、0 失败、4 平台相关跳过；clean-entrypoints 6/6。收尾自定义入口读取范围限制另补受影响测试与最终重建。。

新增测试覆盖实际意图：同版代码替换能被已有连接识别，重建观察后恢复 same，仅触碰时间戳/文档不误报；worker/scheduler 变化可见、缺失入口为 unknown；MCP schema 和当前观察透传不改持久幂等回执；结果诊断脱敏、Kimi 额度优先、cleanup 阻塞和 checkpoint 恢复。

本机 30 次只读指纹观察：编译 core 中位约 1.93 ms、插件约 2.40 ms；这是本机热文件缓存样本，不代表远端磁盘时延保证。

## 安装与未运行边界

本次功能提交时尚待替换两端安装文件；安装后另行补充实际四入口检查。旧于本功能的已连接进程不会凭空获得检测能力，需要首次重连；本功能不热加载或自动重启用户会话/worker。

ZCode/Kimi 故障诊断链路通过原生协议 fixture 验证，没有主动制造真实内容安全拒绝、额度故障或限流。Kimi 真实 API 模式补测已由当前聊天一次性预约，尚未在本轮完成；不将离线结果当作模型认证。Windows 原生执行未在本机运行，按平台测试跳过项明确记录。
