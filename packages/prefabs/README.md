# @mud/prefabs

MUD 文字游戏引擎的**领域预制件**——移动/房间、查看/描述、物品/背包、状态的开箱即用实现。

分层哲学：引擎（`@mud/ecs-engine`）只提供能力原语（事件驱动 ECS、确定性、快照/回滚/
录像、对话机制），**不内置任何领域内容**；本包负责"MUD 游戏里有什么"的常用件，
换一个游戏直接复用，不必从示例里抄代码。

零第三方依赖；ESM / CJS 双产物；需与引擎一起安装。

> 渐进式学习路径见 [`docs/guide/`](../../docs/guide/)（领域篇三章专讲本包用法，
> 示例全部机器验证）；本 README 按"模块 + 规则表"组织，适合当参考手册查。

## 安装

```bash
npm install @mud/ecs-engine @mud/prefabs
```

## 快速上手

```ts
import { World, Name } from '@mud/ecs-engine';
import {
  MovementSystem, DescriptionSystem, ItemSystem,
  Health, Position, Located, Exits, Description, Portable,
  GoCommand, createDirectionCommand,
  LookCommand, InventoryCommand, ScoreCommand, TakeCommand, DropCommand,
} from '@mud/prefabs';

const world = new World();
world.register(MovementSystem, DescriptionSystem, ItemSystem);
world.registerCommands(
  GoCommand,
  createDirectionCommand('north', ['north', 'n', '北']),
  LookCommand, InventoryCommand, ScoreCommand, TakeCommand, DropCommand,
);

// 玩家：挂 Health / Position
const player = world.entities.createWithId('player-1');
world.addComponent(player, Health, { current: 100, max: 100 });
world.addComponent(player, Position, { roomId: 'town' });

// 房间：房间实体挂 Name / Description / Exits（方向 → 房间 id）
const town = world.entities.createWithId('town');
world.addComponent(town, Name, { text: '城镇', aliases: [] });
world.addComponent(town, Description, { text: '一座安静的小镇。' });
world.addComponent(town, Exits, { north: 'tavern' });

// 物品是真实实体：Located 记录它所在的容器（房间 id 或玩家 id）
const coin = world.entities.createWithId('coin');
world.addComponent(coin, Name, { text: '金币', aliases: ['coin'] });
world.addComponent(coin, Portable);               // 可携带（take 的前提）
world.addComponent(coin, Located, { at: 'town' }); // 在城镇地上

await world.execute('go north', player);   // 移动（MovementSystem 校验出口并落位）
await world.execute('look', player);       // → 房间描述 + 地上可拾取物列表
await world.execute('take 金币', player);  // → 金币进入背包（Located.at = 玩家）
await world.execute('inventory', player);  // → 列出背包（Located.at == 玩家）
await world.execute('drop 金币', player);  // → 放回当前房间
```

## 约定（重要）

| 组件 | 含义 | 谁消费 |
| --- | --- | --- |
| `Position.roomId` | 所在房间（房间实体 id） | `MovementSystem`、`/tp` |
| `Exits` | 房间出口 `{ 方向: 房间id }` | `MovementSystem` |
| `Health` | 生命值 | `ScoreCommand`、`/heal` |
| `Located.at` | **物品所在容器**（房间/玩家/箱子实体 id，单源位置） | `ItemSystem`、`InventoryCommand`、`DescriptionSystem` |
| `Portable` | 可携带标记（take 的前提） | `ItemSystem` |
| `Description` | 展示文本（房间/物品/NPC） | `DescriptionSystem`、`LookCommand` |
| `Weapon` | 额外伤害 | 内容层自行消费 |

**物品模型（0.3-C）**：物品是真实实体，位置 = `Located.at` 单源真相。
"某容器里有什么" = 查询拥有 `Located` 且 `at == 容器` 的实体。
玩家背包 = `at == 玩家`；房间地面 = `at == 房间`。不需要独立的 Inventory 组件。

**已知边界**：删除容器实体（房间/箱子）前请先转移或删除其中的物品——
引擎不级联清理 `Located.at` 悬挂引用（容器被删后其物品对任何活容器不可见）。

> Name 组件是引擎的查找契约（`findEntityByName`），请从 `@mud/ecs-engine` 导入。
> 引擎开发者命令 `/tp /heal` 按 `position/health` 命名约定工作；`/give` 已随
> Inventory 退役迁出（0.3-C breaking）。

## 模块组成

