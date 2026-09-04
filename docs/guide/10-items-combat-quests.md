# 10 · 物品、战斗与任务

> **本章你会学到**：`Located` 单源容器模型、战斗/掉落/死亡管线、任务闭环、
> Buff 定时效果。一条"击杀 → 掉落 → 拾取 → 交任务 → 领奖"的完整闭环。
> 本章代码对应验证示例 [04-loot-quest.mts](../examples/04-loot-quest.mts)。

---

## 物品模型：`Located` 单源位置（0.3-C）

物品是**真实体**，位置 = `Located.at` 单源真相。"某容器里有什么" = 查询拥有
`Located` 且 `at == 容器` 的实体。玩家背包 = `at == 玩家`；房间地面 = `at == 房间`。
**不需要独立的 Inventory 组件**：

| 组件 | 含义 | 谁消费 |
| --- | --- | --- |
| `Position.roomId` | 所在房间（房间实体 id） | `MovementSystem`、`/tp` |
| `Located.at` | **物品所在容器**（房间/玩家/箱子实体 id，单源位置） | `ItemSystem`、`InventoryCommand`、`DescriptionSystem` |
| `Portable` | 可携带标记（take 的前提） | `ItemSystem` |
| `Description` | 展示文本（房间/物品/NPC） | `DescriptionSystem`、`LookCommand` |

> **已知边界**：删除容器实体（房间/箱子）前请先转移或删除其中的物品——
> 引擎不级联清理 `Located.at` 悬挂引用（容器被删后其物品对任何活容器不可见）。

## 战斗与死亡管线（v0.5）

死亡是一条管线：战斗只 emit `Died`，掉落/清场按各自 priority 依次处理。
要"打死了就消失"必须带上 `DeathSystem`（priority 最高，永远最后清场）：

```ts
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

- **攻击规则**：目标须与自己同房间且有 `Health`；伤害取攻击者 `Weapon.damage`
  （>0）否则 10；
- **巡逻确定性**：不引入随机——下一跳由世界时间决定（`floor(time/3000) % 出口数`），
  同世界同时间 ⇒ 同位置，录像/分叉/读档天然一致；
- look 会列出房间里的活物（有 `Position` 的同房实体，不含查看者自己）。

## 掉落与任务闭环（v0.6）

`Died` 钩子从此有了官方消费者——**击杀 → 掉落 → 拾取 → 交任务 → 领奖**一条闭环。
下面的完整世界（酒馆悬赏杀狗）演示了从组建世界到领奖的全过程：

```ts
import assert from 'node:assert';
import { Name } from '@mud/ecs-engine';
import { ManualClock, createTestWorld } from '@mud/ecs-engine/testing';
import {
  MovementSystem, ItemSystem, CombatSystem, LootSystem, DeathSystem,
  QuestSystem, DescriptionSystem, BuffSystem, BuffCleanupSystem, buffBlueprint,
  Health, Position, Located, Exits, Loot, QuestGiver, QuestLog,
  AttackCommand, TakeCommand, InventoryCommand, QuestCommand, TurnInCommand,
  GoCommand, createDirectionCommand,
} from '@mud/prefabs';

// ---- 可控时钟：clock.advance 真的驱动世界时间 ----
const clock = new ManualClock();
const w = createTestWorld({ tickInterval: 100, clock });

w.world.register(
  MovementSystem, ItemSystem, CombatSystem, LootSystem, DeathSystem,
  QuestSystem, DescriptionSystem, BuffSystem, BuffCleanupSystem,
);
w.world.registerCommands(
  AttackCommand, TakeCommand, InventoryCommand, QuestCommand, TurnInCommand,
  GoCommand, createDirectionCommand('north', ['north']),
);

const player = w.entities.createWithId('player');
w.addComponent(player, Health, { current: 50, max: 100 });
w.addComponent(player, Position, { roomId: 'town' });
w.addComponent(player, Name, { text: '勇者' });
w.addComponent(player, QuestLog); // 没有它就不参与任务

const town = w.entities.createWithId('town');
w.addComponent(town, Name, { text: '城镇' });
w.addComponent(town, Exits, { north: 'tavern' });
const tavern = w.entities.createWithId('tavern');
w.addComponent(tavern, Name, { text: '酒馆' });
w.addComponent(tavern, Exits, { south: 'town' });

// 常驻 NPC 用 Located 锚定房间
const barman = w.entities.createWithId('barman');
w.addComponent(barman, Name, { text: '酒保' });
w.addComponent(barman, Located, { at: 'tavern' });
w.addComponent(barman, QuestGiver, {
  quests: [
    {
      id: 'dog-hunt',
      title: '除掉野狗',
      objective: { type: 'kill', target: '野狗', count: 1 },
      reward: { items: [{ name: '陈酿麦酒' }], heal: 20 },
    },
  ],
});

