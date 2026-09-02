# @mud/prefabs

MUD 文字游戏引擎的**领域预制件**——移动/房间、查看/描述、背包、状态的开箱即用实现。

分层哲学：引擎（`@mud/ecs-engine`）只提供能力原语（事件驱动 ECS、确定性、快照/回滚/
录像、对话系统），**不内置任何领域内容**；本包负责"MUD 游戏里有什么"的常用件，
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
  MovementSystem, DescriptionSystem,
  Health, Position, Inventory, Exits, Description,
  GoCommand, createDirectionCommand, InventoryCommand, ScoreCommand,
} from '@mud/prefabs';

const world = new World();
world.register(MovementSystem, DescriptionSystem);
world.registerCommands(
  GoCommand,                          // go/move/走 <方向>
  createDirectionCommand('north', ['north', 'n', '北']),  // 每个方向一个动词
  InventoryCommand, ScoreCommand,
);

// 玩家：挂 Health / Position / Inventory（约定）
const player = world.entities.createWithId('player-1');
world.entities.addComponent(player, Health, { current: 100, max: 100 });
world.entities.addComponent(player, Position, { roomId: 'town' });
world.entities.addComponent(player, Inventory, { items: [] });

// 房间：房间实体挂 Name / Description / Exits（方向 → 房间 id）
const town = world.entities.createWithId('town');
world.entities.addComponent(town, Name, { text: '城镇', aliases: [] });
world.entities.addComponent(town, Description, { text: '一座安静的小镇。' });
world.entities.addComponent(town, Exits, { north: 'tavern' });

await world.execute('go north', player);   // → 酒馆，MovementSystem 校验出口并落位
await world.execute('look', player);       // → 输出当前房间标题与描述
await world.execute('score', player);      // → 生命值 + 位置
```

## 约定（重要）

| 组件 | 含义 | 谁消费 |
| --- | --- | --- |
| `Position.roomId` | 所在房间（房间实体 id） | `MovementSystem`、`/tp` |
| `Exits` | 房间出口 `{ 方向: 房间id }` | `MovementSystem` |
| `Health` | 生命值 | `ScoreCommand`、`/heal` |
| `Inventory.items` | 持有物品（名称字符串） | `InventoryCommand`、`/give` |
| `Description` | 展示文本（房间/物品/NPC） | `DescriptionSystem`、`LookCommand` |
| `Portable` / `Weapon` | 物品标记 | 内容层自行消费 |

引擎的开发者命令（`createDeveloperCommands()`：`/tp /give /heal`）按
`position/inventory/health` 命名约定操作——**这些 trait 正是本包定义的正式主人**。

> Name 组件是引擎的查找契约（`findEntityByName`），请从 `@mud/ecs-engine` 导入，
> 本包不重复导出。

## 模块组成

- `src/traits.ts`：组件定义
- `src/events.ts`：`Moved`（移动）、`Look`（查看）事件
- `src/systems.ts`：`MovementSystem`（出口校验 + 落位 + 描述）、`DescriptionSystem`
- `src/commands.ts`：`GoCommand`、`createDirectionCommand`、`LookCommand`、
  `InventoryCommand`、`ScoreCommand`

## 开发

```bash
pnpm build            # tsc + esbuild 双格式 + d.ts 扩展名后处理
pnpm test             # vitest 集成测试（移动/查看/背包/状态/开发者命令协同）
pnpm test:contract    # 外部全新安装的 ESM/CJS/TS strict 契约
```
