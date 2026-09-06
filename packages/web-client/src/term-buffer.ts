/**
 * 终端行缓冲（CRT 渲染器阶段一）：纯逻辑、无 DOM 依赖。
 *
 * 职责：把引擎的 Segment[] 输出折行成固定宽度的行模型，并维护
 * scrollback 与"行内 segment → 鼠标命中"的映射（点击预填用）。
 * measure 由渲染器注入（canvas measureText）——本文件可在纯 Node 下单测。
 */
import type { OutputMessage, Segment } from '@mud/ecs-engine';

export interface TermSeg {
  text: string;
  x: number;
  w: number;
  color: string;
  bold: boolean;
  italic: boolean;
  tag?: string;
  entityRef?: string;
}

export interface TermLine {
  segs: TermSeg[];
  text: string;
}

export type Measure = (text: string, bold: boolean, italic: boolean) => number;

/** kind → 颜色解析（渲染器注入 CSS 变量实值） */
export type ColorOf = (kind: string, seg: Segment) => string;

const KIND_COLOR_VAR: Record<string, string> = {
  title: 'var(--c-title)',
  system: 'var(--c-system)',
  error: 'var(--c-error)',
  dialogue: 'var(--c-dialogue)',
  status: 'var(--c-status)',
  narrative: 'var(--fg)',
};

export function kindColor(kind: string, seg: Segment, resolve: (cssVar: string) => string): string {
  if (seg.style?.color) {
    const known = ['red', 'green', 'yellow', 'blue', 'gray', 'white', 'cyan', 'magenta'];
    if (known.includes(seg.style.color)) return resolve(`var(--c-${seg.style.color === 'gray' ? 'system' : seg.style.color})`);
    return seg.style.color; // 内容直接给了色值
  }
  const v = KIND_COLOR_VAR[kind] ?? 'var(--fg)';
  return resolve(v);
}

export class TermBuffer {
  lines: TermLine[] = [];
  width: number;
  constructor(
    width: number,
    private measure: Measure,
    private colorOf: ColorOf,
  ) {
    this.width = width;
  }

  setWidth(width: number): void {
    if (width === this.width) return;
    this.width = width;
    // 宽度变化整体重排（罕见：窗口缩放）
    void 0;
  }

  /** 把一条输出消息折行进缓冲 */
  pushMessage(msg: OutputMessage): void {
    // 折行状态机：逐 segment 逐字符贪心排布（CJK 友好）
    let cur: TermSeg[] = [];
    let curText = '';
    let x = 0;
    const flush = () => {
      if (curText.length > 0 || cur.length > 0) {
        this.lines.push({ segs: cur, text: curText });
        cur = [];
        curText = '';
        x = 0;
      }
    };
    for (const seg of msg.segments) {
      const color = this.colorOf(msg.kind, seg);
      const bold = seg.style?.bold ?? msg.kind === 'title';
      const italic = seg.style?.italic ?? false;
      const text = seg.text;
      let i = 0;
      // \n 显式断行
      while (i < text.length) {
        const ch = text[i]!;
        const w = this.measure(ch, bold, italic);
        if (ch === '\n') {
          flush();
          i++;
          continue;
        }
        if (x + w > this.width && x > 0) flush();
        // 同 segment 的连续字符尽量合并成一个 TermSeg（命中映射粒度足够）
        let run = ch;
        let runW = w;
        i++;
        while (i < text.length && text[i] !== '\n') {
          const cw = this.measure(text[i]!, bold, italic);
          if (x + runW + cw > this.width) break;
          run += text[i]!;
          runW += cw;
          i++;
        }
        cur.push({ text: run, x, w: runW, color, bold, italic, tag: seg.style?.tag, entityRef: seg.entityRef });
        curText += run;
        x += runW;
      }
    }
    flush();
  }

  /** 命中测试：视口坐标 → 命中的 segment（点击预填用） */
  hitTest(scrollLines: number, viewLines: number, mx: number, my: number, lineHeight: number): TermSeg | undefined {
    const lineIdx = Math.floor(my / lineHeight) + scrollLines;
    if (lineIdx < 0 || lineIdx >= this.lines.length) return undefined;
    if (lineIdx < this.lines.length - viewLines && this.lines.length > viewLines) return undefined;
    const line = this.lines[lineIdx]!;
    return line.segs.find((s) => mx >= s.x && mx < s.x + s.w);
  }
}
