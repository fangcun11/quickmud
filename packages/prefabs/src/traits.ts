/**
 * @mud/prefabs 组件族（0.3 toolkit）—— MUD 文字游戏开箱即用的领域 trait
 *
 * 与引擎的关系：本包是**领域预制件**，引擎保持零内容预设。
 * 组件名（确定性 id）即约定，`@mud/ecs-engine` 的开发者命令
 * （/tp /heal 按 position/health 命名约定）依赖此处的定义。
 *
 * Name 组件属引擎契约（findEntityByName 的查找载体），不在此重复导出——
 * 需要时请直接从 `@mud/ecs-engine` 导入。
 */
import { trait } from '@mud/ecs-engine';
import type { EntityId } from '@mud/ecs-engine';

/** 文本描述组件（房间/物品/NPC 的展示文本） */
export const Description = trait('description', () => ({
  text: '',
}));

/** 生命值组件（/heal 的约定目标） */
export const Health = trait('health', () => ({
  current: 100,
  max: 100,
}));

/** 位置组件（/tp 的约定目标；roomId 引用房间实体 id） */
export const Position = trait('position', () => ({
  roomId: 'town_square',
}));

/**
 * 物品位置组件（0.3-C）：物品实体的**单源位置**
 *
 * `at` = 所在容器实体 id。房间/玩家/箱子都只是普通实体，均可作容器：
 * - 物品在地上：`at` = 房间实体 id
 * - 物品在背包：`at` = 玩家实体 id
 *
 * "某容器里有什么" = 查询所有带 Located 且 at==容器的实体（配合
 * SystemContext / CommandContext 的 findByComponent）。
 *
 * @deprecated 曾用于背包的 `Inventory { items: string[] }` 已被本模型取代。
 */
export const Located = trait('located', () => ({
  at: null,
}) as LocatedData);

/** Located 组件数据类型 */
export type LocatedData = {
  at: EntityId | null;
};

/** 房间出口组件（房间专用）：{ [方向]: 目标房间 id } */
export const Exits = trait('exits', () => ({} as Record<string, string>));

/** 便携性标记组件（物品可被拾取/持有） */
export const Portable = trait('portable', () => ({}));

/** 武器组件：额外伤害 */
export const Weapon = trait('weapon', () => ({
  damage: 0,
}));
