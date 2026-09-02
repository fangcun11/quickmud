import type { EventDefinition } from './types';
import type { EventToken } from '../core/types';

/**
 * 事件定义工厂
 * 创建类型安全的事件定义
 *
 * @example
 * ```typescript
 * const Damage = defineEvent('damage')<{ amount: number }>()
 * const error = defineEvent('system_error', { version: 1 })<{ message: string }>()
 * ```
 */
export function defineEvent<TName extends string>(
  name: TName,
  options?: {
    version?: number;
    schema?: {
      validate: (data: unknown) => data is unknown;
    };
  }
) {
  return function <TPayload>() {
    const token = name as unknown as EventToken;

    const definition: EventDefinition<TPayload> = {
      token,
      name,
      version: options?.version ?? 1,
      schema: options?.schema as EventDefinition<TPayload>['schema'],
    };

    return definition;
  };
}