/**
 * 单 HTML 入口 - 浏览器版本
 *
 * 与 main.ts (REPL) 共享相同的世界组装（bootstrap），
 * 但使用 WebRenderer 而非 readline。
 *
 * 命令建议（web-client 0.3）：数据面由 bootstrap 导出的命令表 + 方向词
 * 生成（createSuggester）；状态栏已按 MUD 传统移除，属性看 score 命令。
 */
import { bootstrap } from './world/bootstrap';
import { WebRenderer } from '@mud/web-client';
import { createSuggester } from '@mud/prefabs';

function main() {
  const { world, playerId, commands, directionWords } = bootstrap();

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
    suggest: createSuggester({ commands, query: world, playerId, directions: directionWords }),
  });

  renderer.showWelcome();
}

main();
