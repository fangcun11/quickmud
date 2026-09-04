# 16 · API 速查

> 全 API 一览。分**引擎核心**（`@mud/ecs-engine`）与**领域预制件**
> （`@mud/prefabs`）两段。详细信息点"详"列的章节链接。

---

## 引擎核心

### 世界

| API | 说明 | 详 |
| --- | --- | --- |
| `new World({ tickInterval?, maxEventsPerCommand? })` | 核心入口 | [02](./02-quick-start.md) |
| `world.register(...systems)` | 注册系统 | [05](./05-systems.md) |
| `world.registerCommands(...commands)` | 注册命令（动词冲突即抛错） | [06](./06-commands.md) |
| `await world.execute(input, playerId)` | 执行玩家输入 → `string \| null` | [02](./02-quick-start.md) |
| `world.createSnapshot()` / `world.rollbackWorld(snap)` | 快照 / 回滚 | [12](./12-save-rollback.md) |
| `world.start()` / `world.stop()` / `world.tick()` | 游戏循环 | [05](./05-systems.md) |
| `world.fork()` | 世界分叉（沙箱试跑） | [13](./13-determinism.md) |
| `world.findEntity(name)` | 按 Name 组件找实体 → `EntityId \| undefined` | [03](./03-entities-components.md) |
| `world.spawn(bp, opts?)` | 世界级蓝图造物 | [09](./09-areas-behaviors.md) |
| `world.getSystemErrors()` / `.clearSystemErrors()` | 系统错误记录（含 `cause`） | [05](./05-systems.md) |

### 实体与组件

| API | 说明 | 详 |
| --- | --- | --- |
| `entities.create()` / `entities.createWithId(id)` | 创建实体 | [03](./03-entities-components.md) |
| `entities.addComponent(id, comp, data)` | 挂组件 | [03](./03-entities-components.md) |
| `entities.getComponent(id, comp)` | 读组件 → `T \| undefined` | [03](./03-entities-components.md) |
| `entities.has(id)` / `findByComponent(comp)` | 存在性 / 按组件查询 | [03](./03-entities-components.md) |
| `trait(name, defaults?)` / `relation(name)` | 组件 / 关系（ID 碰撞 fail-fast） | [03](./03-entities-components.md) |
| `blueprint({ components: [...] })` | 实体蓝图 | [09](./09-areas-behaviors.md) |

### 定义

| API | 说明 | 详 |
| --- | --- | --- |
| `defineEvent(name)<T>()` | 事件定义（柯里化：名字字面量 → 载荷） | [04](./04-events.md) |
| `defineSystem({ name?, on?, priority?, every?, onError?, handle })` | 系统定义（on 传事件定义 → 类型贯通） | [05](./05-systems.md) |
| `ctx.after(delayMs, defOrToken, data)` → `ScheduledEventHandle` / `ctx.cancel(handle)` | 延时调度与幂等取消（0.12 起） | [05](./05-systems.md) |
| `defineCommand({ verbs, abbrev?, args?, handle })` | 命令定义（args 类型自动推导） | [06](./06-commands.md) |
| `registerDeveloperKit(world)` | 开发者套件一步注册：命令 + 效果系统（0.12 起） | [06](./06-commands.md) |
| `createDeveloperCommands()` | 仅命令组（效果系统不注册时状态不落） | [06](./06-commands.md) |

### 输出

| API | 说明 | 详 |
| --- | --- | --- |
| `world.output.narrative / dialogue / error / status / title / prompt / system` | 各类输出 | [07](./07-output.md) |
| `world.output.ofKind(kind)` / `.getAll()` / `.count` | 读取（不清空） | [07](./07-output.md) |
| `world.drainOutput()` | 取走全部输出并复位缓冲（0.12 起；execute 不再自动清空） | [07](./07-output.md) |
| `renderAnsi(msgs, opts?)` / `renderSemanticHtml(msgs)` / `renderPlainText(msgs)` | 三种渲染纯函数 | [07](./07-output.md) |
| `s(text)` / `seg(text, style?)` | 段落构造快捷函数 | [07](./07-output.md) |

### 存档

| API | 说明 | 详 |
| --- | --- | --- |
| `new SavePort(backend, version)` | `save / load / exists / delete` | [12](./12-save-rollback.md) |
| `save.registerMigrations(...)` | 版本迁移链 | [12](./12-save-rollback.md) |
| `FsBackend`（`@mud/ecs-engine/node`） / `LocalStorageBackend` | Node 子路径 / 浏览器 | [12](./12-save-rollback.md) |

### 确定性

| API | 说明 | 详 |
| --- | --- | --- |
| `record(world)` → `rec.execute/tick` → `rec.stop()` | 录制输入序列 | [13](./13-determinism.md) |
| `verifyReplay(recording, build)` | 重放验证（含 `versionMismatch` 护栏） | [13](./13-determinism.md) |
| `replay(recording, build)` | 重放并拿回世界 | [13](./13-determinism.md) |
| `firstDiff(a, b)` | 首个快照分叉路径 | [13](./13-determinism.md) |

### 对话

