# @mud/prefabs

MUD 文字游戏引擎的**领域预制件**——移动/房间、查看/描述、物品/背包、状态的开箱即用实现。

分层哲学：引擎（`@mud/ecs-engine`）只提供能力原语（事件驱动 ECS、确定性、快照/回滚/
录像、对话机制），**不内置任何领域内容**；本包负责"MUD 游戏里有什么"的常用件，
换一个游戏直接复用，不必从示例里抄代码。

零第三方依赖；ESM / CJS 双产物；需与引擎一起安装。

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
world.entities.addComponent(player, Health, { current: 100, max: 100 });
world.entities.addComponent(player, Position, { roomId: 'town' });

// 房间：房间实体挂 Name / Description / Exits（方向 → 房间 id）
const town = world.entities.createWithId('town');
world.entities.addComponent(town, Name, { text: '城镇', aliases: [] });
world.entities.addComponent(town, Description, { text: '一座安静的小镇。' });
world.entities.addComponent(town, Exits, { north: 'tavern' });

// 物品是真实实体：Located 记录它所在的容器（房间 id 或玩家 id）
const coin = world.entities.createWithId('coin');
world.entities.addComponent(coin, Name, { text: '金币', aliases: ['coin'] });
world.entities.addComponent(coin, Portable);               // 可携带（take 的前提）
world.entities.addComponent(coin, Located, { at: 'town' }); // 在城镇地上

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
  Loot/QuestGiver/QuestLog）
- `src/events.ts`：`Moved`、`Look`、`ItemTaken`、`ItemDropped`、`Attack`、`Died`、
  `LootDropped`、`QuestStarted/Progressed/Completed/TurnedIn`
- `src/systems.ts`：`MovementSystem`、`DescriptionSystem`（含房间物品与活物列表）、
  `ItemSystem`（take/drop）、`CombatSystem`（伤害结算 + emit `Died`，**不再自己销毁**）、
  `LootSystem`（掉落结算）、`DeathSystem`（死亡管线末端清场）、
  `QuestSystem`（任务进度 + 交付发奖）、
  `NpcWanderSystem`（`Wander` + `Position` 实体按 every 时钟确定性巡逻）
- `src/commands.ts`：`GoCommand`、`createDirectionCommand`、`LookCommand`、
  `TakeCommand`、`DropCommand`、`InventoryCommand`、`ScoreCommand`、`AttackCommand`、
  `QuestCommand`、`TurnInCommand`
- `src/queries.ts`：容器/房间解析工具（`itemsInContainer`/`occupantsIn`/`resolveInContainer`/`resolveOccupantIn`/`containerOf`）

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
world.entities.addComponent(mob, Name, { text: '野狗' });
world.entities.addComponent(mob, Position, { roomId: 'town' }); // 有身体 → 在房间
world.entities.addComponent(mob, Health, { current: 20, max: 20 });
world.entities.addComponent(mob, Wander);        // 巡逻标记

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
world.entities.addComponent(mob, Loot, {
  drops: [
    { name: '狗肉', aliases: ['肉'], description: '一块血淋淋的肉。' },
    { name: '生锈的犬牙', damage: 4 },          // damage > 0 → 掉落物带 Weapon
  ],
});

// 发任务者：常驻 NPC 用 Located 锚定房间（会动的才用 Position）
world.entities.addComponent(barman, Located, { at: 'tavern' });
world.entities.addComponent(barman, QuestGiver, {
  quests: [{
    id: 'dog-hunt',
    title: '除掉野狗',
    objective: { type: 'kill', target: '野狗', count: 1 },   // 或 { type: 'collect', ... }
    reward: { items: [{ name: '陈酿麦酒' }], heal: 20 },
  }],
});

// 玩家必须有 QuestLog 才参与任务（系统不能替玩家补组件）
world.entities.addComponent(player, QuestLog);
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

## 开发

```bash
pnpm build            # tsc + esbuild 双格式 + d.ts 扩展名后处理
pnpm test             # vitest 集成测试（移动/查看/物品转移/确定性）
pnpm test:contract    # 外部全新安装的 ESM/CJS/TS strict 契约
```
