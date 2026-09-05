/**
 * 侠客行 · 山神庙祈祷（M5 沉浸内容）
 *
 * 山神庙专属交互：每日首次祈祷恢复 30 气血（死亡重生重置）。
 * 让山神庙从"路过的地方"变成"有理由回去的地方"。
 */
import { defineCommand, defineSystem } from '@mud/ecs-engine';
import { Position, Health } from '@mud/prefabs';
import { Prayed } from './traits';

export const PrayCommand = defineCommand({
  verbs: ['pray', '拜', '祈祷'],
  describe: '在山神庙祈祷（恢复 30 气血，一次）',
  handle({ output, player, world }) {
    const pos = world.getComponent(player, Position);
    if (!pos || pos.roomId !== 'shrine') {
      output.error('你得在山神庙里才能祈祷。');
      return null;
    }
    const prayed = world.getComponent(player, Prayed);
    if (prayed?.done) {
      output.narrative('你再次跪拜，但山神已不再回应。');
      return null;
    }
    if (prayed) prayed.done = true;
    const hp = world.getComponent(player, Health);
    if (hp) hp.current = Math.min(hp.max, hp.current + 30);
    output.narrative('你跪在香案前，虔诚叩首。一阵暖流涌遍全身——气血回复了 30 点。');
    return null;
  },
});
