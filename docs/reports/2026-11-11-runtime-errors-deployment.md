# 版本自动发现与错误回传安装验收

> Status: RESEARCH
> Date: 2026-11-11（用户当地日期；执行记录为次日 UTC）
> Verified against: 122d9b723d296bf3ab53d81525912e5fae247e7d
> Scope: Linux 本机 Codex 插件、远端 Codex / Claude 插件及 Claude 独立核心

## 交付

`c0ec7ce` 提交 ADR-021/022 的官方 Server 版本发现、原始错误脱敏回传及同步构建产物；`122d9b7` 补齐安装实测发现的 Kimi 普通请求异常回传缺口，并更新插件使用说明。两次源码提交均已推送。没有发布新插件版本号，现有 1.2.7 安装就地替换。

三个插件入口各替换三个执行 bundle 及 README；独立 Claude 核心替换 166 个编译/声明文件。各目标与对应提交构建逐字节相同。替换时持有三个实际任务库的 Manager 锁，并逐个文件备份及原子替换。两端最终配置、代理 wrapper 和独立宿主入口逐字节保留；保持 yolo、20 并发及原模型/账号配置，远端两份配置仍以 null 清除旧版本固定路径。本机原有 Desktop 显式入口有效且保留。

只关闭身份匹配的旧 Bridge Manager，未向 Codex、Claude 宿主或 worker 发信号；两次替换检查均无活动 worker / 预约 runner。旧 MCP 连接不保证自动重建：当前聊天调用旧连接实际返回 Transport closed，须在原宿主重连 MCP 或重启宿主。下表记录安装后的新实例；旧宿主会话须重连。

## 最终安装实测

每个入口以真实宿主配置和已安装入口启动，任务数据另设诊断目录。MCP 初始化、工具列表、provider_error.message schema、有界脱敏说明及 doctor 必需运行条件通过；运行构建与磁盘一致、reconnect_required=false。该字段仅描述受测新进程。

| 入口 | GLM-5.3 / max / API 模式 | Kimi 原生默认模型 / API 模式 | 长 TMPDIR 启动错误 |
|---|---|---|---|
| 本机 Codex 插件 | 指定应答通过 | 指定应答通过 | 本轮未在本机制造该故障 |
| 远端 Codex 插件 | 指定应答通过 | prompt 接收请求 30 秒超时，未通过 | 具体错误通过 |
| 远端 Claude 插件 | 指定应答通过 | prompt 接收请求 30 秒超时，未通过 | 具体错误通过 |
| 远端 Claude 独立核心 | 指定应答通过 | prompt 接收请求 30 秒超时，未通过 | 具体错误通过 |

8 次正常模型调用中 5 次完成（GLM 四入口、本机 Kimi），原始答案与指定应答逐字一致；3 次远端 Kimi 调用失败，没有模型应答。另有 3 次远端故障按预期失败，status/result 均保留 `exited (1); stderr: Error: listen EINVAL …sock`，没有被 closed-before 覆盖，未创建模型 session 或调用模型。11 项任务的清理均 verified。Kimi 本机报告原生 k3.1-pro，前轮远端两个成功样本报告 k3-256k，本轮远端失败未报告有效模型；没有改默认模型或官方系统提示。本机 Node 22.22.2、远端 Node 24.22.1 / Observed ZCode Server 3.18.0。

## 首次验收失败与补充修复

首次验收脚本的汇总输出把 flush 错传给 json.dumps；本机两次实际调用已成功，但脚本整体报 TypeError，不能把首次脚本退出码当通过。远端故障场景还提前查询了模型目录，该操作自身需要启动 app-server，因长 TMPDIR 在测试任务提交前失败。修正私有测试入口后完成 c0ec7ce 的三项启动错误验证与真实调用。

其中远端 Codex 的第一次 Kimi 调用在 session/profile 准备后约 30 秒失败，原生 wire 已记 agent.turn.started，Bridge 结果却只有通用 kimi_nonzero_exit，provider_error 为空。原始异常当时已丢失，不能仅凭时长断言网络、代理或上游限额。两个 Claude 入口同轮 Kimi 调用成功，该失败记录保留，没有改写。

查到 Kimi catch 分支会丢弃非 BridgeError 的普通异常。122d9b7 复用 ADR-022 的字段投影，保留脱敏 message/cause 到结果、摘要和日志；新增真实 worker 回归模拟 prompt 接收请求超时，验证具体原因保留、凭据脱敏，且不误报总任务超时/额度耗尽。不修改 HTTP 超时、重试或原生启动 banner 的隐私边界。最终安装复测的远端三个 Kimi 调用仍失败，但现均明确返回 provider_error.message = The operation was aborted due to timeout；没有恢复首次丢失的异常文本。

随后仅做一次串行 Kimi 诊断，复用已安装核心与原宿主配置，worker 的 fetch 包装只记录请求路径、耗时和状态，不改超时、消息或模型。会话创建、snapshot、配置、OpenAPI 和工具目录均正常返回；POST /api/v1/sessions/<id>/prompts 于 30,003 ms 抛超时，任务整体约 33.85 秒失败，清理 verified。可确认阻塞阶段是本地 Kimi prompt 接收 HTTP 请求，单独执行仍能复现；仅凭该证据不能判定是上游模型、代理还是原生服务内部阻塞。HTTP 30 秒上限保持原值；本轮未解决远端 Kimi 的 prompt 接收阻塞。

## 离线验证与边界

最终源码：完整回归 714 项，710 通过、4 项平台跳过、0 失败；跳过项为 Windows hook、两项 Windows 进程树及非 Linux 预约分支。Kimi 专项 29/29，0 跳过。typecheck、build、validate:plugin、clean-entrypoints（6/6）、git diff --check 通过，三个 tracked bundle 与源码同步。检查由独立 systemd user unit 托管；远端真实调用由独立会话托管，命令、监督标识、日志和输出目录保存在私人诊断记录，已核实与聊天/SSH 分离存活。

没有重跑 111 条业务补标、修改补标脚本或历史失败记录。业务调用方仍须先把 TMPDIR 换成同盘短路径再决定重试。未重做图片标注正确率、预约唤醒、Windows 或长时间/高并发 provider 稳定性验收。公开记录省略私人路径、主机名和任务/会话标识；原始诊断与备份不进 Git。
