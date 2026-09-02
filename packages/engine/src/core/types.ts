/**
 * 实体ID - 游戏对象的唯一标识符
 */
export type EntityId = string;

/**
 * 组件ID - 组件类型的唯一标识符
 */
export type ComponentId = string;

/**
 * 事件令牌 - 事件类型的唯一标识符
 */
export type EventToken = string;

/**
 * 实体 - 游戏对象的基础单位
 */
export interface Entity {
  id: EntityId;
  components: Map<ComponentId, unknown>;
}

/**
 * 组件定义 - 描述组件的结构和行为
 */
export interface ComponentDefinition<T = unknown> {
  id: ComponentId;
  name: string;
  create: () => T;
  validate?: (data: unknown) => data is T;
}