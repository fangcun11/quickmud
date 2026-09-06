/**
 * CRT shader 源与降级路径测试（happy-dom 无 WebGL/2D，验证不炸与降级形态）
 */
import { describe, it, expect } from 'vitest';
import { CRT_VERT, CRT_FRAG } from './crt-shaders';
import { CrtRenderer } from './crt-renderer';

describe('CRT shader 源（typed-crt 移植）', () => {
  it('包含全部效果与 uniform', () => {
    expect(CRT_FRAG).toContain('uTex');
    expect(CRT_FRAG).toContain('uRes');
    expect(CRT_FRAG).toContain('uTime');
    expect(CRT_FRAG).toContain('0.115'); // 桶形弯曲
    expect(CRT_FRAG).toContain('0.012'); // 径向色差
    expect(CRT_FRAG).toContain('0.92'); // 扫描线频率
    expect(CRT_FRAG).toContain('1.34'); // RGB 荫罩增益
    expect(CRT_FRAG).toContain('0.045'); // 滚动亮带
    expect(CRT_FRAG).toContain('0.42'); // 暗角
    expect(CRT_FRAG).toContain('0.028'); // 闪烁
    expect(CRT_FRAG).toContain('0.022'); // 噪点
    expect(CRT_FRAG).toContain('vec3(0.004, 0.010, 0.008)'); // 磷光底色
    expect(CRT_VERT).toContain('aPos');
  });
});

describe('CrtRenderer 降级路径', () => {
  it('无 WebGL 环境：构造不炸，view 挂载，输入行存在', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const world = {
      execute: async () => null,
      output: { getAll: () => [], clear: () => {} },
    };
    const r = new CrtRenderer({ container, world, playerId: 'p1' });
    expect(container.querySelector('.crt-canvas')).toBeTruthy();
    expect(container.querySelector('#cmd-input')).toBeTruthy();
    r.showWelcome({ title: '测试' });
    // 文字进的是 canvas 缓冲（happy-dom 无 2D 上下文，绘制被守卫跳过）——断言行数增长
    expect(r.lines).toBeGreaterThanOrEqual(2); // 标题 + 默认行
    // 无 2D 上下文时 draw 为空操作，但 showWelcome 的文本进不了画布——
    // happy-dom 下 getContext 返回 null，画布逻辑被守卫跳过即可
  });
});
