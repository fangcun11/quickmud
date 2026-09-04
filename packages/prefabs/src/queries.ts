/**
 * @mud/prefabs 容器查询工具（0.3-C）
 *
 * 物品位置 = Located 关系；"某容器里有什么" = `findRelated(Located, 容器)`
 * （引擎二级索引 O(k) 候选 + 创建序）。同名解析必须在**容器作用域**内进行
 * ——全局 findEntity 会让跨容器同名物品被先创建者永久遮蔽（眼前的东西
 * 永远拿不到）。
 *
 * WorldQuery 形状兼容 SystemContext 与 CommandContext.world
 * （两者都提供 findByComponent/getComponent 与关系只读三件）。
 */
import { Name } from '@mud/ecs-engine';
import type { ComponentDefinition, EntityId, RelationDefinition } from '@mud/ecs-engine';
import { Located, Position } from './traits.js';

/** 只读查询接口（系统/命令上下文均满足） */
export interface WorldQuery {
  findByComponent<T>(c: ComponentDefinition<T>): EntityId[];
  getComponent<T>(id: EntityId, c: ComponentDefinition<T>): T | undefined;
  /** 该实体的全部关系目标（拷贝；空数组 = 没有这条关系） */
  getRelations(id: EntityId, rel: RelationDefinition): EntityId[];
  /** 是否建立了指向 target 的关系 */
  hasRelation(id: EntityId, rel: RelationDefinition, target: EntityId): boolean;
  /** 反查"谁指向 target"（引擎二级索引，创建序） */
  findRelated(rel: RelationDefinition, target: EntityId): EntityId[];
}

/** 容器内物品实体列表（Located → container，创建序；索引直查） */
export function itemsInContainer(q: WorldQuery, container: EntityId): EntityId[] {
  return q.findRelated(Located, container);
}

/**
 * 实体所在房间（v0.6-A2）
 *
 * 两种归属都认：会动的用 `Position`（玩家/NPC/怪物），常驻的用 `Located`
 * 关系（酒保这类钉在房间里的 NPC）。任务归属、房间内交互都基于它。
 */
export function containerOf(q: WorldQuery, entity: EntityId): EntityId | undefined {
  return q.getComponent(entity, Position)?.roomId ?? q.getRelations(entity, Located)[0];
}

/** 实体展示名（Name.text，空则回退 id） */
export function displayName(q: WorldQuery, id: EntityId): string {
  const text = q.getComponent(id, Name)?.text;
  return text && text !== '' ? text : id;
}

/** 名称匹配层级：主名精确 > 别名精确 > 主名子串 > 别名子串 */
function matchRank(q: WorldQuery, id: EntityId, name: string): number {
  const nc = q.getComponent(id, Name);
  if (!nc) return -1;
  if (nc.text === name) return 3;
  if (nc.aliases?.includes(name)) return 2;
  if (nc.text.includes(name)) return 1;
  if (nc.aliases?.some((a) => a.includes(name))) return 0;
  return -1;
}

/**
 * 在容器内按名称解析实体；返回匹配层级最高的实体（同级取创建序靠前者）。
 * 未命中返回 undefined。
 */
export function resolveInContainer(
  q: WorldQuery,
  container: EntityId,
  name: string,
): EntityId | undefined {
  return bestRanked(q, itemsInContainer(q, container), name);
}

/** 房间内"有身体"的实体（Position.roomId == room；含玩家/NPC/敌怪） */
export function occupantsIn(q: WorldQuery, room: EntityId): EntityId[] {
  return q
    .findByComponent(Position)
    .filter((id) => q.getComponent(id, Position)?.roomId === room);
}

/** 在房间内按名称解析有名字的实体（attack 等目标定位用） */
export function resolveOccupantIn(
  q: WorldQuery,
  room: EntityId,
  name: string,
): EntityId | undefined {
  return bestRanked(q, occupantsIn(q, room), name);
}

/** 在一组候选里选名称匹配层级最高者（同级取创建序靠前） */
function bestRanked(q: WorldQuery, ids: EntityId[], name: string): EntityId | undefined {
  let best: EntityId | undefined;
  let bestRank = -1;
  for (const id of ids) {
    const rank = matchRank(q, id, name);
    if (rank > bestRank) {
      best = id;
      bestRank = rank;
    }
  }
  return best;
}
