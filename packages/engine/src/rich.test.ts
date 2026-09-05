/**
 * 富文本模板标签与描述内联标记测试（0.14）
 */
import { describe, it, expect } from 'vitest';
import { rich, red, bold, entity, parseInlineMarkup } from './index';

describe('rich 模板标签', () => {
  it('静态串 + 插值段 + 普通值混排', () => {
    const segs = rich`你来到了${bold('城隍庙')}前，${'丙申年'}。`;
    expect(segs).toEqual([
      { text: '你来到了' },
      { text: '城隍庙', style: { bold: true } },
      { text: '前，' },
      { text: '丙申年' },
      { text: '。' },
    ]);
  });

  it('助手可叠加：bold(red(x)) 合并语义', () => {
    expect(bold(red('崩拳'))).toEqual({
      text: '崩拳',
      style: { color: 'red', bold: true },
    });
  });

  it('entity 标注 + 段数组展开', () => {
    const segs = rich`「${entity('野狼')}」×2，掉落${[red('狼皮')]}`;
    expect(segs[1]).toEqual({ text: '野狼', style: { tag: 'entity' } });
    expect(segs[3]).toEqual({ text: '狼皮', style: { color: 'red' } });
  });

  it('null/undefined 插值安全跳过', () => {
    expect(rich`a${null}b${undefined}c${1}`).toEqual([
      { text: 'a' },
      { text: 'b' },
      { text: 'c' },
      { text: '1' },
    ]);
  });
});

describe('parseInlineMarkup', () => {
  it('{{语义|文本}} → 带样式段；普通文本保持', () => {
    expect(parseInlineMarkup('你站在{{bold|城隍庙}}前。')).toEqual([
      { text: '你站在' },
      { text: '城隍庙', style: { bold: true } },
      { text: '前。' },
    ]);
  });

  it('+ 组合：red+b → 红色加粗', () => {
    expect(parseInlineMarkup('{{red+b|警}}')).toEqual([
      { text: '警', style: { color: 'red', bold: true } },
    ]);
  });

  it('未知语义 → fail-soft 原样渲染', () => {
    expect(parseInlineMarkup('a{{blurp|x}}b')).toEqual([{ text: 'a{{blurp|x}}b' }]);
  });

  it('相邻纯文本合并', () => {
    expect(parseInlineMarkup('{{red|警}}告{{yellow|示}}')).toEqual([
      { text: '警', style: { color: 'red' } },
      { text: '告' },
      { text: '示', style: { color: 'yellow' } },
    ]);
  });
});
