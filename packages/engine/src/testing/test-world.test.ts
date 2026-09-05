/**
 * 手动时钟与测试世界时间推进（v0.6-B）
 *
 * 背景：API 评审 P1-4 —— `ManualClock.advance(ms)` 曾只改自己的计数器，
 * 与世界时间毫无连接，README 的"手动时钟，确定性测试"是空头支票。
 * 本文件锁死"advance 真的驱动世界"这一契约。
 */
import { describe, it, expect, vi } from 'vitest';
import { ManualClock, createTestWorld, TestWorld } from './test-world';
import { defineSystem } from '../systems/define-system';
import { defineEvent } from '../events/define-event';
import { defineCommand } from '../commands/define-command';
import { trait } from '../core/trait';

const Counter = trait('counter', () => ({ value: 0 }));

describe('ManualClock / TestWorld 时间推进', () => {
  it('clock.advance(ms) 推进世界时间（此前是空承诺）', () => {
    const clock = new ManualClock();
    const tw = createTestWorld({ clock, tickInterval: 100 });

    clock.advance(500);

    expect(tw.world.currentTime).toBe(500);
    expect(clock.now()).toBe(500);
  });

  it('clock.advance 驱动 every 周期系统（按世界时间网格触发）', () => {
    const clock = new ManualClock();
    const handler = vi.fn();
    const tw = createTestWorld({
      clock,
      tickInterval: 100,
      systems: [defineSystem({ name: 'pulse', every: 1000, handle: handler })],
    });

    clock.advance(3000);

    // 网格点 1000 / 2000 / 3000 → 3 次（tickInterval=100 精确落在网格上）
    expect(handler).toHaveBeenCalledTimes(3);
    expect(tw.world.currentTime).toBe(3000);
  });

  it('TestWorld.tick(n) 推进 n 个 tick 并同步 clock', () => {
    const clock = new ManualClock();
    const tw = createTestWorld({ clock, tickInterval: 250 });

    tw.tick(4);

    expect(tw.world.currentTime).toBe(1000);
    expect(clock.now()).toBe(1000);
  });

  it('interval 不整除：世界时间取上整，clock 与世界保持一致', () => {
    const clock = new ManualClock();
    const tw = createTestWorld({ clock, tickInterval: 300 });

    clock.advance(1000); // 1000/300 → 4 tick = 1200

    expect(tw.world.currentTime).toBe(1200);
    expect(clock.now()).toBe(1200);
  });

  it('advance 多次调用可累加（世界时间单调）', () => {
    const clock = new ManualClock();
    const tw = createTestWorld({ clock, tickInterval: 100 });

    clock.advance(300);
    clock.advance(200);

    expect(tw.world.currentTime).toBe(500);
  });

  it('独立 ManualClock（未绑定世界）仍是纯计数器，行为不变', () => {
    const clock = new ManualClock();

    clock.advance(500);
    expect(clock.now()).toBe(500);

    clock.reset();
    expect(clock.now()).toBe(0);
  });

  it('clock.reset() 后再次 advance 从当前世界时间续推', () => {
    const clock = new ManualClock();
    const tw = createTestWorld({ clock, tickInterval: 100 });

    clock.advance(200);
    clock.reset(); // 只重置 clock 自身计数，世界时间不动
    clock.advance(300);

    expect(tw.world.currentTime).toBe(500);
  });

  it('tickInterval <= 0 显式报错，绝不退化成死循环', () => {
    const clock = new ManualClock();
    new TestWorld({ clock, tickInterval: 0 });

    expect(() => clock.advance(100)).toThrow(/tickInterval/);
  });

  it('默认 tickInterval 下 advance 仍然可用', () => {
    const clock = new ManualClock();
    const tw = createTestWorld({ clock });

    clock.advance(1000);

    expect(tw.world.currentTime).toBeGreaterThanOrEqual(1000);
    expect(tw.world.currentTime % 500).toBe(0); // 引擎默认 tickInterval = 500
  });

  it('推进世界后组件状态可被系统读到（端到端）', () => {
    const ticker = defineSystem({
      name: 'counter-bump',
      every: 100,
      handle(_payload, ctx) {
        for (const id of ctx.findByComponent(Counter)) {
          const c = ctx.getComponent(id, Counter)!;
          c.value += 1;
        }
      },
    });
    const tw = createTestWorld({ tickInterval: 100, systems: [ticker] });
    const e = tw.entities.createWithId('e');
    tw.addComponent(e, Counter, { value: 0 });

    tw.advance(500);

    expect(tw.getComponent(e, Counter)?.value).toBe(5);
  });
});

describe('P1-5 TestWorld 探针增强（0.12）', () => {
  const Ping = defineEvent('ping')<{ n: number }>();
  const Pong = defineEvent('pong')<{ n: number }>();
  const Health = trait('health', () => ({ current: 10, max: 10 }));

  const Echo = defineSystem({
    name: 'echo',
    on: [Ping],
    handle(event, ctx) {
      ctx.emit(Pong, { n: event.data.n * 2 });
    },
  });

  const Hi = defineCommand({
    describe: '测试用命令',
    verbs: ['hi'],
    handle: () => '你好',
  });

  it('emit 接受 EventDefinition（类型贯通），token 形态行为不变', () => {
    const w = createTestWorld({ systems: [Echo] });

    w.emit(Ping, { n: 21 });
    w.runChain();

    expect(w.getLog()).toEqual(['ping', 'pong']);
  });

  it('run(input, player) 直通 world.execute，不再需要两跳', async () => {
    const w = createTestWorld({ commands: [Hi] });
    const p = w.entities.createWithId('p');

    expect(await w.run('hi', p)).toBe('你好');
  });

  it('emitImmediate 路径也进 eventLog（此前 DFS 传播对日志隐形）', () => {
    const w = createTestWorld();

    w.world.eventPump.emitImmediate('immediate', {});

    expect(w.getLog()).toContain('immediate');
  });

  it('元组夹具走 addComponent 正路，data 省略时用组件默认值', () => {
    const w = createTestWorld({
      entities: [
        { id: 'a', components: [[Health, { current: 5 }]] },
        { id: 'b', components: [[Health]] },
      ],
    });

    // addComponent 语义：data 整存替换，不与默认值深合并（补丁合并请用 blueprint）
    expect(w.getComponent('a', Health)).toEqual({ current: 5 });
    expect(w.getComponent('b', Health)).toEqual({ current: 10, max: 10 });
  });

  it('TestWorld.wrap/fromWorld 给 fork 世界装探针，继承件照常可用', async () => {
    const base = createTestWorld({ systems: [Echo], commands: [Hi] });
    const forked = base.world.fork();

    const probe = TestWorld.wrap(forked);
    probe.emit(Ping, { n: 3 });
    probe.runChain();
    expect(probe.getLog()).toEqual(['ping', 'pong']); // 探针拦截生效

    const p = probe.entities.createWithId('p');
    expect(await probe.run('hi', p)).toBe('你好'); // fork 继承的命令可用

    expect(TestWorld.fromWorld(forked)).toBeInstanceOf(TestWorld);
  });
});
