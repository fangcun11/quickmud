/**
 * P1-4：延时事件可取消（第二批）
 *
 * 审查发现：ctx.after 无返回句柄、EventPump.schedule 无 cancel——
 * "死亡取消已调度的报复事件"只能靠内容在触发时自查（绕行）。
 *
 * 0.12 定稿：after 返回句柄，ctx.cancel(handle) 取消；
 * 句柄是纯数据（{ id }）可存进组件——快照/回滚/fork 后取消语义保持。
 */
import { describe, it, expect } from 'vitest';
import {
  World,
  trait,
  defineEvent,
  defineSystem,
  createTestWorld,
} from './index';

const Exploded = defineEvent('exploded')<{ room: string }>();
const TrapSet = defineEvent('trap-set')<{ room: string }>();

describe('P1-4 延时事件取消', () => {
  it('ctx.after 返回句柄，ctx.cancel 后到点不再触发；重复取消幂等', () => {
    const fired: string[] = [];
    let handle: { id: number } | undefined;

    const TrapSystem = defineSystem({
      name: 'trap',
      on: [TrapSet],
      handle(event, ctx) {
        handle = ctx.after(300, Exploded, { room: event.data.room });
      },
    });
    const BoomSystem = defineSystem({
      name: 'boom',
      on: [Exploded],
      handle(event) {
        fired.push(event.data.room);
      },
    });

    const w = createTestWorld({ systems: [TrapSystem, BoomSystem], tickInterval: 100 });
    w.emit(TrapSet.token, { room: 'hall' });
    w.runChain();
    expect(handle).toBeDefined();

    expect(w.world.eventPump.cancel(handle!)).toBe(true); // 取消成功
    expect(w.world.eventPump.cancel(handle!)).toBe(false); // 重复取消：幂等无害
    w.advance(500);
    expect(fired).toEqual([]); // 到点也不炸
  });

  it('句柄是纯数据：随快照走，回滚后 cancel 依然有效（确定性）', () => {
    const w = createTestWorld({ tickInterval: 100 });
    const h = w.world.eventPump.schedule(Exploded.token, { room: 'hall' }, 300, w.world.currentTime);

    // 句柄进快照：id 随 ScheduledEventHandle 持久化（PendingEvent.id）
    const snap = w.world.createSnapshot();
    expect(snap.scheduler?.pendingEvents[0]!.id).toBe(h.id);

    // 回滚后：同 id 恢复，原句柄（或等价新句柄对象）可取消
    w.world.rollbackWorld(snap);
    expect(w.world.eventPump.getScheduled()[0]!.id).toBe(h.id);
    expect(w.world.eventPump.cancel(h)).toBe(true);
    w.advance(1000);
    expect(w.world.eventPump.queueLength).toBe(0); // 没有事件因取消而入队
  });

  it('ctx.cancel 经由 SystemContext 可用（句柄存组件的完整用法）', () => {
    const Probe = trait('trap_probe', () => ({ handle: null as { id: number } | null }));
    const fired: string[] = [];

    const BoomSystem = defineSystem({
      name: 'boom',
      on: [Exploded],
      handle(event) {
        fired.push(event.data.room);
      },
    });
    const DefuserSystem = defineSystem({
      name: 'defuser',
      on: [TrapSet],
      handle(event, ctx) {
        for (const id of ctx.findByComponent(Probe)) {
          const probe = ctx.getComponent(id, Probe);
          if (probe?.handle) ctx.cancel(probe.handle); // 句柄从组件里读出来取消
        }
      },
    });

    const w = createTestWorld({ systems: [BoomSystem, DefuserSystem], tickInterval: 100 });
    const holder = w.entities.createWithId('holder');
    w.addComponent(holder, Probe, {
      handle: w.world.eventPump.schedule(Exploded.token, { room: 'hall' }, 300, 0),
    });

    w.emit(TrapSet.token, { room: 'hall' }); // 拆弹系统消费该事件
    w.runChain();
    w.advance(1000);
    expect(fired).toEqual([]);
  });

  it('旧快照（无 id/cancelled 字段）恢复后语义不变、照常触发', () => {
    const fired: string[] = [];
    const BoomSystem = defineSystem({
      name: 'boom',
      on: [Exploded],
      handle(event) {
        fired.push(event.data.room);
      },
    });
    const w = createTestWorld({ systems: [BoomSystem], tickInterval: 100 });
    // 模拟旧版本快照：PendingEvent 只有 token/data/triggerAt
    w.world.eventPump.restoreScheduled([
      { token: Exploded.token, data: { room: 'old' }, triggerAt: 200 },
    ]);
    w.advance(300);
    expect(fired).toEqual(['old']); // 旧档没有取消语义，行为原样保留
  });

  it('World 构造的普通事件 timestamp 与世界时间对齐（P0-2 同源验证）', async () => {
    const seen: number[] = [];
    const Probe = defineSystem({
      name: 'probe',
      on: [Exploded],
      handle(event) {
        seen.push(event.timestamp);
      },
    });
    const w = new World({ tickInterval: 100 });
    w.register(Probe);
    w.tick(); // 世界时间 → 100
    w.eventPump.emit(Exploded.token, { room: 'x' }); // 空闲 emit：同步排水
    expect(seen).toEqual([100]);
  });
});
