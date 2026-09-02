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
 *
 * 注：曾声明 `validate(data)` 校验钩子，但引擎从未调用（emit/挂载不校验），
 * 属"类型承诺 > 运行时现实"，已删除——校验交给各组件数据的消费方。
 */
export interface ComponentDefinition<T = unknown> {
  id: ComponentId;
  name: string;
  /** 默认数据工厂/模板的产物副本（每次调用返回独立实例） */
  create: () => T;
}