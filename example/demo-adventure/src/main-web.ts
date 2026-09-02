/**
 * 单 HTML 入口 - 浏览器版本
 *
 * 与 main.ts (REPL) 共享相同的系统/命令/实体定义，
 * 但使用 WebRenderer 而非 readline。
 */
import { bootstrap } from './world/bootstrap';
import { WebRenderer } from '@mud/web-client';
import { Health, Position, Name } from './world/traits';
import type { EntityId } from '@mud/ecs-engine';

function main() {
  const { world, playerId } = bootstrap();

  // 挂载渲染器
  const app = document.getElementById('app');
  if (!app) {
    document.body.innerHTML = '<div style="color:red;padding:20px">Error: #app not found</div>';
    return;
  }

  // 状态栏文本：用 demo 自己的 trait 定义读取组件（key 为 trait 的哈希 id）
  const status = (pid: EntityId): string | undefined => {
    const health = world.entities.getComponent(pid, Health);
    const pos = world.entities.getComponent(pid, Position);
    const roomName = pos ? world.entities.getComponent(pos.roomId, Name) : undefined;

    const parts: string[] = [];
    if (health) parts.push(`HP: ${health.current}/${health.max}`);
    if (roomName) parts.push(`位置: ${roomName.text}`);
    return parts.length ? parts.join('  |  ') : undefined;
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
