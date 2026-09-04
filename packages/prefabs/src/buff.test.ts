/**
 * 最小 Buff 系统测试（v0.7-A）
 *
 * 锁死五件事：
 * 1. 定时结算：damage/heal 按 effect.every 网格走，挂上瞬间不立即结算
 * 2. 到期自动移除（Duration）并 emit BuffExpired
 * 3. 毒杀走完整死亡管线（Died → 掉落/清场），killer = buff 施加者
 * 4. 受害者死亡时身上的 buff 被清理（BuffCleanupSystem，管线中段）
 * 5. 全程确定性：快照 round-trip + 录像重放（用 v0.6 的可控时钟精确驱动）
 */
import { describe, it, expect } from 'vitest';
import { ManualClock, createTestWorld, record, verifyReplay, Name } from '@mud/ecs-engine';
import type { OutputMessage } from '@mud/ecs-engine';
import {
  ItemSystem,
  CombatSystem,
  LootSystem,
  DeathSystem,
  BuffSystem,
  BuffCleanupSystem,
  buffBlueprint,
} from './systems.js';
import { Health, Position, Exits, Loot, Afflicted, Duration } from './traits.js';
import type { BuffEffect } from './traits.js';
import { BuffExpired, BuffTicked } from './events.js';
import { itemsInContainer } from './queries.js';

function textOf(messages: OutputMessage[], kind: string): string[] {
  return messages
    .filter((m) => m.kind === kind)
    .map((m) => m.segments.map((s) => s.text).join(''));
}

interface BuffWorldOpts {
  hp?: { current: number; max: number };
  loot?: boolean;
}

function buffWorld(opts: BuffWorldOpts = {}) {
  const clock = new ManualClock();
  const w = createTestWorld({
    tickInterval: 100,
    clock,
    systems: [ItemSystem, LootSystem, CombatSystem, DeathSystem, BuffSystem, BuffCleanupSystem],
  });

  const victim = w.entities.createWithId('victim');
  w.addComponent(victim, Name, { text: '倒霉蛋' });
  w.addComponent(victim, Health, opts.hp ?? { current: 100, max: 100 });
  w.addComponent(victim, Position, { roomId: 'town' });
  if (opts.loot) {
    w.addComponent(victim, Loot, { drops: [{ name: '遗产' }] });
  }

  const town = w.entities.createWithId('town');
  w.addComponent(town, Name, { text: '城镇' });
  w.addComponent(town, Exits, {});

  const spawnBuff = (effect: BuffEffect, lasts: number, source?: string) => {
    const id = w.world.spawn(buffBlueprint({ victim, effect, lasts, source }));
    // 激活与结算都由 BuffSystem 在网格点处理——内容层零时间感知
    return id;
  };

  return { w, clock, victim, town, spawnBuff };
}

