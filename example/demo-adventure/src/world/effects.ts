/**
 * demo 效果系统：对话给物品（v0.5——用 ctx.spawn 现酿，演示"系统内造物"）
 *
 * 玩家在酒保对话里选「来一杯麦酒。」（remember: patron）→
 * 从蓝图 spawn 一杯新麦酒放进玩家容器（能力缺口补上后不再依赖预置实体）。
 * 前置：玩家须在酒馆；NPC 同室归属的正式模型留待后续。
 */
import { defineSystem, DialogueChoiceMade, blueprint } from '@mud/ecs-engine';
import type { EntityId } from '@mud/ecs-engine';
import { Position, Located, Portable, Description } from '@mud/prefabs';

/** 麦酒蓝图：一杯现酿（由效果系统 spawn） */
const AleBp = blueprint({
  name: '麦酒',
  components: [
    [Description, { text: '一杯冒着细腻泡沫的麦酒，还温着。' }],
    [Portable],
    [Located, { at: null }],
  ],
});

export const BarkeepEffectsSystem = defineSystem({
  name: 'demo.barkeep-effects',
  on: [DialogueChoiceMade],
  priority: 0,
  handle(event, ctx) {
    const { player, remember } = event.data;
    if (!remember?.includes('patron')) return;

    // 玩家不在酒馆 → 不能隔空买酒
    const pos = ctx.getComponent(player, Position);
    if (pos?.roomId !== ('tavern' as EntityId)) {
      ctx.output.narrative('老王朝你这边喊：要买麦酒得上酒馆来，我这儿可不是送酒铺子。');
      return;
    }

    // 现酿一杯，直接进玩家背包（Located.at = 玩家）
    ctx.spawn(AleBp, { patch: { located: { at: player } } });
    ctx.output.narrative('老王从吧台后打了一杯麦酒递给你：慢用，刚出桶的。');
  },
});
