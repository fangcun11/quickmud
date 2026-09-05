/**
 * @mud/prefabs 事件（0.3 toolkit）—— 移动与查看的官方事件
 *
 * 移动有两个事件，**语义不同、不可混用**（v0.9-A 拆分）：
 * - `MoveRequested`：意图。命令 emit，`MovementSystem` 是它的唯一订阅者
 * - `Moved`：结果。`MovementSystem` 校验通过并落位后才 emit
 *
 * 拆分前只有一个 `Moved`（to = 方向），于是"撞墙"和"到达"共用同一个事件，
 * 订阅者只能从出发房间的出口表反查目标房间——一旦引入 `canEnter/canLeave`
 * 守卫（守卫放行前不能算到达），这套反查会同时误记 `Visited` 并幽灵触发
 * 房间 `enter`。**这不是风格选择，是正确性的前提。**
 */
import { defineEvent } from '@mud/ecs-engine';
import type { EntityId } from '@mud/ecs-engine';

/**
 * 移动**意图**（v0.9-A）：{ entity, to = 方向 }
 *
 * 由移动命令 emit，`MovementSystem` 是唯一订阅者。
 * 注意没有 `from`——出发房间由系统从 `Position` 读出，命令不该抄状态。
 */
export const MoveRequested = defineEvent('move_requested')<{
  entity: EntityId;
  /** 方向（north/south/east/west/……） */
  to: string;
}>();

/**
 * 移动**结果**（v0.9-A 起 `to` 是房间 id，不再是方向）
 *
 * 只在 `MovementSystem` 真正落位后 emit——一切"人真的到了"才该发生的事
 * （探索记账、房间 enter/leave/firstEnter、区域效果）都挂在这里。
 * `direction` 便于房间写出"你从北面走进来"这类文案。
 */
export const Moved = defineEvent('moved')<{
  entity: EntityId;
  from: EntityId;
  to: EntityId;
  /** 走的是哪个方向（可选：非移动触发的 Moved 没有方向） */
  direction?: string;
}>();

/**
 * 房间命令被触发（v0.9-A）：{ player, roomId, verb }
 *
 * 房间专属动词的**翻译层**：全局注册的房间命令只做"玩家在不在那个房间"的
 * 校验并 emit 本事件，真正的命令逻辑由 `RoomEventSystem` 在事件泵内派发——
 * 所以房间命令处理器与房间事件处理器同级，拥有系统特权（spawn/destroy），
 * 而"命令不改状态"的铁律对翻译层依然成立。
 */
export const RoomCommandInvoked = defineEvent('room_command_invoked')<{
  player: EntityId;
  roomId: EntityId;
  /** 命令的主动词（verbs[0]，归一化用） */
  verb: string;
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

/**
 * buff 挂上（v0.7-A）：内容层 spawn buff 实体后，由 BuffSystem 首个网格激活时 emit
 * （播报/统计钩子）
 */
export const BuffApplied = defineEvent('buff_applied')<{
  buff: EntityId;
  victim: EntityId;
}>();

/** buff 单次结算：{ applied } 为本次实际变化量（heal 截断后可能小于 amount） */
export const BuffTicked = defineEvent('buff_ticked')<{
  buff: EntityId;
  victim: EntityId;
  effect: import('./traits.js').BuffEffect;
  applied: number;
}>();

/** buff 到期：Duration 走完，buff 实体即将销毁 */
export const BuffExpired = defineEvent('buff_expired')<{
  buff: EntityId;
  victim: EntityId;
}>();

/**
 * 详略模式切换**意图**（v0.11）：{ entity }
 *
 * 由 `详细/verbose` 命令 emit，`VerboseSystem` 是唯一订阅者——
 * 命令不改状态（铁律），挂/摘 `Verbose` 标记由系统完成。
 */
export const VerboseToggled = defineEvent('verbose_toggled')<{
  entity: EntityId;
}>();

/**
 * 进房略图切换**意图**（0.14 方案二）：{ entity }
 *
 * 由 `略图/minimap` 命令 emit，`MiniMapSystem` 是唯一订阅者——
 * 命令不改状态（铁律），翻转 `MiniMap.on` 由系统完成。
 */
export const MiniMapToggled = defineEvent('mini_map_toggled')<{
  entity: EntityId;
}>();
