import type { EventToken } from '../core/types';
import type { SystemContext, SystemDefinition } from './types';
import type { EventDefinition } from '../events/types';

/** on 列表元素：事件定义（类型贯通，推荐）或 token 字符串 */
type OnInput<T> = EventToken | EventDefinition<T>;

/**
 * 系统定义工厂
 * 创建游戏逻辑系统的声明式定义
 *
 * 泛型 T 显式声明本系统处理的事件载荷类型，
 * handle 收到的 event.data 即为 T（类型从事件定义贯通到处理函数）。
 *
 * 运行时把 on 中的 EventDefinition 归一化为 token 字符串（唯一事实源仍是 token）。
 *
 * @example
 * ```typescript
 * const Damage = defineEvent('damage')<{ target: string; amount: number }>();
 *
 * const CombatSystem = defineSystem<{ target: string; amount: number }>({
 *   name: 'combat',
 *   on: [Damage],            // 传事件定义，类型贯通
 *   priority: 10,
 *   handle(event, ctx) {
 *     event.data.amount;     // number，无需断言
 *   }
 * })
 * ```
 */
export function defineSystem<T>(definition: {
  name?: string;
  on?: OnInput<T>[];
  priority?: number;
  handle: (
    event: { token: EventToken; data: T; timestamp: number },
    context: SystemContext
  ) => void | Promise<void>;
}): SystemDefinition<T> {
  return {
    ...definition,
    // 运行时归一化：EventDefinition -> token
    on: definition.on?.map((entry) =>
      typeof entry === 'string' ? entry : entry.token
    ),
    priority: definition.priority ?? 0,
  } as SystemDefinition<T>;
}
