import type { EventDefinition } from './types';
import type { EventToken } from '../core/types';

/**
 * 事件定义工厂
 * 创建类型安全的事件定义
 *
 * @example
 * ```typescript
 * const Damage = defineEvent('damage')<{ amount: number }>()
 * ```
 */
export function defineEvent<TName extends string>(name: TName, options?: { version?: number }) {
  return function <TPayload>() {
    const token = name as unknown as EventToken;

    const definition: EventDefinition<TPayload> = {
      token,
      name,
      version: options?.version ?? 1,
    };

    return definition;
  };
}
