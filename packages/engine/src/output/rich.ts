/**
 * 富文本模板标签与语义助手（0.14）
 *
 * 解决"一句话里局部高亮要手工切段"的啰嗦：
 *
 * ```ts
 * import { rich, red, yellow, bold, entity } from '@mud/ecs-engine';
 * ctx.output.narrative(rich`你来到了${bold(roomName)}，${yellow('北风')}正紧。`);
 * ```
 *
 * - `rich`：模板标签——静态串成普通段；插值若是 Segment 原样并入、
 *   段数组展开、普通值按纯文本（动态名词直接插）。
 * - 助手：把字符串/段包上语义 style，可叠加（`bold(red('崩拳'))`）。
 *   只产**语义名**（red/yellow/…），色值由渲染端主题决定——与 F3 定约一致。
 */
import type { Segment, SemanticColor } from './types';

type Piece = string | Segment;

function styled(text: Piece, style: NonNullable<Segment['style']>): Segment {
  if (typeof text === 'string') return { text, style };
  const inner = text.style ?? {};
  return { text: text.text, style: { ...inner, ...style } };
}

function color(c: SemanticColor): (piece: Piece) => Segment {
  return (piece) => styled(piece, { color: c });
}

export const red = color('red');
export const green = color('green');
export const yellow = color('yellow');
export const blue = color('blue');
export const gray = color('gray');
export const white = color('white');
export const cyan = color('cyan');
export const magenta = color('magenta');

export function bold(piece: Piece): Segment {
  return styled(piece, { bold: true });
}

export function italic(piece: Piece): Segment {
  return styled(piece, { italic: true });
}

/** 实体名标注：web 端可点击（= look 该实体），终端端下划线 */
export function entity(piece: Piece): Segment {
  return styled(piece, { tag: 'entity' });
}

function isSegment(v: unknown): v is Segment {
  return typeof v === 'object' && v !== null && 'text' in v;
}

/**
 * 富文本模板标签：`rich`你来到了${bold(name)}。`` → Segment[]
 *
 * - 静态串 → 普通段；空串跳过
 * - 插值：Segment 并入 / Segment[] 展开 / 字符串按纯文本 / 其余 String()
 */
export function rich(strings: TemplateStringsArray, ...values: unknown[]): Segment[] {
  const segs: Segment[] = [];
  strings.forEach((raw, i) => {
    if (raw) segs.push({ text: raw });
    if (i >= values.length) return;
    const v = values[i];
    if (v === null || v === undefined) return;
    if (typeof v === 'string') {
      segs.push({ text: v });
      return;
    }
    if (Array.isArray(v)) {
      segs.push(...(v as Segment[]));
      return;
    }
    if (isSegment(v)) {
      segs.push(v);
      return;
    }
    segs.push({ text: String(v) });
  });
  return segs;
}
