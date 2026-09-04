import type { ComponentDefinition, ComponentId } from './types';
import { deepClone } from '../internal/clone';

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

/**
 * 组件名 → ID 注册表（碰撞防护）
 *
 * deterministicId 是 32 位 djb2 哈希，理论可碰撞——实测 10 万个组件名
 * 能找到 3 对撞车（如 comp_1r_x / comp_30_x → 同一 ID）。碰撞的后果是
 * 两个不同 trait 静默共享同一存储槽、数据互相覆盖，且无任何报错。
 * 这里在 trait()/relation() 注册时查重：同 id 不同名 → fail-fast 抛错。
 */
const idRegistry = new Map<ComponentId, string>();

function registerId(id: ComponentId, name: string): void {
  const existing = idRegistry.get(id);
  if (existing !== undefined && existing !== name) {
    throw new Error(
      `deterministicId 冲突（collision）：组件 "${name}" 与 "${existing}" 哈希撞车（${id}）。` +
        `请给其中一个换个名字。`,
    );
  }
  idRegistry.set(id, name);
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
  registerId(id, name);
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
  registerId(id, name);

  return {
    id,
    name,
    create: () => ({ target: '', type: name }),
  };
}
