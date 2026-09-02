/**
 * @mud/prefabs 命令（0.3 toolkit）—— 移动 / 查看 / 背包 / 状态的官方命令
 *
 * 命令只翻译输入并 emit 事件，状态改动由对应系统完成（三条铁律）。
 */
import { defineCommand } from '@mud/ecs-engine';
import type { AnyCommand } from '@mud/ecs-engine';
import { Moved, Look } from './events.js';
import { Position, Inventory, Health } from './traits.js';

/** 移动命令：go/move/walk/走 <方向>，支持 n/s/e/w/北 等归一 */
export const GoCommand = defineCommand({
  verbs: ['go', 'move', 'walk', '走', '移动', '前往'],
  abbrev: ['g'],
  args: {
    direction: { type: 'direction' },
  },
  handle({ args, player, world }) {
    const { direction } = args;
    if (!direction) {
      return '你要去哪里？';
    }

    // 方向归一化（单字母/中文 → 标准方向名）
    const dirMap: Record<string, string> = {
      n: 'north', s: 'south', e: 'east', w: 'west',
      北: 'north', 南: 'south', 东: 'east', 西: 'west',
    };
    const normalizedDir = dirMap[direction.toLowerCase()] ?? direction.toLowerCase();

    const pos = world.getComponent(player, Position);
    if (!pos) return '你不在任何地方。';

    world.emit(Moved, { entity: player, from: pos.roomId, to: normalizedDir });
    return null;
  },
});

/** 方向命令工厂：为每个方向生成专属动词（north/北）的命令，消除重复 */
export function createDirectionCommand(direction: string, verbs: string[]): AnyCommand {
  return defineCommand({
    verbs,
    handle({ player, world }) {
      const pos = world.getComponent(player, Position);
      if (!pos) return '你不在任何地方。';
      world.emit(Moved, { entity: player, from: pos.roomId, to: direction });
      return null;
    },
  });
}

/** 查看命令：look/l/看 <目标?>（无目标时查看所在房间） */
export const LookCommand = defineCommand({
  verbs: ['look', 'l', '看', '观察'],
  args: {
    target: { type: 'optional_entity' },
  },
  handle({ args, player, world }) {
    world.emit(Look, { entity: player, target: args.target ?? undefined });
    return null;
  },
});

/** 背包命令：inventory/i/物品 <查看持有物品> */
export const InventoryCommand = defineCommand({
  verbs: ['inventory', 'i', '物品', '背包'],
  handle({ player, world }) {
    const inv = world.getComponent(player, Inventory);
    if (!inv || inv.items.length === 0) {
      return '你的背包是空的。';
    }
    return `你的背包里有：${inv.items.join('、')}`;
  },
});

/** 状态命令：score/状态 <生命与位置一览> */
export const ScoreCommand = defineCommand({
  verbs: ['score', '状态', '属性'],
  handle({ player, world }) {
    const health = world.getComponent(player, Health);
    const pos = world.getComponent(player, Position);

    const lines: string[] = [];
    if (health) {
      lines.push(`生命值：${health.current}/${health.max}`);
    }
    if (pos) {
      lines.push(`位置：${pos.roomId}`);
    }
    return lines.join('\n') || '没有状态信息。';
  },
});
