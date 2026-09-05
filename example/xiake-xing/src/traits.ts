/**
 * 侠客行 · 领域组件（M1 内功根基）
 *
 * 只放武侠语义的数据形状；通用件（Health/Position/Visited…）继续用
 * prefabs 的。数值原则：小数值起步（属性 1~20、生命/内力 10~200），
 * M6 统一平衡。
 */
import { trait } from '@mud/ecs-engine';

/** 内力资源：打坐恢复、（M2 起）出招消耗 */
export const Energy = trait('energy', () => ({
  current: 20,
  max: 100,
}));

/** 裸属性：战斗公式的三输入。装备/经脉加成走聚合函数（M3+），不写回 */
export const Stats = trait('stats', () => ({
  atk: 1, // 攻击
  def: 0, // 防御
  dodge: 0, // 身法（闪避/格挡判定的唯一变量）
}));

/**
 * 打坐中标记：玩家出生即预挂（与 Verbose 同款——组件由内容层声明，
 * 系统只翻转数据），`on` 表示是否在打坐；MeditationSystem 每 tick
 * 给 on 者结算回复，移动/受击自动置 off。
 */
export const Cultivating = trait('cultivating', () => ({
  on: false,
  lastTickedAt: 0, // 上次回复结算的世界时间（快照/回滚一致性）
}));

/**
 * 还手标记：挂了它的实体被攻击时会自动还击一击（NpcRetaliateSystem）。
 * 显式标记而非"有 Stats 就是 NPC"——玩家也有 Stats，语义要分得开。
 */
export const Retaliate = trait('retaliate', () => ({}));

/** 玩家标记：战斗文案区分视角（"你击中它" vs "它咬中你"）——玩家出生即挂 */
export const PlayerTag = trait('player_tag', () => ({}));

/** 来路标记：FleeSystem 记录玩家最后所在的房间，逃跑成功时退回那里 */
export const Trail = trait('trail', () => ({
  roomId: '',
}));

/**
 * 已习武学进度（M2）：artId → { level, exp }。键控数组组件——等出现
 * "武学实例需要被指向"的真实需求（M5 师承）再实体化。
 */
export const Arsenal = trait('arsenal', () => ({
  arts: {} as Record<string, { level: number; exp: number }>,
}));

/**
 * 当前运转的心法（M2）：同时只能运转一门；打坐时该心法随 tick 涨熟练度，
 * 吐纳术运转时打坐内力回复翻倍。`lastTickedAt` 与 Cultivating 同理由：
 * 时间账本走组件（快照/回滚一致）。
 */
export const Channeling = trait('channeling', () => ({
  artId: '',
  lastTickedAt: 0,
}));

/** 秘籍标记（M2）：挂在物品实体上——`学 <秘籍>` 消耗物品、写入 Arsenal */
export const Scripture = trait('scripture', () => ({
  artId: '',
}));
