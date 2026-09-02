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

/**
 * 创建组件定义
 * @param name - 组件名称（用于生成确定性 ID）
 * @param defaults - 默认值工厂函数
 * @returns 组件定义对象
 */
export function trait<T extends Record<string, unknown>>(
  name: string,
  defaults?: () => T
): ComponentDefinition<T> {
  const id = deterministicId(name);
  
  return {
    id,
    name,
    create: defaults ?? (() => ({} as T)),
    validate: (data): data is T => {
      // 基础类型检查
      return typeof data === 'object' && data !== null && !Array.isArray(data);
    }
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
    validate: (data): data is { target: string; type: string } => {
      return (
        typeof data === 'object' &&
        data !== null &&
        'target' in data &&
        'type' in data
      );
    }
  };
}