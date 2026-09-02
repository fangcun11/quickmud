import { defineCommand } from '@mud/ecs-engine';
import { Moved } from '../world/events';
import { Position } from '../world/traits';

/**
 * 移动命令
 */
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

    // 方向归一化
    const dirMap: Record<string, string> = {
      n: 'north', s: 'south', e: 'east', w: 'west',
      北: 'north', 南: 'south', 东: 'east', 西: 'west',
      北上: 'north', 南下: 'south', 东进: 'east', 西行: 'west',
    };

    const normalizedDir = dirMap[direction.toLowerCase()] ?? direction.toLowerCase();

    const pos = world.getComponent(player, Position);
    if (!pos) return '你不在任何地方。';

    world.emit(Moved, {
      entity: player,
      from: pos.roomId,
      to: normalizedDir,
    });

    return null;
  },
});

/**
 * 方向命令工厂 - 消除四个方向命令的重复代码
 */
export function createDirectionCommand(
  direction: string,
  verbs: string[],
) {
  return defineCommand({
    verbs,
    handle({ player, world }) {
      const pos = world.getComponent(player, Position);
      if (!pos) return '你不在任何地方。';

      world.emit(Moved, {
        entity: player,
        from: pos.roomId,
        to: direction,
      });

      return null;
    },
  });
}
