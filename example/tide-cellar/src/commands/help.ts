import { defineCommand } from '@mud/ecs-engine';

/** 潮汐地窖帮助命令（列出本游戏注册的全部动词 + 三个房间专用动词） */
export const HelpCommand = defineCommand({
  verbs: ['help', '帮助', 'h'],
  handle() {
    return [
      '可用命令：',
      '  look (l/看)      - 观察周围环境（look 铁轮 查看目标）',
      '  go (走) <方向>    - 向指定方向移动（或直接用方向词）',
      '  north/south/east/west (北/南/东/西) - 向指定方向移动',
      '  up/down (上/下)   - 上下楼层（跨区域）',
      '  inventory (i/物品) - 查看背包',
      '  take (拿) <物品>   - 拾取当前房间的物品',
      '  drop (放下) <物品> - 放下背包中的物品',
      '  map (地图)       - 绘制**当前区域**的已探明地图',
      '  worldmap (世界地图) - 绘制三层之间的位置图（跨层不画连线）',
      '  score (状态)     - 查看状态',
      '  房间专用（走对了地方才听得到）：',
      '    turn (转动/关闸) - 闸门房：拧铁轮，潮水再也涨不上来（可也退不干净）',
      '    pray (祈祷)      - 祭坛：求取青铜祭器',
      '    ring (敲钟)      - 钟室：敲钟，逼退一格潮水（只开一小会儿）',
      '  /dev-help        - 开发者命令（/tp /heal）',
      '  quit (退出)      - 退出（仅终端 REPL）',
    ].join('\n');
  },
});
