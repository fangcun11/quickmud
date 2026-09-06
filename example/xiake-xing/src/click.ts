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
  DIRECTION_LABELS,
  directionFromLabel,
  Located,
  Portable,
  Position,
  Health,
  QuestGiver,
} from '@mud/prefabs';
import { Combat, Cultivating, ForSale } from './traits';

export function createClickPolicy(
  world: World,
  playerId: EntityId,
): (seg: Segment) => ClickAction | null {
  return (seg: Segment): ClickAction | null => {
    const tag = seg.style?.tag;
    const text = seg.text.trim();
    if (!text) return null;

    // 出口方向：机器 id 直书（小地图可点格 entityRef=方向 id）或中文名反查
    if (tag === 'direction') {
      const ref = seg.entityRef;
      const dir =
        ref && ref in DIRECTION_LABELS ? ref : directionFromLabel(text);
      return dir ? { command: `go ${dir}`, hint: `往${text}走` } : null;
    }
    if (tag !== 'entity') return null;

    // 有 entityRef → 按实体现状选语境动词；没有（纯内联标注）退回 look
    const id = seg.entityRef;
    if (!id) return { command: `look ${text}`, hint: `看看「${text}」` };

    const pos = world.getComponent(playerId, Position);
    // 在脚下房间的两种活法：物品走 Located 关系，活物挂 Position（0.18 修复——
    // 之前只查 Located，点狼永远进不了攻击分支）
    const inRoom =
      !!pos &&
      (world.hasRelation(id, Located, pos.roomId) ||
        world.getComponent(id, Position)?.roomId === pos.roomId);
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
        // 精确指向（0.19 ID 机制）：预填**唯一 id** 而非名字——同名多狼不误伤
        return { command: `attack ${id}`, mode: 'prefill', hint: `攻击「${text}」（回车确认）` };
      }
      if (world.getComponent(id, Portable) !== undefined) {
        return { command: `take ${text}`, hint: `捡起「${text}」` };
      }
    }
    return { command: `look ${text}`, hint: `看看「${text}」` };
  };
}

/**
 * 语境动作条（交互标注③）：输入框收起后的常用操作入口。
 * 每次提示符刷新时按世界现状求值——战斗中给 停战/逃跑，打坐中给 停，
 * 平时给 打坐；查探类（状态/背包/任务/地图）恒驻。全部单击直发。
 */
export function createActionProvider(
  world: World,
  playerId: EntityId,
): Array<{ text: string; hint?: string }> {
  const actions: Array<{ text: string; hint?: string }> = [
    { text: '状态', hint: '气血/内力/三围一览' },
    { text: '背包', hint: '随身物品（背包里的东西可点击）' },
    { text: '任务', hint: '当前任务与进度' },
    { text: '地图', hint: '所在区域的略图' },
  ];
  const combat = world.getComponent(playerId, Combat);
  if (combat?.foe) {
    actions.push({ text: '停战', hint: '脱离战斗（对方可能追击）' });
    actions.push({ text: '逃跑', hint: '从来路逃走' });
  } else if (world.getComponent(playerId, Cultivating)?.on) {
    actions.push({ text: '停', hint: '收功起身' });
  } else {
    actions.push({ text: '打坐', hint: '运气回内力' });
  }
  return actions;
}
