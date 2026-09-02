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

> Name 组件是引擎的查找契约（`findEntityByName`），请从 `@mud/ecs-engine` 导入。
> 引擎开发者命令 `/tp /heal` 按 `position/health` 命名约定工作；`/give` 已随
> Inventory 退役迁出（0.3-C breaking）。

## 模块组成

- `src/traits.ts`：组件定义（Health/Position/Located/Description/Exits/Portable/Weapon）
- `src/events.ts`：`Moved`、`Look`、`ItemTaken`、`ItemDropped`
- `src/systems.ts`：`MovementSystem`、`DescriptionSystem`（含房间物品列表）、
  `ItemSystem`（take/drop 校验与转移）
- `src/commands.ts`：`GoCommand`、`createDirectionCommand`、`LookCommand`、
  `TakeCommand`、`DropCommand`、`InventoryCommand`、`ScoreCommand`

## 开发

```bash
pnpm build            # tsc + esbuild 双格式 + d.ts 扩展名后处理
pnpm test             # vitest 集成测试（移动/查看/物品转移/确定性）
pnpm test:contract    # 外部全新安装的 ESM/CJS/TS strict 契约
```
