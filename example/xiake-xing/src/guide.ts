/**
 * 侠客行 · 引导与攻略（沉浸感方案 B3）
 *
 * - `建议` 命令（对标北侠 jobquery）：**命令级指路**——按人物现状给 1-3 条
 *   下一步可执行事项，每条都带可直接照抄的命令，新手永远有答案。
 * - `helpme` 命令（对标北侠大高手）：游戏内问答攻略库，回答署名虚构前辈。
 *
 * 规则与条目都是**纯数据**（content 层 checklist），可重放、可快照。
 */
import { defineCommand } from '@mud/ecs-engine';
import type { EntityId, ComponentDefinition } from '@mud/ecs-engine';

/** 只读最小接口（CommandContext.world 与 SystemContext 都满足） */

import { Located, Position, displayName, itemsInContainer, type WorldQuery } from '@mud/prefabs';
import { Purse, Tutorial } from './traits';
import { Combat, Cultivating, Energy, Scripture } from './traits';
import { STEP_HINTS } from './tutorial';

// ---------------------------------------------------------------- 建议 --

interface SuggestionRule {
  when: (w: WorldQuery, player: EntityId) => boolean;
  tip: string;
}

const RULES: SuggestionRule[] = [
  {
    // 引导未完成时永远第一优先（新手 5 分钟上手）
    when: (w, p) => {
      const tut = w.getComponent(p, Tutorial);
      return !!tut && !tut.done;
    },
    tip: '', // 运行时按当前步填充（SuggestCommand 尾部处理）
  },
  {
    when: (w, p) => {
      const combat = w.getComponent(p, Combat);
      return !!combat?.foe;
    },
    tip: '正在交战——专心应敌（attack 续打 / 停战 脱离 / 逃跑 撤退）',
  },
  {
    when: (w, p) => {
      const pos = w.getComponent(p, Position);
      if (!pos) return false;
      return itemsInContainer(w, p).some((id) => w.getComponent(id, Scripture));
    },
    tip: '包里有秘籍没读——去武馆「学」了它（学 秘籍）',
  },
  {
    when: (w, p) => {
      const cultivating = w.getComponent(p, Cultivating);
      const energy = w.getComponent(p, Energy);
      return !cultivating?.on && !!energy && energy.current < energy.max * 0.5;
    },
    tip: '内力不足一半——打坐回气（打坐）',
  },
  {
    when: (w, p) => {
      const purse = w.getComponent(p, Purse);
      return !!purse && purse.silver >= 15;
    },
    tip: '兜里宽裕——铁匠铺的铁剑正合适（去铁匠铺 buy 铁剑）',
  },
  {
    when: () => true,
    tip: '去野狼林历练——出了镇口一直往南（打狼得经验，狼皮换碎银）',
  },
];

export const SuggestCommand = defineCommand({
  verbs: ['建议', '下一步'],
  describe: '看看现在可以做点什么（命令级指路）',
  handle({ player, world }) {
    const tips: string[] = [];
    for (const rule of RULES) {
      if (tips.length >= 3) break;
      try {
        if (rule.when(world, player)) tips.push(rule.tip);
      } catch {
        // 规则自身异常按不适用处理
      }
    }
    // 引导占位条目按当前步填充
    const tut = world.getComponent(player, Tutorial);
    const filled = tips.map((t) => (t === '' && tut && !tut.done ? `新手引导：${STEP_HINTS[tut.step]}（照做即可）` : t));
    if (filled.length === 0) return '一切随心——江湖之大，去走走看看吧。';
    return ['你现在可以：', ...filled.map((t, i) => `${i + 1}. ${t}`)].join('\n');
  },
});

// ---------------------------------------------------------------- helpme --

interface Entry {
  keywords: string[];
  answer: string;
  by: string;
}

const ENTRIES: Entry[] = [
  {
    keywords: ['野狼', '狼', '狼皮'],
    answer: '野狼出没野狼林（出镇口一直往南），两下就能放倒；皮子能卖碎银，夜里它们更凶，手潮的白天再去。',
    by: '忆雪前辈',
  },
  {
    keywords: ['铁匠', '铁剑', '皮甲', '护身符', '装备'],
    answer: '铁匠铺在青石街北头。铁剑加攻、皮甲加防、护身符加身法——新手先攒 15 碎银买剑，打狼效率翻倍。',
    by: '老周前辈',
  },
  {
    keywords: ['山神庙', '祈祷', '拜', '香案'],
    answer: '松林道边上有座山神庙，进去拜一拜（pray），山神会给你回口血。一天一次，别贪。',
    by: '过路香客',
  },
  {
    keywords: ['金创药', '馒头', '干粮', '吃喝'],
    answer: '杂货铺有馒头（回气血）和金创药（回内力）。馒头便宜管饱；药粉金贵，留着打硬仗再用。',
    by: '跑镖的汉子',
  },
  {
    keywords: ['秘籍', '学武', '剑谱', '心法', '吐纳'],
    answer: '武馆地上摆着剑谱和心法，捡进背包「学」了它——学完即焚，功夫永久上身。学完记得打坐消化。',
    by: '武馆扫地的',
  },
  {
    keywords: ['碎银', '赚钱', '挣钱', '银两'],
    answer: '新手挣钱三条路：打狼剥皮卖铺子、抄经做活计、帮跑腿。别赌别抢，细水长流。',
    by: '钱庄掌柜',
  },
];

export const HelpmeCommand = defineCommand({
  verbs: ['helpme', '求助'],
  describe: '向说书人打听江湖事（helpme ask 野狼）',
  args: { topic: { type: 'rest' } },
  handle({ args }) {
    const topic = String(args.topic ?? '').trim();
    if (!topic) return '向说书人打听什么？（helpme ask 野狼）';
    const hit = ENTRIES.find((e) => e.keywords.some((k) => topic.includes(k) || k.includes(topic)));
    if (!hit) return `说书人捻着胡须想了半天：「${topic}？这位子老朽也说不清，你自己去问问看吧。」`;
    return `【说书人】「${hit.answer}」—— by ${hit.by}`;
  },
});