- `src/traits.ts`：组件定义（Health/Position/Located/Description/Exits/Portable/Weapon/Wander/
  Loot/QuestGiver/QuestLog/Afflicted/Duration/Coordinates/Visited）
- `src/events.ts`：`Moved`、`Look`、`ItemTaken`、`ItemDropped`、`Attack`、`Died`、
  `LootDropped`、`QuestStarted/Progressed/Completed/TurnedIn`、
  `BuffApplied/BuffTicked/BuffExpired`
- `src/systems.ts`：`MovementSystem`、`DescriptionSystem`（含房间物品与活物列表）、
  `ItemSystem`（take/drop）、`CombatSystem`（伤害结算 + emit `Died`，**不再自己销毁**）、
  `LootSystem`（掉落结算）、`DeathSystem`（死亡管线末端清场）、
  `QuestSystem`（任务进度 + 交付发奖）、
  `NpcWanderSystem`（`Wander` + `Position` 实体按 every 时钟确定性巡逻）、
  `BuffSystem`（定时效果结算 + 到期移除）、`BuffCleanupSystem`（死亡清 buff）、
  `buffBlueprint()`（buff 实体蓝图工厂）、
  `VisitationSystem`（把走到的房间记进 `Visited`——地图迷雾的数据源）
- `src/commands.ts`：`GoCommand`、`createDirectionCommand`、`LookCommand`、
  `TakeCommand`、`DropCommand`、`InventoryCommand`、`ScoreCommand`、`AttackCommand`、
  `QuestCommand`、`TurnInCommand`、`MapCommand`
- `src/queries.ts`：容器/房间解析工具（`itemsInContainer`/`occupantsIn`/`resolveInContainer`/`resolveOccupantIn`/`containerOf`）
- `src/room.ts`：`defineRoom`（纯数据定义）/ `layoutRooms`（坐标推断 + 冲突 fail-fast）/
  `buildRooms`（注入世界）/ `renderAsciiMap`（渲染纯函数）/ `markVisited`（seed 探索记录）

## 战斗与巡逻（v0.5）

```ts
import {
  CombatSystem, LootSystem, DeathSystem, NpcWanderSystem, AttackCommand, Wander,
} from '@mud/prefabs';

// 死亡是一条管线：战斗只 emit Died，掉落/清场按各自 priority 依次处理。
// 要"打死了就消失"必须带上 DeathSystem（priority 最高，永远最后清场）。
world.register(CombatSystem, LootSystem, DeathSystem, NpcWanderSystem);
world.registerCommands(AttackCommand);

// 一只会巡逻、可被攻击的敌人
const mob = world.entities.createWithId('mob');
world.addComponent(mob, Name, { text: '野狗' });
world.addComponent(mob, Position, { roomId: 'town' }); // 有身体 → 在房间
world.addComponent(mob, Health, { current: 20, max: 20 });
world.addComponent(mob, Wander);        // 巡逻标记

await world.execute('attack 野狗', player);      // 造成 Weapon.damage（默认 10）
// HP 归零：输出 → emit Died → [LootSystem 结算掉落 → DeathSystem 销毁实体]
```

- **攻击规则**：目标须与自己同房间且有 Health；伤害取攻击者 `Weapon.damage`（>0）否则 10
- **巡逻确定性**：不引入随机——下一跳由世界时间决定（`floor(time/3000) % 出口数`），
  同世界同时间 ⇒ 同位置，录像/分叉/读档天然一致
- `Died` 事件含 `{ entity, killer?, roomId }`，供掉落、任务等效果系统订阅
- look 会列出房间里的活物（有 `Position` 的同房实体，不含查看者自己）

## 掉落与任务（v0.6）

`Died` 钩子从此有了官方消费者：**击杀 → 掉落 → 拾取 → 交任务 → 领奖**，一条闭环。

```ts
import { Loot, QuestGiver, QuestLog, QuestCommand, TurnInCommand, Located } from '@mud/prefabs';

// 掉落表：纯数据（可 JSON、进快照）；掉落物由 LootSystem 用 ctx.spawn 现造实体
world.addComponent(mob, Loot, {
  drops: [
    { name: '狗肉', aliases: ['肉'], description: '一块血淋淋的肉。' },
    { name: '生锈的犬牙', damage: 4 },          // damage > 0 → 掉落物带 Weapon
  ],
});

// 发任务者：常驻 NPC 用 Located 锚定房间（会动的才用 Position）
world.addComponent(barman, Located, { at: 'tavern' });
world.addComponent(barman, QuestGiver, {
  quests: [{
    id: 'dog-hunt',
    title: '除掉野狗',
    objective: { type: 'kill', target: '野狗', count: 1 },   // 或 { type: 'collect', ... }
    reward: { items: [{ name: '陈酿麦酒' }], heal: 20 },
  }],
});

// 玩家必须有 QuestLog 才参与任务（系统不能替玩家补组件）
world.addComponent(player, QuestLog);
world.registerCommands(QuestCommand, TurnInCommand);
```

