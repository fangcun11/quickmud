/**
 * 侠客行 · 新手引导任务串（0.18，改进建议 #2）
 *
 * 解决"新手 5 分钟上手"：五步引导（look → take → 打坐 → buy → attack），
 * 每步由真实游戏事件驱动步进（不做倒计时/不做确认），完成即奖。
 *
 * - 步进提示走叙事（「引导」前缀），`建议` 命令联动指路（guide.ts）
 * - 完成奖励：碎银 +5、金创药一枚进背包
 * - 纯事件驱动：进快照/重放天然一致
 */
import { defineSystem, blueprint, Name } from '@mud/ecs-engine';
import type { EntityId } from '@mud/ecs-engine';
import { ItemTaken, Look, Portable, Description, Located, Consumable, displayName } from '@mud/prefabs';
import { Attacked, Bought, MeditateRequested } from './events';
import { PlayerTag, Purse, Tutorial } from './traits';

/** 每步的下一步指引（步进后立刻告知）；建议命令复用同一份 */
export const STEP_HINTS = [
  '先观察四周——敲 look',
  '把柜台上的粗布包袱捡起来——敲 take baofu',
  '盘膝打坐回复内力——敲 打坐',
  '去杂货铺买个馒头尝尝——出客栈往东到青石街再往北，敲 buy 馒头',
  '出镇口一直往南进野狼林，打一只野狼——敲 attack 野狼',
];

export const TutorialSystem = defineSystem({
  name: 'xk.tutorial',
  on: [Look, ItemTaken, MeditateRequested, Bought, Attacked],
  handle(event, ctx) {
    for (const player of ctx.findByComponent(PlayerTag)) {
      const tut = ctx.getComponent(player, Tutorial);
      if (!tut || tut.done) continue;

      // 各步的触发条件（事件驱动，一步只认一种事件）
      const step = tut.step;
      let hit = false;
      if (step === 0 && event.token === Look.token && event.data.entity === player && event.data.target === undefined) hit = true;
      if (step === 1 && event.token === ItemTaken.token && event.data.player === player && displayName(ctx, event.data.item).includes('包袱')) hit = true;
      if (step === 2 && event.token === MeditateRequested.token && event.data.entity === player) hit = true;
      if (step === 3 && event.token === Bought.token && event.data.entity === player) hit = true;
      if (step === 4 && event.token === Attacked.token && event.data.attacker === player) hit = true;
      if (!hit) continue;

      tut.step = step + 1;
      if (tut.step >= STEP_HINTS.length) {
        // 出师奖励
        tut.done = true;
        const purse = ctx.getComponent(player, Purse);
        if (purse) purse.silver += 5;
        const med = blueprint({
          components: [
            [Name, { text: '金创药', aliases: ['yao', 'jinchuangyao'] }],
            [Description, { text: '小瓷瓶装的药粉，洒在伤口上刀枪痕都能收。' }],
            [Consumable, { hp: 0, energy: 50, empty: false }],
            [Portable, {}],
            [Located, { targets: [player as EntityId] }],
          ],
        });
        ctx.spawn(med);
        ctx.output.narrative('「引导」出师了！碎银 +5，金创药一枚已放进你背包。江湖路远，多加保重。');
      } else {
        ctx.output.narrative(`「引导」很好！下一步：${STEP_HINTS[tut.step]}`);
      }
      return; // 一次事件只步进一步
    }
  },
});
