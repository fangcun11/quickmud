/**
 * A1 定时系统测试：every 周期系统 + ctx.after 延时事件 + 快照 round-trip
 */
import { describe, it, expect, vi } from 'vitest';
import { World, TICK_TOKEN } from './core/world';
import { trait } from './core/trait';
import { defineEvent } from './events/define-event';
import { defineSystem } from './systems/define-system';
import type { SnapshotData } from './persistence/types';

const Counter = trait('counter', () => ({ value: 0 }));
const Ticked = defineEvent('ticked')<{ time: number }>();
const Boom = defineEvent('boom')<{ target: string }>();

describe('A1 定时系统', () => {
  it('every 系统：tick 按间隔触发，次数精确', () => {
    const handler = vi.fn();
    const w = new World({ tickInterval: 100 });
    w.register(defineSystem({ name: 'pulse', every: 250, handle: handler }));
    // lastRun 初值 = -tickInterval，第一次 tick 即满足 250 间隔
    w.tick(); // t=100, 100-(-100)=200 < 250? 初值实现为 timeMs - tickInterval = 0 → 100-0=100 <250 不触发
    w.tick(); // t=200, 200-0=200 <250 不触发
    w.tick(); // t=300, 300-0=300>=250 触发
    w.tick(); // t=400, 400-300=100 不触发
    w.tick(); // t=500, 500-300=200 不触发
    w.tick(); // t=600, 600-300=300>=250 触发
    expect(handler).toHaveBeenCalledTimes(2);
    const [payload] = handler.mock.calls[0]!;
    expect(payload.token).toBe(TICK_TOKEN);
    expect(payload.data.time).toBe(300);
  });

  it('ctx.after：延时事件到期才触发，同刻按调度顺序', () => {
    const order: string[] = [];
    const w = new World({ tickInterval: 100 });
    const Alarm = defineEvent('alarm')<{ label: string }>();
    w.register(
      defineSystem({
        name: 'listen',
        on: [Alarm.token],
        handle(event) {
          order.push(event.data.label);
        },
      }),
    );
    w.register(
      defineSystem({
        name: 'setter',
        on: [Boom.token],
        handle(_event, ctx) {
          // 同刻调度两个：A 先入队
          ctx.after(250, Alarm.token, { label: 'A' });
          ctx.after(250, Alarm.token, { label: 'B' });
        },
      }),
    );
    const p = w.entities.createWithId('p');
    w.entities.addComponent(p, Counter, { value: 0 });

    w.eventPump.emit(Boom.token, { target: p }); // t=0 调度
    expect(order).toEqual([]); // 尚未到期

    w.tick(); // t=100
    w.tick(); // t=200
    expect(order).toEqual([]);
    w.tick(); // t=300 到期
    expect(order).toEqual(['A', 'B']); // 同刻按调度顺序，确定性
  });

  it('快照 round-trip：未触发的延时事件随快照恢复，不丢失不重复', () => {
    const w = new World({ tickInterval: 100 });
    const got: string[] = [];
    w.register(defineSystem({
      name: 'listen',
      on: [Ticked.token],
      handle(event) {
        got.push(event.data.time.toString());
      },
    }));
    w.register(defineSystem({
      name: 'setter',
      on: [Boom.token],
      handle(_e, ctx) {
        ctx.after(500, Ticked.token, { time: 1 });
      },
    }));
    const p = w.entities.createWithId('p');
    w.entities.addComponent(p, Counter, { value: 0 });
    w.eventPump.emit(Boom.token, { target: p });

    const snap = w.createSnapshot();
    expect(snap.scheduler.pendingEvents).toHaveLength(1);

    // 回滚：改状态+再调度，回滚后应回到快照时刻的调度状态
    w.rollbackWorld(snap);
    expect(w.eventPump.getScheduled()).toHaveLength(1);
    expect(w.getSystemErrors()).toHaveLength(0);

    w.tick(); w.tick(); w.tick(); w.tick(); // t=400 未到期
    expect(got).toEqual([]);
    w.tick(); // t=500 到期
    expect(got).toEqual(['1']);
  });

  it('0.1 旧存档（无 worldTime/scheduler 字段）可加载', () => {
    const w = new World({ tickInterval: 100 });
    const oldSave: SnapshotData = {
      engineVersion: '0.1.0',
      tickCount: 5,
      registry: {},
      entities: [],
      scheduler: { pendingEvents: [] },
    };
    w.rollbackWorld(oldSave);
    expect(w.getTickCount()).toBe(5);
    expect(w.currentTime).toBe(0);
    expect(w.eventPump.getScheduled()).toEqual([]);
  });

  it('every 系统时相由世界时间派生：回滚后重放同一段时间，触发时刻一致', () => {
    const w = new World({ tickInterval: 100 });
    const times: number[] = [];
    w.register(defineSystem({
      name: 'pulse',
      every: 250,
      handle: (p) => times.push((p.data as { time: number }).time),
    }));

    w.tick(); // t=100
    w.tick(); // t=200
    const snap = w.createSnapshot();
    w.tick(); // t=300 → 触发
    expect(times).toEqual([300]);

    // 回滚到 t=200 再走一遍同样的 tick，必须复现同样的触发
    // （every 时相若游离在快照之外，回滚后会静默失联）
    w.rollbackWorld(snap);
    times.length = 0;
    w.tick(); // t=300
    expect(times).toEqual([300]);
  });

  it('every 系统按固定时间网格触发（drift-free）', () => {
    const w = new World({ tickInterval: 100 });
    const times: number[] = [];
    w.register(defineSystem({
      name: 'pulse',
      every: 250,
      handle: (p) => times.push((p.data as { time: number }).time),
    }));
    for (let i = 0; i < 10; i++) w.tick(); // t=100..1000
    // 网格点 250/500/750/1000 各自被"跨过它的第一个 tick"承接。
    // 10 个 tick（共 1000ms）内恰好触发 1000/250 = 4 次，无漂移；
    // 旧的"自上次触发起算"语义只会触发 3 次（300/600/900，间隔漂移到 300）
    expect(times).toEqual([300, 500, 800, 1000]);
  });

  it('every 系统 + onError degrade：出错后被摘除，后续 tick 不再执行', () => {
    const calls = vi.fn();
    const w = new World({ tickInterval: 100 });
    w.register(defineSystem({
      name: 'bad',
      every: 100,
      onError: 'degrade',
      handle() {
        calls();
        throw new Error('tick boom');
      },
    }));
    w.tick(); // 触发并报错 → 隔离
    expect(calls).toHaveBeenCalledTimes(1);
    expect(w.getSystemErrors()).toHaveLength(1);
    w.tick(); w.tick();
    expect(calls).toHaveBeenCalledTimes(1); // 不再执行
  });

  it('R2: 事件预算按 tick 重置（纯 tick 长跑不因累计超限崩溃）', () => {
    const w = new World({ tickInterval: 100, maxEventsPerCommand: 3 });
    w.register(defineSystem({
      name: 'noisy',
      every: 100,
      handle: (_p, ctx) => {
        ctx.emit('noise', { n: 1 });
      },
    }));
    // 修复前：事件计数在命令间不归零，第 4 个 tick 即抛 budget exceeded
    expect(() => {
      for (let i = 0; i < 10; i++) w.tick();
    }).not.toThrow();
  });

  it('R2: 单个 tick 内仍受预算约束（每 tick 独立预算而非无上限）', () => {
    const w = new World({ tickInterval: 100, maxEventsPerCommand: 3 });
    w.register(defineSystem({
      name: 'flood',
      every: 100,
      handle: (_p, ctx) => {
        for (let i = 0; i < 4; i++) ctx.emit('noise', { n: i });
      },
    }));
    expect(() => w.tick()).toThrow(/Event budget exceeded/);
  });
});
