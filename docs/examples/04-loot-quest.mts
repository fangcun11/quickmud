// 文档 §6「写测试」扩展：v0.6 的可控时钟 + @mud/prefabs 掉落/任务闭环示例
// 由 verify-doc-examples.mjs 实测（strict tsc 类型检查 + 运行断言）
import assert from 'node:assert';
import { World, Name } from '@mud/ecs-engine';
import { ManualClock, createTestWorld } from '@mud/ecs-engine/testing';
import {
  // 系统：战斗管线（战斗 → 掉落 → 清场）+ 任务 + 移动
  MovementSystem,
  ItemSystem,
  CombatSystem,
  LootSystem,
  DeathSystem,
  QuestSystem,
  DescriptionSystem,
  BuffSystem,
  BuffCleanupSystem,
  buffBlueprint,
  // 组件
  Health,
  Position,
  Located,
  Exits,
  Loot,
  QuestGiver,
  QuestLog,
  // 命令
  AttackCommand,
  TakeCommand,
  InventoryCommand,
  QuestCommand,
  TurnInCommand,
  GoCommand,
  createDirectionCommand,
} from '@mud/prefabs';

// ---- 1. 可控时钟：clock.advance 真的驱动世界时间（0.6 兑现） ----
const clock = new ManualClock();
const w = createTestWorld({ tickInterval: 100, clock });

// ---- 2. 一个最小任务世界：酒馆悬赏杀狗，狗死后掉狗肉 ----
w.world.register(
  MovementSystem,
  ItemSystem,
  CombatSystem,
  LootSystem,
  DeathSystem,
  QuestSystem,
  DescriptionSystem,
  BuffSystem, // 定时效果结算（v0.7）
  BuffCleanupSystem, // 死亡清 buff
);
w.world.registerCommands(
  AttackCommand,
  TakeCommand,
  InventoryCommand,
  QuestCommand,
  TurnInCommand,
  GoCommand,
  createDirectionCommand('north', ['north']),
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

// ---- 3. 跑闭环：击杀 → 掉落 → 拾取 → 回酒馆交任务领奖 ----
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

// ---- 4. 时钟与确定性：advance 推进的是世界时间 ----
clock.advance(300); // 3 个 tick（tickInterval: 100）
assert.strictEqual(w.currentTime, 300, '世界时间被真正推进');
assert.strictEqual(clock.now(), 300, 'clock 与世界时间同步');

// ---- 5. Buff：定时效果也是实体（v0.7），结算由世界时间网格驱动 ----
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

console.log('04-loot-quest ✓ 掉落/任务/buff/可控时钟 全通过');