规则一览：

| 规则 | 说明 |
| --- | --- |
| 掉落 | 死者带 `Loot` → 掉落物实体落入**死亡房间**容器，输出一句话，emit `LootDropped` |
| kill 目标 | 订阅 `Died`，死者名与 `target` 包含匹配，`killer` 记功 |
| collect 目标 | 订阅 `ItemTaken`，**物品真正到手里才计数**（拿不动的不白送进度） |
| 进度 | 全局追踪，不看玩家在哪（在酒馆接任务、去广场杀怪照样记功） |
| 交付 | `turnin` 必须与发任务者**同房间**；发奖后写入 `turnedIn`，不可重复领 |
| 奖励 | `items` 用 `ctx.spawn` 进玩家容器；`heal` 回血（上限 max） |
| 查询 | `quests` 列出当前房间 NPC 的任务与进度（0/x、已完成、已交付） |

不引入随机掉落——概率需要确定性伪随机设计（seed 来源），单开一版再做。

## Buff 系统（v0.7）

**Buff 是实体，不是列表组件**（与 `Located` 同哲学）：每个 buff 是一个挂
`Afflicted` 的实体，指向受害者。查询"谁身上有什么"= `findByComponent(Afflicted)`，
快照天然安全，死亡清场只需订阅 `Died` 销毁 buff 实体。

```ts
import { BuffSystem, BuffCleanupSystem, buffBlueprint } from '@mud/prefabs';

world.register(BuffSystem, BuffCleanupSystem);   // 与死亡管线一起注册

// 内容侧唯一入口：构造蓝图 → ctx.spawn / world.spawn（spawn 即忘）
world.spawn(buffBlueprint({
  victim: player,
  effect: { type: 'damage', amount: 3, every: 2000 },  // 或 { type: 'heal', ... }
  lasts: 8000,          // 毫秒，自激活起；<= 0 表示永久
  source: spiderId,     // 可选：毒杀时 Died.killer 归属 ta
}));
```

规则一览：

| 规则 | 说明 |
| --- | --- |
| 计时起点 | 内容层 `startedAt` 留 0（待激活），`BuffSystem` 首个结算网格写入世界时间——**内容层零时间感知** |
| 结算 | 自 `lastTickedAt` 起计 `effect.every`，`damage` 扣血 / `heal` 回血（截断在 0..max） |
| 毒杀 | HP 归零 → emit `Died`（killer = `source`）→ **走完整死亡管线**（掉落/任务/清场全生效） |
| 到期 | 挂 `Duration` 的到期那格**不再结算**，emit `BuffExpired` 后销毁 |
| 死亡清场 | `BuffCleanupSystem`（on `Died`，priority 50）：销毁死者身上全部 buff，不留孤儿 |
| 事件 | `BuffApplied`（激活）/ `BuffTicked`（含实际变化量 `applied`）/ `BuffExpired` |
| 确定性 | 与 `NpcWanderSystem` 同款 every 网格时相——快照/回滚/录像/分叉天然一致 |

> 本版是**定时效果层**（最小 Buff）。属性修正（+攻/-防）、叠加/互斥/驱散属于
> "属性层"复杂度，等真实内容逼出需求后再做。

## 房间定义与 ASCII 地图（v0.8）

房间曾是唯一没有 `define*` 封装的领域对象。本版补上，并让地图成为**免费赠品**：

