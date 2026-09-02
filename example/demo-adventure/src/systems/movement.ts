import { defineSystem } from '@mud/ecs-engine';
import { Moved } from '../world/events';
import { Position, Exits, Name, Description } from '../world/traits';

/**
 * 移动系统 - 处理实体移动
 *
 * on 直接传事件定义，event.data 类型贯通，无需断言
 */
export const MovementSystem = defineSystem<{ entity: string; from: string; to: string }>({
  name: 'movement',
  on: [Moved],
  priority: 0,
  handle(event, ctx) {
    const { entity, to } = event.data;

    const pos = ctx.getComponent(entity, Position);
    if (!pos) return;

    // 从当前房间的出口中查找目标房间ID
    const exits = ctx.getComponent(pos.roomId, Exits);
    if (!exits || !exits[to]) {
      ctx.output.narrative(`你不能往${to}走。`);
      return;
    }

    const targetRoomId = exits[to];

    // 更新位置
    pos.roomId = targetRoomId;

    // 输出目标房间的描述
    const roomName = ctx.getComponent(targetRoomId, Name);
    const desc = ctx.getComponent(targetRoomId, Description);

    ctx.output.narrative([{ text: `你来到了${roomName?.text ?? targetRoomId}。`, style: { bold: true } }]);
    if (desc) {
      ctx.output.narrative(desc.text);
    }
  },
});
