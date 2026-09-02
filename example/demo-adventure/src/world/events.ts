import { defineEvent } from '@mud/ecs-engine';

/**
 * 移动事件
 */
export const Moved = defineEvent('moved')<{
  entity: string;
  from: string;
  to: string;
}>();

/**
 * 拾取事件
 */
export const ItemPickedUp = defineEvent('item_picked_up')<{
  entity: string;
  item: string;
  from: string;
}>();

/**
 * 伤害事件
 */
export const Damage = defineEvent('damage')<{
  target: string;
  amount: number;
  source: string;
}>();

/**
 * 死亡事件
 */
export const Death = defineEvent('death')<{
  entity: string;
  killer?: string;
}>();

/**
 * 查看事件
 */
export const Look = defineEvent('look')<{
  entity: string;
  target?: string;
}>();

/**
 * 对话事件
 */
export const Talk = defineEvent('talk')<{
  entity: string;
  target: string;
}>();