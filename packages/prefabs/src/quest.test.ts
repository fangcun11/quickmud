/**
 * 任务进度系统测试（v0.6-A2）
 *
 * 锁死四件事：
 * 1. `collect` 目标由 ItemTaken 推进，`kill` 目标由 Died 推进
 * 2. 只在玩家真的拿到物品之后才推进（拿不动的东西不计数）
 * 3. 任务归属按房间：不同房间的 NPC 不会因为别人的行为给玩家记功
 * 4. 交任务才发奖，且只能交一次（重复交付被拒）
 */
import { describe, it, expect } from 'vitest';
import { World, Name, record, verifyReplay } from '@mud/ecs-engine';
import type { OutputMessage } from '@mud/ecs-engine';
import {
  ItemSystem,
  CombatSystem,
  LootSystem,
  DeathSystem,
  QuestSystem,
} from './systems.js';
import {
  TakeCommand,
  AttackCommand,
  QuestCommand,
  TurnInCommand,
  InventoryCommand,
} from './commands.js';
import {
  Health,
  Position,
  Description,
  Exits,
  Portable,
  Located,
  Loot,
  QuestGiver,
  QuestLog,
} from './traits.js';
import type { QuestDef } from './traits.js';
import {
  QuestStarted,
  QuestProgressed,
  QuestCompleted,
  QuestTurnedIn,
} from './events.js';
import { itemsInContainer, displayName } from './queries.js';

function textOf(messages: OutputMessage[], kind: string): string[] {
  return messages
    .filter((m) => m.kind === kind)
    .map((m) => m.segments.map((s) => s.text).join(''));
}

const DOG_HUNT: QuestDef = {
  id: 'dog-hunt',
  title: '除掉野狗',
  objective: { type: 'kill', target: '野狗', count: 1 },
  reward: { items: [{ name: '麦酒', description: '一杯冰镇麦酒。' }], heal: 10 },
};

const MEAT_ERRAND: QuestDef = {
  id: 'meat-errand',
  title: '送一块狗肉',
  objective: { type: 'collect', target: '狗肉', count: 1 },
  reward: { items: [{ name: '金币' }] },
};

/** 城镇（酒保 + 玩家） + 广场（野狗，带掉落狗肉） */
function questWorld(quests: QuestDef[] = [DOG_HUNT]) {
  const w = new World({ tickInterval: 500 });
  w.register(ItemSystem, CombatSystem, LootSystem, DeathSystem, QuestSystem);
  w.registerCommands(
    TakeCommand,
    AttackCommand,
    QuestCommand,
    TurnInCommand,
    InventoryCommand,
  );

  const player = w.entities.createWithId('player');
  w.addComponent(player, Health, { current: 50, max: 100 });
  w.addComponent(player, Position, { roomId: 'town' });
  w.addComponent(player, Name, { text: '勇者' });
  w.addComponent(player, QuestLog);

  const town = w.entities.createWithId('town');
  w.addComponent(town, Name, { text: '城镇' });
  w.addComponent(town, Exits, { east: 'square' });

  const square = w.entities.createWithId('square');
  w.addComponent(square, Name, { text: '广场' });
  w.addComponent(square, Exits, { west: 'town' });

  // 酒保常驻酒馆（用 Located 关系锚定房间，不用 Position）
  const barman = w.entities.createWithId('barman');
  w.addComponent(barman, Name, { text: '酒保' });
  w.addComponent(barman, Located, { targets: ['town'] });
  w.addComponent(barman, QuestGiver, { quests });

  const mob = w.entities.createWithId('mob');
  w.addComponent(mob, Name, { text: '野狗', aliases: ['狗'] });
  w.addComponent(mob, Position, { roomId: 'town' });
  w.addComponent(mob, Health, { current: 20, max: 20 });
  w.addComponent(mob, Loot, {
    drops: [{ name: '狗肉', description: '一块血淋淋的肉。' }],
  });

  const meat = w.entities.createWithId('meat');
  w.addComponent(meat, Name, { text: '狗肉' });
  w.addComponent(meat, Description, { text: '一块血淋淋的肉。' });
  w.addComponent(meat, Portable);
  w.addComponent(meat, Located, { targets: ['town'] });

  return { w, player, barman, mob, meat };
}

