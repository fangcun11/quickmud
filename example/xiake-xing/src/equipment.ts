/**
 * 侠客行 · 装备（M3）
 *
 * - `Equipment` 三槽（weapon/armor/trinket）指向背包中的装备品实体
 * - 装备品带 `Gear`（槽位）与 `Bonus`（加成）——战斗时经 effectiveStats 聚合
 * - 装备不改变物品位置（仍挂在玩家身上）；卸下只是清槽
 *
 * 铁律照旧：命令 emit 意图（Equipped/Unequipped），写状态的是系统。
 */
import { defineCommand, defineSystem } from '@mud/ecs-engine';
import type { ComponentDefinition, EntityId } from '@mud/ecs-engine';
import { resolveInContainer, displayName } from '@mud/prefabs';
import { Equipment, Gear, Bonus, Stats } from './traits';
import { Equipped, Unequipped } from './events';

export const SLOTS = ['weapon', 'armor', 'trinket'] as const;
export type SlotName = (typeof SLOTS)[number];

const SLOT_NAMES: Record<SlotName, string> = { weapon: '武器', armor: '防具', trinket: '饰物' };

/** 聚合函数（M3）：Stats + 已装备 Bonus 之和——战斗公式的唯一入口 */
export function effectiveStats(
  world: {
    getComponent: <T>(id: EntityId, c: ComponentDefinition<T>) => T | undefined;
  },
  id: EntityId,
): { atk: number; def: number; dodge: number } {
  const base = world.getComponent(id, Stats) ?? { atk: 1, def: 0, dodge: 0 };
  const out = { atk: base.atk, def: base.def, dodge: base.dodge };
  const eq = world.getComponent(id, Equipment);
  if (!eq) return out;
  for (const slot of SLOTS) {
    const itemId = eq[slot];
    if (!itemId) continue;
    const bonus = world.getComponent(itemId, Bonus);
    if (!bonus) continue;
    out.atk += bonus.atk;
    out.def += bonus.def;
    out.dodge += bonus.dodge;
  }
  return out;
}

/** 装备命令：equip/装备 <物品>（物品须在背包；同槽旧装备自动被顶替——它还在背包里） */
export const EquipCommand = defineCommand({
  verbs: ['equip', '装备'],
  describe: '装备背包里的武器/防具/饰物（加成进战斗公式）',
  args: { item: { type: 'entity' } },
  handle({ args, output, player, world }) {
    if (!args.item) {
      output.error('装备什么？（背包里的装备品：装备 铁剑）');
      return null;
    }
    const itemId = resolveInContainer(world, player, args.item);
    if (!itemId) {
      output.error(`你背包里没有「${args.item}」。`);
      return null;
    }
    const gear = world.getComponent(itemId, Gear);
    if (!gear) {
      output.error(`「${args.item}」不是可装备的东西。`);
      return null;
    }
    world.emit(Equipped, { entity: player, item: itemId, slot: gear.slot });
    return null;
  },
});

/** 卸下命令：unequip/卸下 <槽位>（weapon/armor/trinket；武器=卸 武器） */
export const UnequipCommand = defineCommand({
  verbs: ['unequip', '卸下'],
  describe: '卸下装备（unequip 武器；加成随之失效）',
  args: { slot: { type: 'word' } },
  handle({ args, output, player, world }) {
    const raw = (args.slot ?? '').trim();
    const slot = SLOTS.find((s) => s === raw || SLOT_NAMES[s] === raw || s.startsWith(raw));
    if (!slot) {
      output.error('卸哪个槽位？（weapon/armor/trinket，或：卸下 武器）');
      return null;
    }
    const eq = world.getComponent(player, Equipment);
    if (!eq || !eq[slot]) {
      output.error(`你没有装备${SLOT_NAMES[slot]}。`);
      return null;
    }
    world.emit(Unequipped, { entity: player, slot });
    return null;
  },
});

/** 装备落地（M3）：写槽位（同槽旧装备被顶替——它仍在背包，随时可再装） */
export const EquipSystem = defineSystem({
  name: 'xk.equip',
  on: [Equipped, Unequipped],
  handle(event, ctx) {
    const eq = ctx.getComponent(event.data.entity, Equipment);
    if (!eq) return;
    if (event.token === Equipped.token) {
      const { item, slot } = event.data as { item: EntityId; slot: SlotName };
      eq[slot] = item;
      const bonus = ctx.getComponent(item, Bonus);
      const parts: string[] = [];
      if (bonus && bonus.atk) parts.push(`攻 +${bonus.atk}`);
      if (bonus && bonus.def) parts.push(`防 +${bonus.def}`);
      if (bonus && bonus.dodge) parts.push(`身法 +${bonus.dodge}`);
      const label = parts.length ? `（${parts.join('，')}）` : '';
      ctx.output.narrative(
        `你装备了${SLOT_NAMES[slot]}「${displayName(ctx, item)}」${label}。`,
      );
      return;
    }
    const { slot } = event.data as { slot: SlotName };
    eq[slot] = '';
    ctx.output.narrative(`你卸下了${SLOT_NAMES[slot]}。`);
  },
});

