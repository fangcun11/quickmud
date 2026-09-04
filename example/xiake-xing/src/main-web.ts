/**
 * 单 HTML 入口 - 浏览器版本
 *
 * 与 main.ts (REPL) 共享相同的世界组装（bootstrap），
 * 使用 WebRenderer 渲染。构建产物是自包含单文件（pnpm build
 * → dist/game.html），浏览器直接打开即玩，无需服务器。
 *
 * 存档（v0.2）：localStorage 自动保存/读档——每条命令后存，
 * 刷新/重开页面自动恢复；「重开」连输两次清档从头来。
 */
import { bootstrap } from './world/bootstrap';
import { WebRenderer } from '@mud/web-client';
import type { SnapshotData } from '@mud/ecs-engine';
import { Name } from '@mud/ecs-engine';
import type { EntityId } from '@mud/ecs-engine';
import { Health, Position } from '@mud/prefabs';
import { Energy } from './traits';

function main() {
  const { world, playerId } = bootstrap();

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

  // 状态栏：位置 + 生命/内力（M1）
  const status = (_pid: EntityId): string | undefined => {
    const pos = world.getComponent(playerId, Position);
    const roomName = pos ? world.getComponent(pos.roomId, Name) : undefined;
    const hp = world.getComponent(playerId, Health);
    const en = world.getComponent(playerId, Energy);
    const where = roomName ? `位置: ${roomName.text}` : '';
    const vitals =
      hp && en ? ` · 生命 ${hp.current}/${hp.max} · 内力 ${en.current}/${en.max}` : '';
    return where || vitals ? `${where}${vitals}` : undefined;
  };

  const renderer = new WebRenderer({
    container: app,
    world,
    playerId,
    status,
    title: '侠客行',
    persistence: {
      // :m1 后缀作废 M0 旧档——M1 加了 Energy/Stats 等组件，旧快照恢复出来的
      // 玩家缺件没法玩；内容升级直接重开，不做迁移
      key: 'save:xiake-xing:m1',
      capture: () => world.createSnapshot(),
      restore: (snapshot) => world.rollbackWorld(snapshot as SnapshotData),
    },
  });

  renderer.showWelcome({
    title: '侠客行',
    lines: [
      '终南山下，青石镇。你是个初出茅庐的少年，兜里几枚碎银，一腔江湖梦。',
      '听说武馆在收学徒，山里的野狼近来伤了好几个人——习武之路，就从这里开始。',
      '（输入 help 查看命令；移动直接敲 北/南/东/西 或 n/s/e/w）',
    ],
  });

  // 回到上次的位置后看一眼周围——不然刷新回来只知道“进度在”，不知道人在哪
  if (renderer.restored) {
    void renderer.runCommand('look');
  }
}

main();
