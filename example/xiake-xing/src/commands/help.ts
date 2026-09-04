import { defineCommand } from '@mud/ecs-engine';

/** 侠客行帮助命令（终端与网页共用；网页专属能力单独标注） */
export const HelpCommand = defineCommand({
  verbs: ['help', '帮助', 'h'],
  handle() {
    return [
      '可用命令：',
      '  look (l/看)      - 观察周围环境（出口和地上的东西都会列出来）',
      '  移动             - 直接敲 北/南/东/西（或 n/s/e/w、往东、向东）',
      '  map (地图)       - 当前区域的地图与已探明地点',
      '  worldmap (世界地图) - 各区域之间的位置图',
      '  详细 (verbose)   - 切换描述详略：默认重复经过的房间只报地名',
      '  quit (退出)      - 退出（仅终端；网页版直接关页面）',
      '  重开（网页版）   - 清除进度，从头开始（连输两次确认）',
      '  /dev-help        - 开发者命令（/tp /heal）',
    ].join('\n');
  },
});

/**
 * 退出提示（网页版兜底）：
 * 终端 REPL 在 execute 之前拦截 quit，永远走不到这里；
 * 网页版 quit 没有终端语义，给一句人话而不是"我不明白"。
 */
export const QuitHintCommand = defineCommand({
  verbs: ['quit', 'exit', '退出'],
  handle() {
    return '网页版直接关闭页面即可，进度会自动保存；想重新开始，输入 重开。';
  },
});
