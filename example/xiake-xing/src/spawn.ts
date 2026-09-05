/**
 * 侠客行 · 刷怪点（0.14 沉浸支线）
 *
 * 狼被杀后**不会永久消失**——每个狼区域有预期的狼数下限，
 * 每 5 息检查一次：不足则在原房间重生一只（保证可持续练级/经济）。
 *
 * 确定性：重生由固定时钟网格驱动（every 5000），零随机。
 */
import { defineSystem, blueprint, Name } from '@mud/ecs-engine';
import type { EntityId, ComponentDataTuple } from '@mud/ecs-engine';
import { Description, Position, Health, Wander, Loot } from '@mud/prefabs';
import { Retaliate, Aggressive, Pose, Stats } from './traits';

/** 每个区域的预期狼数（与 bootstrap 初始分配一致） */
const WOLF_ZONES: Array<{ roomId: EntityId; expected: number }> = [
  { roomId: 'thicket', expected: 1 },
  { roomId: 'den', expected: 2 },
];

let spawnCounter = 0;

/** 狼蓝图（与 bootstrap 手动创建的狼同款组件集） */
function wolfBlueprint(roomId: EntityId, _seq: number) {
  const components: Array<[new (...args: unknown[]) => unknown, Record<string, unknown> | undefined]> = [
    [Name, { text: '野狼', aliases: ['狼', 'wolf'] }],
    [Description, { text: '一头精瘦的灰狼，绿油油的眼睛盯着你，喉咙里滚出低低的呜声。' }],
    [Pose, { text: '压低前身，喉咙里滚出低低的呜声' }],
    [Position, { roomId }],
    [Health, { current: 25, max: 25 }],
    [Stats, { atk: 6, def: 1, dodge: 2 }],
    [Retaliate],
    [Aggressive],
    [Wander],
    [Loot, { drops: [{ name: '狼皮', aliases: ['皮', 'wolf skin'], description: '一张带腥味的狼皮，毛色油亮。' }] }],
  ];
  return blueprint({ components });
}

export const WolfSpawnSystem = defineSystem({
  name: 'xk.wolf-spawn',
  every: 5000,
  handle(payload, ctx) {
    for (const zone of WOLF_ZONES) {
      const alive = ctx.findByComponent(Retaliate).filter((id) => {
        const p = ctx.getComponent(id, Position);
        return p?.roomId === zone.roomId;
      });
      if (alive.length >= zone.expected) continue;
      // 不足 → 重生一只
      spawnCounter++;
      const id = ctx.spawn(wolfBlueprint(zone.roomId, spawnCounter)) as EntityId;
      // 给予 Health（blueprint 未含——Health 默认值即 25/25，由内容层 addComponent 更可控）
      // 注意：blueprint 方式 Position 已在蓝图内设置
      void id;
    }
  },
});
