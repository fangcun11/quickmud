import { trait } from '@mud/ecs-engine';

// 名称组件直接复用引擎内置的单语言 Name（{ text, aliases }）
export { Name } from '@mud/ecs-engine';

/**
 * 描述组件
 */
export const Description = trait('description', () => ({
  text: '',
}));

/**
 * 生命值组件
 */
export const Health = trait('health', () => ({
  current: 100,
  max: 100,
}));

/**
 * 位置组件
 */
export const Position = trait('position', () => ({
  roomId: 'town_square',
}));

/**
 * 背包组件
 */
export const Inventory = trait('inventory', () => ({
  items: [] as string[],
}));

/**
 * 出口组件（房间专用）
 */
export const Exits = trait('exits', () => ({} as Record<string, string>));

/**
 * 便携性组件
 */
export const Portable = trait('portable', () => ({}));

/**
 * 武器组件
 */
export const Weapon = trait('weapon', () => ({
  damage: 0,
}));
