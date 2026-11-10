# 上游 stable / preview 审阅与采纳台账

> Status: RESEARCH
> Last updated: 2026-11-10
> Review date: 2026-11-10；上游清单的 author date 范围为 2026-10-29 至 2026-11-10（保留 Git 中原时区）。
> Fork baseline: `07768efc49f338bf637c47f74127f36f911fecd2`
> Merge base: `0e74ee1c64b179752a24317574916a98c77a5ef1`
> Recorded upstream master: `aabbb0a959ee234508c62731ed5122f28dfcf5b0`（stable 1.6.0）
> Recorded upstream preview: `61c78b7c637432d3d39768c48030609d6dbf253a`（2.0.0-preview.2）
> Verification scope: Git 历史与固定提交最终树、选定代码路径专项核查、Linux 打包启动与离线内存 fixture；未运行上游全量测试、Windows 真机或真实模型。

本台账记录哪些提交已经看过、按什么强度看过、为何采纳或搁置，供下一轮增量审阅使用。它不是当前运行合同，也不表示这些上游提交已经进入 fork。下面完整覆盖 master 自 merge base 以来的 83 个提交，以及 preview 相对该 master 的 11 个提交，共 94 个不重复 SHA；包含 merge commit，未以 first-parent 清单代替完整范围。

本轮结论是保留 fork 的生产路径，只选两个有确定反例的局部修复：`a6ba76c` 的 ACK 合帧去重 guard，以及 `4a3763e` 的 Windows cleanup helper stdin error 处理。此处状态为**选中、待本地落地与回归**，不把部分采纳写成整 commit 已合入。以 fork baseline 对 stable 执行 `git merge-tree --write-tree --name-only --no-messages HEAD upstream/master`，exit 1，列出 30 个冲突路径，未改工作区；代表路径包括 `src/host/stdio.ts`、`src/mcp/server.ts`、`src/worker/run-task.ts`、`src/adapters/zcode-app-server-adapter.ts`，以及文档和 skill。该冲突数只对应 stable，不是 preview 的试合并结果。结合以下运行与接口差异，不建议全量整合 stable 或 preview。

## 如何理解审阅强度与处置

| 标记 | 本轮实际含义 |
|---|---|
| 逐代码专项核查 | 对表中注明的局部 hunk、调用链或字段流作了核对；不表示整 commit 每一行均已深审。 |
| 按最终树/专题分组审阅 | 将相关提交放到该分支最终树，围绕启动、存储、worker、路径、技能等专题判断；不逐提交重演中间状态，也不宣称逐行审阅。 |
| 发布/合并元数据 | 核对其在范围内的身份及归属；发布、合并、版本、渠道、生成物或无行为格式调整不独立移植。 |
| 选中待落地（部分采纳） | 仅选择明确列出的 hunk；实现与回归完成前仍为 pending。后续应补本地提交与验证结果，不能用上游 SHA 宣称整 commit merged。 |
| 候选，按需抽取 | 留下价值与已知缺陷；本轮不实现，不表示已获完整兼容认证。 |
| 不取 / 暂缓 | 在本次 fork 基线及范围内作出的处置；上游实现或 fork 需求变化后可以重新评估。 |

## 影响全量整合的事实

### SQLite 默认路径与 fork 的兼容边界

