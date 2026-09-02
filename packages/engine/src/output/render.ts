/**
 * 输出渲染参考实现（A3）
 *
 * 纯函数：OutputMessage[] → 渲染字符串。不依赖 World、不产生副作用。
 * 引擎只负责产出语义化消息，呈现策略完全交给消费端；本文件提供两个
 * 开箱可用的参考实现（终端 ANSI / Web 语义标签）与纯文本兜底。
 *
 * 确定性说明：渲染不读系统时间、不用随机源，同一消息序列输出恒等。
 */
import type { OutputMessage, Segment, SemanticColor } from './types';

// ---------- ANSI 终端渲染 ----------

const ANSI_COLOR: Record<SemanticColor, string> = {
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
  white: '\x1b[37m',
};

const ANSI_RESET = '\x1b[0m';
const ANSI_BOLD = '\x1b[1m';
const ANSI_ITALIC = '\x1b[3m';

/** kind → 终端默认样式 */
const KIND_ANSI: Record<OutputMessage['kind'], { color?: SemanticColor; bold?: boolean }> = {
  title: { color: 'cyan', bold: true },
  error: { color: 'red' },
  system: { color: 'gray' },
  dialogue: { color: 'magenta' },
  narrative: {},
  prompt: { color: 'cyan' },
  status: { color: 'yellow' },
};

function ansiWrap(text: string, color?: SemanticColor, bold?: boolean, italic?: boolean): string {
  let prefix = '';
  if (color) prefix += ANSI_COLOR[color];
  if (bold) prefix += ANSI_BOLD;
  if (italic) prefix += ANSI_ITALIC;
  return prefix ? `${prefix}${text}${ANSI_RESET}` : text;
}

/** 渲染单条消息为 ANSI 行（不含行尾换行） */
function ansiLine(msg: OutputMessage, noColor: boolean): string {
  const kindStyle = KIND_ANSI[msg.kind] ?? {};
  return msg.segments
    .map((seg) => {
      const { color = kindStyle.color, bold = kindStyle.bold, italic } = seg.style ?? {};
      if (noColor) return seg.text;
      return ansiWrap(seg.text, color, bold, italic);
    })
    .join('');
}

export interface AnsiRenderOptions {
  /** 关闭颜色（重定向到文件时有用），默认 false */
  noColor?: boolean;
  /** 每条消息之间的分隔符，默认 '\n' */
  separator?: string;
}

/**
 * 渲染为终端 ANSI 文本
 *
 * @example
 * ```typescript
 * process.stdout.write(renderAnsi(world.output.getAll()));
 * ```
 */
export function renderAnsi(messages: OutputMessage[], options: AnsiRenderOptions = {}): string {
  const { noColor = false, separator = '\n' } = options;
  return messages.map((m) => ansiLine(m, noColor)).join(separator);
}

// ---------- Web 语义标签渲染 ----------

const KIND_CLASS: Record<OutputMessage['kind'], string> = {
  title: 'mud-title',
  error: 'mud-error',
  system: 'mud-system',
  dialogue: 'mud-dialogue',
  narrative: 'mud-narrative',
  prompt: 'mud-prompt',
  status: 'mud-status',
};

function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function segmentAttrs(seg: Segment): string {
  const attrs: string[] = [];
  if (seg.style?.color) attrs.push(`data-color="${seg.style.color}"`);
  if (seg.style?.bold) attrs.push('data-bold');
  if (seg.style?.italic) attrs.push('data-italic');
  if (seg.style?.tag) attrs.push(`data-tag="${seg.style.tag}"`);
  if (seg.entityRef) attrs.push(`data-entity-ref="${seg.entityRef}"`);
  return attrs.length ? ` ${attrs.join(' ')}` : '';
}

/**
 * 渲染为语义化 HTML 片段（不含 <html>/<body> 外壳）
 *
 * 结构约定：
 *   <p class="mud-{kind}"><span data-...>text</span>...</p>
 * 语义信息全部落在 data-* 属性上，样式由消费端 CSS 决定。
 * 文本经 HTML 转义，entityRef 保留为 data-entity-ref 供交互（点击查看实体等）。
 */
export function renderSemanticHtml(messages: OutputMessage[]): string {
  return messages
    .map((msg) => {
      const spans = msg.segments
        .map((seg) => `<span${segmentAttrs(seg)}>${escapeHtml(seg.text)}</span>`)
        .join('');
      const cls = KIND_CLASS[msg.kind] ?? 'mud-narrative';
      return `<p class="${cls}">${spans}</p>`;
    })
    .join('\n');
}

// ---------- 纯文本兜底 ----------

/**
 * 渲染为纯文本（丢弃所有样式，适合日志/无障碍场景）
 */
export function renderPlainText(messages: OutputMessage[]): string {
  return messages.map((m) => m.segments.map((s) => s.text).join('')).join('\n');
}
