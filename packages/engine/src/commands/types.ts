import type { EntityId, Entity, ComponentDefinition } from '../core/types';
import type { TypedEmit } from '../events/types';

/**
 * 参数定义
 *
 * 注：曾声明 `filter?(entity)` 实体过滤字段，但 parseArgs 从不执行
 * （类型承诺 > 运行时现实，已删除）。目标约束请在各命令/系统内自行实现。
 */
export interface ArgumentDefinition {
  type: 'entity' | 'optional_entity' | 'direction' | 'word' | 'rest';
}

/**
 * 参数声明的解析结果类型
 *
 * 契约与 World.parseArgs 的运行时行为严格一致：
 * - word / direction / rest → string（缺失时为空串）
 * - entity / optional_entity → string | null（原始 token，未解析为实体ID；缺失时为 null）
 */
export type ParsedArgValue<T extends ArgumentDefinition> = T['type'] extends
  | 'entity'
  | 'optional_entity'
  ? string | null
  : string;

/** 解析后参数对象类型：由 args 声明逐键推导 */
export type ParsedArgs<A extends Record<string, ArgumentDefinition>> = {
  [K in keyof A]: ParsedArgValue<NonNullable<A[K]>>;
};

/**
 * 命令定义 - 玩家输入的处理单元
 *
 * 泛型参数 A 由 args 声明自动推导，handle 内的 args 即获得精确类型，
 * 无需 as 断言。
 */
export interface CommandDefinition<
  A extends Record<string, ArgumentDefinition> = Record<string, ArgumentDefinition>,
> {
  /** 动词列表（支持多语言） */
  verbs: string[];
  /** 缩写列表 */
  abbrev?: string[];
  /** 参数定义 */
  args?: A;
  /**
   * 处理函数
   * 返回 string 时直接作为命令反馈输出；返回 null/void 时输出由事件链产出
   * （运行时对非字符串返回值一律按 null 处理，void 仅为书写便利）。
   */
  handle: (
    context: CommandContext<A>,
  ) => string | null | void | Promise<string | null | void>;
}

/**
 * 注册表内部使用的命令类型别名
 *
 * World 按动词注册/查找命令时无法预知具体 args 泛型 A，
 * 存储层用 any 收敛（仅此一处）；用户侧 defineCommand 仍保持精确类型。
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyCommand = CommandDefinition<any>;

/**
 * 命令上下文 - 命令执行时的环境
 */
export interface CommandContext<
  A extends Record<string, ArgumentDefinition> = Record<string, ArgumentDefinition>,
> {
  /** 原始输入 */
  raw: string;
  /** 解析后的参数（类型由 args 声明推导） */
  args: ParsedArgs<A>;
  /** 玩家实体ID */
  player: EntityId;
  /** 世界接口 */
  world: {
    emit: TypedEmit;
    getEntity: (id: EntityId) => Entity | undefined;
    getComponent: <T>(id: EntityId, component: ComponentDefinition<T>) => T | undefined;
    /** 按组件查询实体（容器查询等场景） */
    findByComponent: <T>(component: ComponentDefinition<T>) => EntityId[];
    findEntity: (name: string) => EntityId | undefined;
  };
}