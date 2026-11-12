# ZCode Server 自动发现与远端健康检查

> Status: RESEARCH
> Date: 2026-11-11
> Verified against: e0a19e8 + ADR-021 working tree
> Scope: Linux 本地回归，远端 Codex / Claude 插件和 Claude 独立宿主；本轮改动尚未提交或推送

## 根因与修复

检查时，Codex 运行配置固定引用已删除的 ZCode Server 3.16.3 release；标准 Claude 插件读取同一份配置，因此一起失效。抽样任务库有 48 条 runtime_not_found，错误明确指向该旧文件，发生在模型请求前。Claude 独立服务的配置已指向 3.18.0，其修复前 doctor 正常。三个入口都能初始化 MCP；连接成功不代表 worker 或模型调用成功。

实现 [ADR-021](../decisions/ADR-021-zcode-server-runtime-discovery.md)：保留显式入口与 Desktop 的原有优先级；自动模式读取官方 server/current.json 的 releaseDir，每次解析重新读取，校验真实目录位于 server/releases 并使用 runtime/zcode.cjs。不按目录修改时间或版本号猜测，不修改官方指针。现有指针损坏、越界或 runtime 缺失明确失败。两份宿主配置均将 ZCODE_BRIDGE_ZCODE_CJS 设为 null，清除旧父进程继承的固定路径。

另发现 Kimi 原生 2.4.1 程序仍在持久化数据目录，但其 bin 不在后台 PATH，标准 bin 也没有 kimi。恢复持久化标准 bin 下的启动符号链接后，非交互环境能找到并启动原有 2.4.1；没有重装 Kimi，也没有手工改写账号、登录或 provider 文件。

## 离线验证

- Linux Node 22.22.2：707 项，703 通过、0 失败、4 项平台条件跳过。跳过项仍为 Windows hook、两项 Windows 进程树和非 Linux 预约分支，没有计为通过。
- typecheck、build、validate:plugin、差异检查通过，clean-entrypoints 6/6。三个插件 bundle 已重新构建，预约 bundle 字节未变。
- 远端 Node 24.22.1：runtime-resolver 专项 24/24，0 跳过。
- 专项包括官方指针升级后删除旧 release、持久化符号链接、默认/自定义宿主、ZCODE_HOME 与数据基目录、Desktop 优先级、显式固定入口、坏指针/缺文件/有效但越界的 runtime，以及不能猜测其它已安装 release。
- 两个真实 detached worker 使用合成 app-server，在保存的 null 清除继承的失效入口后完成一次执行与清理；不是仅验证文件存在。

## 远端替换与真实调用

已备份并替换两个插件的三个入口文件，以及独立 core 的 resolver 编译文件。所有目标与受测产物字节一致。两份配置只修改自动入口字段，yolo、并发 20、代理 wrapper、独立宿主脚本及数据目录保留。关闭 16 个旧 Bridge Manager，均响应 SIGTERM；没有向 detached worker 或 Codex / Claude 主进程发送信号。本轮没有替换本机插件安装。

| 入口 | MCP 工具 | ZCode | Kimi |
|---|---:|---|---|
| 远端 Codex 插件 | 17 | 指定短应答准确，completed，清理通过 | 指定短应答准确，completed，清理通过 |
| 远端 Claude 插件 | 17 | 指定短应答准确，completed，清理通过 | 指定短应答准确，completed，清理通过 |
| 远端 Claude 独立 core | 13 | 指定短应答准确，completed，清理通过 | 指定短应答准确，completed，清理通过 |

六个最终检查任务均使用独立诊断数据与工作区、raw/minimal，无项目文件修改。ZCode 使用自动发现的 Server 3.18.0，实际模型 GLM-5.3，runtime 确认 max。Kimi 原生 2.4.1，实际模型 kimi-code/k3-256k；未覆盖模型/档位，本轮 runtime 没有报告有效推理档位，保持未报告。三处新进程的运行构建与磁盘构建相同，reconnect_required=false。另直接解析两份实际宿主配置，均与官方当前 3.18.0 入口一致。

## 失败的检查及边界

第一轮远端 Node 24 离线包遗漏既有 provider-failure 模块，在执行测试前报模块缺失；补齐依赖后 24/24 通过。第一次本机类型检查误用了不存在的 npm 位置，未执行检查；改用系统 npm 与受测 Node 后完成上述完整回归。原始失败记录没有计作通过。

首轮插件探针没有应用 manifest 的 ZCODE_BRIDGE_PLUGIN_MODE=1，误找 worker-main.js，四个任务被回收为 worker_lost；更正为按已安装 manifest 注入环境后重测。独立 core 的首个 Kimi 任务因启动文件不在 PATH 而 spawn_failed，恢复持久化入口后通过；首轮独立 core 的 GLM 已通过。

第二轮 Claude 插件探针在读取 status.json 时一度收到文件不存在，探针中断后没有取消原任务。后验文件和重新连接 MCP 查询均确认原 GLM 任务已完成，指定输出准确且清理通过；保留原 task ID 验收，仅补做尚未运行的 Kimi。该次文件可见性原因未进一步归因，不能据此宣称共享盘问题已解决。失败的探针、原任务和最终结果分别保存在私有诊断目录；未改写原始失败任务。

本轮验证文本 API 短调用及自动发现，不代表完整编码、附图质量、20 路模型吞吐、Windows/macOS 或未知未来 Server 布局认证。慢共享盘的突发写入限制沿用前轮记录。没有修改默认系统提示。新 Bridge 首次安装须重连 MCP；后续官方 current 指针更新在新任务解析时生效，不需要再次填写版本化路径。长任务执行中删除其当前 runtime 的行为没有测试。