```ts
import {
  defineRoom, layoutRooms, buildRooms, renderAsciiMap,
  VisitationSystem, MapCommand, markVisited, Visited,
} from '@mud/prefabs';

// 只写拓扑（Exits 是唯一真相），二维坐标由 layoutRooms 从入口 BFS 自动推断
const layout = layoutRooms(
  [
    defineRoom({ id: 'village', name: '村庄', description: '安静的小村。', exits: { east: 'forest' } }),
    defineRoom({ id: 'forest', name: '森林小径', description: '树影幢幢。', exits: { west: 'village', south: 'swamp' } }),
    defineRoom({ id: 'swamp', name: '沼泽', description: '瘴气弥漫。', exits: { north: 'forest', east: 'cave' } }),
  ],
  { entry: 'village' },            // 入口坐标 = (0,0)，坐标系锚点
);
buildRooms(world, layout);          // 注入：Name/Description/Exits/Coordinates

// 地图带迷雾：玩家挂 Visited，走到的房间才亮（没挂则 map 渲染全图）
world.register(VisitationSystem);   // 探索记录
world.registerCommands(MapCommand);
world.addComponent(player, Visited);
markVisited(world, player);         // seed 出生房间（初始位置没有 Moved 事件）
```

规则一览：

| 规则 | 说明 |
| --- | --- |
| 坐标推断 | BFS 从入口铺开，四方向偏移；`up/down` 等非四方向出口可达但**无坐标**（二维平面装不下，地图不画） |
| 冲突 fail-fast | 重复 id / 悬空出口 / 坐标撞格 / 显式坐标不一致 / **反向出口不自洽**（A east→B 但 B 用 east→ 指回 A）/ 孤岛房间——全在 `layoutRooms` 时抛错，启动即炸 |
| 显式 coords | escape hatch（非欧空间），必须与推断一致，否则报错 |
| 迷雾 | 只画已探明房间；**连线两端都探明才画**（不泄漏邻接信息）；未探明区域留白 |
| 字符 | `@` 当前 / `S` 入口（内容层自定义命令时用）/ `·` 已探明 / `—` `│` 连线 |
| 渲染 | `renderAsciiMap` 是纯函数（坐标 → 字符串），测试可直接断言每一行 |

**为什么坐标在定义期推断而不是运行时**：冲突在启动阶段就炸（玩家不会走进第三个
房间才发现地图像鬼画符）、运行时零推断开销、快照里坐标只是普通数据。
`Coordinates` 是 `Exits` 的**派生产物**，不是第二份真相——拓扑改了地图跟着变。

## 区域与世界地图 + 自包含房间行为（v0.9）

两个升级一次到位：**房间之上有了"区域"这一级**（每个区域是一张独立平面），
**房间从静态数据块升级为自包含内容模块**（守卫 / 生命周期 / 房间命令 / 自己的状态）：

```ts
import { trait, blueprint } from '@mud/ecs-engine';
import {
  defineRoom, defineArea, layoutWorld, buildRooms, buildAreas, buildRoomBehaviors,
  WorldMapCommand, MapCommand,
} from '@mud/prefabs';

const HayState = trait('hay_state', () => ({ searched: false }));

const rooms = [
  defineRoom({
    id: 'square', name: '村口广场', description: '…', area: 'village',
    exits: { east: 'path' },
    state: HayState,                        // 房间状态走组件：进快照、可回滚
    commands: [{                            // 房间命令：动词只在身处该房间时生效
      verbs: ['search'],
      handle(ctx) {
        if (ctx.state.searched) return '干草堆已经被你翻遍了。';
        ctx.state.searched = true;
        ctx.spawn(blueprint({ components: [[Name, { text: '火把' }], [Located, { at: ctx.roomId }], [Portable]] }));
        return '你从干草堆里翻出一支火把。';
      },
    }],
  }),
  defineRoom({
    id: 'path', name: '荒野小径', description: '…', area: 'wilds',
    exits: { west: 'square', south: 'mire' },
  }),
  defineRoom({
    id: 'mire', name: '毒雾泥沼', description: '…', area: 'wilds',
    exits: { north: 'path' },
    on: {
      canEnter(ctx) {                       // 守卫：同步查询，返回理由 = 拦下并输出
        return hasTorch(ctx) ? undefined : '泥沼入口漆黑一片，没有火把寸步难行。';
      },
      enter(ctx) {                          // 生命周期：真正落位后触发
        ctx.output.narrative('毒雾无声无息地缠了上来……');
      },
      every: { ms: 2000, handle(ctx) { /* 房间心跳：世界时间驱动，drift-free */ } },
    },
  }),
];

const layout = layoutWorld(rooms, {
  entry: 'square', entryArea: 'village',
  areas: [defineArea({ id: 'village', name: '村庄' }), defineArea({ id: 'wilds', name: '荒野' })],
});
buildRooms(world, layout);
buildAreas(world, layout);          // 区域是实体：能挂天气/危险度等自己的组件，进快照
buildRoomBehaviors(world, rooms);   // 行为注册（必须在 buildRooms 之后）
world.registerCommands(MapCommand, WorldMapCommand); // map=当前区域 / worldmap=区域之间
```