stable 的 stdio 启动已无条件进入 fresh SQLite 初始化与 `SqliteLifecycleMcpAuthority`，preview 继续采用这条默认路径。fresh bootstrap 要求 Windows exclusive-file-handle lock，运行版本为 Node `>=24.16.0 <25`；因此不能把版本号提升理解为 Linux 可直接升级。源码对应 [stable stdio 初始化](https://github.com/Sandyzzx/codex-zcode-bridge/blob/aabbb0a959ee234508c62731ed5122f28dfcf5b0/src/host/stdio.ts#L147-L216)、[Node 范围](https://github.com/Sandyzzx/codex-zcode-bridge/blob/aabbb0a959ee234508c62731ed5122f28dfcf5b0/src/store/lifecycle-gate.ts#L297-L301)和 [Windows bootstrap 限制](https://github.com/Sandyzzx/codex-zcode-bridge/blob/aabbb0a959ee234508c62731ed5122f28dfcf5b0/src/store/lifecycle-gate.ts#L430-L435)；[preview stdio](https://github.com/Sandyzzx/codex-zcode-bridge/blob/61c78b7c637432d3d39768c48030609d6dbf253a/src/host/stdio.ts#L211-L225)也先准备 SQLite 根。

旧 `.tasks` 不会导入新的 SQLite Authority。stable 的 migration CLI 一进入 `main` 就以 `json_to_sqlite_migration_removed` 主动拒绝；下方历史迁移代码不可达，不能因文件仍在就称其支持迁移。[固定源码](https://github.com/Sandyzzx/codex-zcode-bridge/blob/aabbb0a959ee234508c62731ed5122f28dfcf5b0/src/cli/migrate-json-to-sqlite.ts#L162-L168)。preview 的 [SQLite-only 集成提交](https://github.com/Sandyzzx/codex-zcode-bridge/commit/d9b9819860320cbad6152a57a944604e5f70173e)进一步删除旧 JSON TaskStore、Manager、run-task 与 migration CLI，不能将其当作可独立 cherry-pick 的 Start Plan 功能。

fork 的预约 runner 仍消费 JSON 任务权威状态。如果只把默认 stdio 换成上游 SQLite 而保留现有 schedule，任务创建、观察、续作和验收会面对两套 authority。该边界必须整体设计和实测，本轮不通过拼接两条路径规避。

上游 SQLite worker 直接构造 `ZCodeAppServerAdapter`，没有 fork 的 Kimi 执行器分派；续作调用未转发本轮补图；其 `CandidateTaskResult` 白名单还会遗漏 fork 增加的 `acceptance_met`、`provider_error` 等字段。来源为 [stable worker 执行及结果映射](https://github.com/Sandyzzx/codex-zcode-bridge/blob/aabbb0a959ee234508c62731ed5122f28dfcf5b0/src/worker/worker-main.ts#L327-L412)与 [preview worker](https://github.com/Sandyzzx/codex-zcode-bridge/blob/61c78b7c637432d3d39768c48030609d6dbf253a/src/worker/worker-main.ts#L434-L477)。这不等于所有新输入字段都会丢：初始 task 对象沿 envelope 透传，`report_mode` / minimal 初始字段未必损失；风险应分别定位在执行器选择、续作参数和结果投影，不能夸大为全部 raw/minimal 失效。

### Start Plan 与路由仍不能作为真实主链通过证据

preview 自带报告记载，2026-11-09 的一次真实 Start Plan turn 进入模型请求后以 HTTP 405 失败，根因未确认。2026-11-10 的 provider registration 修复后，只核对了 registration、`session/create` 与 `session/setModel`，没有发送 `session/send`，也未重跑正式真实 E2E。因此不能将较新的 registration 通过覆盖先前真实 turn 的失败。[11-09 真实 turn 记录](https://github.com/Sandyzzx/codex-zcode-bridge/blob/61c78b7c637432d3d39768c48030609d6dbf253a/docs/reports/model-routing-v1-20261109.md#L33-L55)、[11-10 修复与未执行范围](https://github.com/Sandyzzx/codex-zcode-bridge/blob/61c78b7c637432d3d39768c48030609d6dbf253a/docs/reports/2026-11-10-gate-e2-registration-contract.md#L60-L86)、[未重跑声明](https://github.com/Sandyzzx/codex-zcode-bridge/blob/61c78b7c637432d3d39768c48030609d6dbf253a/docs/reports/2026-11-10-gate-e2-registration-contract.md#L116-L122)。

路由的静态核查与隔离函数探针还指出三项局部风险：

| 风险 | 代码依据与适用范围 |
|---|---|
| 相同 `task_id` 的后续输入 model 被首次路由缓存替换 | [router 在读取当前 model 前命中 task_id cache](https://github.com/Sandyzzx/codex-zcode-bridge/blob/61c78b7c637432d3d39768c48030609d6dbf253a/src/runtime/model-routing.ts#L171-L196)。可能掩盖同 ID 改模型本应触发的冲突。 |
| 显式 provider 仍会先解析 registry | [router 无条件 await registry](https://github.com/Sandyzzx/codex-zcode-bridge/blob/61c78b7c637432d3d39768c48030609d6dbf253a/src/runtime/model-routing.ts#L187-L189)，而 [stdio registry resolver 失败直接 throw](https://github.com/Sandyzzx/codex-zcode-bridge/blob/61c78b7c637432d3d39768c48030609d6dbf253a/src/host/stdio.ts#L265-L276)。纯函数本身支持 explicit provider，实际 hook 可能更早阻断它。 |
| entitlement journal 不按账户分键，也不检查过期 | [journal 只以 model 保存和读取 verdict](https://github.com/Sandyzzx/codex-zcode-bridge/blob/61c78b7c637432d3d39768c48030609d6dbf253a/src/runtime/model-routing.ts#L124-L156)。`observedAt` 被存储但读取时不参与判断，账户切换后可能沿用旧路由建议；它仍不代替每次真实 entitlement 检查。 |

这些是源码和函数层面的可复现判断；本轮没有调用真实账户、Billing 或模型，不能据此承诺完整主链中的最终表现。

## 两项优先修复及保留候选

| 来源 | 本轮处置 | 理由及边界 |
|---|---|---|
| `a6ba76c7a3ddb97e4c7f37754eb85c7eb9c9d82b` | **选中待落地（部分采纳）**：只取合帧 ACK 的 `!entry.turnStartedAt` guard，并按 fork 测试/构建方式补回归和生成物。 | 同一 stdout chunk 含 ACK、`turn.started`、终态时，先处理强 runtime 事件、后恢复 send promise 会再合成一次 start。离线反例为 2 次，内存应用该 guard 后为 1 次，前后 cleanup 均 verified。[上游局部源码](https://github.com/Sandyzzx/codex-zcode-bridge/blob/aabbb0a959ee234508c62731ed5122f28dfcf5b0/src/adapters/zcode-app-server-adapter.ts#L767-L772)。 |
| `4a3763ebbd61f8b9d12b9464e2e406df70d0ce88` | **选中待落地（部分采纳）**：只取 Windows cleanup helper stdin error 转换为既有失败路径的 hunk。 | helper 提前关闭后 stdin 的异步 EPIPE 无 listener 会逸出；处理后仍须保持 cleanup unverified，不得把错误吞掉。[stdin fail 路径](https://github.com/Sandyzzx/codex-zcode-bridge/blob/aabbb0a959ee234508c62731ed5122f28dfcf5b0/src/adapters/windows-process-cleanup.ts#L1159-L1170)。本 commit 其余 worker/teardown 变化不取，尤其 [stdout/stderr 空 error listener](https://github.com/Sandyzzx/codex-zcode-bridge/blob/aabbb0a959ee234508c62731ed5122f28dfcf5b0/src/adapters/zcode-app-server-adapter.ts#L1231-L1237)缺乏运行期读错的分类，可能吞掉重要故障。 |
| `d91913a2c1b4b04485ee2815bb3b9fb80be2f131` | 候选，按需抽取 host token 观测模块；不取整 commit。 | 观测有价值，但 commit 为 825 files、392,158 insertions，混入大量 evidence。若后续有需求应只抽最小模块、补隐私边界与回归。[上游提交](https://github.com/Sandyzzx/codex-zcode-bridge/commit/d91913a2c1b4b04485ee2815bb3b9fb80be2f131)。 |
| `c39909a…32ed22f` 路径专题 | 候选，按需抽取；本轮不整组移植。 | 统一路径发现和 doctor 分类有价值，但 [sameCleanPath](https://github.com/Sandyzzx/codex-zcode-bridge/blob/aabbb0a959ee234508c62731ed5122f28dfcf5b0/src/runtime/paths.ts#L302-L314)只 normalize 后比较，尾斜杠仍可能产生不相等；fork 已有 Linux dataBaseDir 迁移支持，不能为同一问题再引入一套。 |
| `fc73947`、`bfab338`、`6050e1e` | Windows 低优先候选，暂缓。 | 分别涉及 helper 启动预算或有界锁重试；本轮没有 Windows 真机测量，不以延长超时作为已证实修复。 |
| `7fbbfce` | 不取。 | 面向 claim-only SQLite worker 的退出路径，不适用于 fork 现有 worker。 |
| `78115c1` | 不取。 | 仅 MVP fake app-server fixture 修复，不是生产 app-server 修复。 |
| `83d3f13` 与 complete-task 思想 | 不整搬技能。 | fork 已有完整任务委派与主 agent 验收思想；保留现有 `coding-agent-bridge` 短 skill、按需参考、API 参数、Kimi 和 `coding_agent_*` 工具名，不回退为上游单执行器技能。 |

## 本轮可公开的验证摘要

以下结果来自 Linux 上的受控启动与内存 fixture。原始证据包含本机布局，因此只将下表的精简结果纳入版本库；未复制主机名、用户名、绝对用户路径、真实任务 ID、代理或凭据。证据文件名为 `startup-results.json`、`runtime-offline-evidence.json` 和 `runtime-offline-probes.mjs`；源码依据及复现边界已在上文给出固定 SHA 链接，结论不依赖读者访问私有目录。

| 检查 | 观测结果 | 能证明什么 |
|---|---|---|
| stable 打包入口，Node 22，默认 Linux 环境 | exit 1；`local_app_data_unavailable` | 默认安装数据目录假设先阻止启动。 |
| stable 打包入口，Node 22，显式配置隔离数据根 | exit 1；`SQLite candidate requires Node >=24.16.0 <25` | 绕过目录问题后仍受 SQLite Node 版本限制。 |
| stable 打包入口，Node 24.22.1，显式配置隔离数据根 | exit 1；`Fresh SQLite bootstrap requires the Windows exclusive-file-handle lock` | 满足 Node 范围仍不能在此 Linux 环境完成 fresh bootstrap。 |
| fork baseline 编译产物，合帧 ACK 内存 fixture | `turn_started` 2 次；内存只应用 `a6ba76c` guard 后 1 次；两次 cleanupVerified 均为 true | 确定复现重复 start，并证明局部 guard 消除该反例；未写仓库或调用模型。 |
| fork baseline cleanup helper 的内存 stream fixture | stdin `error` listener 为 0；注入 EPIPE 后异常逸出 | 确定有未处理 stream error；没有真实启动 PowerShell，也未认证 Windows 进程树清理。 |

本轮**未运行**：上游全量测试、上游 Windows 生产安装或真机清理、真实 ZCode/Kimi 模型、真实 Start Plan/Billing、真实账户切换、完整迁移与 schedule/SQLite 联动。上游报告中的 Windows 测试属于其记录版本的历史证据，不计为本轮通过。

## 本地落地与回归记录

截至本台账初稿，两项局部修复已选中，尚未在本节记录实现与回归结果。实施方完成后应补本地提交、实际测试及 skip/fail 边界，并同步更新下表的“部分采纳”状态；在此之前保持 pending，不以“审阅完成”代替“修复完成”。

## 下一轮增量审阅

先更新远端引用，并确认下面 recorded HEAD 仍是对应新分支的祖先；若上游 rebase、force-push 或更换谱系，应重新确定共同祖先和范围，不直接把“旧 HEAD 之后”当作完整增量。以下为人工审阅命令，不创建自动 gate，也不冻结 hash 合同：

```bash
git fetch upstream
git merge-base --is-ancestor aabbb0a959ee234508c62731ed5122f28dfcf5b0 upstream/master
git merge-base --is-ancestor 61c78b7c637432d3d39768c48030609d6dbf253a upstream/preview
git log --reverse --format='%H %s' aabbb0a959ee234508c62731ed5122f28dfcf5b0..upstream/master
git log --reverse --format='%H %s' 61c78b7c637432d3d39768c48030609d6dbf253a..upstream/preview
```

应先看本台账保留的候选与部分采纳项，再审查新增 SHA。merge commit 的新结果树仍须看；不能因父提交已列入本表就自动跳过新的冲突解决。若新 master 吸收了已记载的 preview 提交，用本表完整 SHA 去重即可；若同一改动以新 SHA 重做，则核对 patch 和最终树，不只比较提交标题。

## 完整提交处置清单

以下标题和完整 SHA 直接从 Git 生成，顺序为 `git log --reverse`。专题代号指向上文事实与处置：**技能**（保留 fork 技能与命名）、**外观**（非本轮需求）、**Windows**（本轮未实测）、**SQLite**（authority/执行器/平台不兼容）、**token**（仅保留抽取候选）、**路径**（有价值但需修正缺陷）、**waiter**（上游 SQLite attention/waiter 设计，未与 fork 调度一起认证）、**Start Plan**（真实主链未通过）、**路由**（存在已列出的缓存/registry 风险）、**fixture**（不属于生产修复）。每一行给出处置，不把“按专题审阅”提升为逐行深审。


### master：83 个提交

| 完整 SHA | Git subject | 审阅强度 / 专题 | 本轮处置 |
|---|---|---|---|
| [`a66d612665ef5c2a9beb76f678092e0f5e44a7d9`](https://github.com/Sandyzzx/codex-zcode-bridge/commit/a66d612665ef5c2a9beb76f678092e0f5e44a7d9) | feat: clarify complete-task dispatch and acceptance ownership | 按最终树/专题分组审阅；技能 | 不整搬；保留 fork 完整任务委派、短 skill、API/Kimi 与工具名 |
| [`83d3f13b7f9163bdb1e3d0decff630dde3e36164`](https://github.com/Sandyzzx/codex-zcode-bridge/commit/83d3f13b7f9163bdb1e3d0decff630dde3e36164) | feat: require scoped Bridge authorization and progressively load Skill guidance | 按最终树/专题分组审阅；技能 | 不整搬；保留 fork 完整任务委派、短 skill、API/Kimi 与工具名 |
| [`fb5c0a0a9bd55973d8e754aa55946aa04ac993eb`](https://github.com/Sandyzzx/codex-zcode-bridge/commit/fb5c0a0a9bd55973d8e754aa55946aa04ac993eb) | feat: use Owner-selected original E plugin artwork | 按最终树/专题分组审阅；外观 | 不取；非本轮功能需求 |
| [`20661d44c10337ae18636ec66b7850c1e365e102`](https://github.com/Sandyzzx/codex-zcode-bridge/commit/20661d44c10337ae18636ec66b7850c1e365e102) | fix: stabilize Windows release regression tests | 按最终树/专题分组审阅；Windows | 暂缓；平台/fixture/诊断变化，本轮未实测 |
| [`7999583ddc61f38866e023e4daf74897d41093d0`](https://github.com/Sandyzzx/codex-zcode-bridge/commit/7999583ddc61f38866e023e4daf74897d41093d0) | test: batch platform probe assertions on Windows | 按最终树/专题分组审阅；Windows | 暂缓；平台/fixture/诊断变化，本轮未实测 |
| [`bfab3386937f552d4c60761f32df9ea097fcb6f1`](https://github.com/Sandyzzx/codex-zcode-bridge/commit/bfab3386937f552d4c60761f32df9ea097fcb6f1) | fix: extend bounded Windows lock release retries | 按最终树/专题分组审阅；Windows | 低优先候选；锁重试/helper 启动预算未实测，不取整 commit |
| [`f27f7afc2b73ac21e221ec6dcf69a171fdc9fd25`](https://github.com/Sandyzzx/codex-zcode-bridge/commit/f27f7afc2b73ac21e221ec6dcf69a171fdc9fd25) | feat: add stop-the-world SQLite authority candidate | 按最终树/专题分组审阅；SQLite | 不取；需整体解决平台、authority 与 fork 功能兼容 |
| [`ca288fd386fc086410d8e1b0104196ad70d95165`](https://github.com/Sandyzzx/codex-zcode-bridge/commit/ca288fd386fc086410d8e1b0104196ad70d95165) | fix(sqlite-candidate): bind provenance to shipped bridge bundle | 按最终树/专题分组审阅；SQLite | 不取；需整体解决平台、authority 与 fork 功能兼容 |
| [`46cd3a541bc3c13ec7528d86d530afcb3f75686e`](https://github.com/Sandyzzx/codex-zcode-bridge/commit/46cd3a541bc3c13ec7528d86d530afcb3f75686e) | test: align validator fixture with node24 plugin layout | 按最终树/专题分组审阅；SQLite | 不取；需整体解决平台、authority 与 fork 功能兼容 |
| [`aae3abfad17203a54da23f24037aa9ba7484b9ba`](https://github.com/Sandyzzx/codex-zcode-bridge/commit/aae3abfad17203a54da23f24037aa9ba7484b9ba) | feat(sqlite): finalize Stage 2 cutover candidate | 按最终树/专题分组审阅；SQLite | 不取；需整体解决平台、authority 与 fork 功能兼容 |
| [`d91913a2c1b4b04485ee2815bb3b9fb80be2f131`](https://github.com/Sandyzzx/codex-zcode-bridge/commit/d91913a2c1b4b04485ee2815bb3b9fb80be2f131) | feat: add Codex rollout master token usage | 按最终树/专题分组审阅；token | 候选；按需抽取 host token 观测模块，整 commit 不取 |
| [`8ca84a1ac251d0d8f49e4fbf93c0f7f4e4082bfb`](https://github.com/Sandyzzx/codex-zcode-bridge/commit/8ca84a1ac251d0d8f49e4fbf93c0f7f4e4082bfb) | feat(sqlite): preserve local workspace workflow | 按最终树/专题分组审阅；SQLite | 不取；需整体解决平台、authority 与 fork 功能兼容 |
| [`7d66c2dad46ff0f7c6b53237ad5d59ea3ead4d4c`](https://github.com/Sandyzzx/codex-zcode-bridge/commit/7d66c2dad46ff0f7c6b53237ad5d59ea3ead4d4c) | chore(plugin): replace icons with Original E pack | 按最终树/专题分组审阅；外观 | 不取；非本轮功能需求 |
| [`5527800ad1c31660ab53a44456d8e6f2dbef3aea`](https://github.com/Sandyzzx/codex-zcode-bridge/commit/5527800ad1c31660ab53a44456d8e6f2dbef3aea) | fix: expose execution observation in MCP status schema | 按最终树/专题分组审阅；SQLite | 不取；需整体解决平台、authority 与 fork 功能兼容 |
| [`71964e0fcd941b79a76c773048c8de7caeb10036`](https://github.com/Sandyzzx/codex-zcode-bridge/commit/71964e0fcd941b79a76c773048c8de7caeb10036) | feat(sqlite): add administrative abandonment recovery | 按最终树/专题分组审阅；SQLite | 不取；需整体解决平台、authority 与 fork 功能兼容 |
| [`fb312eaf92043345cf962e7638c5b28a7c3192f0`](https://github.com/Sandyzzx/codex-zcode-bridge/commit/fb312eaf92043345cf962e7638c5b28a7c3192f0) | chore(release): assemble v1.3.0-rc.1 preview | 发布/合并元数据；发布/合并/生成元数据 | 记录身份；不独立移植 |
| [`d85f6ae92ba715ceaee7f9d593f3ba32ef16e70b`](https://github.com/Sandyzzx/codex-zcode-bridge/commit/d85f6ae92ba715ceaee7f9d593f3ba32ef16e70b) | fix(test): preserve compiled SQLite schema fixture | 按最终树/专题分组审阅；SQLite | 不取；需整体解决平台、authority 与 fork 功能兼容 |
| [`b1e01672aa7b0f8987e9dd3c06842c36ef2a6261`](https://github.com/Sandyzzx/codex-zcode-bridge/commit/b1e01672aa7b0f8987e9dd3c06842c36ef2a6261) | fix(test): create ignored token evidence parent | 按最终树/专题分组审阅；token fixture | 不取；仅相关 evidence fixture |
| [`be06ce3c480cee6c71cde00e91a6137ad67648e3`](https://github.com/Sandyzzx/codex-zcode-bridge/commit/be06ce3c480cee6c71cde00e91a6137ad67648e3) | docs(release): document fresh SQLite activation | 按最终树/专题分组审阅；SQLite | 不取；需整体解决平台、authority 与 fork 功能兼容 |
| [`f52096b5b67cd16c97261a6dda9897ea5b74b2af`](https://github.com/Sandyzzx/codex-zcode-bridge/commit/f52096b5b67cd16c97261a6dda9897ea5b74b2af) | fix(release): publish v1.3.0-rc.2 preview | 发布/合并元数据；发布/合并/生成元数据 | 记录身份；不独立移植 |
| [`f2bf7a5f6f23eed90c1f7aea314a06aca27eb111`](https://github.com/Sandyzzx/codex-zcode-bridge/commit/f2bf7a5f6f23eed90c1f7aea314a06aca27eb111) | test(runtime): preserve fixture process identity | 按最终树/专题分组审阅；Windows | 暂缓；平台/fixture/诊断变化，本轮未实测 |
| [`cab82a918514c6329f4982477b7eb0e8ada6cc01`](https://github.com/Sandyzzx/codex-zcode-bridge/commit/cab82a918514c6329f4982477b7eb0e8ada6cc01) | fix: prevent live worker recovery latch | 按最终树/专题分组审阅；SQLite | 不取；需整体解决平台、authority 与 fork 功能兼容 |
| [`ca0e19c437438d2bfcb9e79f5825893062aecd66`](https://github.com/Sandyzzx/codex-zcode-bridge/commit/ca0e19c437438d2bfcb9e79f5825893062aecd66) | fix: release local trust and recovery fences | 按最终树/专题分组审阅；SQLite | 不取；需整体解决平台、authority 与 fork 功能兼容 |
| [`0ebd983048660332610690be5e3d28493cf5182b`](https://github.com/Sandyzzx/codex-zcode-bridge/commit/0ebd983048660332610690be5e3d28493cf5182b) | fix(sqlite): harden fresh bootstrap lock and crash recovery | 按最终树/专题分组审阅；SQLite | 不取；需整体解决平台、authority 与 fork 功能兼容 |
| [`da4594146baec94997a96b2c71fa347a39c61192`](https://github.com/Sandyzzx/codex-zcode-bridge/commit/da4594146baec94997a96b2c71fa347a39c61192) | style: remove trailing blank line | 发布/合并元数据；发布/合并/生成元数据 | 记录身份；不独立移植 |
| [`80a27c98cb12e7f6a908111b2f45e453ac2e8d7d`](https://github.com/Sandyzzx/codex-zcode-bridge/commit/80a27c98cb12e7f6a908111b2f45e453ac2e8d7d) | test: make release verification portable across CI | 按最终树/专题分组审阅；SQLite | 不取；需整体解决平台、authority 与 fork 功能兼容 |
| [`4468bf6310a908d6dfd231cfae783f7efdfb402a`](https://github.com/Sandyzzx/codex-zcode-bridge/commit/4468bf6310a908d6dfd231cfae783f7efdfb402a) | test: scope production bootstrap checks to Windows | 按最终树/专题分组审阅；SQLite | 不取；需整体解决平台、authority 与 fork 功能兼容 |
| [`91cc047d35e6268403a1aa9e1898aa1c1e04f386`](https://github.com/Sandyzzx/codex-zcode-bridge/commit/91cc047d35e6268403a1aa9e1898aa1c1e04f386) | Merge pull request #50 from Sandyzzx/codex/sqlite-bootstrap-policy-20261102 | 发布/合并元数据；发布/合并/生成元数据 | 记录身份；不独立移植 |
| [`663595c4372e6a214826dc7ce11aded9f49d72d3`](https://github.com/Sandyzzx/codex-zcode-bridge/commit/663595c4372e6a214826dc7ce11aded9f49d72d3) | chore(release): request stable 1.3.0 | 发布/合并元数据；发布/合并/生成元数据 | 记录身份；不独立移植 |
| [`460b6f13eb5a738f8b133440dec8c81bad333423`](https://github.com/Sandyzzx/codex-zcode-bridge/commit/460b6f13eb5a738f8b133440dec8c81bad333423) | docs: publish stable v1.3.0 install guidance | 发布/合并元数据；发布/合并/生成元数据 | 记录身份；不独立移植 |
| [`67dd8c67275c4afeb81dd9795ee03e258083c54d`](https://github.com/Sandyzzx/codex-zcode-bridge/commit/67dd8c67275c4afeb81dd9795ee03e258083c54d) | Merge pull request #52 from Sandyzzx/codex/release-as-130-20261102 | 发布/合并元数据；发布/合并/生成元数据 | 记录身份；不独立移植 |
| [`196eb17165d2be42f1ebb4c364f2908b7da1d6bb`](https://github.com/Sandyzzx/codex-zcode-bridge/commit/196eb17165d2be42f1ebb4c364f2908b7da1d6bb) | fix(sqlite): frame bootstrap lock handoff safely | 按最终树/专题分组审阅；SQLite | 不取；需整体解决平台、authority 与 fork 功能兼容 |
| [`d53775fdd7d09efef6dd72c970c49674665c3399`](https://github.com/Sandyzzx/codex-zcode-bridge/commit/d53775fdd7d09efef6dd72c970c49674665c3399) | Merge PR #53: fix SQLite bootstrap lock handoff | 发布/合并元数据；发布/合并/生成元数据 | 记录身份；不独立移植 |
| [`26f7be806618438164e7fe65542502b0aeb53dd6`](https://github.com/Sandyzzx/codex-zcode-bridge/commit/26f7be806618438164e7fe65542502b0aeb53dd6) | chore(master): release codex-zcode-bridge 1.3.0 | 发布/合并元数据；发布/合并/生成元数据 | 记录身份；不独立移植 |
| [`58947ad770353b62ca3efccb2c6fd47c00e56894`](https://github.com/Sandyzzx/codex-zcode-bridge/commit/58947ad770353b62ca3efccb2c6fd47c00e56894) | Merge PR #51: release codex-zcode-bridge 1.3.0 | 发布/合并元数据；发布/合并/生成元数据 | 记录身份；不独立移植 |
| [`c39909a5718396f463de08b1a812cf309f3a1616`](https://github.com/Sandyzzx/codex-zcode-bridge/commit/c39909a5718396f463de08b1a812cf309f3a1616) | feat: unify ZCode path discovery | 按最终树/专题分组审阅；路径 | 候选；分组复核，尾斜杠缺陷及本地已有迁移能力阻止整搬 |
| [`c95b9c42ab9a236c9e723a4e63f9dae09cf1cacb`](https://github.com/Sandyzzx/codex-zcode-bridge/commit/c95b9c42ab9a236c9e723a4e63f9dae09cf1cacb) | fix: repair ZCode path discovery review findings | 按最终树/专题分组审阅；路径 | 候选；分组复核，尾斜杠缺陷及本地已有迁移能力阻止整搬 |
| [`c505c240f8bb21d9b7417d8c7a8c4f3323e0b633`](https://github.com/Sandyzzx/codex-zcode-bridge/commit/c505c240f8bb21d9b7417d8c7a8c4f3323e0b633) | fix: repair path discovery validation and doctor diagnostics | 按最终树/专题分组审阅；路径 | 候选；分组复核，尾斜杠缺陷及本地已有迁移能力阻止整搬 |
| [`fc0574f8eacc961d29449f1bc385be9818fcb22e`](https://github.com/Sandyzzx/codex-zcode-bridge/commit/fc0574f8eacc961d29449f1bc385be9818fcb22e) | docs: add ZCode path discoverer repair report | 按最终树/专题分组审阅；路径 | 候选；分组复核，尾斜杠缺陷及本地已有迁移能力阻止整搬 |
| [`0a157eb245859c33a0ae03c954a543e2237cefbf`](https://github.com/Sandyzzx/codex-zcode-bridge/commit/0a157eb245859c33a0ae03c954a543e2237cefbf) | docs: clarify ADR renumber audit | 按最终树/专题分组审阅；路径 | 候选；分组复核，尾斜杠缺陷及本地已有迁移能力阻止整搬 |
| [`88b21b08f8c22f3b0a81eae2767d6806f2acd95e`](https://github.com/Sandyzzx/codex-zcode-bridge/commit/88b21b08f8c22f3b0a81eae2767d6806f2acd95e) | test: make Windows path discovery cases portable | 按最终树/专题分组审阅；路径 | 候选；分组复核，尾斜杠缺陷及本地已有迁移能力阻止整搬 |
| [`82df9879a1b2b85fa7faaa94bc086e03ef30b061`](https://github.com/Sandyzzx/codex-zcode-bridge/commit/82df9879a1b2b85fa7faaa94bc086e03ef30b061) | fix: honor POSIX data directory migrations | 按最终树/专题分组审阅；路径 | 候选；分组复核，尾斜杠缺陷及本地已有迁移能力阻止整搬 |
| [`c41b6d1ed5c339ade76f377b82f63a3ada75a7d5`](https://github.com/Sandyzzx/codex-zcode-bridge/commit/c41b6d1ed5c339ade76f377b82f63a3ada75a7d5) | docs: update path discoverer final evidence | 按最终树/专题分组审阅；路径 | 候选；分组复核，尾斜杠缺陷及本地已有迁移能力阻止整搬 |
| [`df38f13006f418d40a9f06461682e880cb8bb572`](https://github.com/Sandyzzx/codex-zcode-bridge/commit/df38f13006f418d40a9f06461682e880cb8bb572) | fix: align PowerShell UNC path classification | 按最终树/专题分组审阅；路径 | 候选；分组复核，尾斜杠缺陷及本地已有迁移能力阻止整搬 |
| [`eec76db22110b2cbd3f3854dd614f0efbde4eb24`](https://github.com/Sandyzzx/codex-zcode-bridge/commit/eec76db22110b2cbd3f3854dd614f0efbde4eb24) | docs: record final PowerShell parity evidence | 按最终树/专题分组审阅；路径 | 候选；分组复核，尾斜杠缺陷及本地已有迁移能力阻止整搬 |
| [`4282b8fc64c97399416d8a9a9d53e59bc799cb67`](https://github.com/Sandyzzx/codex-zcode-bridge/commit/4282b8fc64c97399416d8a9a9d53e59bc799cb67) | fix: classify doctor data directory access errors | 按最终树/专题分组审阅；路径 | 候选；分组复核，尾斜杠缺陷及本地已有迁移能力阻止整搬 |
| [`8ace74faa6b1487ac83f17abd586ee70ce6f3bfd`](https://github.com/Sandyzzx/codex-zcode-bridge/commit/8ace74faa6b1487ac83f17abd586ee70ce6f3bfd) | docs: record final path discoverer repair verification | 按最终树/专题分组审阅；路径 | 候选；分组复核，尾斜杠缺陷及本地已有迁移能力阻止整搬 |
| [`045bdf15ff54a93c78a02e3dfc5d76c29eb261ec`](https://github.com/Sandyzzx/codex-zcode-bridge/commit/045bdf15ff54a93c78a02e3dfc5d76c29eb261ec) | docs: clarify repair report commit identity | 按最终树/专题分组审阅；路径 | 候选；分组复核，尾斜杠缺陷及本地已有迁移能力阻止整搬 |
| [`8fad454b4d4f78d82b75fbbbdee3c049346fb26a`](https://github.com/Sandyzzx/codex-zcode-bridge/commit/8fad454b4d4f78d82b75fbbbdee3c049346fb26a) | fix: compare worker paths by platform rules | 按最终树/专题分组审阅；路径 | 候选；分组复核，尾斜杠缺陷及本地已有迁移能力阻止整搬 |
| [`99758324904ea4128043c5af5949ecedb68c4d9b`](https://github.com/Sandyzzx/codex-zcode-bridge/commit/99758324904ea4128043c5af5949ecedb68c4d9b) | docs: record platform-aware doctor path verification | 按最终树/专题分组审阅；路径 | 候选；分组复核，尾斜杠缺陷及本地已有迁移能力阻止整搬 |
| [`32ed22fb743e97dd40d69f9e8c92ea912178c6b5`](https://github.com/Sandyzzx/codex-zcode-bridge/commit/32ed22fb743e97dd40d69f9e8c92ea912178c6b5) | feat: unify ZCode path discovery | 按最终树/专题分组审阅；路径 | 候选；分组复核，尾斜杠缺陷及本地已有迁移能力阻止整搬 |
| [`6f0ec6124823372bc01b71d8f6d85dcc155a84d2`](https://github.com/Sandyzzx/codex-zcode-bridge/commit/6f0ec6124823372bc01b71d8f6d85dcc155a84d2) | chore(master): release codex-zcode-bridge 1.4.0 | 发布/合并元数据；发布/合并/生成元数据 | 记录身份；不独立移植 |
| [`879568c211bac6233817acc90923e23d7861ca79`](https://github.com/Sandyzzx/codex-zcode-bridge/commit/879568c211bac6233817acc90923e23d7861ca79) | chore(master): release codex-zcode-bridge 1.4.0 | 发布/合并元数据；发布/合并/生成元数据 | 记录身份；不独立移植 |
| [`7b4dcaa9a9e1dc5bc9b20c2aa9eead3d31f29cbd`](https://github.com/Sandyzzx/codex-zcode-bridge/commit/7b4dcaa9a9e1dc5bc9b20c2aa9eead3d31f29cbd) | feat: bind doctor to SQLite authority and add test impact gating | 按最终树/专题分组审阅；SQLite | 不取；需整体解决平台、authority 与 fork 功能兼容 |
| [`bf06f5204723915ebfe3723c18a181736a292556`](https://github.com/Sandyzzx/codex-zcode-bridge/commit/bf06f5204723915ebfe3723c18a181736a292556) | fix(test): respect Windows-only SQLite lifecycle support on POSIX | 按最终树/专题分组审阅；SQLite | 不取；需整体解决平台、authority 与 fork 功能兼容 |
| [`23958d8098dfed4016d0a7c60895b6651f663898`](https://github.com/Sandyzzx/codex-zcode-bridge/commit/23958d8098dfed4016d0a7c60895b6651f663898) | fix(ci): diagnose Windows worker identity probes | 按最终树/专题分组审阅；Windows | 暂缓；平台/fixture/诊断变化，本轮未实测 |
| [`43db9a7e2c470cdeb523bd174645c41e0793105e`](https://github.com/Sandyzzx/codex-zcode-bridge/commit/43db9a7e2c470cdeb523bd174645c41e0793105e) | ci: pin Windows lifecycle checks to Server 2022 | 按最终树/专题分组审阅；Windows | 暂缓；平台/fixture/诊断变化，本轮未实测 |
| [`2ee975df603aafe9b5246d831dbfd30aba761000`](https://github.com/Sandyzzx/codex-zcode-bridge/commit/2ee975df603aafe9b5246d831dbfd30aba761000) | fix(runtime): launch Windows identity probe directly | 按最终树/专题分组审阅；Windows | 暂缓；平台/fixture/诊断变化，本轮未实测 |
| [`0308d5e2905ad530232fc267feaa32b92da3c6e9`](https://github.com/Sandyzzx/codex-zcode-bridge/commit/0308d5e2905ad530232fc267feaa32b92da3c6e9) | ci: compare Windows worker PowerShell environments | 按最终树/专题分组审阅；Windows | 暂缓；平台/fixture/诊断变化，本轮未实测 |
| [`3925eabae634b3d4b7a48aa190ae3e4615875066`](https://github.com/Sandyzzx/codex-zcode-bridge/commit/3925eabae634b3d4b7a48aa190ae3e4615875066) | fix(runtime): pin Windows PowerShell module discovery | 按最终树/专题分组审阅；Windows | 暂缓；平台/fixture/诊断变化，本轮未实测 |
| [`21ffa7581aac7f3cc6cc9ef1234b1d896864df96`](https://github.com/Sandyzzx/codex-zcode-bridge/commit/21ffa7581aac7f3cc6cc9ef1234b1d896864df96) | fix(runtime): avoid PowerShell module lookup in identity probe | 按最终树/专题分组审阅；Windows | 暂缓；平台/fixture/诊断变化，本轮未实测 |
| [`a26a72da2c2890252474f189f8fea37102dcd36a`](https://github.com/Sandyzzx/codex-zcode-bridge/commit/a26a72da2c2890252474f189f8fea37102dcd36a) | docs: record bounded Windows process identity probe | 按最终树/专题分组审阅；Windows | 暂缓；平台/fixture/诊断变化，本轮未实测 |
| [`6050e1ecc0e3d5e11fba6c51a3365bcd0bdc03bf`](https://github.com/Sandyzzx/codex-zcode-bridge/commit/6050e1ecc0e3d5e11fba6c51a3365bcd0bdc03bf) | fix(store): widen bounded transient lock retries | 按最终树/专题分组审阅；Windows | 低优先候选；锁重试/helper 启动预算未实测，不取整 commit |
| [`71182ad9f1fafb25639aa8b74d5043a7b571552f`](https://github.com/Sandyzzx/codex-zcode-bridge/commit/71182ad9f1fafb25639aa8b74d5043a7b571552f) | test(sqlite): retain lifecycle diagnostics on adapter failure | 按最终树/专题分组审阅；SQLite | 不取；需整体解决平台、authority 与 fork 功能兼容 |
| [`ba9277df8ee1daef0434b1e8b26645f1e80e4044`](https://github.com/Sandyzzx/codex-zcode-bridge/commit/ba9277df8ee1daef0434b1e8b26645f1e80e4044) | Merge pull request #56 from Sandyzzx/codex/sqlite-doctor-test-gating-integration-20261103 | 发布/合并元数据；发布/合并/生成元数据 | 记录身份；不独立移植 |
| [`85fd984ef1ba3cf38fbe08694b69ad9401cdd951`](https://github.com/Sandyzzx/codex-zcode-bridge/commit/85fd984ef1ba3cf38fbe08694b69ad9401cdd951) | chore(master): release codex-zcode-bridge 1.5.0 | 发布/合并元数据；发布/合并/生成元数据 | 记录身份；不独立移植 |
| [`77dd5f14ee61701ac15872192429ecd4f53e1323`](https://github.com/Sandyzzx/codex-zcode-bridge/commit/77dd5f14ee61701ac15872192429ecd4f53e1323) | Merge pull request #57 from Sandyzzx/release-please--branches--master--components--codex-zcode-bridge | 发布/合并元数据；发布/合并/生成元数据 | 记录身份；不独立移植 |
| [`9b7b0c7a7f2ea5be0d7be70dc04ebec6fb64a24a`](https://github.com/Sandyzzx/codex-zcode-bridge/commit/9b7b0c7a7f2ea5be0d7be70dc04ebec6fb64a24a) | feat(sqlite): scope hold recovery to workspace per ADR-024 | 按最终树/专题分组审阅；SQLite | 不取；需整体解决平台、authority 与 fork 功能兼容 |
| [`785304d359a61b9dc11aa1a438ca5780594766f5`](https://github.com/Sandyzzx/codex-zcode-bridge/commit/785304d359a61b9dc11aa1a438ca5780594766f5) | feat: unify attention waiting with thin waiter | 按最终树/专题分组审阅；waiter | 不取；上游 SQLite attention/waiter 未与 fork 预约路径认证 |
| [`b3ac540e295994277d05881309d08231edcf5c17`](https://github.com/Sandyzzx/codex-zcode-bridge/commit/b3ac540e295994277d05881309d08231edcf5c17) | fix: address M2 attention waiter review findings | 按最终树/专题分组审阅；waiter | 不取；上游 SQLite attention/waiter 未与 fork 预约路径认证 |
| [`a0707fc9bd4e5dc45ea8be07c2dac5fc5f59a435`](https://github.com/Sandyzzx/codex-zcode-bridge/commit/a0707fc9bd4e5dc45ea8be07c2dac5fc5f59a435) | docs: renumber attention decision to ADR-025 after ADR-024 hold collision | 按最终树/专题分组审阅；waiter | 不取；上游 SQLite attention/waiter 未与 fork 预约路径认证 |
| [`020d138af77c747a46762805b1ef34360abb282a`](https://github.com/Sandyzzx/codex-zcode-bridge/commit/020d138af77c747a46762805b1ef34360abb282a) | build: regenerate wait-task bundle from integrated source | 按最终树/专题分组审阅；waiter | 不取；上游 SQLite attention/waiter 未与 fork 预约路径认证 |
| [`28c132546284c8d774da871eff0b8baf97174c48`](https://github.com/Sandyzzx/codex-zcode-bridge/commit/28c132546284c8d774da871eff0b8baf97174c48) | test: use a writable scratch root for waiter fixtures on POSIX | 按最终树/专题分组审阅；waiter | 不取；上游 SQLite attention/waiter 未与 fork 预约路径认证 |
| [`c7703451b51d6cb7d0922671a739e672bd690b7e`](https://github.com/Sandyzzx/codex-zcode-bridge/commit/c7703451b51d6cb7d0922671a739e672bd690b7e) | Merge pull request #58 from Sandyzzx/codex/adr024-m2-integration-publish-20261105 | 发布/合并元数据；发布/合并/生成元数据 | 记录身份；不独立移植 |
| [`4a3763ebbd61f8b9d12b9464e2e406df70d0ce88`](https://github.com/Sandyzzx/codex-zcode-bridge/commit/4a3763ebbd61f8b9d12b9464e2e406df70d0ce88) | fix: keep worker alive through app-server and cleanup-helper teardown races | 逐代码专项核查；helper stdin | 选中待落地（部分采纳）；仅 stdin error hunk，其余不取 |
| [`7fbbfceca166eba7e51110c8c64727b8bceaf19f`](https://github.com/Sandyzzx/codex-zcode-bridge/commit/7fbbfceca166eba7e51110c8c64727b8bceaf19f) | fix: exit claim-only workers deterministically after result write | 按最终树/专题分组审阅；SQLite worker | 不取；claim-only SQLite worker 专用退出路径 |
| [`78115c188c66233b4f83561d2fca1e5fec70b1da`](https://github.com/Sandyzzx/codex-zcode-bridge/commit/78115c188c66233b4f83561d2fca1e5fec70b1da) | fix: keep the MVP fake app-server alive in hosted CI | 按最终树/专题分组审阅；fixture | 不取；MVP fake app-server fixture，不是生产修复 |
| [`b8f1679631f494ace1ae41180599b17dbe8a4c91`](https://github.com/Sandyzzx/codex-zcode-bridge/commit/b8f1679631f494ace1ae41180599b17dbe8a4c91) | test: surface bounded Windows cleanup failure summaries | 按最终树/专题分组审阅；Windows | 暂缓；平台/fixture/诊断变化，本轮未实测 |
| [`fc739471d0a566d19ec6d9a308c8b5c34b53d7da`](https://github.com/Sandyzzx/codex-zcode-bridge/commit/fc739471d0a566d19ec6d9a308c8b5c34b53d7da) | fix: allow bounded startup time for Windows cleanup helper | 按最终树/专题分组审阅；Windows | 低优先候选；锁重试/helper 启动预算未实测，不取整 commit |
| [`a6ba76c7a3ddb97e4c7f37754eb85c7eb9c9d82b`](https://github.com/Sandyzzx/codex-zcode-bridge/commit/a6ba76c7a3ddb97e4c7f37754eb85c7eb9c9d82b) | fix: avoid duplicate turn-start events on coalesced ACKs | 逐代码专项核查；合帧 ACK | 选中待落地（部分采纳）；仅去重 guard，待本地回归 |
| [`f8cfb510c9ba8a0be31b5887277a7ff7cf7c4dfa`](https://github.com/Sandyzzx/codex-zcode-bridge/commit/f8cfb510c9ba8a0be31b5887277a7ff7cf7c4dfa) | Merge pull request #60 from Sandyzzx/codex/mvp-real-adapter-ci-fix-20261105 | 发布/合并元数据；发布/合并/生成元数据 | 记录身份；不独立移植 |
| [`97c8280a7c914820723938d430e4a7906b85ffed`](https://github.com/Sandyzzx/codex-zcode-bridge/commit/97c8280a7c914820723938d430e4a7906b85ffed) | chore(master): release codex-zcode-bridge 1.6.0 | 发布/合并元数据；发布/合并/生成元数据 | 记录身份；不独立移植 |
| [`aabbb0a959ee234508c62731ed5122f28dfcf5b0`](https://github.com/Sandyzzx/codex-zcode-bridge/commit/aabbb0a959ee234508c62731ed5122f28dfcf5b0) | Merge pull request #59 from Sandyzzx/release-please--branches--master--components--codex-zcode-bridge | 发布/合并元数据；发布/合并/生成元数据 | 记录身份；不独立移植 |

### preview 相对 recorded master：11 个提交

| 完整 SHA | Git subject | 审阅强度 / 专题 | 本轮处置 |
|---|---|---|---|
| [`f351847987f25108cf59468dda78ef6fd57ba3f8`](https://github.com/Sandyzzx/codex-zcode-bridge/commit/f351847987f25108cf59468dda78ef6fd57ba3f8) | chore(prereview): establish independent marketplace channel | 发布/合并元数据；渠道/CI/发布 | 记录身份；不独立移植 |
| [`d77de9bb5cbdc034ccc5386c2c4b7b7c11627224`](https://github.com/Sandyzzx/codex-zcode-bridge/commit/d77de9bb5cbdc034ccc5386c2c4b7b7c11627224) | chore(prereview): distinguish preview plugin listing | 发布/合并元数据；渠道/CI/发布 | 记录身份；不独立移植 |
| [`c2e73205e1f338fdd9675532c338e83fb04ca325`](https://github.com/Sandyzzx/codex-zcode-bridge/commit/c2e73205e1f338fdd9675532c338e83fb04ca325) | Prereview 1.6.0-prereview.2: Start Plan P0 integration (#62) | 按最终树/专题分组审阅；Start Plan | 不取；SQLite 依赖及真实 turn 未通过边界见正文 |
| [`46d40d2cd68619cd0b6350cd236d1d99f2f7a249`](https://github.com/Sandyzzx/codex-zcode-bridge/commit/46d40d2cd68619cd0b6350cd236d1d99f2f7a249) | Preview 1.6.0-preview.2: rename prereview channel to preview (#63) | 发布/合并元数据；渠道/CI/发布 | 记录身份；不独立移植 |
| [`3ac67514f5959dad1195b149bfd3bc2ce038aa2d`](https://github.com/Sandyzzx/codex-zcode-bridge/commit/3ac67514f5959dad1195b149bfd3bc2ce038aa2d) | ci(preview): run push CI on the preview branch (#64) | 发布/合并元数据；渠道/CI/发布 | 记录身份；不独立移植 |
| [`7df1a205ce4308bc6c3b321fc92d1c1cb58f7367`](https://github.com/Sandyzzx/codex-zcode-bridge/commit/7df1a205ce4308bc6c3b321fc92d1c1cb58f7367) | fix(start-plan): decode official encrypted credentials (#65) | 按最终树/专题分组审阅；Start Plan | 不取；SQLite 依赖及真实 turn 未通过边界见正文 |
| [`265466cddca6dff5dcff8527b15379c66cadb8b3`](https://github.com/Sandyzzx/codex-zcode-bridge/commit/265466cddca6dff5dcff8527b15379c66cadb8b3) | chore(release): prepare 1.6.0-preview.3 (#66) | 发布/合并元数据；渠道/CI/发布 | 记录身份；不独立移植 |
| [`d9b9819860320cbad6152a57a944604e5f70173e`](https://github.com/Sandyzzx/codex-zcode-bridge/commit/d9b9819860320cbad6152a57a944604e5f70173e) | feat(preview): integrate SQLite-only runtime and Start Plan (#67) | 按最终树/专题分组审阅；SQLite-only | 不取；删除旧 JSON runtime，无法独立移植 Start Plan |
| [`064d23ce2d46aa7cda4519cc495f849e4fb60f22`](https://github.com/Sandyzzx/codex-zcode-bridge/commit/064d23ce2d46aa7cda4519cc495f849e4fb60f22) | feat(routing): Model Routing v1 and Desktop host compatibility (#68) | 逐代码专项核查；路由 | 不取；task_id cache、registry 与 journal 风险见正文 |
| [`003d508c9a7630c5355fcab6007453dd8e77c33d`](https://github.com/Sandyzzx/codex-zcode-bridge/commit/003d508c9a7630c5355fcab6007453dd8e77c33d) | fix(start-plan): repair provider registration contract (#69) | 按最终树/专题分组审阅；Start Plan | 不取；SQLite 依赖及真实 turn 未通过边界见正文 |
| [`61c78b7c637432d3d39768c48030609d6dbf253a`](https://github.com/Sandyzzx/codex-zcode-bridge/commit/61c78b7c637432d3d39768c48030609d6dbf253a) | chore(release): prepare 2.0.0-preview.2 (#70) | 发布/合并元数据；渠道/CI/发布 | 记录身份；不独立移植 |
