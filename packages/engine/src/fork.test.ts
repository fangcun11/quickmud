/**
 * D2 世界分叉测试
 */
import { describe, it, expect } from 'vitest';
import { World, trait, defineEvent, defineSystem, defineCommand, firstDiff } from './index';

const Health = trait('health', () => ({ current: 100, max: 100 }));
const Position = trait('position', () => ({ roomId: 'hall' }));
const Inventory = trait('inventory', () => ({ items: [] as string[] }));
const Healed = defineEvent('healed')<{ target: string; amount: number }>();

const HealSystem = defineSystem({
  name: 'heal',
  on: [Healed.token],
  priority: 10,
  handle(event, ctx) {
    const hp = ctx.getComponent(event.data.target, Health);
    if (hp) hp.current = Math.min(hp.max, hp.current + event.data.amount);
    ctx.output.narrative([{ text: `+${event.data.amount}` }]);
  },
});

const Rest = defineCommand({
  verbs: ['rest'],
  args: { minutes: { type: 'word' } },
  handle({ args, player, world }) {
    world.emit(Healed, { target: player, amount: Number(args.minutes) || 10 });
    return null;
  },
});

function buildWorld(): World {
  const w = new World({ tickInterval: 100 });
  w.register(HealSystem);
  w.registerCommands(Rest);
  const p = w.entities.createWithId('player-1');
  w.entities.addComponent(p, Health, { current: 50, max: 100 });
  w.entities.addComponent(p, Position, { roomId: 'hall' });
  w.entities.addComponent(p, Inventory, { items: ['rope'] });
  return w;
}

describe('D2 世界分叉（fork）', () => {
  it('fork 初始状态与主世界深度一致，行为等价', async () => {
    const main = buildWorld();
    const forked = main.fork();
    expect(firstDiff(main.createSnapshot(), forked.createSnapshot())).toBeUndefined();

    // fork 世界里命令可用（系统/命令定义已复用）
    const feedback = await forked.execute('rest 30', 'player-1');
    expect(feedback).toBeNull();
    expect(forked.entities.getComponent('player-1', Health)!.current).toBe(80);
  });

  it('沙盒内任意操作不影响主世界（含快照与输出隔离）', async () => {
    const main = buildWorld();
    const mainSnapBefore = main.createSnapshot();
    const forked = main.fork();

    // 沙盒里大动干戈
    await forked.execute('rest 50', 'player-1');
    forked.entities.getComponent('player-1', Inventory)!.items.push('magic-sword');
    forked.entities.getComponent('player-1', Position)!.roomId = 'dungeon';
    forked.tick();

    // 主世界纹丝不动
    expect(firstDiff(mainSnapBefore, main.createSnapshot())).toBeUndefined();
    expect(main.entities.getComponent('player-1', Health)!.current).toBe(50);
    expect(main.output.count).toBe(0); // 沙盒的输出不会串到主世界
  });

  it('fork 世界可独立快照/回滚', async () => {
    const forked = buildWorld().fork();
    const snapA = forked.createSnapshot();
    await forked.execute('rest 40', 'player-1');
    expect(forked.entities.getComponent('player-1', Health)!.current).toBe(90);
    forked.rollbackWorld(snapA);
    expect(forked.entities.getComponent('player-1', Health)!.current).toBe(50);
  });

  it('主世界后续操作不影响已 fork 的沙盒（单向切断）', async () => {
    const main = buildWorld();
    const forked = main.fork();
    main.entities.getComponent('player-1', Health)!.current = 10;
    expect(forked.entities.getComponent('player-1', Health)!.current).toBe(50);
  });

  it('fork 继承 every 系统时相：分叉世界与主世界的后续 tick 行为等价', () => {
    const times: number[] = [];
    const Pulse = defineSystem({
      name: 'pulse',
      every: 250,
      handle: (p) => times.push((p.data as { time: number }).time),
    });
    const main = new World({ tickInterval: 100 });
    main.register(Pulse);
    main.tick(); // t=100
    main.tick(); // t=200
    main.tick(); // t=300 → 触发
    expect(times).toEqual([300]);

    // 主世界已走到 t=300 且刚触发过；沙盒必须继承这个时相，
    // 否则 fork 后第一个 tick 会因 lastRun=0 而立即误触发
    const forked = main.fork();
    times.length = 0;
    forked.tick(); // t=400 → 不该触发
    expect(times).toEqual([]);

    // 与主世界同一步进的结果逐帧一致
    main.tick(); // t=400 → 同样不触发
    expect(times).toEqual([]);
    forked.tick(); // t=500 → 触发
    main.tick(); // t=500 → 触发
    expect(times).toEqual([500, 500]);
  });

  it('性能基线：1000 实体 fork < 100ms（无 COW 的已知限制）', () => {
    const main = new World();
    for (let i = 0; i < 1000; i++) {
      const id = main.entities.createWithId(`e-${i}`);
      main.entities.addComponent(id, Health, { current: i % 100, max: 100 });
      main.entities.addComponent(id, Position, { roomId: `room-${i % 50}` });
    }
    // 性能计时是真实墙钟的合法场景（确定性约束针对的是模拟状态）
    // eslint-disable-next-line no-restricted-syntax
    const start = performance.now();
    const forked = main.fork();
    // eslint-disable-next-line no-restricted-syntax
    const elapsed = performance.now() - start;
    expect(forked.entities.getAll()).toHaveLength(1000);
    expect(elapsed).toBeLessThan(100);
  });
});
