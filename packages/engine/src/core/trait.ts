import type { ComponentDefinition, ComponentId } from './types';

/**
 * 基于名称的确定性 ID 生成（djb2 哈希 + base36 编码）
 * 同一组件名始终产生相同 ID，避免热重载或重复调用时 ID 不匹配
 *
 * 导出供引擎内部（如 World.findEntityByName 按名称查找组件）复用，
 * 确保与 trait() 生成的存储 key 一致。
 */
export function deterministicId(name: string): ComponentId {
  let hash = 5381;
  for (let i = 0; i < name.length; i++) {
    hash = ((hash << 5) + hash + name.charCodeAt(i)) | 0;
  }
  // 转为正数再 base36 编码，取前 10 位
  return (`c${(hash >>> 0).toString(36)}`.slice(0, 10)) as ComponentId;
}

/** 深拷贝：默认值是共享模板/工厂产物，create() 必须返回独立实例 */
function deepClone<T>(value: T): T {
  if (typeof structuredClone === 'function') {
    return structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value)) as T;
}

/**
 * 创建组件定义
 *
 * 默认值两种形态（运行时归一为"每次 create 返回深拷贝新实例"，互不共享）：
 * - 工厂：`trait('health', () => ({ current: 100, max: 100 }))`
 * - 对象模板：`trait('health', { current: 100, max: 100 })`（同义，更简洁）
 *
 * 早年 README 曾示范对象形态但实现只认工厂（create 变成数据对象、共享引用）；
 * 0.5 起对象模板正式受支持，两者行为一致。
 *
 * @param name - 组件名称（用于生成确定性 ID）
 * @param defaults - 默认数据对象或返回默认数据的工厂
 */
export function trait<T extends Record<string, unknown>>(
  name: string,
  defaults?: T | (() => T),
): ComponentDefinition<T> {
  const id = deterministicId(name);
  const base: T | undefined =
    typeof defaults === 'function' ? (defaults as () => T)() : defaults;

  return {
    id,
    name,
    create: () => (base === undefined ? ({} as T) : deepClone(base)),
  };
}

/**
 * 创建关系定义
 * @param name - 关系名称
 * @returns 关系定义对象
 */
export function relation(name: string): ComponentDefinition<{
  target: string;
  type: string;
}> {
  const id = deterministicId(name);

  return {
    id,
    name,
    create: () => ({ target: '', type: name }),
  };
}
