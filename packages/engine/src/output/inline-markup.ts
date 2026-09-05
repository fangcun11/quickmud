/**
 * 描述内联标记解析（0.14）：`{{语义|文本}}` → Segment[]
 *
 * 背景：房间/NPC 描述是**内容数据**（纯字符串），模板标签（rich）帮不上
 * ——这里是 xkx 的老路（LPC 描述内嵌 $HIY$…$NOR$ 颜色码）的极小化版本：
 *
 *   '你站在{{bold|城隍庙}}前。{{ent|村长}}朝你望来。'
 *
 * - 语义集：8 语义色 / bold / italic / entity，`+` 组合（`{{red+b|…}}`）
 * - **fail-soft**：语义名未知 → 整个 `{{…}}` 原样渲染（内容数据不让世界崩）
 * - 相邻纯文本段合并，输出即标准 Segment[]——三个渲染器零改动获得高亮
 */
import type { Segment } from './types';
import { red, green, yellow, blue, gray, white, cyan, magenta, bold, italic, entity } from './rich';

const MODS: Record<string, (piece: string | Segment) => Segment> = {
  red, green, yellow, blue, gray, white, cyan, magenta, bold, italic, entity,
  // 常用简写：ent = 实体可点；b/i = 粗/斜（组合如 {{red+b|…}}）
  ent: entity,
  b: bold,
  i: italic,
};

const MARKUP = /\{\{([^|{}]+)\|([^{}]*)\}\}/g;

export function parseInlineMarkup(text: string): Segment[] {
  const out: Segment[] = [];
  let last = 0;
  for (const m of text.matchAll(MARKUP)) {
    const idx = m.index!;
    if (idx > last) out.push({ text: text.slice(last, idx) });

    const mods = m[1]!.split('+').map((x) => x.trim());
    if (mods.every((k) => MODS[k] !== undefined)) {
      let piece: Segment = { text: m[2]! };
      for (const k of mods) piece = MODS[k]!(piece);
      out.push(piece);
    } else {
      out.push({ text: m[0] }); // fail-soft：未知语义 → 原样渲染
    }
    last = idx + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last) });

  // 相邻纯文本段合并（避免无谓碎片）
  const merged: Segment[] = [];
  for (const piece of out) {
    const prev = merged[merged.length - 1];
    if (prev && !prev.style && !piece.style) {
      prev.text += piece.text;
    } else {
      merged.push(piece);
    }
  }
  return merged.length > 0 ? merged : [{ text: '' }];
}

/** 语义名是否合法（供内容层校验/文档示例使用） */
export function isInlineMarkupMod(name: string): boolean {
  return MODS[name] !== undefined;
}
