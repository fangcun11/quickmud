/**
 * 潮汐地窖帮助（0.15 自动归集）：注册表实时渲染，永不漂移。
 * 房间专属动词（拧/敲等）由房间块自带注册，同样自动归集。
 */
import { createAutoHelpCommand } from '@mud/prefabs';

export const HelpCommand = createAutoHelpCommand({
  title: '可用命令（含房间专属动词，走到才有）：',
  tips: [
    '  /dev-help        - 开发者命令（/tp /heal）',
    '  quit (退出)      - 退出（仅终端 REPL）',
  ],
});
