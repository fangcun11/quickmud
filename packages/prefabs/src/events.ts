/**
 * @mud/prefabs 事件（0.3 toolkit）—— 移动与查看的官方事件
 */
import { defineEvent } from '@mud/ecs-engine';
import type { EntityId } from '@mud/ecs-engine';

/** 实体移动事件：{ entity, from 房间, to 方向 }（MovementSystem 校验出口并落位） */
export const Moved = defineEvent('moved')<{
  entity: EntityId;
  from: string;
  to: string;
}>();

/** 查看事件：{ entity, target? }（DescriptionSystem 输出当前位置描述） */
export const Look = defineEvent('look')<{
  entity: EntityId;
  target?: string;
}>();

/** 拾取事件：{ player, item }（ItemSystem 校验后把物品放入玩家容器） */
export const ItemTaken = defineEvent('item_taken')<{
  player: EntityId;
  item: EntityId;
}>();

/** 放下事件：{ player, item }（ItemSystem 把背包物品放到玩家当前房间） */
export const ItemDropped = defineEvent('item_dropped')<{
  player: EntityId;
  item: EntityId;
}>();

/** 攻击事件：{ attacker, target }（CombatSystem 结算伤害；目标须与攻击者同房间且有 Health） */
export const Attack = defineEvent('attack')<{
  attacker: EntityId;
  target: EntityId;
}>();

/** 死亡事件：{ entity, killer?, roomId }（目标 HP 归零时 emit，供掉落/任务等效果系统订阅） */
export const Died = defineEvent('died')<{
  entity: EntityId;
  killer?: EntityId;
  roomId?: string;
}>();

/**
 * 掉落完成事件（v0.6-A1）：{ entity, roomId, items }
 *
 * `items` 是新生成的掉落物实体 id 列表——任务系统的 kill 型目标、统计、
 * 掉落播报都挂在这个钩子上。
 */
export const LootDropped = defineEvent('loot_dropped')<{
  entity: EntityId;
  roomId: EntityId;
  items: EntityId[];
}>();

/** 任务开始（v0.6-A2）：玩家首次对某任务产生进度 */
export const QuestStarted = defineEvent('quest_started')<{
  player: EntityId;
  giver: EntityId;
  questId: string;
}>();

/** 任务进度推进：{ progress, count } 为当前值与目标值 */
export const QuestProgressed = defineEvent('quest_progressed')<{
  player: EntityId;
  giver: EntityId;
  questId: string;
  progress: number;
  count: number;
}>();

/** 任务达标（尚未交付，奖励在 turnin 时发放） */
export const QuestCompleted = defineEvent('quest_completed')<{
  player: EntityId;
  giver: EntityId;
  questId: string;
}>();

/** 任务交付：由 turnin 命令 emit，QuestSystem 据此发奖 */
export const QuestTurnedIn = defineEvent('quest_turned_in')<{
  player: EntityId;
  giver: EntityId;
  questId: string;
}>();
