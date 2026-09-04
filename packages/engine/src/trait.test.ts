/**
 * 组件定义（trait/relation）测试
 *
 * 0.11：deterministicId 是 32 位 djb2 哈希，理论可碰撞（实测 10 万名字 3 对）。
 * 两个不同名的 trait 若静默共享同一存储槽，组件数据会互相覆盖——
 * 现在模块级注册表查重，同 id 不同名 fail-fast。
 */
import { describe, it, expect } from 'vitest';
import { trait, deterministicId } from './index';

describe('trait() 确定性 ID 碰撞防护', () => {
  it('同名重复调用幂等（热重载/重复定义安全）', () => {
    const a = trait('health-test-a', { current: 100 });
    const b = trait('health-test-a', { current: 50 });
    expect(b.id).toBe(a.id);
    expect(b.name).toBe(a.name);
  });

  it('不同名同 ID（djb2 碰撞）→ fail-fast 抛错', () => {
    // comp_1r_x / comp_30_x 是实测找到的 djb2 碰撞对（同 ID ci5d8b1）
    expect(deterministicId('comp_1r_x')).toBe(deterministicId('comp_30_x'));
    expect(() => trait('comp_1r_x')).not.toThrow();
    expect(() => trait('comp_30_x')).toThrow(/冲突|collision/);
  });
});