describe('V5 任务进度（v0.6-A2）', () => {
  it('collect 目标：拾取物品后推进并 emit 完成', async () => {
    const seen: string[] = [];
    const { w, player } = questWorld([MEAT_ERRAND]);
    w.register({
      name: 'questwatch',
      on: [QuestStarted.token, QuestProgressed.token, QuestCompleted.token],
      handle: (e: { data: { questId: string } }) => seen.push(`${e.data.questId}`),
    } as never);

    await w.execute('take 狗肉', player);

    expect(w.getComponent(player, QuestLog)!.active['meat-errand']).toBe(1);
    expect(w.getComponent(player, QuestLog)!.completed).toEqual(['meat-errand']);
    expect(seen).toEqual(['meat-errand', 'meat-errand', 'meat-errand']);
    expect(textOf(w.output.getAll(), 'narrative')).toContain('任务「送一块狗肉」完成。');
  });

  it('kill 目标：击杀后推进（掉落与任务互不干扰）', async () => {
    const { w, player } = questWorld([DOG_HUNT]);

    await w.execute('attack 野狗', player);
    await w.execute('attack 野狗', player);

    const log = w.getComponent(player, QuestLog)!;
    expect(log.active['dog-hunt']).toBe(1);
    expect(log.completed).toEqual(['dog-hunt']);
    // 掉落照旧发生
    expect(itemsInContainer(w.entities, 'town').length).toBeGreaterThan(0);
  });

  it('进度全局追踪：玩家与发任务者不在同一房间也记功', async () => {
    const { w, player } = questWorld([MEAT_ERRAND]);
    // 把酒保挪到广场，玩家留在城镇捡狗肉 —— 在酒馆接任务、别处办事是常态
    w.removeRelation('barman', Located, 'town');
    w.addRelation('barman', Located, 'square');

    await w.execute('take 狗肉', player);

    expect(w.getComponent(player, QuestLog)!.active['meat-errand']).toBe(1);
    // 但交付必须回到酒保身边
    expect(await w.execute('turnin', player)).toBeNull();
    expect(textOf(w.output.getAll(), 'error')).toContain('这里没有可交付的任务。');
  });

  it('物品没真正到手 → 不推进（拿不动的东西不计数）', async () => {
    const { w, player } = questWorld([MEAT_ERRAND]);
    // 去掉 Portable → ItemSystem 会拒绝转移
    w.removeComponent('meat', Portable);

    await w.execute('take 狗肉', player);

    expect(w.getComponent(player, QuestLog)!.active['meat-errand']).toBeUndefined();
    expect(textOf(w.output.getAll(), 'error')).toContain('「狗肉」纹丝不动——那不是你能拿走的东西。');
  });

  it('quests 命令列出当前房间 NPC 的任务与进度', async () => {
    const { w, player } = questWorld([DOG_HUNT, MEAT_ERRAND]);

    expect(await w.execute('quests', player)).toBe(
      '任务：\n- 除掉野狗（0/1）\n- 送一块狗肉（0/1）',
    );

    await w.execute('take 狗肉', player);
    expect(await w.execute('quests', player)).toBe(
      '任务：\n- 除掉野狗（0/1）\n- 送一块狗肉（已完成，可交付）',
    );
  });

  it('turnin：交付后发奖励（物品进背包 + 回血），且只能交一次', async () => {
    const { w, player } = questWorld([DOG_HUNT]);
    await w.execute('attack 野狗', player);
    await w.execute('attack 野狗', player);
    w.output.clear();

    await w.execute('turnin', player);

    const log = w.getComponent(player, QuestLog)!;
    expect(log.turnedIn).toEqual(['dog-hunt']);
    expect(w.getComponent(player, Health)!.current).toBe(60); // 50 + heal 10
    const bag = itemsInContainer(w.entities, player);
    expect(bag.map((id) => displayName(w.entities, id))).toContain('麦酒');
    expect(textOf(w.output.getAll(), 'narrative')).toContain(
      '你把「除掉野狗」交给了「酒保」。',
    );

    // 再交一次 → 被拒，不重复发奖
    expect(await w.execute('turnin', player)).toBeNull();
    expect(textOf(w.output.getAll(), 'error')).toContain('这里没有可交付的任务。');
  });

  it('任务未完成时 turnin 被拒', async () => {
    const { w, player } = questWorld([DOG_HUNT]);
    expect(await w.execute('turnin', player)).toBeNull();
    expect(textOf(w.output.getAll(), 'error')).toContain('这里没有可交付的任务。');
  });

  it('玩家没有 QuestLog 时不参与任务（静默，不报错）', async () => {
    const { w, player } = questWorld([MEAT_ERRAND]);
    w.removeComponent(player, QuestLog);

    await w.execute('take 狗肉', player);

    expect(w.getComponent(player, QuestLog)).toBeUndefined();
  });

  it('快照 → 推进任务 → 回滚 → 进度归零', async () => {
    const { w, player } = questWorld([MEAT_ERRAND]);
    const snap = w.createSnapshot();

    await w.execute('take 狗肉', player);
    expect(w.getComponent(player, QuestLog)!.completed).toEqual(['meat-errand']);

    w.rollbackWorld(snap);
    expect(w.getComponent(player, QuestLog)!.completed).toEqual([]);
    expect(w.getComponent(player, QuestLog)!.active).toEqual({});
  });

  it('录像重放：collect → turnin 全链路确定性一致', async () => {
    const build = () => questWorld([MEAT_ERRAND]);
    const world = build();
    const rec = record(world.w);
    await rec.execute('take 狗肉', world.player);
    await rec.execute('turnin', world.player);

    const result = await verifyReplay(rec.stop(), () => build().w);
    expect(result.ok).toBe(true);
    expect(result.diff).toBeUndefined();
  });

  it('QuestTurnedIn 事件载荷完整', async () => {
    const seen: unknown[] = [];
    const { w, player } = questWorld([DOG_HUNT]);
    w.register({
      name: 'turninwatch',
      on: [QuestTurnedIn.token],
      handle: (e: { data: unknown }) => seen.push(e.data),
    } as never);

    await w.execute('attack 野狗', player);
    await w.execute('attack 野狗', player);
    await w.execute('turnin', player);

    expect(seen).toEqual([{ player: 'player', giver: 'barman', questId: 'dog-hunt' }]);
  });
});
