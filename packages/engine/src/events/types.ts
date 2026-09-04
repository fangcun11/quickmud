import type { EventToken } from '../core/types';
import { TICK_TOKEN } from './tick';

/**
 * every 系统收到的合成 tick 事件（World.tick 直接调用 handle，不经事件泵）
 */
export interface TickEventPayload {
  token: typeof TICK_TOKEN;
  /** data.time = 当时的世界时间（毫秒） */
  data: { time: number };
  timestamp: number;
}

/**
 * 类型化事件发射器
 *
 * 两种调用形态：
 * - emit(Moved, data)         —— 传事件定义，data 类型自动约束（推荐）
 * - emit('moved', data)       —— 传 token 字符串，data 类型不校验
 */
export interface TypedEmit {
  <T>(definition: EventDefinition<T>, data: T): void;
  <T>(token: EventToken, data: T): void;
}

/**
 * 事件定义 - 描述事件的结构和行为
 *
 * 泛型 T 是载荷类型（emit / defineSystem 的类型推导来源）；
 * 泛型 TName 保留调用处的**名称字面量**——token 随之携带字面量类型，
 * defineSystem 多事件订阅时依 `event.token === Def.token` 收窄 event.data。
 *
 * schema 字段只是**载荷类型的类型锚点**：帮助 TS 关联 EventDefinition<T> 的
 * 载荷类型（emit/defineSystem 的类型推导）。引擎**不做运行时校验**——
 * 不要指望 emit 时调用 validate。version 保留作为未来事件迁移的扩展点。
 */
export interface EventDefinition<T = void, TName extends string = string> {
  token: TName;
  name: string;
  version: number;
  /** 类型锚点（引擎不执行运行时校验；缺省即可） */
  schema?: {
    validate: (data: unknown) => data is T;
  };
}

/**
 * 事件载荷 - 事件携带的数据
 */
export interface EventPayload<T = unknown> {
  token: EventToken;
  data: T;
  timestamp: number;
}

/**
 * 事件处理器 - 处理事件的函数
 */
export type EventHandler<T = unknown> = (
  payload: EventPayload<T>,
  context: EventContext
) => void | Promise<void>;

/**
 * 事件上下文 - 直接订阅事件泵（EventPump.on）时收到的环境
 *
 * 只有 emit：事件泵是纯派发设施，不持有实体表。
 * 需要实体/组件/输出访问请用 defineSystem + World.register，
 * 那条路径收到的是 World 注入的完整 SystemContext。
 *
 * （此处曾有一个恒返回 undefined 的 getEntity 占位，注释称"将由 World
 * 注入"，而 World 走的是另一条路径、从不注入——类型撒谎，已删除。）
 */
export interface EventContext {
  emit: <P>(token: EventToken, data: P) => void;
}

/**
 * 事件订阅 - 事件处理器的注册信息
 */
export interface EventSubscription<T = unknown> {
  token: EventToken;
  handler: EventHandler<T>;
  priority: number;
  /** 错误策略（由系统定义透传），默认 'propagate' */
  onError?: import('../systems/types').SystemErrorPolicy;
  /** degrade 模式下的隔离标记 */
  disabled?: boolean;
}