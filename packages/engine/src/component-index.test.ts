/**
 * 组件反查索引 + world.each（0.14）
 *
 * 索引是性能优化（flecs query cache 最小版）：语义必须与全表扫描完全一致——
 * 输出恒为**创建序**、内连接语义、快照恢复后自动重建。这批测试用
 * "暴力扫描参照实现"逐点对照，语义回归一目了然。
 */
import { describe, it, expect } from 'vitest';
import { World, trait, defineSystem, defineCommand } from './index';

const Health = trait('health', () => ({ current: 100, max: 100 }));
const Position = trait('position', () => ({ roomId: 'hall' }));
const Inventory = trait('inventory', () => ({ items: [] as string[] }));

/** 参照实现：全表扫描（0.13 及之前的语义） */
function scanByComponent(w: World, componentId: string): string[] {
  const result: string[] = [];
  for (const entity of w.entities.getAll()) {
    if (entity.components.has(componentId)) result.push(entity.id);
  }
  return result;
}

describe('组件反查索引（0.14）', () => {
  it('findByComponent 输出与全表扫描逐点一致（创建序）', () => {
    const w = new World();
    const a = w.entities.create();
    const b = w.entities.createWithId('fixed-b');
    const c = w.entities.create();
    w.addComponent(b, Health);
    w.addComponent(a, Health);
    w.addComponent(c, Position);

    expect(w.findByComponent(Health)).toEqual(scanByComponent(w, Health.id));
    // 创建序：a 先创建（e1），b 后创建（fixed-b）——b 先挂组件不改变创建顺序
    expect(w.findByComponent(Health)).toEqual([a, b]);
    expect(w.findByComponent(Position)).toEqual([c]);
    expect(w.findByComponent(Inventory)).toEqual([]);
  });

  it('重复挂组件（整存替换）不产生重复条目，顺序不变', () => {
    const w = new World();
    const a = w.entities.create();
    const b = w.entities.create();
    w.addComponent(a, Health, { current: 80, max: 100 });
    w.addComponent(b, Health);
    w.addComponent(a, Health, { current: 50, max: 100 }); // 替换

    expect(w.findByComponent(Health)).toEqual([a, b]);
    expect(w.getComponent(a, Health)!.current).toBe(50);
  });

  it('removeComponent / delete 实体后立即从查询中消失', () => {
    const w = new World();
    const a = w.entities.create();
    const b = w.entities.create();
    w.addComponent(a, Health);
    w.addComponent(b, Health);
    w.addComponent(a, Position);

    expect(w.removeComponent(a, Health)).toBe(true);
    expect(w.findByComponent(Health)).toEqual([b]);
    expect(w.removeComponent(a, Health)).toBe(false); // 已摘，再摘返回 false

    expect(w.entities.delete(b)).toBe(true);
    expect(w.findByComponent(Health)).toEqual([]);
    expect(w.entities.has(b)).toBe(false);
  });

  it('delete 挂多组件的实体：从所有组件的查询中同时消失', () => {
    const w = new World();
    const a = w.entities.create();
    w.addComponent(a, Health);
    w.addComponent(a, Position);
    w.addComponent(a, Inventory);

    w.entities.delete(a);
    expect(w.findByComponent(Health)).toEqual([]);
    expect(w.findByComponent(Position)).toEqual([]);
    expect(w.findByComponent(Inventory)).toEqual([]);
  });

  it('rollbackWorld 后索引随快照重建，恢复序 = 快照序（= 原创建序）', () => {
    const w = new World();
    const first = w.entities.create();
    const second = w.entities.create();
    w.addComponent(second, Health);
    w.addComponent(first, Position);

    const snap = w.createSnapshot();

    // 快照后大动干戈：删实体、摘组件、加新实体
    w.entities.delete(first);
    w.removeComponent(second, Health);
    const extra = w.entities.create();
    w.addComponent(extra, Health);

    w.rollbackWorld(snap);

    expect(w.findByComponent(Health)).toEqual(scanByComponent(w, Health.id));
    expect(w.findByComponent(Health)).toEqual([second]);
    expect(w.findByComponent(Position)).toEqual([first]);
    expect(w.findByComponent(Health)).not.toContain(extra);
  });

  it('fork 后索引与主世界一致（fork 走快照恢复路径）', () => {
    const main = new World();
    const a = main.entities.create();
    const b = main.entities.create();
    main.addComponent(a, Health);
    main.addComponent(b, Position);

    const forked = main.fork();
    expect(forked.findByComponent(Health)).toEqual([a]);
    expect(forked.findByComponent(Position)).toEqual([b]);

    // 隔离：fork 里删除不影响主世界索引
    forked.entities.delete(a);
    expect(main.findByComponent(Health)).toEqual([a]);
    expect(forked.findByComponent(Health)).toEqual([]);
  });

  it('findByComponents 多组件内连接，与全表扫描参照一致', () => {
    const w = new World();
    const a = w.entities.create(); // Health + Position
    const b = w.entities.create(); // Health only
    const c = w.entities.create(); // Health + Position + Inventory
    const d = w.entities.create(); // Position only
    w.addComponent(a, Health);
    w.addComponent(a, Position);
    w.addComponent(b, Health);
    w.addComponent(c, Health);
    w.addComponent(c, Position);
    w.addComponent(c, Inventory);
    w.addComponent(d, Position);

    const both = w.entities.findByComponents(Health, Position);
    expect(both).toEqual([a, c]);
    expect(both).toEqual(
      scanByComponent(w, Health.id).filter((id) =>
        w.entities.get(id)!.components.has(Position.id)
      )
    );
    const all = w.entities.findByComponents(Health, Position, Inventory);
    expect(all).toEqual([c]);
  });

  it('findByComponents 空参保持既有语义：返回全部实体（创建序）', () => {
    const w = new World();
    const a = w.entities.create();
    const b = w.entities.create();
    expect(w.entities.findByComponents()).toEqual([a, b]);
  });

  it('大规模正确性压测：1000 实体随机挂/摘后与参照一致', () => {
    const w = new World();
    const ids: string[] = [];
    for (let i = 0; i < 1000; i++) {
      const id = w.entities.create();
      ids.push(id);
      if (i % 3 === 0) w.addComponent(id, Health);
      if (i % 5 === 0) w.addComponent(id, Position);
    }
    // 摘掉一部分
    for (let i = 0; i < 1000; i += 6) {
      if (w.hasComponent(ids[i]!, Health)) w.removeComponent(ids[i]!, Health);
    }
    // 删掉一部分
    for (let i = 0; i < 1000; i += 10) w.entities.delete(ids[i]!);

    expect(w.findByComponent(Health)).toEqual(scanByComponent(w, Health.id));
    expect(w.findByComponent(Position)).toEqual(scanByComponent(w, Position.id));
    const both = w.entities.findByComponents(Health, Position);
    expect(both).toEqual(
      scanByComponent(w, Health.id).filter((id) =>
        w.entities.get(id)!.components.has(Position.id)
      )
    );
  });
});

