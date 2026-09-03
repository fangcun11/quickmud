import { defineCommand } from '@mud/ecs-engine';

/** mini-rpg 帮助命令（列出本游戏注册的全部动词） */
export const HelpCommand = defineCommand({
  verbs: ['help', '帮助', 'h'],
  handle() {
    return [
      '可用命令：',
      '  look (l/看)      - 观察周围环境（look 野狼 查看目标）',
      '  go (走) <方向>    - 向指定方向移动（或直接用方向词）',
      '  north/south/east/west (北/南/东/西) - 向指定方向移动',
      '  inventory (i/物品) - 查看背包',
      '  take (拿) <物品>   - 拾取当前房间的物品',
      '  drop (放下) <物品> - 放下背包中的物品',
      '  attack (打) <目标> - 攻击同房间的目标',
      '  quests (任务)    - 查看当前房间 NPC 的任务与进度',
      '  map (地图)       - 绘制当前区域的已探明地图',
      '  worldmap (世界地图) - 绘制区域之间的连接图',
      '  turnin (交任务)  - 向当前房间的 NPC 交付已完成的任务',
      '  score (状态)     - 查看状态',
      '  talk/ask (说/对话) - 与 NPC 对话（如 talk 村长；选项用 talk 村长 1）',
      '  /dev-help        - 开发者命令（/tp /heal）',
      '  quit (退出)      - 退出（仅终端 REPL）',
    ].join('\n');
  },
});
