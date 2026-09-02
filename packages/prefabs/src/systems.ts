/**
 * @mud/prefabs 系统（0.3 toolkit）—— 移动与描述的官方实现
 *
 * 约定：
 * - 移动：`Position.roomId` 指向房间实体 id；房间实体带 `Exits`（方向→房间 id）；
 *   MovementSystem 校验出口，合法才落位并输出目标房间名与描述
 * - 查看：DescriptionSystem 输出所在房间的 Name/Description
 */
import { defineSystem, Name } from '@mud/ecs-engine';
import type { EntityId } from '@mud/ecs-engine';
import { Moved, Look } from './events.js';
import { Position, Exits, Description } from './traits.js';

/** 处理实体移动（出口校验 + 落位 + 描述） */
export const MovementSystem = defineSystem<{
  entity: EntityId;
  from: string;
  to: string;
}>({
  name: 'prefab.movement',
  on: [Moved],
  priority: 0,
  handle(event, ctx) {
    const { entity, to } = event.data;

    const pos = ctx.getComponent(entity, Position);
    if (!pos) return;

    // 从当前所在房间的出口中查找目标房间
    const exits = ctx.getComponent(pos.roomId, Exits);
    const targetRoomId = exits?.[to];
    if (!exits || !targetRoomId) {
      ctx.output.narrative(`你不能往${to}走。`);
      return;
    }

    // 更新位置（唯一改状态处）
    pos.roomId = targetRoomId;

    // 输出目标房间的标题与描述
    const roomName = ctx.getComponent(targetRoomId, Name);
    const desc = ctx.getComponent(targetRoomId, Description);
    ctx.output.narrative([
      { text: `你来到了${roomName?.text ?? targetRoomId}。`, style: { bold: true } },
    ]);
    if (desc) {
      ctx.output.narrative(desc.text);
    }
  },
});

/** 处理查看（输出所在房间的描述） */
export const DescriptionSystem = defineSystem<{
  entity: EntityId;
  target?: string;
}>({
  name: 'prefab.description',
  on: [Look],
  priority: 0,
  handle(event, ctx) {
    const { entity } = event.data;

    const pos = ctx.getComponent(entity, Position);
    if (!pos) return;

    const name = ctx.getComponent(pos.roomId, Name);
    const desc = ctx.getComponent(pos.roomId, Description);

    if (name) {
      ctx.output.narrative([{ text: `【${name.text}】`, style: { bold: true } }]);
    }
    if (desc) {
      ctx.output.narrative(desc.text);
    } else {
      ctx.output.narrative('这里没有任何描述。');
    }
  },
});
