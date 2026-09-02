/**
 * demo 效果系统：对话给物品（0.3-C 第一次把 DialogueChoiceMade 接上真实物品转移）
 *
 * 玩家在酒保对话里选「来一杯麦酒。」（remember: patron）→
 * 把吧台上那杯麦酒（Located.at == tavern）放进玩家容器。
 * 前置：玩家本人须在酒馆（对话命令尚不做同室校验，这是 demo 层的兜底）；
 * 麦酒已被先拿/移走时给出自然反馈（demo 边界，接受）。
 */
import { defineSystem, DialogueChoiceMade, Name } from '@mud/ecs-engine';
import type { EntityId } from '@mud/ecs-engine';
import { Located, Position } from '@mud/prefabs';

type ChoicePayload = {
  player: EntityId;
  npc: EntityId;
  optionText: string;
  remember?: string[];
};

export const BarkeepEffectsSystem = defineSystem({
  name: 'demo.barkeep-effects',
  on: [DialogueChoiceMade.token],
  priority: 0,
  handle(event, ctx) {
    const { player, remember } = event.data as ChoicePayload;
    // 只关心"买麦酒"分支（remember 里带 patron）
    if (!remember?.includes('patron')) return;

    // 玩家不在酒馆 → 不能隔空买酒（酒保不会把酒递到广场上）
    const pos = ctx.getComponent(player, Position);
    if (pos?.roomId !== ('tavern' as EntityId)) {
      ctx.output.narrative('老王朝你这边喊：要买麦酒得上酒馆来，我这儿可不是送酒铺子。');
      return;
    }

    const aleLoc = ctx.getComponent('ale' as EntityId, Located);
    if (!aleLoc || aleLoc.at !== ('tavern' as EntityId)) {
      ctx.output.narrative('老王翻了翻吧台，有点尴尬：啊，麦酒刚好卖完了……');
      return;
    }

    aleLoc.at = player;
    const aleName = ctx.getComponent('ale' as EntityId, Name)?.text ?? '麦酒';
    ctx.output.narrative(`老王把一杯${aleName}递到你手里。`);
  },
});
