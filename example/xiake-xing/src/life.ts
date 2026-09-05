/**
 * 侠客行 · 世界活着（0.14 沉浸支线）：进退场播报 + 玩家死亡重生
 *
 * - `PresenceSystem`：NPC 进出玩家所在房间 → 一行氛围（xkx 的"有人走了进来"）
 * - `PlayerAwareDeathSystem`：**替代** prefabs `DeathSystem` 注册——
 *   NPC/怪死亡照旧清场；玩家死亡有重量：黑屏文案 → 回客栈重生
 *   （生命回满、内力清零、来路栈清空——死地回不去，得重新走出去）。
 *
 * 确定性：全部由事件与既有状态派生，零随机、零时钟直接读取。
 */
import { defineSystem } from '@mud/ecs-engine';
import type { EntityId } from '@mud/ecs-engine';
import { Died, Moved, Position, displayName, directionLabel } from '@mud/prefabs';
import { PlayerTag, Energy, Cultivating, Trail } from './traits';
import { Health, Backtrack } from '@mud/prefabs';

const INN_ROOM_ID = 'inn';

/** 来方向的玩家文案：direction 是"往 X 走到达"，来者自然从反方向来 */
const OPPOSITE: Record<string, string> = {
  north: '南面', south: '北面', east: '西面', west: '东面',
  up: '下方', down: '上方',
};

/** 进退场播报：NPC 进/出玩家所在房间 → 一行氛围（玩家自己的移动不播） */
export const PresenceSystem = defineSystem({
  name: 'xk.presence',
  on: [Moved],
  priority: 1,
  handle(event, ctx) {
    const { entity, from, to, direction } = event.data;
    if (!!ctx.getComponent(entity, PlayerTag)) return; // 玩家自己不播

    const player = ctx.findByComponent(PlayerTag)[0];
    if (!player) return;
    const pos = ctx.getComponent(player, Position);
    if (!pos) return;
    const name = displayName(ctx, entity);

    const dir = direction ?? '';
    if (to === pos.roomId) {
      const side = OPPOSITE[dir] ?? '黑暗中';
      ctx.output.narrative(`${name}从${side}走了进来。`);
    } else if (from === pos.roomId && dir !== 'back') {
      ctx.output.narrative(`${name}往${directionLabel(dir)}离开了。`);
    }
  },
});

/**
 * 玩家死亡重生（替代 prefabs `DeathSystem` 注册）：
 *
 * - NPC/怪死亡 → 照旧 `destroy` 清场（掉落/任务在其前的 priority 已完成）
 * - 玩家死亡 → 复活流程：黑屏文案 → 悦来客栈重生（生命回满、内力清零、
 *   打坐收功、来路栈清空——死地回不去，得重新走出去）
 */
export const PlayerAwareDeathSystem = defineSystem({
  name: 'xk.death',
  on: [Died],
  priority: 50, // LootSystem(0) 之后、prefabs DeathSystem(100) 之前——本系统替代它
  handle(event, ctx) {
    const { entity } = event.data;
    if (!ctx.getComponent(entity, PlayerTag)) {
      ctx.destroy(entity);
      return;
    }

    const hp = ctx.getComponent(entity, Health)!;
    hp.current = hp.max;
    const energy = ctx.getComponent(entity, Energy);
    if (energy) energy.current = 0;
    const cultivating = ctx.getComponent(entity, Cultivating);
    if (cultivating) cultivating.on = false;
    const backtrack = ctx.getComponent(entity, Backtrack);
    if (backtrack) backtrack.rooms = [];
    const trail = ctx.getComponent(entity, Trail);
    if (trail) trail.roomId = INN_ROOM_ID;
    const pos = ctx.getComponent(entity, Position)!;
    pos.roomId = INN_ROOM_ID as EntityId;

    ctx.output.narrative([
      { text: '眼前一黑，你倒了下去……', style: { color: 'red', bold: true } },
    ]);
    ctx.output.narrative('');
    ctx.output.narrative('……不知过了多久，你在悦来客栈的床上醒来。浑身酸痛，内力荡然无存。');
    ctx.output.narrative([
      { text: '（来路已断——你得重新走出青石镇。）', style: { color: 'gray' } },
    ]);
  },
});
