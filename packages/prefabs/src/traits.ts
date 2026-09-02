/**
 * @mud/prefabs 组件族（0.3 toolkit）—— MUD 文字游戏开箱即用的领域 trait
 *
 * 与引擎的关系：本包是**领域预制件**，引擎保持零内容预设。
 * 组件名（确定性 id）即约定，`@mud/ecs-engine` 的开发者命令
 * （/tp /give /heal 按 position/inventory/health 命名约定）依赖此处的定义。
 *
 * Name 组件属引擎契约（findEntityByName 的查找载体），不在此重复导出——
 * 需要时请直接从 `@mud/ecs-engine` 导入。
 */
import { trait } from '@mud/ecs-engine';

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

/** 背包组件（/give 的约定目标；物品以名称字符串持有，实体化物品见 0.3-C） */
export const Inventory = trait('inventory', () => ({
  items: [] as string[],
}));

/** 房间出口组件（房间专用）：{ [方向]: 目标房间 id } */
export const Exits = trait('exits', () => ({} as Record<string, string>));

/** 便携性标记组件（物品可被拾取/持有） */
export const Portable = trait('portable', () => ({}));

/** 武器组件：额外伤害 */
export const Weapon = trait('weapon', () => ({
  damage: 0,
}));
