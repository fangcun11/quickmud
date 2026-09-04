/**
 * 侠客行 · 领域事件（M1 内功根基）
 *
 * Attack/Died 沿用 prefabs；这里只补武侠战斗内核自己要的两枚：
 * 结算结果（Attacked，供打断/还手订阅）与逃跑意图（Fled，供 FleeSystem 结算）。
 */
import { defineEvent } from '@mud/ecs-engine';

/**
 * 一次攻击结算完成：{ attacker, target, damage, result }
 *
 * result 三态（纯公式，零随机）：
 * - 'hit'     dodge 差 ≥ 2 → 全额伤害
 * - 'blocked' −1..1       → 七成伤害（被格挡）
 * - 'dodged'  ≤ −2        → 零伤（被闪避）
 */
export const Attacked = defineEvent('attacked')<{
  attacker: string;
  target: string;
  damage: number;
  result: 'hit' | 'blocked' | 'dodged';
}>();

/** 逃跑意图：逃/flee 命令发出，FleeSystem 结算成败 */
export const Fled = defineEvent('fled')<{
  entity: string;
}>();

/** 打坐意图：打坐命令发出，CultivationToggleSystem 挂 Cultivating（命令无写特权） */
export const MeditateRequested = defineEvent('meditate_requested')<{
  entity: string;
}>();

/** 收功意图：停命令发出，CultivationToggleSystem 摘 Cultivating */
export const StopRequested = defineEvent('stop_requested')<{
  entity: string;
}>();
