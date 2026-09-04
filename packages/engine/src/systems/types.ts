import type { EventToken, Entity, EntityId, ComponentDefinition } from '../core/types';
import type { EventDefinition, EventPayload, TypedEmit } from '../events/types';
import type { Segment } from '../output/types';
import type { EntityBlueprint, SpawnOptions } from '../core/blueprint';

/**
 * 系统定义 - 游戏逻辑的组织单元
 *
 * 泛型 T 为本系统处理的事件载荷类型：
 * - `on` 可直接传 EventDefinition<T>（推荐，类型贯通）或 EventToken 字符串
 * - `handle` 收到的 event.data 即 T，无需断言
 *
 * 通过 defineSystem<T>({...}) 创建以完成类型推断。
 */
/** 系统错误策略（onError） */
export type SystemErrorPolicy =
  /** 抛出并中止整条事件链（默认，fail-fast） */
  | 'propagate'
  /** 记录错误并继续执行同事件的后续系统 */
  | 'skip'
  /** 记录错误并继续，但该系统此后被隔离禁用（不再响应任何事件） */
  | 'degrade';

export interface SystemDefinition<T = unknown> {
  name?: string;
  on?: (EventToken | EventDefinition<T>)[];
  priority?: number;
  /** 周期触发间隔（毫秒）。设置后由 World.tick 按此时钟驱动，
   * handle 收到 { token: 'engine:tick', data: { time: number } } 载荷 */
  every?: number;
  /** 错误策略，默认 'propagate' */
  onError?: SystemErrorPolicy;
  handle: (payload: EventPayload<T>, context: SystemContext) => void | Promise<void>;
}

/**
 * 输出视图 - narrative/dialogue/error/status 的统一形态
 *
 * SystemContext 与 CommandContext 共用（0.11 起命令侧也有输出通道）：
 * 字符串自动包装为单段 narrative/dialogue，Segment[] 原样透传。
 */
export interface OutputView {
  narrative: (textOrSegments: string | Segment[]) => void;
  dialogue: (textOrSegments: string | Segment[]) => void;
  error: (text: string) => void;
  status: (data: unknown) => void;
}

/**
 * 系统上下文 - 系统执行时的环境
 */
export interface SystemContext {
  /** 发射事件（支持类型化：emit(EventDefinition, data) 或 emit(token, data)） */
  emit: TypedEmit;
  /** 获取实体 */
  getEntity: (id: EntityId) => Entity | undefined;
  /** 类型化组件读取（按 trait 定义，返回带类型的数据或 undefined） */
  getComponent: <T>(id: EntityId, component: ComponentDefinition<T>) => T | undefined;
  /** 按组件查询实体（容器查询等场景；返回拥有该组件的实体 id，创建序） */
  findByComponent: <T>(component: ComponentDefinition<T>) => EntityId[];
  /**
   * 从蓝图创建实体（系统内造物：掉落、对话产出、刷怪）。
   * 命令仍应只 emit 事件——这是系统的特权（唯一改状态的手）。
   */
  spawn: (bp: EntityBlueprint, opts?: SpawnOptions) => EntityId;
  /** 销毁实体（死亡清场等）。注意：不级联清理其他实体的引用 */
  destroy: (id: EntityId) => boolean;
  /** 输出消息 */
  output: OutputView;
  /** 调度延时事件：delayMs 后以指定 token 触发（World.tick 驱动） */
  after: (delayMs: number, definitionOrToken: EventDefinition<unknown> | EventToken, data: unknown) => void;
}
