/**
 * TermBuffer 单测（CRT 渲染器阶段一）：折行 / 命中 / 颜色映射。
 * measure 用假定宽（每字符 10px），纯 Node 可跑。
 */
import { describe, it, expect } from 'vitest';
import { TermBuffer, kindColor } from './term-buffer';

const measure = (t: string) => t.length * 10;
const colorOf = (_kind: string, seg: { style?: { color?: string } }) => seg.style?.color ?? '#fff';

describe('TermBuffer', () => {
  it('超宽文本按宽度折行，行模型带 x 偏移', () => {
    const buf = new TermBuffer(350, measure, colorOf); // 35 字符宽
    buf.pushMessage({ kind: 'narrative', segments: [{ text: 'a'.repeat(80) }] });
    expect(buf.lines.length).toBe(3); // 35 + 35 + 10
    expect(buf.lines[0]!.text.length).toBe(35);
    expect(buf.lines[0]!.segs[0]!.x).toBe(0);
    expect(buf.lines[1]!.segs[0]!.x).toBe(0);
  });

  it('显式 \\n 断行；segment 边界保留（命中映射粒度）', () => {
    const buf = new TermBuffer(500, measure, colorOf);
    buf.pushMessage({
      kind: 'narrative',
      segments: [
        { text: '第一行\n' },
        { text: '野狼', style: { tag: 'entity', color: 'green' } },
        { text: '看着你。' },
      ],
    });
    expect(buf.lines.length).toBe(2);
    const segs = buf.lines[1]!.segs;
    expect(segs.length).toBeGreaterThanOrEqual(2);
    const wolf = segs.find((s) => s.text.includes('野狼'))!;
    expect(wolf.tag).toBe('entity');
  });

  it('hitTest：视口坐标反查 segment（点击预填的数据源）', () => {
    const buf = new TermBuffer(500, measure, colorOf);
    buf.pushMessage({
      kind: 'narrative',
      segments: [
        { text: 'look ' },
        { text: '野狼', style: { tag: 'entity' } },
      ],
    });
    // 第 0 行，y 在 0~lineHeight 内；'look ' 占 0-50px，野狼占 50-100px
    expect(buf.hitTest(0, 1, 10, 5, 20)?.text).toBe('look ');
    expect(buf.hitTest(0, 1, 60, 5, 20)?.text).toContain('野狼');
    expect(buf.hitTest(0, 1, 999, 5, 20)).toBeUndefined(); // 超出行宽
  });

  it('kindColor：语义色走 CSS 变量映射，色值直通', () => {
    const resolve = (v: string) => `resolved(${v})`;
    expect(kindColor('narrative', { text: '' }, resolve)).toBe('resolved(var(--fg))');
    expect(kindColor('error', { text: '' }, resolve)).toBe('resolved(var(--c-error))');
    expect(kindColor('narrative', { text: '', style: { color: 'yellow' } }, resolve)).toBe('resolved(var(--c-yellow))');
    expect(kindColor('narrative', { text: '', style: { color: '#ff0' } }, resolve)).toBe('#ff0');
  });
});
