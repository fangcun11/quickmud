import { defineCommand } from '@mud/ecs-engine';
import { Look } from '../world/events';
import { Health, Position, Inventory } from '../world/traits';

/**
 * 查看命令
 */
export const LookCommand = defineCommand({
  verbs: ['look', 'l', '看', '观察'],
  args: {
    target: { type: 'optional_entity' },
  },
  handle({ args, player, world }) {
    world.emit(Look, {
      entity: player,
      target: args.target ?? undefined,
    });
    return null;
  },
});

/**
 * 背包命令
 */
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

/**
 * 状态命令
 */
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

/**
 * 帮助命令
 */
export const HelpCommand = defineCommand({
  verbs: ['help', '帮助', 'h'],
  handle() {
    return [
      '可用命令：',
      '  look (l/看)     - 观察周围环境',
      '  north (n/北)    - 向北移动',
      '  south (s/南)    - 向南移动',
      '  east  (e/东)    - 向东移动',
      '  west  (w/西)    - 向西移动',
      '  inventory (i/物品) - 查看背包',
      '  score (状态)    - 查看状态',
      '  help (帮助)     - 显示帮助',
      '  quit (退出)     - 退出游戏',
    ].join('\n');
  },
});
