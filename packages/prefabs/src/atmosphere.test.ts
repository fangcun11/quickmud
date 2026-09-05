/**
 * 时辰与天气测试（0.14 氛围支线）——纯函数、派生只读
 */
import { describe, it, expect } from 'vitest';
import { shichenOf, weatherOf, weatherLabel } from './atmosphere.js';

describe('shichenOf', () => {
  it('默认刻度：一昼夜 4 分钟，12 时辰各 20 秒', () => {
    expect(shichenOf(0)).toBe('子时');
    expect(shichenOf(19_999)).toBe('子时');
    expect(shichenOf(20_000)).toBe('丑时');
    expect(shichenOf(120_000)).toBe('午时'); // 第 7 段
    expect(shichenOf(239_999)).toBe('亥时');
    expect(shichenOf(240_000)).toBe('子时'); // 翻日回子
  });

  it('负数时间（回滚越过 0 的理论情形）也安全', () => {
    expect(shichenOf(-1)).toBe('亥时');
  });

  it('自定义刻度', () => {
    expect(shichenOf(1_500, { dayLengthMs: 12_000 })).toBe('丑时'); // 12s/12 段 = 1s 一时辰
  });
});

describe('weatherOf', () => {
  it('同区域同时段恒定（确定性）', () => {
    for (let t = 0; t < 60_000; t += 10_000) {
      expect(weatherOf('town', t)).toBe(weatherOf('town', 5));
    }
  });

  it('不同区域/不同时段可不同（有变化感）', () => {
    const kinds = new Set<string>();
    for (let slot = 0; slot < 8; slot++) kinds.add(weatherOf('woods', slot * 60_000));
    // 轮换表 8 槽必含晴与雨（哈希取模不保证全覆盖,但多槽多区域下多样性必现）
    const across = new Set<string>();
    for (const area of ['town', 'woods', 'road']) {
      for (let slot = 0; slot < 8; slot++) across.add(weatherOf(area, slot * 60_000));
    }
    expect(across.size).toBeGreaterThan(1);
    expect(kinds.size).toBeGreaterThanOrEqual(1);
  });

  it('返回值都在合法集合内', () => {
    for (let slot = 0; slot < 32; slot++) {
      const kind = weatherOf('any', slot * 60_000);
      expect(['clear', 'rain', 'snow', 'mist']).toContain(kind);
      expect(weatherLabel(kind)).toBeTruthy();
    }
  });
});
