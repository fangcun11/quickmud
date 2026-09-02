/**
 * 0.3 B0 蓝图预制件测试
 */
import { describe, it, expect } from 'vitest';
import { World, trait, blueprint } from './index';

const Health = trait('health', () => ({ current: 100, max: 100 }));
const Position = trait('position', () => ({ roomId: 'hall' }));
const Inventory = trait('inventory', () => ({ items: [] as string[] }));

const Goblin = blueprint({
  name: '哥布林',
  components: [
    [Health, { current: 30, max: 30 }],
    [Position, { roomId: 'cave' }],
  ],
});

describe('B0 蓝图预制件', () => {
  it('spawn 与手写 addComponent 逐组件等价', () => {
    const w = new World();
    const g = w.spawn(Goblin, { id: 'gob-1' });

    // 手写对照
    const h = w.entities.createWithId('gob-manual');
    w.entities.addComponent(h, Health, { current: 30, max: 30 });
    w.entities.addComponent(h, Position, { roomId: 'cave' });
    w.entities.addComponent(h, trait('name'), { text: '哥布林', aliases: [] });

    expect(w.entities.getComponent(g, Health)).toEqual(w.entities.getComponent(h, Health));
    expect(w.entities.getComponent(g, Position)).toEqual(w.entities.getComponent(h, Position));
    expect(w.findEntity('哥布林')).toBe(g); // name 自动挂载可查
  });

  it('patch 覆盖生效且不污染蓝图（蓝图不可变）', () => {
    const w = new World();
    const boss = w.spawn(Goblin, { id: 'king', patch: { health: { current: 200, max: 200 } } });
    const plain = w.spawn(Goblin, { id: 'minion' });

    expect(w.entities.getComponent(boss, Health)).toEqual({ current: 200, max: 200 });
    // 后续 spawn 不受 patch 影响
    expect(w.entities.getComponent(plain, Health)).toEqual({ current: 30, max: 30 });
  });

  it('data 缺省时用 trait 工厂默认值', () => {
    const w = new World();
    const Chest = blueprint({ components: [[Inventory]] });
    const c = w.spawn(Chest);
    expect(w.entities.getComponent(c, Inventory)).toEqual({ items: [] });
  });

  it('同蓝图同 id 两次 spawn 的实体组件数据恒等（确定性）', () => {
    const snapOf = (id: string) => {
      const w = new World();
      w.spawn(Goblin, { id });
      return JSON.stringify(w.createSnapshot().entities);
    };
    expect(snapOf('gob-x')).toBe(snapOf('gob-x'));
  });

  it('空组件蓝图 fail-fast', () => {
    expect(() => blueprint({ components: [] })).toThrow('at least one component');
  });

  it('patch 引用蓝图中不存在的组件时 fail-fast（拼错 trait 名不再静默失效）', () => {
    const w = new World();
    expect(() =>
      w.spawn(Goblin, { id: 'typo', patch: { hp: { current: 1 } } }),
    ).toThrow(/hp/);
    // 正确的键照常工作
    expect(() =>
      w.spawn(Goblin, { id: 'ok', patch: { health: { current: 1 } } }),
    ).not.toThrow();
  });

  it('同蓝图 spawn 的实体组件互不共享引用（改一个不污染另一个）', () => {
    const w = new World();
    const a = w.spawn(Goblin, { id: 'gob-a' });
    const b = w.spawn(Goblin, { id: 'gob-b' });

    // 同蓝图两次 spawn：各自持有独立的数据副本
    expect(w.entities.getComponent(a, Health)).not.toBe(w.entities.getComponent(b, Health));
    w.entities.getComponent(a, Health)!.current = 1;
    expect(w.entities.getComponent(b, Health)!.current).toBe(30);
  });

  it('同一蓝图 spawn 不反向污染蓝图本身（再次 spawn 得到全新数据）', () => {
    const w = new World();
    w.spawn(Goblin, { id: 'x' });
    w.entities.getComponent('x', Health)!.current = 999;
    // 蓝图仍应是 { current: 30 }：spawn 过程不反向改写蓝图对象
    const y = w.spawn(Goblin, { id: 'y' });
    expect(w.entities.getComponent(y, Health)!.current).toBe(30);
  });
});
