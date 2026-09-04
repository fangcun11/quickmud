import { defineCommand } from '@mud/ecs-engine';

/** 侠客行帮助命令（M0：只列本包实际注册的动词） */
export const HelpCommand = defineCommand({
  verbs: ['help', '帮助', 'h'],
  handle() {
    return [
      '可用命令：',
      '  look (l/看)      - 观察周围环境（look <目标> 查看目标）',
      '  go (走) <方向>    - 向指定方向移动（或直接用方向词）',
      '  north/south/east/west (北/南/东/西) - 向指定方向移动',
      '  map (地图)       - 绘制**当前区域**的已探明地图',
      '  worldmap (世界地图) - 绘制各区域之间的位置图',
      '  /dev-help        - 开发者命令（/tp /heal）',
      '  quit (退出)      - 退出（仅终端 REPL）',
      '',
      'M1 起开放：打坐/状态/攻击/逃……',
    ].join('\n');
  },
});
