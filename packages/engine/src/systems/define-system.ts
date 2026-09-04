import type { EventToken } from '../core/types';
import type { SystemContext, SystemDefinition, SystemErrorPolicy } from './types';
import type { EventDefinition, TickEventPayload } from '../events/types';

/** on 列表元素：事件定义（类型贯通，推荐）或 token 字符串 */
type OnInput = EventToken | EventDefinition<unknown>;

/**
 * 单个 on 元素 → handle 收到的事件形态：
 * token 保留字面量类型、data 从事件定义贯通（分布式条件类型逐成员展开）
 */
type EventOfEntry<E> = E extends EventDefinition<infer T, infer N>
  ? { token: N; data: T; timestamp: number }
  : E extends EventToken
    ? { token: E; data: unknown; timestamp: number }
    : never;

/**
 * 从 on 声明推导 handle 的 event 参数类型：
 * - `on: [Attack]` → `{ token: 'attack'; data: AttackPayload; timestamp: number }`
 * - `on: [A, B]`   → 上述形态的 union——handle 里 `event.token === A.token` 自动收窄 `event.data`
 * - 无 on（every 系统）→ TICK 合成事件（data.time 为世界时间毫秒）
 */
export type SystemEventOf<TOn> = TOn extends readonly unknown[]
  ? EventOfEntry<TOn[number]>
  : TickEventPayload;

/**
 * 系统定义工厂
 * 创建游戏逻辑系统的声明式定义
 *
 * 事件类型从 on 列表**自动贯通**到 handle：传事件定义（推荐）即可，
 * 多事件订阅时 handle 收到 discriminated union，按 token 收窄——无需
 * 显式泛型、无需 `as` 断言。
 *
 * 运行时把 on 中的 EventDefinition 归一化为 token 字符串（唯一事实源仍是 token）。
 *
 * @example
 * ```typescript
 * const Damage = defineEvent<{ target: string; amount: number }>('damage');
 * const Died = defineEvent<{ entity: string }>('died');
 *
 * const CombatSystem = defineSystem({
 *   name: 'combat',
 *   on: [Damage, Died],      // 多事件：union 自动收窄
 *   priority: 10,
 *   handle(event, ctx) {
 *     if (event.token === Damage.token) {
 *       event.data.amount;   // number——类型贯通，无需断言
 *     } else {
 *       event.data.entity;   // string
 *     }
 *   }
 * })
 * ```
 */
export function defineSystem<const TOn extends readonly OnInput[] | undefined = undefined>(
  definition: {
    name?: string;
    on?: TOn;
    priority?: number;
    /** 周期触发间隔（毫秒）；设置后由 World.tick 驱动（payload.data.time 为世界时间） */
    every?: number;
    /** 错误策略，默认 'propagate' */
    onError?: SystemErrorPolicy;
    handle: (
      event: SystemEventOf<TOn>,
      context: SystemContext
    ) => void | Promise<void>;
  },
): SystemDefinition {
  return {
    ...definition,
    // 运行时归一化：EventDefinition -> token
    on: definition.on?.map((entry) =>
      typeof entry === 'string' ? entry : entry.token
    ),
    priority: definition.priority ?? 0,
  } as SystemDefinition;
}
