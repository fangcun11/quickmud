import { defineSystem } from '@mud/ecs-engine';
import { Look } from '../world/events';
import { Position, Name, Description } from '../world/traits';

/**
 * 描述系统 - 处理查看命令
 *
 * on 直接传事件定义，event.data 类型贯通，无需断言
 */
export const DescriptionSystem = defineSystem<{ entity: string; target?: string }>({
  name: 'description',
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
