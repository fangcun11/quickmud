# Changelog

本项目遵循[语义化版本](https://semver.org/)。

## [Unreleased]

### 修复（跨 0.3/0.4 全量审查产出，2026-09-02）

**引擎（确定性边界）**
- 实体 ID 计数器进快照：`SnapshotData.idCounter`，`rollbackWorld`/fork 后
  `create()` 与主世界拥有相同的"未来"（此前 fork/读档世界从 0 起算，ID 分叉）
- 快照的延时事件载荷（`scheduler.pendingEvents[].data`）深拷贝：
  fork 世界触发修改不再隔空污染主世界尚未触发的载荷
- **degrade 隔离态随 fork 继承**（`EventPump.getDisabled/restoreDisabled`）：
  已降级系统不会在分叉世界复活
- 事件预算按 tick 重置：纯 tick 长跑（start()/自动世界）不再因跨 tick 累计超限崩溃；
  单 tick 内风暴仍受预算约束
- `TestWorld.emit` 事件日志去重（此前与命令路径双记录，计数断言会误报）；
  `createTestWorld` entities 夹具支持固定 id（不再静默丢弃）
- `ArgumentDefinition.filter` 死承诺删除（parseArgs 从不执行，类型诚实化）；
  `define-command` 误导性示例改写

**@mud/prefabs（物品语义）**
- **take/drop 改为容器作用域内解析**（`queries.ts`：resolveInContainer）：消除
  跨容器同名物品被先创建者永久遮蔽的硬锁死（眼前的东西永远拿不到/放不下）
- `look <目标>` 落地：查看当前房间容器内物品描述（此前 target 参数无人消费）
- 玩家无 Position 时 take/drop 给出明确反馈（此前静默无输出）
- 工程：vitest 直连引擎源码已配（前版）；契约冒烟补 0.3-C 物品链路
  （take→inventory→drop→look，外部 dist 零验证的盲区补上）

**demo / 文档**
- 隔空买酒拦截：效果系统校验玩家在酒馆（对话命令的同室校验留待 NPC 归属）
- help 文本与实际注册表对齐（补 go/开发者命令、quit 注明仅 REPL）
- build-html.js 补 `@mud/prefabs` 源码 alias（此前 web bundle 混用陈旧 dist）
- `Located` 误标 `@deprecated` 修正；engine README 版本/变量小错修正

## [0.4.0] - 2026-09-02

主题：**实体物品容器模型**（`@mud/ecs-engine` 0.4.0 / `@mud/prefabs` 0.2.0）。

### 新增

- **实体物品容器模型（0.3-C，@mud/prefabs）**
  - `Located { at }` trait：物品的**单源位置**（房间/玩家/箱子实体皆可为容器）；
    玩家背包 = `Located.at == 玩家` 的实体集合
  - `ItemTaken` / `ItemDropped` 事件 + `ItemSystem`：take/drop 校验（当前房间 +
    Portable / 背包持有）与转移，全部组件态 → 快照/回滚/录像天然一致
  - `take` / `drop` 命令（take/get/拿/拾取、drop/put/放下/丢弃）
  - `DescriptionSystem` 增强：look 列出房间地上可拾取物
  - demo 闭环：广场剑/金币可拾取放下、对话买酒（`DialogueChoiceMade` 效果系统）
    把麦酒真实转入背包
- **引擎查询原语**：`SystemContext` / `CommandContext.world` 注入
  `findByComponent(component)`（按组件查实体），容器查询的基础

### 变更（破坏性）

- **`Inventory { items: string[] }` 退役**（@mud/prefabs）：由 Located 实体模型取代
- **`/give` 从引擎开发者命令移除**：其 inventory.items 约定随组件退役；物品版
  开发者能力归 prefabs。`createDeveloperCommands()` 现为 `/tp /heal /dev-help`
  （0.3.0 未发布到 npm，实际影响为零）

## [0.3.0] - 2026-09-02

主题：**内容表达力 + 领域预制件**。路线图见 `docs/roadmap-0.3.md`。

### 新增

- **新包 `@mud/prefabs`（领域预制件，0.3-D）**
  - 分层决策：引擎只留能力原语与对话机制，**领域常用件外置**——移动/房间、
    查看/描述、背包、状态从 demo 上移为正式库包，换游戏直接复用
  - `traits.ts`：Health / Position / Inventory / Description / Exits / Portable /
    Weapon（组件名即约定，引擎开发者命令 /tp /give /heal 的命名约定正式主人）
  - `events.ts` / `systems.ts`：`Moved`+`MovementSystem`（出口校验、落位、描述）、
    `Look`+`DescriptionSystem`
  - `commands.ts`：`GoCommand`、`createDirectionCommand`、`LookCommand`、
    `InventoryCommand`、`ScoreCommand`
  - 质量门与 engine 同标准：确定性 ESLint 禁令、集成测试（9 个）、构建双格式、
    外部契约测试（ESM/CJS/TS strict 全新安装）
  - demo-adventure 改为消费 `@mud/prefabs`（bootstrap 只留世界观内容），
    删除上移的重复源码（约 300 行）；REPL / Web 双端回归通过

- **对话与 NPC（0.3-B 核心）**
  - `Dialogue` trait（对话树 + 活动指针）与 `Memory` trait（记忆 flags），组件数据纯 JSON 可序列化
  - `defineDialogue(entry, nodes)`：内容定义 + 校验（entry/to 引用、id 唯一，fail-fast）
  - `DialogueSystem`：唯一推进对话状态的手。talk/choose 展示文本与"可用选项"
    （`requires` flags 门过滤）、选项推进（`remember` 写记忆、跳转 to / reply 收尾）、
    无可用选项自动结束；随快照/回滚/存档走
  - `createDialogueCommands()`：`talk/ask/说/对话 <npc> [序号]`，动词冲突 fail-fast 同引擎惯例
  - `DialogueChoiceMade` 事件：选项生效时 emit，供游戏层效果系统订阅
    （给物品、发任务等副作用走事件链，不在对话模块内实现）
- **蓝图 spawn 隔离性**：同蓝图多次 spawn 的实体组件数据深拷贝隔离
  （此前直接挂引用，改 A 组件会"隔空"污染 B，破坏蓝图不可变承诺）

### 修复

- **every 系统时相改为由世界时间派生的固定网格（drift-free）**：原"自上次触发起算"依赖
  游离于快照之外的 `lastRunAt`——`rollbackWorld` 回滚后 every 系统静默失联（时相指向未来，
  长时间不再触发）；`fork()` 出的沙盒因 lastRun=0，在 `timeMs` 已推进的主世界上 fork 后首个
  tick 会立即误触发全部周期系统。现改为按 `k * every` 网格跨点触发，时相随 `worldTime`
  走，快照 / 回滚 / fork / 录像重放天然一致，且长期无漂移（10 tick×100ms / every=250ms
  下由触发 3 次变为精确 4 次）。此变更属行为语义调整：触发时刻可能平移至网格承接点。
- `Recording.engineVersion` 硬编码 `'engine'` → `ENGINE_VERSION`（版本单一事实源 = package.json）
- `createTestWorld()` 工厂签名补齐 `commands`：与构造器共用 `TestWorldConfig` 类型，
  杜绝两份签名再次漂移（此前运行时支持、类型层未兑现）
- `TestWorld.runChain()` 空转忙等死循环风险 → 改为显式调用 `EventPump.drain()`
- `EventPump.processEvent` 移除恒返回 `undefined` 的 `getEntity` 死 context
  （破坏性：直接经 `EventPump.on` 订阅收到的 `EventContext` 现在只含 `emit`；
  经 `defineSystem`+`World.register` 的系统不受影响，仍收到完整 `SystemContext`）
- `findEntityByName` 改为分级匹配（精确优先）：主名精确 > 别名精确 > 主名子串 >
  别名子串 > 输入反包含。先注册的长名不再用子串包含抢走后注册的精确同名实体
- `World.spawn` 的 `patch` 引用蓝图中不存在的组件时 fail-fast 抛错（不再静默失效）
- `EventPump` 新增公开 `drain()` 方法（测试工具显式排水的官方通道）
- Web demo 构建回归：`build-html.js` external 清单缺 `node:` 前缀（FsBackend 的
  `import('node:path')` 在 esbuild 无法解析，浏览器打包失败）——补 `node:path`/`node:fs/promises`

## [0.2.0] - 2026-09-02

主题：**基建补全 + 确定性能力**。路线图见 `docs/roadmap-0.2.md`。

### 新增

- **定时系统**（A1）
  - `defineSystem({ every: ms })`：周期系统，由 `World.tick()` 驱动，载荷 `{ token: 'engine:tick', data: { time } }`
  - `ctx.after(delayMs, event, data)`：调度一次性延时事件
  - 延时事件纳入快照，回滚不丢失、不重复；`SnapshotData.worldTime` 字段（0.1 存档免迁移）
- **系统错误策略**（A2）
  - `defineSystem({ onError })`：`propagate`（默认，fail-fast）/ `skip`（记录继续）/ `degrade`（记录+隔离禁用）
  - `world.getSystemErrors()` / `clearSystemErrors()`
- **输出渲染参考实现**（A3）
  - `renderAnsi`（终端，kind 默认色 + segment 覆盖，`noColor` 选项）
  - `renderSemanticHtml`（`<p class="mud-{kind}"><span data-...>`，HTML 转义，`data-entity-ref` 交互）
  - `renderPlainText`（纯文本兜底）
- **开发者命令**（A4）
  - `createDeveloperCommands()`：`/tp` `/give` `/heal` `/dev-help`，按组件命名约定
    （position/inventory/health）操作；走标准流水线，受快照/回滚/录像覆盖
- **录像重放**（D1）
  - `record(world)` → `stop()` 产出可 JSON 序列化的录像
  - `replay` / `verifyReplay`：全新世界重放并逐字段比对，`firstDiff` 定位首个分叉路径
- **世界分叉**（D2）
  - `world.fork()`：快照深拷贝的沙盒世界（含系统/命令），与主世界零共享；
    适合 NPC AI 决策试跑、技能预演。无 COW（已文档化），1000 实体 < 100ms
- **确定性防护体系**（D3）
  - 金测试：200 步固定场景，双跑深度相等 + 快照基线 + 回滚重放一致性
  - ESLint 强制禁用 `Math.random` / `Date.now` / `new Date` / `performance.now` / crypto / nanoid

### 修复

- `EntityManager.create()` 弃用随机 ID（nanoid）→ 确定性计数器 ID（碰撞保护）
- `EventPump` 默认时间源 `Date.now()` → 内部单调计数器（可注入 `now`）
- `SavePort.migrate` 迁移后未推进 `engineVersion` 导致死循环；现按 `migration.to`
  推进并校验 `to > from`
- `createSnapshot` 组件数据浅引用——后续突变会反向污染过去快照；改 `structuredClone`
- `CommandDefinition.handle` 返回 `void` 类型不合法（纯 emit 型命令需 `return null`）
- `.d.ts` 相对导入无扩展名，node16 解析下外部 TS 消费者编译失败（build 后处理补 `.js`）
- `ManualClock` / `TestWorld` 被误导出为纯类型，运行时不可用

### 变更

- 实体 ID 格式：nanoid 12 位随机串 → `e<n>` 计数器格式（确定性；读档恢复的旧 ID 照常工作）
- 引擎依赖清零：nanoid 移除，运行时/编译期零第三方依赖（Node 内置除外）
- `execute()` 移除 `/` 前缀硬编码拦截，开发者命令走标准注册表
- `createTestWorld` 支持 `commands` 注册

### 基础设施

- 外部消费者契约测试 `pnpm test:contract`：pack → 全新安装 → ESM/CJS 运行时 → TS strict
- 文档示例验证脚本：`docs/examples/` 全部实测防腐烂

## [0.1.0] - 2026-09-01

首个可用版本：事件驱动 ECS 核心、命令系统、快照/回滚、SavePort 持久化与迁移链、
测试工具（createTestWorld/ManualClock）、demo-adventure 示例。
