/**
 * 侠客行帮助（0.15 自动归集）：从注册表实时渲染，永不漂移——
 * 新命令写 describe 即自动出现（未写则注册期报错）。游戏侧提示走 tips。
 */
import { createAutoHelpCommand } from '@mud/prefabs';

export const HelpCommand = createAutoHelpCommand({
  title: '侠客行 · 可用命令：',
  tips: [
    '  重开（网页版）   - 清除进度，从头开始（连输两次确认）',
    '  quit (退出)      - 退出（仅终端；网页版直接关页面）',
    '  /dev-help        - 开发者命令（/tp /heal）',
  ],
});

/**
 * 退出提示（网页版兜底）：
 * 终端 REPL 在 execute 之前拦截 quit，永远走不到这里；
 * 网页版 quit 没有终端语义，给一句人话而不是"我不明白"。
 */
import { defineCommand } from '@mud/ecs-engine';

export const QuitHintCommand = defineCommand({
  verbs: ['quit', 'exit', '退出'],
  describe: '退出游戏（仅终端；网页版直接关页面）',
  handle() {
    return '网页版直接关闭页面即可；想清空进度输入 重开。';
  },
});
