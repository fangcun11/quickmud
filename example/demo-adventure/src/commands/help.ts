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
      '  look (l/看)     - 观察周围环境（look 剑 查看物品）',
      '  go (走) <方向>   - 向指定方向移动（或直接用方向词）',
      '  north (n/北)    - 向北移动',
      '  south (s/南)    - 向南移动',
      '  east  (e/东)    - 向东移动',
      '  west  (w/西)    - 向西移动',
      '  inventory (i/物品) - 查看背包',
      '  take (拿) <物品>  - 拾取当前房间的物品',
      '  drop (放下) <物品> - 放下背包中的物品',
      '  attack (打) <目标> - 攻击同房间的目标（先 look 看看有什么）',
      '  quests (任务)   - 查看当前房间 NPC 的任务与进度',
      '  turnin (交任务) - 向当前房间的 NPC 交付已完成的任务（领奖）',
      '  map (地图)    - 绘制已探明的世界地图',
      '  score (状态)    - 查看状态',
      '  talk/ask (说/对话) - 与 NPC 对话（如 talk 酒保；选项用 talk 酒保 1）',
      '  /dev-help       - 开发者命令（/tp /heal）',
      '  quit (退出)     - 退出（仅终端 REPL；网页端无此命令）',
    ].join('\n');
  },
});
