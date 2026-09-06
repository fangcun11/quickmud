/**
 * 单 HTML 入口 - 浏览器版本
 *
 * 与 main.ts (REPL) 共享相同的世界组装（bootstrap），
 * 使用 WebRenderer 渲染。构建产物是自包含单文件（pnpm build
 * → dist/game.html），浏览器直接打开即玩，无需服务器。
 *
 * 存档（v0.2）：localStorage 自动保存/读档——每条命令后存，
 * 刷新/重开页面自动恢复；「重开」连输两次清档从头来。
 *
 * 命令建议（0.3）：数据面由 bootstrap 导出的命令表 + 方向词生成
 * （createSuggester），渲染器只管展示与键盘契约——状态栏已按 MUD
 * 传统移除，属性看「状态」命令。
 */
import { bootstrap } from './world/bootstrap';
import { WebRenderer } from '@mud/web-client';
import type { SnapshotData } from '@mud/ecs-engine';
import { Health } from '@mud/prefabs';
import { createSuggester } from '@mud/prefabs';
import { createClickPolicy, createActionProvider } from './click';
import { Combat, Energy, Purse } from './traits';

function main() {
  const { world, playerId, commands, directionWords } = bootstrap();

  // M1 起有 every 系统（打坐回气），世界 tick 必须启动——WebRenderer 不管这个，
  // 终端入口在 main.ts 里 start，网页入口在这里 start；重开走 location.reload()
  // 重新进 main()，天然重启
  world.start();

  // 挂载渲染器
  const app = document.getElementById('app');
  if (!app) {
    document.body.innerHTML = '<div style="color:red;padding:20px">Error: #app not found</div>';
    return;
  }

  const renderer = new WebRenderer({
    container: app,
    world,
    playerId,
    title: '侠客行',
    suggest: createSuggester({ commands, query: world, playerId, directions: directionWords }),
    // 点击策略（交互标注②）：出口=走、商品=买、地上物=拿、敌怪=预填攻击
    click: createClickPolicy(world, playerId),
    // 语境动作条（交互标注③）：输入框收起后的常用操作入口
    actions: () => createActionProvider(world, playerId),
    // 提示符状态（xkx prompt 惯例）：输入行上方常驻气血/内力；战斗中加对手血量
    prompt: (pid) => {
      const hp = world.getComponent(pid, Health);
      const en = world.getComponent(pid, Energy);
      if (!hp && !en) return undefined;
      const purse = world.getComponent(pid, Purse);
      const parts: string[] = [];
      if (hp) parts.push(`气血 ${hp.current}/${hp.max}`);
      if (en) parts.push(`内力 ${en.current}/${en.max}`);
      if (purse) parts.push(`碎银 ${purse.silver}`);
      // 交战对手一眼可见（0.18 战斗可读性）
      const combat = world.getComponent(pid, Combat);
      if (combat?.foe) {
        const foe = world.getComponent(combat.foe, Health);
        if (foe) parts.push(`⚔${foe.current}/${foe.max}`);
      }
      return parts.join(' · ');
    },
    persistence: {
      // :m5 后缀作废旧档——刷怪 bug 的旧档里攒着超额狼群，直接重开不做迁移
      key: 'save:xiake-xing:m5',
      capture: () => world.createSnapshot(),
      restore: (snapshot) => world.rollbackWorld(snapshot as SnapshotData),
    },
  });

  renderer.showWelcome({
    title: '侠客行',
    lines: [
      '终南山下，青石镇。你是个初出茅庐的少年，兜里几枚碎银，一腔江湖梦。',
      '听说武馆在收学徒，山里的野狼近来伤了好几个人——习武之路，就从这里开始。',
      '（大部分操作点带下划线的文字就能做：出口、物品、活体都可点；底部动作条是常用命令；要打字按 / 或点 ⌨）',
    ],
  });

  // 回到上次的位置后看一眼周围——不然刷新回来只知道“进度在”，不知道人在哪
  if (renderer.restored) {
    // 重连叙事（沉浸感方案 B1）：断线回来不是干巴巴的 look
    world.output.narrative('你拍了拍身上的尘土——回来了。江湖还在原地等你。');
    void renderer.runCommand('look');
  }
}

main();
