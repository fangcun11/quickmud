import { describe, it, expect } from 'vitest';
import { createTestWorld, ManualClock } from './testing';
import { ENGINE_VERSION } from './version';
import { trait } from './core/trait';
import { Name } from './core/name';
import { defineEvent } from './events/define-event';
import { defineSystem } from './systems/define-system';
import { defineCommand } from './commands/define-command';
import { beforeAll, afterAll } from 'vitest';
import { FsBackend, SavePort } from './persistence/save-port';
import type { SnapshotData } from './persistence/types';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as nodePath from 'node:path';

// 测试用组件
const Health = trait('health', () => ({ current: 100, max: 100 }));
const Position = trait('position', () => ({ roomId: 'town_square' }));

// 测试用事件
const Damage = defineEvent('damage')<{ target: string; amount: number }>();

// 测试用系统
const CombatSystem = defineSystem({
  name: 'combat',
  on: [Damage.token],
  priority: 10,
  handle(event, ctx) {
    const { target, amount } = event.data;

    // 类型化组件访问器：按 trait 定义读取，无需 as 断言
    const health = ctx.getComponent(target, Health);
    if (!health) return;

    health.current = Math.max(0, health.current - amount);
  },
});

describe('MUD Engine', () => {
  it('should create a test world', () => {
    const clock = new ManualClock();
    const w = createTestWorld({
      systems: [CombatSystem],
      clock,
    });

    expect(w).toBeDefined();
    expect(w.world).toBeDefined();
    expect(w.clock).toBe(clock);
  });

  it('should emit and process events', () => {
    const w = createTestWorld({
      systems: [CombatSystem],
    });

    // 创建测试实体
    const entityId = w.entities.create();
    w.entities.addComponent(entityId, Health, { current: 100, max: 100 });

    // 发射伤害事件
    w.emit(Damage.token, { target: entityId, amount: 30 });

    // 处理事件链
    w.runChain();

    // 验证事件日志
    expect(w.getLog()).toContain(Damage.token);

    // 验证状态变更
    const health = w.entities.getComponent(entityId, Health);
    expect(health).toBeDefined();
    expect(health?.current).toBe(70);
  });

  it('should collect output messages', () => {
    const w = createTestWorld();

    // 发送输出
    w.world.output.narrative([{ text: '测试消息' }]);
    w.world.output.error('错误消息');

    // 验证收集
    expect(w.output.count).toBe(2);
    expect(w.output.ofKind('narrative')).toHaveLength(1);
    expect(w.output.ofKind('error')).toHaveLength(1);
  });

  it('should create and restore snapshots', () => {
    const w = createTestWorld();

    // 创建实体
    const entityId = w.entities.create();
    const entity = w.entities.get(entityId);
    if (entity) {
      entity.components.set('health', { current: 50, max: 100 });
      entity.components.set('position', { roomId: 'test_room' });
    }

    // 创建快照
    const snapshot = w.world.createSnapshot();
    expect(snapshot.engineVersion).toBe(ENGINE_VERSION);
    expect(snapshot.entities).toHaveLength(1);
  });

  it('should rollback world to a snapshot (round-trip)', () => {
    const w = createTestWorld();

    // 快照前状态：两个实体
    const alice = w.entities.create();
    w.entities.addComponent(alice, Health, { current: 80, max: 100 });
    w.entities.addComponent(alice, Position, { roomId: 'town_square' });
    const item = w.entities.createWithId('fixed-item-001');
    w.entities.addComponent(item, Position, { roomId: 'tavern' });
    const keptId = alice; // 快照中记录的原始 ID

    const snapshot = w.world.createSnapshot();
    expect(snapshot.entities).toHaveLength(2);
    expect(snapshot.tickCount).toBe(0);

    // 篡改状态：改组件、删实体、加新实体、推进 tick
    w.entities.updateComponent(alice, Health, (h) => ({ ...h, current: 1 }));
    w.entities.removeComponent(alice, Position);
    w.entities.delete(item);
    const extra = w.entities.create();
    w.entities.addComponent(extra, Health, { current: 999, max: 999 });

    // 回滚
    w.world.rollbackWorld(snapshot);

    // 断言：实体集合与快照一致
    expect(w.entities.size).toBe(2);
    expect(w.entities.has(keptId)).toBe(true);
    expect(w.entities.has('fixed-item-001')).toBe(true); // 原始 ID 被恢复
    expect(w.entities.has(extra)).toBe(false); // 快照后的新实体消失

    // 断言：组件数据恢复到快照值
    const health = w.entities.getComponent(keptId, Health);
    expect(health).toEqual({ current: 80, max: 100 });
    expect(w.entities.hasComponent(keptId, Position)).toBe(true);
    expect(w.entities.getComponent('fixed-item-001', Position)).toEqual({ roomId: 'tavern' });

    // 断言：恢复的数据与快照对象不共享引用
    w.entities.updateComponent(keptId, Health, (h) => ({ ...h, current: 77 }));
    const again = (snapshot.entities.find((e) => e.id === keptId)!.components[Health.id]) as { current: number };
    expect(again.current).toBe(80);

    // 断言：tick 计数恢复
    expect(w.world.getTickCount()).toBe(0);
  });

  it('should rollback from a JSON-serialized snapshot', () => {
    const w = createTestWorld();
    const id = w.entities.create();
    w.entities.addComponent(id, Health, { current: 42, max: 100 });

    // 模拟存档：序列化 → 反序列化 → 回滚到新世界
    const serialized = JSON.parse(JSON.stringify(w.world.createSnapshot()));
    const fresh = createTestWorld();
    fresh.world.rollbackWorld(serialized);

    expect(fresh.entities.size).toBe(1);
    expect(fresh.entities.has(id)).toBe(true);
    expect(fresh.entities.getComponent(id, Health)).toEqual({ current: 42, max: 100 });
  });

  /* ---------- P0 回归（2026-09-01 审查） ---------- */

  it('P0-1: findEntity 能按名称/别名找到实体', async () => {
    const w = createTestWorld();
    const npc = w.entities.create();
    w.entities.addComponent(npc, Name, {
      text: '酒保',
      aliases: ['小二', 'barman'],
    });

    const probe = defineCommand({
      verbs: ['probe'],
      handle({ world }) {
        return world.findEntity('酒保') ? 'FOUND' : 'NOT_FOUND';
      },
    });
    w.world.registerCommands(probe);
    const player = w.entities.create();

    // 按主名称命中
    expect(await w.world.execute('probe', player)).toBe('FOUND');
  });

  it('P0-2: 异步命令的返回值不丢失', async () => {
    const w = createTestWorld();
    const AsyncCmd = defineCommand({
      verbs: ['asyncmd'],
      handle: async () => '异步命令的反馈文本',
    });
    w.world.registerCommands(AsyncCmd);
    const player = w.entities.create();

    expect(await w.world.execute('asyncmd', player)).toBe('异步命令的反馈文本');
  });

  it('P0-3: 同动词命令注册冲突应显式报错', () => {
    const w = createTestWorld();
    const A = defineCommand({ verbs: ['l'], handle: () => 'A' });
    const B = defineCommand({ verbs: ['look', 'l'], handle: () => 'B' });

    w.world.registerCommands(A);
    // B 的动词 "l" 与 A 冲突 → 必须抛错而非静默覆盖
    expect(() => w.world.registerCommands(B)).toThrowError(/冲突/);
    // 同一命令重复注册应幂等
    expect(() => w.world.registerCommands(A)).not.toThrow();
  });

  it('P0-4: defineCommand 不返回未声明的 verbMap 字段', () => {
    const cmd = defineCommand({ verbs: ['go'], handle: () => null });
    expect((cmd as Record<string, unknown>).verbMap).toBeUndefined();
  });

  /* ---------- 0.3 修复回归 ---------- */

  it('findEntity: 精确匹配优先于子串匹配', () => {
    const w = createTestWorld();
    // 先注册长名（子串包含 '剑'），后注册精确同名实体
    const rusty = w.entities.createWithId('rusty');
    w.entities.addComponent(rusty, Name, { text: '生锈的剑' });
    const sword = w.entities.createWithId('sword');
    w.entities.addComponent(sword, Name, { text: '剑' });

    // 精确命中必须胜出，而不是被先遍历到的长名子串抢走
    expect(w.world.findEntity('剑')).toBe(sword);
    // 子串匹配仍然可用（无精确命中时）
    expect(w.world.findEntity('生锈')).toBe(rusty);
  });

  it('findEntity: 别名精确匹配优先于主名子串匹配', () => {
    const w = createTestWorld();
    const board = w.entities.createWithId('board');
    w.entities.addComponent(board, Name, { text: '公告板与小二的留言' });
    const waiter = w.entities.createWithId('waiter');
    w.entities.addComponent(waiter, Name, { text: '酒保', aliases: ['小二'] });

    expect(w.world.findEntity('小二')).toBe(waiter);
  });

  it('createTestWorld 工厂支持 commands（类型与运行时一致）', async () => {
    const Probe = defineCommand({ verbs: ['probe'], handle: () => 'PROBED' });
    const w = createTestWorld({ commands: [Probe] });
    const player = w.entities.create();
    expect(await w.world.execute('probe', player)).toBe('PROBED');
  });

  it('runChain 显式排水且可重复调用（不忙等、不死循环）', () => {
    const w = createTestWorld({ systems: [CombatSystem] });
    const target = w.entities.create();
    w.entities.addComponent(target, Health, { current: 50, max: 100 });

    w.emit(Damage.token, { target, amount: 20 });
    w.runChain();
    w.runChain(); // 幂等：队列已空，立即返回
    expect(w.entities.getComponent(target, Health)!.current).toBe(30);
    expect(w.world.eventPump.queueLength).toBe(0);
  });

  /* ---------- C-1 容器查询原语 ---------- */

  it('C-1: 系统上下文 findByComponent 可查询拥有组件的实体', () => {
    let found: string[] = [];
    const Probe = defineSystem({
      name: 'probe',
      on: ['probe'] as string[],
      handle(_event, ctx) {
        found = ctx.findByComponent(Health);
      },
    });
    const w = createTestWorld({ systems: [Probe] });
    const a = w.entities.createWithId('a');
    w.entities.addComponent(a, Health, { current: 10, max: 10 });
    w.entities.createWithId('bare');
    const c = w.entities.createWithId('c');
    w.entities.addComponent(c, Health, { current: 20, max: 20 });

    w.emit('probe' as never, {});
    w.runChain();
    expect(found).toEqual(['a', 'c']);
  });

  it('C-1: 命令上下文 findByComponent 可查询拥有组件的实体', async () => {
    const ProbeCmd = defineCommand({
      verbs: ['probe-c'],
      handle({ world }) {
        return world.findByComponent(Position).join(',');
      },
    });
    const w = createTestWorld();
    w.world.registerCommands(ProbeCmd);
    const p = w.entities.createWithId('p');
    w.entities.addComponent(p, Position, { roomId: 'hall' });
    const r = w.entities.createWithId('room-x');
    w.entities.addComponent(r, Position, { roomId: 'room-x' });

    expect(await w.world.execute('probe-c', p)).toBe('p,room-x');
  });
});
describe('FsBackend', () => {
  const backend = new FsBackend();
  let tmpRoot: string;

  const makeSnapshot = (): SnapshotData => ({
    engineVersion: '0.1.0',
    entities: [],
    savedAt: '2026-09-02T00:00:00Z',
  });

  beforeAll(async () => {
    tmpRoot = await fs.mkdtemp(nodePath.join(os.tmpdir(), 'mud-fsbackend-'));
  });

  afterAll(async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  it('round-trip：保存→加载→删除，含嵌套目录自动创建', async () => {
    const file = nodePath.join(tmpRoot, 'a', 'b', 'save.json');
    const snapshot = makeSnapshot();

    expect(await backend.exists(file)).toBe(false);
    await backend.save(file, snapshot);
    expect(await backend.exists(file)).toBe(true);
    expect(await backend.load(file)).toEqual(snapshot);
    await backend.delete(file);
    expect(await backend.exists(file)).toBe(false);
  });

  it('重复保存覆盖旧内容', async () => {
    const file = nodePath.join(tmpRoot, 'overwrite.json');
    await backend.save(file, makeSnapshot());
    const v2 = { ...makeSnapshot(), savedAt: '2026-09-02T12:00:00Z' };
    await backend.save(file, v2);
    expect(await backend.load(file)).toEqual(v2);
  });

  it('文件不存在时 load 返回 null', async () => {
    expect(await backend.load(nodePath.join(tmpRoot, 'nope.json'))).toBeNull();
  });

  it('JSON 损坏时 load 抛错（不吞错）', async () => {
    const file = nodePath.join(tmpRoot, 'corrupt.json');
    await fs.writeFile(file, '{ not valid json', 'utf-8');
    await expect(backend.load(file)).rejects.toThrow();
  });

  it('SavePort 与 FsBackend 集成：版本号自动写入', async () => {
    const port = new SavePort(backend, '9.9.9');
    const file = nodePath.join(tmpRoot, 'port-save.json');
    await port.save(file, { ...makeSnapshot(), engineVersion: '0.0.0' });
    const loaded = await port.load(file);
    expect(loaded.engineVersion).toBe('9.9.9');
  });
});
