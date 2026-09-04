/**
 * ASCII 地图与探索记录测试（v0.8-B）——TDD 先红后绿
 *
 * 锁死：渲染是纯函数（同输入 ⇒ 同字符串，可直接断言每一行）、
 * 迷雾只暴露已探明区域（连线两端都去过才画，不泄漏邻接信息）、
 * 探索记录由 Moved 驱动且撞墙不记账。
 */
import { describe, it, expect } from 'vitest';
import { World } from '@mud/ecs-engine';
import {
  MovementSystem,
  VisitationSystem,
  MapCommand,
  createDirectionCommand,
  Position,
  Visited,
} from './index.js';
import { defineRoom } from './behavior.js';
import { layoutRooms, buildRooms, renderAsciiMap, markVisited } from './room.js';

const r = (id: string, exits: Record<string, string> = {}) =>
  defineRoom({ id, name: id, description: `${id}`, exits });

/** 直线三房间：a — b — c */
const line = () => layoutRooms([r('a', { east: 'b' }), r('b', { west: 'a', east: 'c' }), r('c', { west: 'b' })], { entry: 'a' });
/** L 形：a — b / a ↓ c */
const ell = () =>
  layoutRooms(
    [r('a', { east: 'b', south: 'c' }), r('b', { west: 'a' }), r('c', { north: 'a' })],
    { entry: 'a' },
  );

describe('renderAsciiMap · 全图', () => {
  it('直线：房间与东西向连线', () => {
    expect(renderAsciiMap(line().rooms)).toBe('·—·—·');
  });

  it('L 形：南北向连线用 │', () => {
    expect(renderAsciiMap(ell().rooms)).toBe('·—·\n│\n·');
  });

  it('入口标 S，当前位置标 @（覆盖入口）', () => {
    expect(renderAsciiMap(line().rooms, { entry: 'a' })).toBe('S—·—·');
    expect(renderAsciiMap(line().rooms, { entry: 'a', current: 'b' })).toBe('S—@—·'); // 入口保持 S
    expect(renderAsciiMap(line().rooms, { entry: 'a', current: 'a' })).toBe('@—·—·'); // @ 覆盖 S
  });

  it('无坐标的房间（跨层可达）不出现在地图上', () => {
    const layout = layoutRooms(
      [r('a', { east: 'b', up: 'attic' }), r('b', { west: 'a' }), r('attic', { down: 'a' })],
      { entry: 'a' },
    );
    expect(renderAsciiMap(layout.rooms)).toBe('·—·'); // attic 没有坐标 → 不画
  });

  it('确定性：同输入两次渲染完全一致', () => {
    expect(renderAsciiMap(ell().rooms, { entry: 'a', current: 'c' })).toBe(
      renderAsciiMap(ell().rooms, { entry: 'a', current: 'c' }),
    );
  });

  it('没有房间时返回空串', () => {
    expect(renderAsciiMap([])).toBe('');
  });

  it('裁掉首尾的纯空行，保留中间的（v0.10 纵向叠层暴露的漏裁）', () => {
    // 三间房南北向叠：a(0,-1) — b(0,0) — c(0,1)，网格五行
    const layout = layoutRooms(
      [r('a', { south: 'b' }), r('b', { north: 'a', south: 'c' }), r('c', { north: 'b' })],
      { entry: 'b' },
    );
    // 只探明 b、c ⇒ a 那行纯空（a—b 的连线也不画，两端必须都探明），
    // 若不裁首部，地图头顶挂两行空白
    expect(renderAsciiMap(layout.rooms, { visited: ['b', 'c'], current: 'c' })).toBe('·\n│\n@');
    // 全部探明 ⇒ 首行有字形，什么都不裁
    expect(renderAsciiMap(layout.rooms)).toBe('·\n│\n·\n│\n·');
  });
});

