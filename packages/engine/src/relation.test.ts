/**
 * 关系系统测试（0.15）
 *
 * 关系 = 多目标组件（`{ targets: EntityId[] }`）+ 二级反查索引。
 * 测试覆盖规格的全部决策点：幂等、活实体校验、拷贝语义、索引一致性、
 * 悬挂保留（删除不级联）、快照/回滚/fork 的索引重建、三层同名。
 */
import { describe, it, expect } from 'vitest';
import { World, trait, relation, defineSystem, defineCommand, Name } from './index';

const Located = trait('located', () => ({ roomId: 'hall' })); // 干扰项：普通组件
const ChildOf = relation('child_of');
const Knows = relation('knows');

describe('relation() 定义', () => {
  it('与 trait 同表查重：关系与组件哈希撞车 fail-fast', () => {
    // djb2 实测碰撞对（v0.11 用例复用）：先注册 trait 占住 id，
    // 同 ID 不同名的关系定义必须当场爆炸
    trait('comp_1r_x', { x: 0 });
    expect(() => relation('comp_30_x')).toThrow(/冲突|collision/);
  });

  it('同名重复调用幂等（同一 id、独立实例）', () => {
    const a = relation('kinship');
    const b = relation('kinship');
    expect(a.id).toBe(b.id);
    expect(a.create()).toEqual({ targets: [] });
  });
});

describe('addRelation / removeRelation', () => {
  it('基本流：加 → 有 → 查 → 删 → 无', () => {
    const w = new World();
    const alice = w.entities.createWithId('alice');
    const bob = w.entities.createWithId('bob');
    w.entities.create(); // 无关实体

    w.addRelation(alice, ChildOf, bob);
    expect(w.hasRelation(alice, ChildOf, bob)).toBe(true);
    expect(w.getRelations(alice, ChildOf)).toEqual([bob]);
    expect(w.findRelated(ChildOf, bob)).toEqual([alice]);

    expect(w.removeRelation(alice, ChildOf, bob)).toBe(true);
    expect(w.hasRelation(alice, ChildOf, bob)).toBe(false);
    expect(w.getRelations(alice, ChildOf)).toEqual([]);
    expect(w.findRelated(ChildOf, bob)).toEqual([]);
  });

  it('幂等：同一 (source, target) 重复 add 不产生重复条目', () => {
    const w = new World();
    const a = w.entities.create();
    const b = w.entities.create();
    w.addRelation(a, ChildOf, b);
    w.addRelation(a, ChildOf, b);
    w.addRelation(a, ChildOf, b);
    expect(w.getRelations(a, ChildOf)).toEqual([b]);
    expect(w.findRelated(ChildOf, b)).toEqual([a]);
  });

  it('fail-fast：目标不存在抛错；来源不存在抛错', () => {
    const w = new World();
    const a = w.entities.create();
    expect(() => w.addRelation(a, ChildOf, 'ghost')).toThrow(/does not exist|活实体/);
    expect(() => w.addRelation('ghost', ChildOf, a)).toThrow(/not found/);
  });

  it('多对多：一个来源挂多目标、多来源指同一目标，互不干扰', () => {
    const w = new World();
    const p1 = w.entities.createWithId('p1');
    const p2 = w.entities.createWithId('p2');
    const c1 = w.entities.createWithId('c1');
    const c2 = w.entities.createWithId('c2');

    w.addRelation(c1, ChildOf, p1);
    w.addRelation(c1, ChildOf, p2); // 一个来源多目标
    w.addRelation(c2, ChildOf, p1); // 多来源同目标

    expect(w.getRelations(c1, ChildOf)).toEqual([p1, p2]);
    expect(w.findRelated(ChildOf, p1)).toEqual([c1, c2]);
    expect(w.findRelated(ChildOf, p2)).toEqual([c1]);

    // 摘掉一条不影响其他
    w.removeRelation(c1, ChildOf, p1);
    expect(w.findRelated(ChildOf, p1)).toEqual([c2]);
    expect(w.findRelated(ChildOf, p2)).toEqual([c1]);
  });

  it('不同关系各自独立；与同 id 普通组件数据互不干扰', () => {
    const w = new World();
    const a = w.entities.create();
    const b = w.entities.create();
    w.addRelation(a, ChildOf, b);
    w.addRelation(b, Knows, a);

    expect(w.getRelations(a, ChildOf)).toEqual([b]);
    expect(w.getRelations(a, Knows)).toEqual([]);
    expect(w.hasRelation(b, Knows, a)).toBe(true);
    expect(w.hasRelation(b, ChildOf, a)).toBe(false);
  });

  it('removeRelation 删最后一条：关系组件整个摘掉（findByComponent 反映）', () => {
    const w = new World();
    const a = w.entities.create();
    const b = w.entities.create();
    w.addRelation(a, ChildOf, b);
    expect(w.findByComponent(ChildOf)).toEqual([a]); // 有关系 = 有组件

    w.removeRelation(a, ChildOf, b);
    expect(w.findByComponent(ChildOf)).toEqual([]); // 零关系 = 零组件
    expect(w.hasComponent(a, ChildOf)).toBe(false);
  });

  it('removeComponent 直接摘关系组件：findRelated 同步清空', () => {
    const w = new World();
    const a = w.entities.create();
    const b = w.entities.create();
    w.addRelation(a, ChildOf, b);
    w.removeComponent(a, ChildOf);
    expect(w.findRelated(ChildOf, b)).toEqual([]);
  });

  it('getRelations 返回拷贝：改返回值不影响世界与索引', () => {
    const w = new World();
    const a = w.entities.create();
    const b = w.entities.create();
    w.addRelation(a, ChildOf, b);

    const list = w.getRelations(a, ChildOf);
    list.push('e999'); // 想绕过 API？没门
    expect(w.getRelations(a, ChildOf)).toEqual([b]);
    expect(w.findRelated(ChildOf, 'e999')).toEqual([]);
  });
});

