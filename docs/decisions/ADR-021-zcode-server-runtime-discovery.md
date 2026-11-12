# ADR-021：按官方版本指针发现 ZCode Server runtime

> Status: DECISION
> Date: 2026-11-11

## Context

ZCode Server 升级删除旧 release 后，Bridge 保存的版本化 zcode.cjs 路径失效，任务在请求模型前报 runtime_not_found。Codex 和 Claude 插件读取 Codex 配置，Claude 独立服务读取自己的配置，必须分别启用自动发现。

Observed ZCode Server 3.18.0 的官方 bin/zcode 启动器读取 server/current.json 的 releaseDir，只接受 server/releases 下的 release，不按版本号或目录修改时间猜测最新版。

## Decision

- 非空 ZCODE_BRIDGE_ZCODE_CJS 仍是显式固定入口；无效时明确报错，不静默换版本。自动模式在宿主 runtime-config.json 中将该键设为 null 或空字符串，以清除旧父进程继承的固定路径。
- 保留现有 Desktop 发现顺序。Desktop 入口不存在时，从 ZCODE_HOME/server/current.json 读取 releaseDir；没有 ZCODE_HOME 时使用 ZCODE_DATA_BASE_DIR/.zcode，最后使用用户 HOME/.zcode。
- current.json 缺失视为未发现 Server；存在但损坏、releaseDir 非绝对路径、越出真实 server/releases、release 或 runtime/zcode.cjs 不可读取时报告 runtime_not_found。不扫描 releases 选最大版本，不回退到旧 release，也不修改官方指针。
- 每次解析重新读取指针，不缓存版本路径；已有任务保持本次选定入口，新任务跟随官方 current。真实路径检查兼容 HOME/.zcode 的持久化符号链接。
- Codex、Claude 插件和独立宿主共用解析器。保留 provider 配置、系统提示、代理 wrapper、权限模式、并发与任务数据；不下载、安装或升级 ZCode。

## Rationale / Consequences

复用官方当前版本是确定性选择，避免维护另一套升级逻辑。显式固定入口与自动模式的边界保持可见；需要首次部署新 Bridge 并清除两份旧固定配置。官方布局仍是观测接口，未知未来布局应明确失败而不是执行猜测的文件。

## Validation

覆盖官方指针切换且旧 release 删除、符号链接、默认和自定义宿主、固定入口优先及失败、损坏/越界/无效指针、不按版本猜测。真实 detached worker 用合成 app-server 验证两宿主执行链；部署后分别做 MCP 检查与有界真实调用，结果和未运行边界另记。
