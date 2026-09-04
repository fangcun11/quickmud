/**
 * 深拷贝——引擎内部唯一实现（0.11 前曾在 world/entity/trait/blueprint 各复制一份）
 *
 * structuredClone 不可用时的 JSON 兜底。
 * 使用方：快照冻结视图、组件默认值实例化、蓝图数据挂载、实体恢复。
 */
export function deepClone<T>(value: T): T {
  if (typeof structuredClone === 'function') {
    return structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value)) as T;
}
