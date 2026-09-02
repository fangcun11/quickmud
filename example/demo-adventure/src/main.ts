import { bootstrap } from './world/bootstrap';
import { ENGINE_VERSION } from '@mud/ecs-engine';

/**
 * 创建并启动游戏世界（终端 REPL）
 *
 * 输入处理采用「队列 + 串行排水」模式：
 * - 'line' 事件可能在同一宏任务内批量派发（管道输入尤其如此），
 *   先入队再用单一 drain 循环逐条 await 处理，保证顺序与完整性；
 * - EOF（close）只置标志，等队列排空后干净退出，避免与在途命令竞态。
 */
async function main() {
  const { world, playerId } = bootstrap();

  // 启动游戏循环
  world.start();

  // 简单 REPL
  const readline = await import('readline');
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  console.log(`=== MUD 文字游戏引擎 v${ENGINE_VERSION} ===`);
  console.log('输入 help 查看可用命令，输入 quit 退出游戏。');
  console.log('');
  process.stdout.write('> ');

  const lines: string[] = [];
  let draining = false;
  let inputClosed = false;

  const handleCommand = async (trimmed: string): Promise<void> => {
    const result = await world.execute(trimmed, playerId);
    if (result) {
      console.log(result);
    }

    // 输出事件链产生的消息
    for (const msg of world.output.getAll()) {
      console.log(msg.segments.map((s) => s.text).join(''));
    }
    world.output.clear();
    process.stdout.write('> ');
  };

  const drain = async (): Promise<void> => {
    if (draining) return;
    draining = true;
    try {
      while (lines.length > 0) {
        const trimmed = lines.shift()!;
        if (!trimmed) continue;

        if (trimmed === 'quit' || trimmed === 'exit') {
          world.stop();
          rl.close();
          process.exit(0);
        }

        try {
          await handleCommand(trimmed);
        } catch (err) {
          console.error(err);
        }
      }

      // 队列排空且输入已结束 → 干净退出
      if (inputClosed) {
        world.stop();
        rl.close();
        process.exit(0);
      }
    } finally {
      draining = false;
    }
  };

  rl.on('line', (raw) => {
    lines.push(raw.trim());
    void drain();
  });

  rl.on('close', () => {
    inputClosed = true;
    void drain();
  });
}

main().catch(console.error);
