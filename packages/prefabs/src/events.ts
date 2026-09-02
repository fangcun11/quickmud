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