| API | 说明 | 详 |
| --- | --- | --- |
| `defineDialogue(entry, nodes)` | 对话树（id 重复/悬空引用定义期报错） | [11](./11-dialogue-npc.md) |
| `Dialogue` / `Memory` 组件 | 挂到 NPC | [11](./11-dialogue-npc.md) |
| `DialogueSystem` + `createDialogueCommands()` | 注册即得 talk 能力 | [11](./11-dialogue-npc.md) |
| `DialogueChoiceMade` 事件 | 副作用钩子 | [11](./11-dialogue-npc.md) |

### 测试

| API | 说明 | 详 |
| --- | --- | --- |
| `createTestWorld({ systems?, commands?, entities?, clock?, tickInterval? })` | 测试世界（夹具支持元组形态 `[[Comp, data?]]`） | [14](./14-testing.md) |
| `w.run(input, player)` / `w.emit(Def, data)` / `TestWorld.wrap(world)` | 执行 / 事件直传 / 接手既有世界探针（0.12 起） | [14](./14-testing.md) |
| `w.emit(token, data)` / `w.runChain()` / `w.getLog()` | 驱动与断言 | [14](./14-testing.md) |
| `w.tick(n)` / `w.advance(ms)` / `w.currentTime` | 推进世界时间 | [14](./14-testing.md) |
| `ManualClock`（可选注入） | `advance(ms)` 驱动世界时间并同步读数；未注入时自动创建 | [14](./14-testing.md) |

## 领域预制件（@mud/prefabs）

### 系统

| API | 说明 | 详 |
| --- | --- | --- |
| `MovementSystem` / `DescriptionSystem` / `ItemSystem` | 移动 / 查看 / 物品 | [10](./10-items-combat-quests.md) |
| `CombatSystem` / `LootSystem` / `DeathSystem` | 战斗 → 掉落 → 清场管线 | [10](./10-items-combat-quests.md) |
| `QuestSystem` / `BuffSystem` / `BuffCleanupSystem` | 任务 / Buff 结算 / 死亡清 buff | [10](./10-items-combat-quests.md) |
| `NpcWanderSystem` / `VisitationSystem` | NPC 确定性巡逻 / 探索记录 | [10](./10-items-combat-quests.md) |

### 命令

| API | 说明 | 详 |
| --- | --- | --- |
| `GoCommand` / `createDirectionCommand(dir, verbs)` | 移动 | [08](./08-rooms-maps.md) |
| `LookCommand` / `TakeCommand` / `DropCommand` / `InventoryCommand` / `ScoreCommand` | 查看 / 拿放 / 背包 / 状态 | [10](./10-items-combat-quests.md) |
| `AttackCommand` / `QuestCommand` / `TurnInCommand` / `MapCommand` / `WorldMapCommand` | 战斗 / 任务 / 双地图 | [10](./10-items-combat-quests.md) |

### 常用组件

| API | 说明 | 详 |
| --- | --- | --- |
| `Position` / `Exits` / `Located` / `Portable` | 位置 / 出口 / 容器单源 / 可携带 | [10](./10-items-combat-quests.md) |
| `Health` / `Description` / `Weapon` / `Wander` | 生命 / 描述 / 武器 / 巡逻标记 | [10](./10-items-combat-quests.md) |
| `Loot` / `QuestGiver` / `QuestLog` / `Visited` | 掉落 / 发任务 / 接任务 / 探索 | [10](./10-items-combat-quests.md) |
| `Afflicted` / `Duration` / `Coordinates` | Buff / 时限 / 地图坐标 | [10](./10-items-combat-quests.md) |

### 房间与地图

| API | 说明 | 详 |
| --- | --- | --- |
| `defineRoom({ id, name, description, exits, area?, state?, commands?, on? })` | 房间定义（可带行为） | [09](./09-areas-behaviors.md) |
| `defineArea({ id, name })` / `layoutWorld(rooms, opts)` / `buildAreas` | 区域层 | [09](./09-areas-behaviors.md) |
| `layoutRooms(rooms, { entry })` / `buildRooms` / `buildRoomBehaviors` | 坐标推断 / 注入 / 行为注册 | [08](./08-rooms-maps.md) |
| `renderAsciiMap(rooms, opts)` / `markVisited(world, player)` | 纯函数渲染 / seed 探索 | [08](./08-rooms-maps.md) |
| `directionLabel(dir)` / `DIRECTION_LABELS` | 方向 id → 中文标签（撞墙文案） | — |
| `buffBlueprint({ victim, effect, lasts, source? })` | Buff 实体蓝图 | [10](./10-items-combat-quests.md) |

### 容器查询（queries）

`WorldQuery` 型工具函数——"容器里有什么 / 谁在房间里"的官方解法，自己手写
`findByComponent(...).filter(...)` 之前先看这里：

| API | 说明 | 详 |
| --- | --- | --- |
| `itemsInContainer(q, container)` | 容器（房间/玩家/箱子）里的物品 | [10](./10-items-combat-quests.md) |
| `occupantsIn(q, room)` | 房间里的活物 | [10](./10-items-combat-quests.md) |
| `containerOf(q, entity)` | 实体所在的容器 → `EntityId \| undefined` | [10](./10-items-combat-quests.md) |
| `resolveInContainer(q, container, name)` / `resolveOccupantIn(q, room, name)` | 按名字在容器/房间内解析实体 | — |
| `displayName(q, id)` | 实体展示名（Name 优先，退回 id） | — |

---

[← 上一篇：15 常见坑](./15-pitfalls.md) | [目录](./index.md)
