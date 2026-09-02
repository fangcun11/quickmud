import { defineCommand } from '@mud/ecs-engine';

/**
 * 帮助命令（demo 特有：列出本 demo 注册的全部动词）
 *
 * 注意：命令列表与注册表脱钩（引擎未给命令加 name/描述字段），
 * 加了命令记得回来补这一行。
 */
export const HelpCommand = defineCommand({
  verbs: ['help', '帮助', 'h'],
  handle() {
    return [
      '可用命令：',
      '  look (l/看)     - 观察周围环境',
      '  north (n/北)    - 向北移动',
      '  south (s/南)    - 向南移动',
      '  east  (e/东)    - 向东移动',
      '  west  (w/西)    - 向西移动',
      '  inventory (i/物品) - 查看背包',
      '  score (状态)    - 查看状态',
      '  talk/ask (说/对话) - 与 NPC 对话（如 talk 酒保；选项用 talk 酒保 1）',
      '  help (帮助)     - 显示帮助',
      '  quit (退出)     - 退出游戏',
    ].join('\n');
  },
});
