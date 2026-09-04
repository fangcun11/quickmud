/**
 * entity_destroyed 合成事件测试（0.14）
 *
 * 契约：delete / ctx.destroy 成功删除 → 引擎自动发射 entity_destroyed；
 * clear()（回滚 / fork / 读档的重建路径）静默，绝不误发。
 */
import { describe, it, expect } from 'vitest';
import { World, trait, defineSystem, defineEvent, EntityDestroyed } from './index';

const Health = trait('health', () => ({ current: 100, max: 100 }));
const Corpse = trait('corpse', () => ({ of: '' }));

const Kill = defineEvent('kill')<{ target: string }>();

describe('entity_destroyed 合成事件（0.14）', () => {
  it('entities.delete 成功 → 事件发射，载荷为 { id }', () => {
    const seen: unknown[] = [];
    const w = new World();
    w.register(
      defineSystem({ name: 'watch', on: [EntityDestroyed], handle: (e) => void seen.push(e.data) })
    );

    const a = w.entities.create();
    w.addComponent(a, Health);
    expect(w.entities.delete(a)).toBe(true);
    expect(seen).toEqual([{ id: a }]);
  });

  it('删除不存在的实体 → 不发事件', () => {
    const seen: unknown[] = [];
    const w = new World();
    w.register(
      defineSystem({ name: 'watch', on: [EntityDestroyed], handle: (e) => void seen.push(e.data) })
    );

    expect(w.entities.delete('ghost')).toBe(false);
    expect(seen).toEqual([]);
  });

  it('系统内 ctx.destroy → 同样发射（订阅者立即感知）', () => {
    const w = new World();
    const KillHandler = defineSystem({
      name: 'kill',
      on: [Kill],
      handle(event, ctx) {
        expect(ctx.destroy(event.data.target)).toBe(true);
      },
    });
    const Reap = defineSystem({
      name: 'reap',
      on: [EntityDestroyed],
      handle(event, ctx) {
        // 事件分发时实体已亡：组件读不到——这是契约的一部分
        expect(ctx.getComponent(event.data.id, Health)).toBeUndefined();
        ctx.spawn({ components: [{ trait: Corpse, data: { of: event.data.id } }] });
      },
    });
    w.register(KillHandler, Reap);

    const victim = w.entities.create();
    w.addComponent(victim, Health);
    w.eventPump.emit(Kill.token, { target: victim });

    expect(w.entities.has(victim)).toBe(false);
    const corpses = w.findByComponent(Corpse);
    expect(corpses).toHaveLength(1);
    expect(w.getComponent(corpses[0]!, Corpse)!.of).toBe(victim);
  });

  it('clear() 静默：回滚路径不误发', () => {
    const seen: unknown[] = [];
    const w = new World();
    w.register(
      defineSystem({ name: 'watch', on: [EntityDestroyed], handle: (e) => void seen.push(e.data) })
    );

    const a = w.entities.create();
    w.addComponent(a, Health);
    w.entities.clear(); // rollbackWorld 的第一步就是 clear
    expect(seen).toEqual([]);
  });

  it('rollbackWorld 全程不误发（即使快照不含当前实体）', () => {
    const seen: unknown[] = [];
    const w = new World();
    w.register(
      defineSystem({ name: 'watch', on: [EntityDestroyed], handle: (e) => void seen.push(e.data) })
    );

    const a = w.entities.create();
    w.addComponent(a, Health);
    const snap = w.createSnapshot();

    const b = w.entities.create(); // 快照之后新增的实体，快照里没有
    w.addComponent(b, Health);
    w.rollbackWorld(snap); // b 会被 clear 清掉——但不是"销毁"

    expect(w.entities.has(b)).toBe(false);
    expect(w.entities.has(a)).toBe(true);
    expect(seen).toEqual([]);
  });

  it('fork 过程不误发；fork 世界内删除事件只走 fork 自己的泵', () => {
    const seen: unknown[] = [];
    // fork 复用系统定义（同一 handle 闭包），seen 由主/分叉世界共享——
    // 用条目数量区分事件来自哪个泵：fork 重建零误发，fork 世界内真实
    // 删除恰好贡献一条
    const watch = defineSystem({
      name: 'watch',
      on: [EntityDestroyed],
      handle: (e) => void seen.push(e.data),
    });
    const main = new World();
    main.register(watch);
    const a = main.entities.create();
    main.addComponent(a, Health);

    const forked = main.fork();
    expect(seen).toEqual([]); // fork 重建静默

    forked.entities.delete(a); // 分叉世界里真的删
    expect(seen).toEqual([{ id: a }]); // 分叉泵驱动（继承的）watch 恰好一次

    // 主世界实体未被波及（fork 是深拷贝）
    expect(main.entities.has(a)).toBe(true);
    expect(main.findByComponent(Health)).toEqual([a]);
  });

  it('与事件预算协同：删除风暴受 maxEventsPerCommand 约束', () => {
    const w = new World({ maxEventsPerCommand: 5 });
    const ids = Array.from({ length: 10 }, () => w.entities.create());
    // 每次 delete 消耗 1 预算，第 6 次 emit 时抛预算超限
    // （状态先落地再通知：抛错时该实体已删，通知随预算中止）
    expect(() => {
      for (const id of ids) w.entities.delete(id);
    }).toThrow(/Event budget exceeded/);
    expect(w.entities.size).toBe(4);
  });
});
