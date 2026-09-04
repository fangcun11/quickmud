/**
 * 伤势警示测试（0.13，P2）——xkx「你受伤颇重」梯度惯例
 *
 * 锁死契约：
 * 1. 档位：>2/3 无恙 → >1/3 轻伤(黄) → >0 重伤(红) → 0 死亡（不提示）
 * 2. 只在**掉档那一刻**出现；同档连击不刷屏；回血升档不提示
 * 3. 玩家目标用「你」视角，NPC 目标用全名
 */
import { describe, it, expect } from 'vitest';
import { injuryWarning } from './vitals.js';

describe('injuryWarning', () => {
  const player = { isPlayerTarget: true, name: '少年侠客' };
  const wolf = { isPlayerTarget: false, name: '野狼' };

  it('无恙区间与死亡档不提示', () => {
    expect(injuryWarning(100, 80, 100, player)).toBeNull(); // 还在无恙档
    expect(injuryWarning(20, 0, 100, player)).toBeNull(); // 死亡句自有分量
    expect(injuryWarning(0, 0, 100, player)).toBeNull(); // 已死不再叠
  });

  it('首次掉到轻伤档 → 黄色；同档连击不重复', () => {
    const first = injuryWarning(100, 60, 100, player);
    expect(first).toEqual({ text: '你受了些伤，气息渐乱。', color: 'yellow' });
    expect(injuryWarning(60, 40, 100, player)).toBeNull(); // 同档
  });

  it('掉到重伤档 → 红色；从轻伤继续掉也提示', () => {
    expect(injuryWarning(60, 30, 100, player)).toEqual({
      text: '你伤得不轻，眼前阵阵发黑！',
      color: 'red',
    });
    expect(injuryWarning(100, 10, 100, wolf)).toEqual({
      text: '「野狼」伤得不轻，摇摇欲坠！',
      color: 'red',
    });
  });

  it('回血升档不提示（警示只跟受伤走）', () => {
    expect(injuryWarning(30, 90, 100, player)).toBeNull();
  });

  it('NPC 目标用全名视角', () => {
    expect(injuryWarning(25, 12, 25, wolf)).toEqual({
      text: '「野狼」受了些伤，气息渐乱。',
      color: 'yellow',
    });
  });
});
