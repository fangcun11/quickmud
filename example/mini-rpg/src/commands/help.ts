/**
 * mini-rpg 帮助（0.15 自动归集）：注册表实时渲染，永不漂移。
 */
import { createAutoHelpCommand } from '@mud/prefabs';

export const HelpCommand = createAutoHelpCommand({
  title: '可用命令：',
  tips: [
    '  /dev-help        - 开发者命令（/tp /heal）',
    '  quit (退出)      - 退出（仅终端 REPL）',
  ],
});
