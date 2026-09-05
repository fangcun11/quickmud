/**
 * 自动归集的帮助命令（0.15）：从 `world.listCommands()` 实时渲染——
 * 注册表即事实源，新命令写了 `describe` 就自动出现，help 永不漂移。
 *
 * - 每条一行：`动词 (缩写/别名) - describe`（注册序）
 * - `tips`：游戏侧追加行（网页注意事项等——放这里是内容，不是漂移源）
 * - `hideVerbPrefixes`：按前缀隐藏（如开发者命令的 `/`——默认全部列出）
 */
import { defineCommand } from '@mud/ecs-engine';

export interface AutoHelpOptions {
  /** 标题行（默认「可用命令：」） */
  title?: string;
  /** 命令清单之后追加的提示行（游戏侧内容） */
  tips?: string[];
  /** 按前缀隐藏的动词（默认全部列出） */
  hideVerbPrefixes?: string[];
}

export function createAutoHelpCommand(options?: AutoHelpOptions) {
  return defineCommand({
    verbs: ['help', '帮助', 'h'],
    describe: '查看可用命令（自动归集自注册表，永不漂移）',
    handle({ world }) {
      const hide = options?.hideVerbPrefixes ?? [];
      const lines: string[] = [options?.title ?? '可用命令：'];
      for (const meta of world.listCommands()) {
        if (meta.verbs.some((v) => hide.some((p) => v.startsWith(p)))) continue;
        const [primary, ...rest] = meta.verbs;
        const aliases = [...(meta.abbrev ?? []), ...rest];
        lines.push(
          `  ${primary}${aliases.length ? ` (${aliases.join('/')})` : ''}  - ${meta.describe}`,
        );
      }
      for (const tip of options?.tips ?? []) lines.push(tip);
      return lines.join('\n');
    },
  });
}
