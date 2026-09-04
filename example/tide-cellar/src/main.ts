import { bootstrap } from './world/bootstrap';
import { ENGINE_VERSION } from '@mud/ecs-engine';

/**
 * 潮汐地窖 终端 REPL（v0.10）
 *
 * 输入处理采用「队列 + 串行排水」模式（与 mini-rpg 同款）：
 * 'line' 可能在同一宏任务内批量派发，先入队再单一 drain 循环逐条 await，
 * 保证顺序与完整性；EOF 只置标志，排空后干净退出。
 */
async function main() {
  const { world, playerId } = bootstrap();

  world.start();

  const readline = await import('readline');
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  console.log('=== 潮汐地窖 · tide-cellar（MUD 文字游戏引擎 v' + ENGINE_VERSION + '） ===');
  console.log('地窖每 4 秒涨落一格。闸门房每 3 秒喷一次蒸汽——别在里面站着。');
  console.log('输入 help 查看命令，输入 quit 退出。');
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