describe('删除与悬挂（不级联铁律）', () => {
  it('来源被删：findRelated 不再包含；目标被删：条目悬挂保留', () => {
    const w = new World();
    const parent = w.entities.createWithId('parent');
    const child1 = w.entities.createWithId('child1');
    const child2 = w.entities.createWithId('child2');
    w.addRelation(child1, ChildOf, parent);
    w.addRelation(child2, ChildOf, parent);

    // 删一个来源：索引即时摘除
    w.entities.delete(child1);
    expect(w.findRelated(ChildOf, parent)).toEqual([child2]);

    // 删目标：不级联，幸存来源的指向保留（悬挂）
    w.entities.delete(parent);
    expect(w.findRelated(ChildOf, parent)).toEqual([child2]);
    expect(w.getRelations(child2, ChildOf)).toEqual([parent]);
    expect(w.hasRelation(child2, ChildOf, parent)).toBe(true);
  });
});

describe('快照 / 回滚 / fork', () => {
  it('回滚后 findRelated 与快照时逐点一致（索引全量重建）', () => {
    const w = new World();
    const parent = w.entities.createWithId('parent');
    const child = w.entities.createWithId('child');
    w.addRelation(child, ChildOf, parent);
    const snap = w.createSnapshot();

    // 快照后大动干戈（x1 是快照后新建的实体——回滚后应消失）
    const x1 = w.entities.createWithId('x1');
    w.addRelation(child, ChildOf, x1);
    const extra = w.entities.create();
    w.addRelation(extra, ChildOf, parent);
    w.removeRelation(child, ChildOf, parent);

    w.rollbackWorld(snap);

    expect(w.findRelated(ChildOf, parent)).toEqual([child]);
    expect(w.findRelated(ChildOf, 'x1')).toEqual([]);
    expect(w.hasRelation(child, ChildOf, parent)).toBe(true);
    expect(w.hasRelation(child, ChildOf, 'x1')).toBe(false);
    expect(w.findByComponent(ChildOf)).toEqual([child]); // extra 的关系随实体消失
  });

  it('fork 后关系索引与主世界一致且相互隔离', () => {
    const main = new World();
    const parent = main.entities.createWithId('parent');
    const child = main.entities.createWithId('child');
    main.addRelation(child, ChildOf, parent);

    const forked = main.fork();
    expect(forked.findRelated(ChildOf, parent)).toEqual([child]);

    forked.addRelation(parent, Knows, child); // fork 里加
    forked.removeRelation(child, ChildOf, parent); // fork 里删
    expect(forked.findRelated(ChildOf, parent)).toEqual([]);
    expect(forked.findRelated(Knows, child)).toEqual([parent]);

    // 主世界纹丝不动
    expect(main.findRelated(ChildOf, parent)).toEqual([child]);
    expect(main.findRelated(Knows, child)).toEqual([]);
  });
});

describe('三层同名', () => {
  it('系统侧 ctx 五件可用（写特权）', () => {
    expect.assertions(5);
    const Greet = defineSystem({
      name: 'greet',
      on: ['meet'],
      handle(event, ctx) {
        ctx.addRelation(event.data.a, Knows, event.data.b);
        expect(ctx.hasRelation(event.data.a, Knows, event.data.b)).toBe(true);
        expect(ctx.getRelations(event.data.a, Knows)).toEqual([event.data.b]);
        expect(ctx.findRelated(Knows, event.data.b)).toEqual([event.data.a]);
        expect(ctx.removeRelation(event.data.a, Knows, event.data.b)).toBe(true);
        expect(ctx.hasRelation(event.data.a, Knows, event.data.b)).toBe(false);
      },
    });
    const w = new World();
    w.register(Greet);
    const a = w.entities.create();
    const b = w.entities.create();
    w.eventPump.emit('meet', { a, b });
  });

  it('命令侧 world 只读三件可用', async () => {
    const WhoCmd = defineCommand({
      verbs: ['who'],
      args: { name: { type: 'word' } },
      handle({ args, world, output }) {
        const target = world.findEntity(args.name);
        if (!target) return '查无此人';
        const relations = world.findRelated(ChildOf, target);
        output.status({ children: relations.length });
        return null;
      },
    });
    const w = new World();
    w.registerCommands(WhoCmd);
    const parent = w.entities.create();
    w.addComponent(parent, Located, { roomId: 'hall' });
    w.addComponent(parent, Name, { text: '老王' });
    const child = w.entities.create();
    w.addRelation(child, ChildOf, parent);

    await w.execute('who 老王', child);
    const status = w.output.ofKind('status');
    expect(status[status.length - 1]!.meta).toEqual({ children: 1 });
  });
});