| 规则 | 说明 |
| --- | --- |
| 区域 = 一张平面 | 每个区域有自己的坐标系；塔顶、洞穴各自成区域——v0.8"非四方向出口拿不到坐标"的边界自然消失 |
| 单一真相 | 房间声明 `area`，区域**不抄** rooms 反表；区域出口由**跨区域房间出口反推**（改房间忘改区域不可能发生） |
| 生命周期 | `on.enter` / `leave` / `firstEnter` / `look` / `every`；`Moved` 是**结果**不是意图：守卫拒绝时不落位、不记账、不触发 enter |
| 房间状态 | `state` 组件（进快照 / fork / 回滚）；**闭包变量不进快照**——未声明 state 却摸 `ctx.state` 会直接报人话错误 |
| 房间命令 | 纯翻译层 + 事件派发；处理器有系统特权（spawn/destroy/output），spawn 出的东西真捡得走；动词冲突定义期 fail-fast |
| 派发架构 | 所有房间由同一对系统查表服务（不是一房一系统）；故障域 = 单房间，一个房间的 bug 不连坐全世界 |
| `every` | 间隔必须是 tick 间隔的整数倍（定义期 fail-fast），`RoomClock` 记账，drift-free |
| 校验 | 空区域 / 孤岛区域 / 区内孤岛（多半是 `area` 标错了）/ 区域出口冲突（同方向通向两个区域）——全部定义期 fail-fast |
| 地图 | `map` 自动按当前区域过滤（两套坐标系不相撞，抬头带【区域名】）；`worldmap` 战争迷雾口径 = 区域内去过任意一间房 |

**为什么房间行为是"代码 + 组件"而不是把一切塞进快照**：函数进不了快照
（`structuredClone` 直接抛 DataCloneError），把行为藏进闭包等于告别存档。
`defineRoom` 的答案是：**行为是代码（回滚后重新可用），状态是数据（`state`
组件，随快照走）**。跨房间的机制不要塞给单个房间——那是区域或全局系统的职责。

## 文案与渲染修正（v0.10）

v0.10 的内容包（`example/tide-cellar`）把 v0.9 的 API 玩了一遍，撞出两个
只有真实消费者才暴露得出来的缺陷，都已修复：

- **撞墙文案说人话**：拒绝移动时输出「你不能往**东**走。」，不再把方向 id
  原样拼进中文句子（此前会吐出「你不能往up走。」）。新增导出：

  ```ts
  import { directionLabel, DIRECTION_LABELS } from '@mud/prefabs';

  directionLabel('up');    // '上'
  directionLabel('enter'); // 'enter'（未知方向退回 id 本身，不拦人说话）
  ```

- **ASCII 地图首尾裁剪对称**：`renderAsciiMap` 此前只裁尾部空行、放任首部，
  纵向叠层的世界地图头顶会挂着几行纯空白。现在首尾的**纯空行**都裁掉
  （空行不带字形，裁掉不影响已探明内容的相对位置）；中间的空白行照旧保留
  ——那是未探明的位置，是信息。

## 类型贯通（v0.11）

多事件系统不再需要 `as` 断言：`on` 传**事件定义**（而非 `.token` 字符串），
handle 收到按 token 可收窄的 union，载荷类型自动贯通——

```ts
// 0.11 前：event.data 是 unknown，两处 as
on: [ItemTaken.token, ItemDropped.token],
handle(event, ctx) {
  if (event.token === ItemTaken.token) {
    handleTake(ctx, event.data as { player: EntityId; item: EntityId });
  }
}

// 0.11 后：event.token === ItemTaken.token 分支里 event.data 自动收窄
on: [ItemTaken, ItemDropped],
handle(event, ctx) {
  if (event.token === ItemTaken.token) {
    handleTake(ctx, event.data); // { player, item }，无断言
  }
}
```

单事件系统（`on: [Attack]`）的 `event.data` 同样直接就是载荷类型。
`on: [X.token]` 旧写法继续可用（data 退化为 unknown）。

## 开发

```bash
pnpm build            # tsc + esbuild 双格式 + d.ts 扩展名后处理
pnpm test             # vitest 集成测试（移动/查看/物品转移/确定性）
pnpm test:contract    # 外部全新安装的 ESM/CJS/TS strict 契约
```
