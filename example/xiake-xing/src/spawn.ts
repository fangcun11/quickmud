/**
 * 侠客行 · 刷怪点（0.14 沉浸支线）
 *
 * 狼被杀后**不会永久消失**——每个狼区域有预期的狼数下限，
 * 每 5 息检查一次：不足则在原房间重生一只（保证可持续练级/经济）。
 *
 * 确定性：重生由固定时钟网格驱动（every 5000），零随机。
 */
import { defineSystem, blueprint, Name } from '@mud/ecs-engine';
import type { EntityId, BlueprintComponentInput } from '@mud/ecs-engine';
import { Description, Position, Health, Wander, Loot, Pose } from '@mud/prefabs';
import { Retaliate, Aggressive, Stats } from './traits';

/** 每个区域的预期狼数（与 bootstrap 初始分配一致） */
const WOLF_ZONES: Array<{ roomId: EntityId; expected: number }> = [
  { roomId: 'thicket', expected: 1 },
  { roomId: 'den', expected: 2 },
];

let spawnCounter = 0;

/** 全局狼口上限：狼会游走出区域房间，按房间计数必然失真（越刷越多） */
const TOTAL_WOLVES = WOLF_ZONES.reduce((n, z) => n + z.expected, 0);

/** 狼蓝图（与 bootstrap 手动创建的狼同款组件集） */
function wolfBlueprint(roomId: EntityId, _seq: number) {
  const components: BlueprintComponentInput[] = [
    [Name, { text: '野狼', aliases: ['狼', 'wolf'] }],
    [Description, { text: '一头精瘦的灰狼，绿油油的眼睛盯着你，喉咙里滚出低低的呜声。' }],
    [Pose, { text: '压低前身，喉咙里滚出低低的呜声' }],
    [Position, { roomId }],
    [Health, { current: 25, max: 25 }],
    [Stats, { atk: 6, def: 1, dodge: 2 }],
    [Retaliate, {}],
    [Aggressive, {}],
    [Wander, {}],
    [Loot, { drops: [{ name: '狼皮', aliases: ['皮', 'wolf skin'], description: '一张带腥味的狼皮，毛色油亮。' }] }],
  ];
  return blueprint({ components });
}

export const WolfSpawnSystem = defineSystem({
  name: 'xk.wolf-spawn',
  every: 30_000,
  handle(payload, ctx) {
    // 全局存活狼数（狼会游走，按"区域房间里的狼数"补会越刷越多——0.18 修复）
    const alive = ctx.findByComponent(Retaliate).filter((id) => {
      return (ctx.getComponent(id, Health)?.current ?? 0) > 0;
    });
    if (alive.length >= TOTAL_WOLVES) return;

    // 补进狼最少的区域房间（缺几只也只补一只——30 息一补，温和回升）
    const zone = [...WOLF_ZONES].sort(
      (a, b) =>
        alive.filter((id) => ctx.getComponent(id, Position)?.roomId === a.roomId).length -
        alive.filter((id) => ctx.getComponent(id, Position)?.roomId === b.roomId).length,
    )[0]!;
    spawnCounter++;
    ctx.spawn(wolfBlueprint(zone.roomId, spawnCounter)) as EntityId;
  },
});