describe('world.each / ctx.each（0.14）', () => {
  it('内连接：缺任一组件的实体跳过，数据按组件顺序展开', () => {
    const w = new World();
    const a = w.entities.create();
    const b = w.entities.create();
    const c = w.entities.create();
    w.addComponent(a, Health, { current: 10, max: 20 });
    w.addComponent(a, Position, { roomId: 'hall' });
    w.addComponent(b, Health, { current: 30, max: 40 }); // 无 Position → 跳过
    w.addComponent(c, Position, { roomId: 'yard' }); // 无 Health → 跳过

    const seen: Array<[string, number, string]> = [];
    w.each([Health, Position], (id, hp, pos) => {
      seen.push([id, hp.current, pos.roomId]);
    });
    expect(seen).toEqual([['e1', 10, 'hall']]);
    expect(seen[0]![0]).toBe(a);

    // 交换组件顺序 → 数据顺序随之交换
    const flipped: Array<[string, string, number]> = [];
    w.each([Position, Health], (id, pos, hp) => {
      flipped.push([id, pos.roomId, hp.current]);
    });
    expect(flipped).toEqual([[a, 'hall', 10]]);
  });

  it('回调收到活引用：原地改数据即改世界状态', () => {
    const w = new World();
    const a = w.entities.create();
    w.addComponent(a, Health, { current: 10, max: 20 });
    w.addComponent(a, Position);

    w.each([Health], (_id, hp) => {
      hp.current = hp.max;
    });
    expect(w.getComponent(a, Health)!.current).toBe(20);
  });

  it('迭代顺序为创建序（与 findByComponent 一致）', () => {
    const w = new World();
    const a = w.entities.create();
    const b = w.entities.create();
    const c = w.entities.create();
    w.addComponent(c, Health); // c 最先挂组件，但创建序仍是 a, b, c
    w.addComponent(a, Health);
    w.addComponent(b, Health);

    const order: string[] = [];
    w.each([Health], (id) => order.push(id));
    expect(order).toEqual([a, b, c]);
  });

  it('空命中不调用回调；单组件即全量扫描的等价形式', () => {
    const w = new World();
    const a = w.entities.create();
    w.addComponent(a, Inventory, { items: ['rope'] });

    let calls = 0;
    w.each([Health], () => calls++);
    expect(calls).toBe(0);

    const seen: string[] = [];
    w.each([Inventory], (id, inv) => {
      calls++;
      if (inv.items.includes('rope')) seen.push(id);
    });
    expect(calls).toBe(1);
    expect(seen).toEqual([a]);
  });

  it('系统侧 ctx.each 可用（类型贯通，无需断言）', () => {
    expect.assertions(3);
    const TotalHealed = defineSystem({
      name: 'total-healed',
      on: ['heal-all'],
      handle(_event, ctx) {
        let total = 0;
        let count = 0;
        ctx.each([Health], (_id, hp) => {
          total += hp.current;
          count++;
        });
        expect(count).toBe(2);
        expect(total).toBe(30);
      },
    });

    const w = new World();
    w.register(TotalHealed);
    const a = w.entities.create();
    const b = w.entities.create();
    w.addComponent(a, Health, { current: 10, max: 20 });
    w.addComponent(b, Health, { current: 20, max: 20 });
    w.eventPump.emit('heal-all', {});
    expect(w.entities.size).toBe(2);
  });

  it('命令侧 world.each 可用（只读惯例）', async () => {
    const CountCmd = defineCommand({
    describe: '测试用命令',
      verbs: ['count'],
      handle({ world, output }) {
        let count = 0;
        world.each([Health], (id, hp) => {
          if (hp.current < 50) count++;
        });
        output.status({ wounded: count });
        return null;
      },
    });

    const w = new World();
    w.registerCommands(CountCmd);
    const a = w.entities.create();
    w.addComponent(a, Health, { current: 10, max: 20 });
    const b = w.entities.create();
    w.addComponent(b, Health, { current: 100, max: 100 });

    await w.execute('count', a);
    const status = w.output.ofKind('status');
    expect(status.length).toBeGreaterThan(0);
    expect(status[status.length - 1]!.meta).toEqual({ wounded: 1 });
  });
});