const mob = w.entities.createWithId('mob');
w.addComponent(mob, Name, { text: '野狗', aliases: ['狗'] });
w.addComponent(mob, Position, { roomId: 'town' });
w.addComponent(mob, Health, { current: 20, max: 20 });
w.addComponent(mob, Loot, { drops: [{ name: '狗肉' }] });

// ---- 跑闭环：击杀 → 掉落 → 拾取 → 回酒馆交任务领奖 ----
await w.world.execute('attack 野狗', player);
await w.world.execute('attack 野狗', player); // HP 归零 → Died → 掉落 + 清场

assert.ok(!w.entities.has('mob'), '死亡管线：目标被清场');
const log = w.getComponent(player, QuestLog)!;
assert.ok(log.completed.includes('dog-hunt'), 'kill 目标已达成（进度全局追踪）');

// 掉落物是真实体：此刻在城镇容器里
await w.world.execute('take 狗肉', player);
assert.ok((await w.world.execute('inventory', player))!.includes('狗肉'), '掉落物可拾取');

// 交付必须回到酒保身边
assert.strictEqual(await w.world.execute('north', player), null, '移动成功');
assert.strictEqual(await w.world.execute('turnin', player), null, '交付成功');
assert.ok(log.turnedIn.includes('dog-hunt'), '任务已交付');
assert.ok((await w.world.execute('inventory', player))!.includes('陈酿麦酒'), '奖励已入包');
assert.strictEqual(
  w.getComponent(player, Health)!.current,
  70,
  'heal 奖励已生效（50 + 20）',
);
```

任务规则一览：

| 规则 | 说明 |
| --- | --- |
| 掉落 | 死者带 `Loot` → 掉落物实体落入**死亡房间**容器，输出一句话，emit `LootDropped` |
| kill 目标 | 订阅 `Died`，死者名与 `target` 包含匹配，`killer` 记功 |
| collect 目标 | 订阅 `ItemTaken`，**物品真正到手里才计数**（拿不动的不白送进度） |
| 进度 | 全局追踪，不看玩家在哪（在酒馆接任务、去广场杀怪照样记功） |
| 交付 | `turnin` 必须与发任务者**同房间**；发奖后写入 `turnedIn`，不可重复领 |
| 奖励 | `items` 用 `ctx.spawn` 进玩家容器；`heal` 回血（上限 max） |

不引入随机掉落——概率需要确定性伪随机设计（seed 来源），单开一版再做。

## Buff：定时效果也是实体（v0.7）

**Buff 是实体，不是列表组件**（与 `Located` 同哲学）：每个 buff 是一个挂
`Afflicted` 的实体，指向受害者。查询"谁身上有什么"= `findByComponent(Afflicted)`，
快照天然安全，死亡清场只需订阅 `Died` 销毁 buff 实体。

```ts
// ---- Buff：结算由世界时间网格驱动 ----
// BuffSystem 每 1000ms 一跳；首跳激活（写计时起点），此后每格结算一次效果
const hp = () => w.getComponent(player, Health)!.current;
w.world.spawn(
  buffBlueprint({
    victim: player,
    effect: { type: 'heal', amount: 5, every: 1000 },
    lasts: 1500, // 毫秒，自激活起；<= 0 表示永久
  }),
);

clock.advance(1000); // 首个结算网格：激活，本格不结算
assert.strictEqual(hp(), 70, '激活网格只写计时起点，不结算');

clock.advance(1000); // 第二网格：结算 +5（截断在 0..max）
assert.strictEqual(hp(), 75, 'heal buff 按网格回血');

clock.advance(1000); // time 3000 ≥ startedAt(1000) + lasts(1500)：到期那格不再结算并销毁
assert.strictEqual(hp(), 75, '到期不再结算');
```

| 规则 | 说明 |
| --- | --- |
| 计时起点 | 内容层 `startedAt` 留 0（待激活），`BuffSystem` 首个结算网格写入世界时间——**内容层零时间感知** |
| 毒杀 | HP 归零 → emit `Died`（killer = `source`）→ **走完整死亡管线**（掉落/任务/清场全生效） |
| 死亡清场 | `BuffCleanupSystem`（on `Died`，priority 50）：销毁死者身上全部 buff，不留孤儿 |
| 事件 | `BuffApplied`（激活）/ `BuffTicked`（含实际变化量 `applied`）/ `BuffExpired` |
| 确定性 | 与 `NpcWanderSystem` 同款 every 网格时相——快照/回滚/录像/分叉天然一致 |

> v0.7 是**定时效果层**（最小 Buff）。属性修正（+攻/-防）、叠加/互斥/驱散属于
> "属性层"复杂度，等真实内容逼出需求后再做。

---

[← 上一篇：09 区域与房间行为](./09-areas-behaviors.md) | [下一篇：11 对话与 NPC →](./11-dialogue-npc.md) | [目录](./index.md)