describe('V6 最小 Buff（v0.7-A）', () => {
  it('毒：按 effect.every 网格掉血，挂上瞬间不结算', () => {
    const { w, clock, victim, spawnBuff } = buffWorld();
    spawnBuff({ type: 'damage', amount: 3, every: 1000 }, 5000);

    clock.advance(1000); // 首个网格：激活（startedAt=1000），本次不结算
    expect(w.getComponent(victim, Health)!.current).toBe(100);

    clock.advance(1000); // t=2000：第一次结算
    expect(w.getComponent(victim, Health)!.current).toBe(97);
    expect(textOf(w.output.getAll(), 'narrative').join('')).toContain('持续伤害');
  });

  it('毒：到期自动移除（Duration），不再掉血', () => {
    const { w, clock, victim, spawnBuff } = buffWorld();
    const buffId = spawnBuff({ type: 'damage', amount: 3, every: 1000 }, 2000);

    clock.advance(3000); // t=1000 激活；t=2000 结算一次；t=3000 到期判定（2000>=2000）→ 销毁
    expect(w.entities.has(buffId)).toBe(false);
    expect(w.getComponent(victim, Health)!.current).toBe(97); // 只结算过一次

    clock.advance(2000); // buff 已消失，不再掉血
    expect(w.getComponent(victim, Health)!.current).toBe(97);
  });

  it('到期 emit BuffExpired；每次结算 emit BuffTicked', () => {
    const expired: unknown[] = [];
    const ticked: number[] = [];
    const { w, clock, victim, spawnBuff } = buffWorld({ hp: { current: 95, max: 100 } });
    w.world.register({
      name: 'buffwatch',
      every: 0,
      on: [BuffExpired.token],
      handle: (e: { data: { buff: string; victim: string } }) =>
        expired.push([e.data.buff, e.data.victim]),
    } as never);
    w.world.register({
      name: 'tickwatch',
      every: 0,
      on: [BuffTicked.token],
      handle: (e: { data: { applied: number } }) => ticked.push(e.data.applied),
    } as never);

    const id = spawnBuff({ type: 'heal', amount: 5, every: 1000 }, 2000);
    clock.advance(3000);

    expect(expired).toEqual([[id, victim]]);
    expect(ticked).toEqual([5]); // t=2000 结算一次 +5
  });

  it('回春：持续回血且不超过 max', () => {
    const { w, clock, victim, spawnBuff } = buffWorld({ hp: { current: 95, max: 100 } });
    spawnBuff({ type: 'heal', amount: 4, every: 1000 }, 10_000);

    clock.advance(3000); // 激活后 2000/3000 两次结算 +8 → 103 → 截到 100

    clock.advance(2000); // t=2000 结算 +5 → 100（截断）
    expect(w.getComponent(victim, Health)!.current).toBe(100);
  });

  it('effect.every 粒度独立于 BuffSystem 结算粒度', () => {
    const { w, clock, victim, spawnBuff } = buffWorld();
    spawnBuff({ type: 'damage', amount: 2, every: 2000 }, 10_000);

    clock.advance(3000); // t=1000 激活；t=3000：elapsed 2000 >= 2000 → 首次结算
    expect(w.getComponent(victim, Health)!.current).toBe(98);

    clock.advance(2000); // t=5000：elapsed 又 2000 → 第二次结算
    expect(w.getComponent(victim, Health)!.current).toBe(96);
  });

  it('毒杀：HP 归零 emit Died，死亡管线全生效（清场 + 掉落），killer = source', () => {
    const deaths: { entity: string; killer?: string }[] = [];
    const { w, clock, victim, spawnBuff } = buffWorld({ hp: { current: 5, max: 100 }, loot: true });
    w.world.register({
      name: 'deathwatch',
      on: ['died'],
      handle: (e: { data: { entity: string; killer?: string } }) =>
        deaths.push({ entity: e.data.entity, killer: e.data.killer }),
    } as never);
    const witch = w.entities.createWithId('witch');
    w.addComponent(witch, Name, { text: '女巫' });

    spawnBuff({ type: 'damage', amount: 3, every: 1000 }, 60_000, witch);

    clock.advance(3000); // 结算两次：5→2→0 → Died
    expect(deaths).toEqual([{ entity: 'victim', killer: 'witch' }]);
    expect(w.entities.has(victim)).toBe(false); // DeathSystem 清场
    expect(itemsInContainer(w.entities, 'town').map((id) => w.getComponent(id, Name)!.text)).toEqual(['遗产']);
  });

  it('受害者死亡时身上的其他 buff 被清理', () => {
    const { w, clock, spawnBuff } = buffWorld({ hp: { current: 5, max: 100 } });
    const poison = spawnBuff({ type: 'damage', amount: 5, every: 1000 }, 60_000);
    const blessing = spawnBuff({ type: 'heal', amount: 2, every: 1000 }, 60_000);

    clock.advance(3000); // t=2000：毒结算 -5 → HP 0 → Died（回春尚未结算也被一并清理）

    expect(w.entities.has(poison)).toBe(false);
    expect(w.entities.has(blessing)).toBe(false);
    expect(w.findByComponent(Afflicted)).toEqual([]);
  });

  it('快照 round-trip：回滚后 HP 与 buff 状态都回到快照时点', () => {
    const { w, clock, victim, spawnBuff } = buffWorld();
    const buffId = spawnBuff({ type: 'damage', amount: 3, every: 1000 }, 10_000);

    clock.advance(2000); // 结算一次 → 97
    const snap = w.world.createSnapshot();

    clock.advance(3000); // 继续掉血（t=3000/4000/5000 三次结算 → 88）
    w.world.rollbackWorld(snap);

    expect(w.getComponent(victim, Health)!.current).toBe(97);
    expect(w.entities.has(buffId)).toBe(true);
    expect(w.getComponent(buffId, Afflicted)!.startedAt).toBe(1000);

    // 回滚后 buff 继续按原节拍结算（确定性不因回滚而断）：t=3000/4000 两次
    clock.advance(2000);
    expect(w.getComponent(victim, Health)!.current).toBe(91);
  });

  it('录像重放：毒杀全链路确定性一致', async () => {
    const build = () => {
      const env = buffWorld({ hp: { current: 5, max: 100 }, loot: true });
      const id = env.spawnBuff({ type: 'damage', amount: 3, every: 1000 }, 60_000, 'witch');
      return { env, id };
    };
    const { env, id } = build();
    const rec = record(env.w.world);
    rec.tick(30); // 3 秒：激活 + 两次结算 + 毒杀（tick 必须经 recorder 才会被录制）

    const result = await verifyReplay(rec.stop(), () => build().env.w.world);
    expect(result.ok).toBe(true);
    expect(result.diff).toBeUndefined();
    void id;
  });

  it('永久 buff：无 Duration 组件时永不过期', () => {
    const { w, clock, victim, spawnBuff } = buffWorld();
    const id = spawnBuff({ type: 'damage', amount: 3, every: 1000 }, 0); // lasts 0 = 不挂 Duration
    expect(w.getComponent(id, Duration)).toBeUndefined();

    clock.advance(5000);
    expect(w.entities.has(id)).toBe(true);
    expect(w.getComponent(victim, Health)!.current).toBe(100 - 3 * 4); // t=1000 激活，2000/3000/4000/5000 四次结算
  });
});
