import { trait } from './trait';
import type { ComponentDefinition } from './types';

/**
 * 内置名称组件（单语言）
 *
 * 这是引擎 findEntityByName 按名称查找实体的唯一契约载体：
 * 存储形状为 { text, aliases }，文本内联（i18n 暂不支持，
 * 待真实需求回归时以独立的本地化组件实现，而非污染本结构）。
 */
export const Name: ComponentDefinition<{
  /** 主名称（展示与查找） */
  text: string;
  /** 别名（查找用，可选） */
  aliases?: string[];
}> = trait('name', () => ({ text: '', aliases: [] as string[] }));
