import type { EventDefinition } from './types';

/**
 * 事件定义工厂
 *
 * 两段调用各自承担一个无法兼得的类型角色（TS 无部分泛型推断）：
 * - 第一层 `defineEvent('moved')` —— 名字由实参**推断**为字面量，token 随之
 *   携带字面量类型（多事件系统按 token 收窄的前提）
 * - 第二层 `<TPayload>()` —— 载荷显式声明（没有推断来源）
 *
 * 若一步到位 `defineEvent<Payload>('moved')`，显式实参会跳过名字推断、
 * token 退化为 string——多事件收窄随之失效。漏写第二层的 `()` 会在
 * 编译期报 "not callable"，fail-fast。
 *
 * @example
 * ```typescript
 * const Damage = defineEvent('damage')<{ amount: number }>();
 * ```
 */
export function defineEvent<const TName extends string>(name: TName, options?: { version?: number }) {
  return function <TPayload = void>(): EventDefinition<TPayload, TName> {
    return {
      token: name,
      name,
      version: options?.version ?? 1,
    };
  };
}
