/**
 * 单 HTML 入口 - 浏览器版本
 *
 * 与 main.ts (REPL) 共享相同的世界组装（bootstrap），
 * 使用 WebRenderer 渲染。构建产物是自包含单文件（pnpm build
 * → dist/game.html），浏览器直接打开即玩，无需服务器。
 */
import { bootstrap } from './world/bootstrap';
import { WebRenderer } from '@mud/web-client';
import { Name } from '@mud/ecs-engine';
import type { EntityId } from '@mud/ecs-engine';
import { Position } from '@mud/prefabs';

function main() {
  const { world, playerId } = bootstrap();

  // 挂载渲染器
  const app = document.getElementById('app');
  if (!app) {
    document.body.innerHTML = '<div style="color:red;padding:20px">Error: #app not found</div>';
    return;
  }

  // 状态栏：M0 只有位置；M1 起补 生命/内力/攻防（Energy/Stats 落地后这里扩）
  const status = (_pid: EntityId): string | undefined => {
    const pos = world.getComponent(playerId, Position);
    const roomName = pos ? world.getComponent(pos.roomId, Name) : undefined;
    return roomName ? `位置: ${roomName.text}` : undefined;
  };

  const renderer = new WebRenderer({
    container: app,
    world,
    playerId,
    status,
  });

  renderer.showWelcome();
}

main();
