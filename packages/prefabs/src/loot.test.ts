/**
 * 掉落系统测试（v0.6-A1）
 *
 * 锁死三件事：
 * 1. `Died` 不再是悬空承诺——带 Loot 的实体死亡会真的掉东西到房间容器
 * 2. 掉落物是**真实体**：能被 look 看见、能被 take 拿走（不是字符串装饰）
 * 3. 掉落链路进快照/回滚/录像后依然一致（确定性不因运行时造物而破）
 */
import { describe, it, expect } from 'vitest';
import { World, Name, record, verifyReplay } from '@mud/ecs-engine';
import type { OutputMessage } from '@mud/ecs-engine';
import { ItemSystem, CombatSystem, LootSystem, DeathSystem } from './systems.js';
import { TakeCommand, InventoryCommand, AttackCommand, LookCommand } from './commands.js';
import { Health, Position, Description, Exits, Portable, Weapon, Located, Loot } from './traits.js';
import type { LootData } from './traits.js';
import { LootDropped } from './events.js';
import { itemsInContainer, displayName } from './queries.js';

function textOf(messages: OutputMessage[], kind: string): string[] {
  return messages
    .filter((m) => m.kind === kind)
    .map((m) => m.segments.map((s) => s.text).join(''));
}

/** 城镇房间 + 玩家 + 一只带掉落表的野狗（drops 为 null 表示不带 Loot 组件） */
function lootWorld(drops: LootData | null) {
  const w = new World({ tickInterval: 500 });
  w.register(ItemSystem, CombatSystem, LootSystem, DeathSystem);
  w.registerCommands(TakeCommand, InventoryCommand, AttackCommand, LookCommand);

  const player = w.entities.createWithId('player');
  w.entities.addComponent(player, Position, { roomId: 'town' });
  w.entities.addComponent(player, Name, { text: '勇者' });

  const town = w.entities.createWithId('town');
  w.entities.addComponent(town, Name, { text: '城镇' });
  w.entities.addComponent(town, Exits, {});

  const mob = w.entities.createWithId('mob');
  w.entities.addComponent(mob, Name, { text: '野狗', aliases: ['狗'] });
  w.entities.addComponent(mob, Position, { roomId: 'town' });
  w.entities.addComponent(mob, Health, { current: 20, max: 20 });
  if (drops !== null) {
    w.entities.addComponent(mob, Loot, drops);
  }

  return { w, player, mob };
}

describe('V4 掉落（v0.6-A1）', () => {
  it('击杀带 Loot 的目标 → 掉落物出现在死亡房间，可 take', async () => {
    const { w, player, mob } = lootWorld({
      drops: [{ name: '狗肉', description: '一块血淋淋的肉。' }],
    });

    await w.execute('attack 野狗', player);
    await w.execute('attack 野狗', player); // HP 20 → 0，死亡

    expect(w.entities.has(mob)).toBe(false);

    const onGround = itemsInContainer(w.entities, 'town');
    expect(onGround).toHaveLength(1);
    expect(displayName(w.entities, onGround[0]!)).toBe('狗肉');
    expect(w.entities.getComponent(onGround[0]!, Description)?.text).toBe('一块血淋淋的肉。');
    expect(w.entities.getComponent(onGround[0]!, Portable)).toBeDefined();

    // 真实体：能拿走
    await w.execute('take 狗肉', player);
    expect(w.entities.getComponent(onGround[0]!, Located)?.at).toBe('player');
  });

  it('掉落输出与 LootDropped 事件（含掉落物 id 列表）', async () => {
    const seen: { items: number; roomId?: string }[] = [];
    const { w, player } = lootWorld({ drops: [{ name: '狗肉' }, { name: '脏兮兮的项圈' }] });
    w.register({
      name: 'lootwatch',
      on: [LootDropped.token],
      handle: (e: { data: { items: string[]; roomId?: string } }) =>
        seen.push({ items: e.data.items.length, roomId: e.data.roomId }),
    } as never);

    w.output.clear();
    await w.execute('attack 野狗', player);
    await w.execute('attack 野狗', player);

    expect(seen).toEqual([{ items: 2, roomId: 'town' }]);
    expect(textOf(w.output.getAll(), 'narrative')).toContain('「野狗」倒下，掉了狗肉、脏兮兮的项圈。');
  });

  it('无 Loot 组件 → 静默不掉落（大多数实体本来就不掉东西）', async () => {
    const { w, player } = lootWorld(null);

    await w.execute('attack 野狗', player);
    await w.execute('attack 野狗', player);

    expect(itemsInContainer(w.entities, 'town')).toEqual([]);
    expect(textOf(w.output.getAll(), 'narrative')).not.toContain(
      '「野狗」倒下，掉了',
    );
  });

  it('掉落武器：damage > 0 时挂 Weapon', async () => {
    const { w, player } = lootWorld({
      drops: [{ name: '生锈的犬牙', damage: 4, description: '一根尖锐的牙。' }],
    });

    await w.execute('attack 野狗', player);
    await w.execute('attack 野狗', player);

    const item = itemsInContainer(w.entities, 'town')[0]!;
    expect(w.entities.getComponent(item, Weapon)?.damage).toBe(4);
  });

  it('掉落物可被 look 看见（进入房间的地上物列表）', async () => {
    const { w, player } = lootWorld({ drops: [{ name: '狗肉' }] });
    w.register(
      (await import('./systems.js')).DescriptionSystem,
    );

    await w.execute('attack 野狗', player);
    await w.execute('attack 野狗', player);
    w.output.clear();

    await w.execute('look', player);
    expect(textOf(w.output.getAll(), 'narrative')).toContain('你可以看到：狗肉。');
  });

  it('快照 → 击杀掉落 → 回滚 → 世界回到无掉落状态', async () => {
    const { w, player } = lootWorld({ drops: [{ name: '狗肉' }] });
    const snap = w.createSnapshot();

    await w.execute('attack 野狗', player);
    await w.execute('attack 野狗', player);
    expect(itemsInContainer(w.entities, 'town')).toHaveLength(1);

    w.rollbackWorld(snap);
    expect(itemsInContainer(w.entities, 'town')).toEqual([]);
  });

  it('录像重放：掉落链路确定性一致（运行时造物不破坏重放）', async () => {
    const build = () =>
      lootWorld({ drops: [{ name: '狗肉' }, { name: '项圈' }] });
    const world = build();
    const rec = record(world.w);
    await rec.execute('attack 野狗', world.player);
    await rec.execute('attack 野狗', world.player);
    await rec.execute('take 狗肉', world.player);

    const result = await verifyReplay(rec.stop(), () => build().w);
    expect(result.ok).toBe(true);
    expect(result.diff).toBeUndefined();
  });
});
