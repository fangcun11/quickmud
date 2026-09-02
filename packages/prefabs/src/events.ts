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