describe('renderAsciiMap · 迷雾', () => {
  it('只渲染去过的房间', () => {
    expect(renderAsciiMap(line().rooms, { visited: ['a'] })).toBe('·');
    expect(renderAsciiMap(line().rooms, { visited: ['a', 'b'] })).toBe('·—·');
  });

  it('连线两端都去过才画——单端Known也不泄漏邻接', () => {
    // 去过 a、c，但没去过中间的 b → a 与 c 之间不该出现连线
    expect(renderAsciiMap(line().rooms, { visited: ['a', 'c'] })).toBe('·   ·');
  });

  it('二维迷雾：竖线同样要求两端都探明', () => {
    expect(renderAsciiMap(ell().rooms, { visited: ['a', 'c'] })).toBe('·\n│\n·');
    expect(renderAsciiMap(ell().rooms, { visited: ['a', 'b'] })).toBe('·—·');
  });

  it('未探明的房间即使有坐标也留白', () => {
    expect(renderAsciiMap(ell().rooms, { visited: ['a'] })).toBe('·');
  });
});

describe('探索记录（Visited / VisitationSystem）', () => {
  function world() {
    const w = new World();
    w.register(MovementSystem, VisitationSystem);
    w.registerCommands(
      MapCommand,
      createDirectionCommand('east', ['east']),
      createDirectionCommand('west', ['west']),
      createDirectionCommand('north', ['north']),
    );
    buildRooms(w, line());
    const player = w.entities.createWithId('player');
    w.entities.addComponent(player, Position, { roomId: 'a' });
    w.entities.addComponent(player, Visited);
    markVisited(w, player); // seed 入口（初始位置没有 Moved 事件）
    return { w, player };
  }

  it('markVisited seed 当前房间，且可重复调用不去重', () => {
    const { w, player } = world();
    expect(w.entities.getComponent(player, Visited)!.rooms).toEqual(['a']);
    markVisited(w, player);
    expect(w.entities.getComponent(player, Visited)!.rooms).toEqual(['a']);
  });

  it('移动后记入目标房间（Moved.to 就是房间 id，与注册顺序无关）', async () => {
    const { w, player } = world();
    await w.execute('east', player);
    expect(w.entities.getComponent(player, Visited)!.rooms).toEqual(['a', 'b']);
  });

  it('来回走不重复记账', async () => {
    const { w, player } = world();
    await w.execute('east', player);
    await w.execute('west', player);
    await w.execute('east', player);
    expect(w.entities.getComponent(player, Visited)!.rooms).toEqual(['a', 'b']);
  });

  it('撞墙（出口校验失败）不记账', async () => {
    const { w, player } = world();
    await w.execute('north', player); // a 没有 north
    expect(w.entities.getComponent(player, Visited)!.rooms).toEqual(['a']);
  });

  it('没挂 Visited 的实体不产生探索记录（也不报错）', async () => {
    const w = new World();
    w.register(MovementSystem, VisitationSystem);
    buildRooms(w, line());
    const ghost = w.entities.createWithId('ghost');
    w.entities.addComponent(ghost, Position, { roomId: 'a' });
    await w.execute('east', ghost);
    expect(w.entities.getComponent(ghost, Visited)).toBeUndefined();
  });
});

describe('MapCommand', () => {
  it('挂了 Visited → 只画已探明区域，附图示', async () => {
    const w = new World();
    w.register(MovementSystem, VisitationSystem);
    w.registerCommands(
      MapCommand,
      createDirectionCommand('east', ['east']),
      createDirectionCommand('west', ['west']),
      createDirectionCommand('north', ['north']),
    );
    buildRooms(w, ell());
    const player = w.entities.createWithId('player');
    w.entities.addComponent(player, Position, { roomId: 'a' });
    w.entities.addComponent(player, Visited);
    markVisited(w, player);

    const out = await w.execute('map', player);
    expect(out).toBe('@\n图例：@ 当前位置 · 已探明（未探明区域留白）');

    await w.execute('east', player);
    const out2 = await w.execute('map', player);
    expect(out2).toBe('·—@\n图例：@ 当前位置 · 已探明（未探明区域留白）');
  });

  it('没挂 Visited → 渲染全图（内容没声明要迷雾就不迷雾）', async () => {
    const w = new World();
    w.register(MovementSystem, VisitationSystem);
    w.registerCommands(
      MapCommand,
      createDirectionCommand('east', ['east']),
      createDirectionCommand('west', ['west']),
      createDirectionCommand('north', ['north']),
    );
    buildRooms(w, ell());
    const player = w.entities.createWithId('player');
    w.entities.addComponent(player, Position, { roomId: 'a' });

    const out = await w.execute('map', player);
    expect(out).toBe('@—·\n│\n·\n图例：@ 当前位置 · 已探明（未探明区域留白）');
  });
});
