/**
 * 侠客行 · 点击策略（交互标注②）
 *
 * "正文即链接"的分发表：渲染层遇到可交互段时来这里问"点了执行什么"。
 * 游戏层有世界知识（ForSale/Portable/Located），按实体现状选语境动词：
 *
 * - 出口方向   → go（直接走）
 * - 铺面商品   → buy（hover 带价格）
 * - 地上可携物 → take
 * - 敌怪       → attack **预填**输入框等回车（危险动词不做一键直发）
 * - NPC        → look
 * - 背包物品   → look（丢弃/装备走语境动作条，见③）
 *
 * 铁律：策略只**编译**成命令文本，全部走 execute 同一条管线——
 * 录像回放、help 归集、输入建议零漂移。
 */
import type { Segment, World, EntityId } from '@mud/ecs-engine';
import { Dialogue } from '@mud/ecs-engine';
import type { ClickAction } from '@mud/web-client';
import {
  directionFromLabel,
  Located,
  Portable,
  Position,
  Health,
  QuestGiver,
} from '@mud/prefabs';
import { ForSale } from './traits';

export function createClickPolicy(
  world: World,
  playerId: EntityId,
): (seg: Segment) => ClickAction | null {
  return (seg: Segment): ClickAction | null => {
    const tag = seg.style?.tag;
    const text = seg.text.trim();
    if (!text) return null;

    // 出口方向：中文名反查机器 id（北 → north）
    if (tag === 'direction') {
      const dir = directionFromLabel(text);
      return dir ? { command: `go ${dir}`, hint: `往${text}走` } : null;
    }
    if (tag !== 'entity') return null;

    // 有 entityRef → 按实体现状选语境动词；没有（纯内联标注）退回 look
    const id = seg.entityRef;
    if (!id) return { command: `look ${text}`, hint: `看看「${text}」` };

    const pos = world.getComponent(playerId, Position);
    const inRoom = !!pos && world.hasRelation(id, Located, pos.roomId);
    const heldByPlayer = world.hasRelation(id, Located, playerId);

    if (heldByPlayer) {
      return { command: `look ${text}`, hint: `查看「${text}」（在背包里）` };
    }
    if (inRoom) {
      if (world.getComponent(id, ForSale)) {
        const price = world.getComponent(id, ForSale)!.price;
        return { command: `buy ${text}`, hint: `买下「${text}」（${price} 碎银）` };
      }
      const isNpc =
        world.getComponent(id, Dialogue) !== undefined ||
        world.getComponent(id, QuestGiver) !== undefined;
      if (!isNpc && world.getComponent(id, Health) !== undefined) {
        return { command: `attack ${text}`, mode: 'prefill', hint: `攻击「${text}」（回车确认）` };
      }
      if (world.getComponent(id, Portable) !== undefined) {
        return { command: `take ${text}`, hint: `捡起「${text}」` };
      }
    }
    return { command: `look ${text}`, hint: `看看「${text}」` };
  };
}
