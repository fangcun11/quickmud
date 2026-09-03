# Changelog

本项目遵循[语义化版本](https://semver.org/)。

## [0.9.0] - 2026-09-04

主题：**区域（Area）+ 自包含房间模块**——房间之上补上 MUD 经典分层缺失的
"区域"层，房间本身从"静态数据块"升级为"自包含内容模块"（`@mud/prefabs` 0.7.0；
`@mud/ecs-engine` **连续三版停在 0.6.0**）。无 breaking。

### 新增（@mud/prefabs）

- **语义拆分：`MoveRequested` vs `Moved`**（正确性的地基）：命令只发**意图**
  `MoveRequested { entity, to: 方向 }`，`MovementSystem` 落位后才发**结果**
  `Moved { entity, from, to: 房间id, direction? }`。v0.8 的 `Moved.to` 是方向的
  陷阱到此为止——行为系统不会再把"想去"当"到了"
- **区域层**：`defineArea` + `layoutWorld` + `buildAreas`
  - 每个区域是**一张独立二维平面**（自己的坐标系）：跨层空间（塔顶/洞穴）各自
    成区域，v0.8"非四方向出口拿不到坐标"的边界自然消失
  - **单一真相**：房间声明 `area`，区域不抄 rooms 反表；区域出口由**跨区域
    房间出口反推**（改房间忘改区域这种事在结构上不可能发生）；区域坐标与房间
    同款 BFS（`inferPlane` 复用，房间图与区域图同构）
  - **区域是实体不是标签**（`area:` 前缀实体 id）：能挂天气/危险度等自己的
    组件，进快照 / fork / 回滚
  - 校验 fail-fast：区域不存在 / 空区域 / 孤岛区域 / 区内孤岛（多半是 `area`
    标错了）/ 区域出口冲突（同方向通向两个区域）/ 入口锚不了坐标系
  - `MapCommand` 自动按当前区域过滤（两套坐标系不相撞，抬头带【区域名】）；
    新增 `WorldMapCommand`（worldmap/wmap/世界地图）：区域之间的连接图，
    战争迷雾口径 = 区域内去过任意一间房；无区域世界向后兼容 v0.8 行为
- **自包含房间模块**：`defineRoom` 扩展 `state` / `on` / `commands`
  - `on.canEnter` / `canLeave`：**同步守卫**——拒绝 = 不落位、不记 `Visited`、
    无 enter、输出理由（事件泵无取消语义，守卫必须在 MovementSystem 提交前
    同步查询，这是 `MoveRequested`/`Moved` 拆分的直接收益）
  - `on.enter` / `leave` / `firstEnter` / `look` / `every`：生命周期在**真正
    落位后**触发；`firstEnter` 的账由 prefabs 记（`RoomEnterLog`），不污染内容
    state；`every` 是世界时间驱动的房间心跳（间隔必须是 tick 间隔的整数倍，
    定义期 fail-fast；`RoomClock` 记账，drift-free）
  - `state` 组件：房间状态进快照 / fork / 回滚；**闭包变量才是快照的敌人**——
    未声明 state 却摸 `ctx.state` 会直接报一句人话
  - `commands`：房间命令 = 纯翻译层（位置校验 + 发 `RoomCommandInvoked`）+
    派发器在事件泵内以系统特权执行（spawn/destroy/output），**"命令不改状态"
    铁律对翻译层依然成立**；动词冲突 fail-fast；spawn 出来的东西真捡得走
  - **派发是查表不是一房一系统**：`RoomEventSystem` / `RoomTickSystem` 两对
    共享派发器服务所有房间（`RoomBehaviorRef` 索引指向模块级行为注册表，
    函数不进快照）；`onError: 'skip'`——故障域 = 单房间，一个房间的 bug
    不连坐全世界

### 变更（example/mini-rpg 迁移）

- 沼泽毒雾从"独立系统硬编码房间 id + `Exits` 反查"改写为沼泽房间的
  `on.enter`——**本方案价值的直接演示**（机制与房间同住，删房间即删机制）
- 蛛巢洞穴改用 `state` 组件 + 房间命令实现一次性 `search`（搜出旧铜币可拾取）
- 世界三区域化（村庄/野地/蛛巢），`help` 补 `worldmap` 条目、`map` 语义更新
  为"当前区域"；content.test 扩到区域地图 / 世界地图 / 房间命令 / firstEnter 断言

### 测试与文档

- prefabs 新增 `behavior.test.ts`（24 例：生命周期 / 守卫 / state 快照与回滚 /
  fork 状态隔离 / 房间命令特权 / 派发架构 / 确定性）+ `area.test.ts`
  （23 例：独立坐标系 / 出口反推 / up-down 跨层 / 全套 fail-fast / entryArea
  回退 / 区域过滤 / 世界地图迷雾）；`Moved` 语义修正相关用例同步改写
- 契约测试补 v0.9 链路：ESM（区域出口反推 + 守卫 + 房间命令 + worldmap）、
  CJS（区域/房间行为导出）、TS strict（`ctx.state` 类型推导）
- 新增 `docs/examples/06-area-room-behavior.mts`（区域 + 房间模块 + 守卫 +
  生命周期 + `every`），纳入 strict tsc + 运行双验证
- prefabs README 增「区域与世界地图 + 自包含房间行为（v0.9）」章节
- 设计定稿与实现记录见 `docs/roadmap-0.9.md`

## [0.8.0] - 2026-09-03

主题：**房间定义封装 + 隐式坐标 + ASCII 地图**（`@mud/prefabs` 0.6.0；`@mud/ecs-engine`
**连续两版停在 0.6.0**——引擎零改动，分层成功的标志）。无 breaking。

### 新增（@mud/prefabs）

- **房间定义封装**（最后一个没有 `define*` 的领域对象补上了）：
  - `defineRoom()`——纯数据定义（可 JSON、进快照），校验 id/name 非空
  - `layoutRooms(defs, { entry, entryCoords?, checkReverseExits? })`——BFS 从入口铺开，
    四方向偏移自动推断坐标；**冲突一律定义期 fail-fast**：重复 id / 悬空出口 /
    坐标撞格（图无法嵌入平面）/ 显式坐标不一致与重叠 / 反向出口不自洽
    （A east→B 但 B 用 east→ 指回 A，手滑最常见形态）/ 孤岛房间
  - `buildRooms(world, layout)`——注入世界（Name/Description/Exits/Coordinates）
- **`Coordinates` trait**：`Exits` 拓扑的**派生产物**，不是第二份真相
  （单一真相铁律：只写出口，坐标跟着拓扑走）
- **`Visited` trait + `VisitationSystem`**：探索记录（走到的房间写进 `Visited`，
  可 JSON、进快照）；用 `Exits[方向]` 反查目标房间——与 v0.7 沼泽毒雾同款
  `Moved.to` 是方向陷阱，撞墙不记账
- **ASCII 地图**：`renderAsciiMap()` 纯函数（坐标 → 字符串，测试可直接断言每一行）+
  `map` 命令；**迷雾**：挂 `Visited` 只画已探明房间、连线两端都探明才画
  （不泄漏邻接）；未挂则渲染全图；`markVisited()` seed 出生房间
- 非四方向出口（`up/down`）可达但**无坐标**——跨层空间二维平面装不下，地图不画

### 变更（example 迁移，行为不变）

- mini-rpg 与 demo-adventure 的 bootstrap 改用 `defineRoom`/`layoutRooms`/`buildRooms`，
  注册 `VisitationSystem` + `MapCommand`，玩家出生点用 `layout.entry`
  （拓扑与初始位置不可能写歪）
- mini-rpg content.test.ts 扩到 7 幕：出生点地图只亮自己 → 终局全图展开
  （`@—· / │ / ·—·`）；顺手修正森林描述文案与拓扑不符的旧 bug
- `help` 补 `map` 条目

### 文档

- prefabs README 增「房间定义与 ASCII 地图（v0.8）」章节
- 新增 `docs/examples/05-room-map.mts`（定义/推断/fail-fast/全图/迷雾），
  纳入 strict tsc + 运行双验证
- 契约测试补 v0.8 链路：ESM（拓扑 fail-fast + map 命令 + 迷雾渲染）、
  CJS（房间/地图导出）、TS strict（定义/布局/渲染类型）
- 设计定稿与实现记录见 `docs/roadmap-0.8.md`

## [0.7.0] - 2026-09-02

主题：**Buff 系统 + 首个"纯内容"游戏**（`@mud/prefabs` 0.5.0；`@mud/ecs-engine`
**停在 0.6.0**——本版引擎零改动，分层成功的标志）。无 breaking。

### 新增（@mud/prefabs）

- **最小 Buff 系统（定时效果层）**：`Afflicted`/`Duration` trait + `BuffSystem`
  （every 1000 结算）+ `BuffCleanupSystem`（死亡清场，priority 50，管线中段）+
  `buffBlueprint()` 蓝图工厂。**Buff 是实体不是列表组件**（与 `Located` 同哲学）：
  `findByComponent(Afflicted)` 查询、structuredClone 快照天然安全、
  未来的叠加/互斥（v0.8）不用改数据结构
- 计时模型：内容层 `startedAt` 留 0（待激活），`BuffSystem` 首个结算网格写入世界
  时间——**内容层零时间感知**（spawn 即忘）；结算自 `lastTickedAt` 起计
  `effect.every`（固定网格在粒度不对齐时会重复结算，弃用）；到期那格不再结算；
  `lasts <= 0` 表示永久
- **毒杀走完整死亡管线**：HP 归零 emit `Died`（killer = buff 的 `source`）→
  掉落/任务计数/清场全部照常生效
- 事件：`BuffApplied`（激活）、`BuffTicked`（含截断后实际变化量 `applied`）、
  `BuffExpired`（到期，销毁前）

### 新增（example/mini-rpg，首个"纯内容"游戏）

- 纵向切片：村庄（村长·任务 / 药婆·回春）→ 森林小径（野狼×2·掉狼皮）→
  沼泽（进房上毒）→ 蛛巢洞穴（巨蛛 boss·毒攻击·掉传家宝）→ 回村交任务终局。
  **内容全程不碰两个包的源码**——prefabs 分层的终极命题验证
- 内容系统示范（全部只用公开 API）：
  - 沼泽毒雾：订阅 `Moved` → 进沼泽上毒（区域效果；`Moved.to` 是**方向**，
    判定要走 from 房间的 `Exits`）
  - 巨蛛反击 + 毒攻：订阅 `Attack` 的**纯内容 boss AI**——反击 emit 标准
    `Attack`（CombatSystem 结算、死亡管线全生效），被咬中上 `source` 蛛毒
  - 药婆草药茶：对话选项（remember: tea）→ 回春 buff（酒保模式 + heal）
  - 终局文案：订阅 `QuestTurnedIn` 的主线交付钩子
- `content.test.ts` **自动通关**（六幕）：真实 World + `execute` 序列 +
  手动 `world.tick()` 推进世界时间，无 sleep 无真实定时器——测试即通关录像，
  内容包从此有 CI；HP 断言精确到结算次数（蛛毒每只 -4 / 沼毒每次 -9）
- REPL 可玩（`pnpm --filter mini-rpg dev`）；根 `test` 脚本纳入 mini-rpg

### 文档

- prefabs README 增「Buff 系统（v0.7）」章节（实体哲学 + 规则一览表）
- 契约测试补 buff 链路：ESM 冒烟（毒上低血怪 → 手动 tick → 毒杀掉落清场）、
  CJS `buffBlueprint` 导出检查、TS strict 蓝图类型可用
- 设计定稿与实现记录（含 4 个内容侧的坑）见 `docs/roadmap-0.7.md`

## [0.6.0] - 2026-09-02

主题：**闭环——掉落 + 任务进度 + 可控时钟**（`@mud/ecs-engine` 0.6.0 / `@mud/prefabs` 0.4.0）。
世界形成第一个完整游戏循环：`击杀 → 掉落 → 拾取 → 交任务 → 领奖`。
无 breaking。

### 新增（@mud/prefabs）

- **掉落系统**：`Loot` trait（纯数据掉落表，可 JSON、进快照）+ `LootSystem`——
  死者带 `Loot` 时按表用 `ctx.spawn` **现造掉落物实体**落入死亡房间容器
  （look 看得见、take 拿得走），emit `LootDropped`。`Died` 钩子不再是悬空承诺
- **任务进度系统**：`QuestGiver`（挂 NPC）/`QuestLog`（挂玩家，进度纯数据进快照）+
  `QuestSystem`；目标两种：`collect`（订阅 `ItemTaken`，物品真正到手才计数）与
  `kill`（订阅 `Died`，按死者名匹配 + `killer` 记功）；进度**全局追踪**，
  交付须回发任务者身边；`QuestStarted/Progressed/Completed/TurnedIn` 事件
- **命令**：`quests`（列当前房间 NPC 的任务与进度）、`turnin`（交付已完成任务，
  发奖：物品 `ctx.spawn` 进背包 + `heal` 回血，`turnedIn` 记账不可重复领）
- **查询工具**：`containerOf`（Position 优先、Located 兜底的房间归属——常驻 NPC
  用 `Located` 锚定房间即可参与任务）

### 变更（@mud/prefabs，行为修正）

- **死亡改为管线**：`CombatSystem` 不再自己销毁目标（处理中 emit 只入队，
  同步 destroy 会让 `Died` 订阅者读不到死者——掉落因此静默失效）；
  新增 `DeathSystem`（priority 100，永远最后清场）。**击杀后要实体消失，
  必须注册 `DeathSystem`**（未注册时目标 HP 归零但留存）
- demo：野狗带掉落表（狗肉/项圈）、酒保挂两个悬赏任务（杀狗/送肉）、
  常驻酒保补 `Located`；REPL 全闭环冒烟（杀狗 → 捡肉 → 交任务 → 领陈酿麦酒）

### 修复（@mud/ecs-engine）

- **`ManualClock.advance(ms)` 真正驱动世界时间**（API 评审 P1-4 空承诺兑现）：
  `TestWorld` 装载推进槽位，`advance` 按 `tickInterval` 循环 tick 直到目标时间，
  clock 与世界时间保持同步（世界时间是唯一真相）；`TestWorldConfig` 补 `tickInterval`，
  新增 `w.tick(n)` / `w.advance(ms)` / `w.currentTime`；独立 ManualClock（未绑定）
  行为不变；`tickInterval <= 0` 显式报错
- 确定性金测试基线更新：时间真正推进后 `ticks` 从恒 0 变为 17——
  该测试此前一直在跑"时间静止"的世界，这正是 P1-4 的证据

### 文档

- prefabs README 增「掉落与任务（v0.6）」章节（规则一览表）与死亡管线说明；
  engine README / guide 兑现 `ManualClock` 承诺并更新速查表
- 新增 `docs/examples/04-loot-quest.mts`（掉落/任务闭环 + 可控时钟），
  纳入 strict tsc + 运行双验证；`docs/examples` 补 `@mud/prefabs` 路径映射
- 设计定稿与实现记录见 `docs/roadmap-0.6.md`

## [0.5.0] - 2026-09-02

主题：**会"活"的世界 + API 形态修正**（`@mud/ecs-engine` 0.5.0 / `@mud/prefabs` 0.3.0）。
含 breaking：C 批死承诺删除（`ComponentDefinition.validate` / `EventDefinition.schema`
运行时承诺 / `SnapshotData.quests`/`QuestSnapshot` / `OutputPort` 接口）。
0.4.x 期间的全量审查修复（R 批）并入本版一并发布。

### 新增

- **系统内造物与销毁（engine）**：`SystemContext` 注入 `spawn(bp, opts)` /
  `destroy(entityId)`——战斗掉落、对话产出、NPC 刷怪不再依赖预置实体 hack
- **战斗与死亡（@mud/prefabs）**：`Attack`/`Died` 事件 + `CombatSystem`（同房间 +
  Health 校验、`Weapon.damage` 结算、HP 归零 emit `Died` 后销毁目标）；
  `attack/kill/攻击` 命令（房间作用域解析）；`Died` 为掉落/任务效果系统的钩子
- **NPC 巡逻（@mud/prefabs）**：`Wander` trait + `NpcWanderSystem`（every 时钟驱动、
  按世界时间确定性地沿房间 Exits 轮换，不引入随机——同世界同时间同位置）
- **look 活物列表**：DescriptionSystem 列出同房有身体的实体（查看者自己除外）
- demo：广场野狗（巡逻 + 可击杀）；酒保买酒改用 `ctx.spawn` 现酿（删预置 ale hack）

### 变更（API 形态修正，含 breaking）

- **`trait` 支持对象模板**：`trait('x', {数据})` 与工厂等价——每次 `create()`
  返回独立深拷贝（修复早年 README 对象形态让 create 变数据对象/共享引用的陷阱）
- **`register`/`registerCommands` 支持数组参数**（自动展开，忘展开不再静默炸）
- **测试工具统一入口**：`@mud/ecs-engine/testing` 聚合测试全家桶（含录像重放
  record/replay），文档统一走子路径；主入口兼容导出
- **死承诺清理（breaking）**：`ComponentDefinition.validate`、`EventDefinition.schema`
  的运行时承诺、`SnapshotData.quests`/`QuestSnapshot`、孤儿 `OutputPort` 接口——
  全部删除；`schema` 保留为纯类型锚点（引擎不做运行时校验，文档注明）

### 修复

- `defineSystem` 构造入参类型补 `every`/`onError`（此前只在返回的 SystemDefinition
  上，`defineSystem({ every })` 在 strict 下编译不过——引擎测试因 tsconfig 排除
  test 文件从未暴露，被 prefabs 巡逻系统编译逼出）

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
