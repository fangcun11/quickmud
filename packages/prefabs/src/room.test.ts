/**
 * 房间定义与坐标推断测试（v0.8-A）——TDD 先红后绿
 *
 * 锁死三件事：
 * 1. defineRoom 是纯数据（可 JSON、进快照）
 * 2. 坐标从 Exits 推断（单一真相），BFS 从入口铺开
 * 3. 冲突一律 fail-fast（定义期炸，而不是玩家走到第三个房间才发现地图像鬼画符）
 */
import { describe, it, expect } from 'vitest';
import { World, Name } from '@mud/ecs-engine';
import { Exits, Description, Coordinates } from './traits.js';
import { defineRoom } from './behavior.js';
import { layoutRooms, buildRooms } from './room.js';

function room(id: string, exits: Record<string, string> = {}, coords?: { x: number; y: number }) {
  return defineRoom({ id, name: id.toUpperCase(), description: `${id} 的描述`, exits, coords });
}

const coordsOf = (layout: ReturnType<typeof layoutRooms>, id: string) =>
  layout.rooms.find((r) => r.id === id)!.coords;

describe('defineRoom', () => {
  it('返回纯数据：可 JSON 序列化、无函数字段', () => {
    const def = room('a', { east: 'b' });
    expect(JSON.parse(JSON.stringify(def))).toEqual({
      id: 'a',
      name: 'A',
      description: 'a 的描述',
      exits: { east: 'b' },
    });
  });

  it('id / name 为空时 fail-fast', () => {
    expect(() => defineRoom({ id: '', name: 'x', description: '', exits: {} })).toThrow(/id/);
    expect(() => defineRoom({ id: 'a', name: '', description: '', exits: {} })).toThrow(/name/);
  });
});

describe('layoutRooms · 坐标推断', () => {
  it('直线：入口 east → 邻居在 x+1', () => {
    const layout = layoutRooms([room('a', { east: 'b' }), room('b', { west: 'a' })], {
      entry: 'a',
    });
    expect(coordsOf(layout, 'a')).toEqual({ x: 0, y: 0 });
    expect(coordsOf(layout, 'b')).toEqual({ x: 1, y: 0 });
  });

  it('四方向偏移正确（north 为 y-1，屏幕坐标系）', () => {
    const layout = layoutRooms(
      [
        room('hub', { north: 'n', south: 's', east: 'e', west: 'w' }),
        room('n', { south: 'hub' }),
        room('s', { north: 'hub' }),
        room('e', { west: 'hub' }),
        room('w', { east: 'hub' }),
      ],
      { entry: 'hub' },
    );
    expect(coordsOf(layout, 'n')).toEqual({ x: 0, y: -1 });
    expect(coordsOf(layout, 's')).toEqual({ x: 0, y: 1 });
    expect(coordsOf(layout, 'e')).toEqual({ x: 1, y: 0 });
    expect(coordsOf(layout, 'w')).toEqual({ x: -1, y: 0 });
  });

  it('回路：四房间首尾相接，坐标自洽', () => {
    const layout = layoutRooms(
      [
        room('a', { east: 'b' }),
        room('b', { south: 'c', west: 'a' }),
        room('c', { west: 'd', north: 'b' }),
        room('d', { east: 'c', north: 'a' }),
      ],
      { entry: 'a' },
    );
    expect(coordsOf(layout, 'a')).toEqual({ x: 0, y: 0 });
    expect(coordsOf(layout, 'b')).toEqual({ x: 1, y: 0 });
    expect(coordsOf(layout, 'c')).toEqual({ x: 1, y: 1 });
    expect(coordsOf(layout, 'd')).toEqual({ x: 0, y: 1 });
  });

  it('entryCoords 可自定义（坐标系锚点）', () => {
    const layout = layoutRooms([room('a', { east: 'b' }), room('b', { west: 'a' })], {
      entry: 'a',
      entryCoords: { x: 10, y: 20 },
    });
    expect(coordsOf(layout, 'a')).toEqual({ x: 10, y: 20 });
    expect(coordsOf(layout, 'b')).toEqual({ x: 11, y: 20 });
  });

  it('非四方向出口（up/down）可达但无坐标——二维平面装不下它', () => {
    const layout = layoutRooms(
      [room('a', { east: 'b', up: 'attic' }), room('b', { west: 'a' }), room('attic', { down: 'a' })],
      { entry: 'a' },
    );
    // attic 走 up 可达（不算孤岛），但没有四方向通路 → 不参与几何、地图不画
    expect(coordsOf(layout, 'attic')).toBeUndefined();
    expect(coordsOf(layout, 'b')).toEqual({ x: 1, y: 0 });
  });

  it('显式 coords 与推断一致 → 通过', () => {
    const layout = layoutRooms(
      [room('a', { east: 'b' }, { x: 0, y: 0 }), room('b', { west: 'a' }, { x: 1, y: 0 })],
      { entry: 'a' },
    );
    expect(coordsOf(layout, 'b')).toEqual({ x: 1, y: 0 });
  });
});

describe('layoutRooms · 冲突 fail-fast', () => {
  it('重复房间 id', () => {
    expect(() => layoutRooms([room('a'), room('a')], { entry: 'a' })).toThrow(/重复/);
  });

  it('入口房间不存在', () => {
    expect(() => layoutRooms([room('a')], { entry: 'nope' })).toThrow(/入口/);
  });

  it('悬空出口（指向不存在的房间）', () => {
    expect(() => layoutRooms([room('a', { east: 'ghost' })], { entry: 'a' })).toThrow(/悬空出口/);
  });

  it('坐标冲突：两个房间挤进同一格（图无法嵌入平面）', () => {
    // a(0,0) b(1,0) c(0,1) → b 的南边 d(1,1)，c 的东边 e 也落在 (1,1)
    expect(() =>
      layoutRooms(
        [
          room('a', { east: 'b', south: 'c' }),
          room('b', { west: 'a', south: 'd' }),
          room('c', { north: 'a', east: 'e' }),
          room('d', { north: 'b' }),
          room('e', { west: 'c' }),
        ],
        { entry: 'a' },
      ),
    ).toThrow(/坐标冲突/);
  });

  it('显式 coords 与推断不一致', () => {
    expect(() =>
      layoutRooms([room('a', { east: 'b' }), room('b', { west: 'a' }, { x: 5, y: 5 })], {
        entry: 'a',
      }),
    ).toThrow(/显式坐标/);
  });

  it('两个显式坐标重叠', () => {
    expect(() =>
      layoutRooms(
        [
          room('a', { east: 'b' }, { x: 0, y: 0 }),
          room('b', { west: 'a' }, { x: 0, y: 0 }),
        ],
        { entry: 'a' },
      ),
    ).toThrow(/显式坐标/);
  });

  it('反向出口不自洽（A east→B，B 却也 east→A）', () => {
    expect(() =>
      layoutRooms([room('a', { east: 'b' }), room('b', { east: 'a' })], { entry: 'a' }),
    ).toThrow(/反向出口不自洽/);
  });

  it('checkReverseExits: false → 关掉的是反向诊断，几何冲突照旧 fail-fast', () => {
    // 说明：四方向下「反向写反」几乎必然伴随坐标冲突，所以这个开关是
    // **诊断开关**（先给可读性最高的那条错误），不是放行开关。
    expect(() =>
      layoutRooms([room('a', { east: 'b' }), room('b', { east: 'a' })], {
        entry: 'a',
        checkReverseExits: false,
      }),
    ).toThrow(/坐标冲突|显式坐标/);
  });

  it('单向通道（对端未声明回边）不算不自洽', () => {
    expect(() => layoutRooms([room('a', { east: 'b' }), room('b', {})], { entry: 'a' })).not.toThrow();
  });

  it('孤岛房间：从入口不可达', () => {
    expect(() =>
      layoutRooms([room('a', { east: 'b' }), room('b', { west: 'a' }), room('c', {})], {
        entry: 'a',
      }),
    ).toThrow(/孤岛/);
  });
});

describe('buildRooms', () => {
  it('为每个房间注入 Name / Description / Exits / Coordinates', () => {
    const w = new World();
    const layout = layoutRooms([room('a', { east: 'b' }), room('b', { west: 'a' })], {
      entry: 'a',
    });
    buildRooms(w, layout);

    expect(w.getComponent('a', Name)!.text).toBe('A');
    expect(w.getComponent('a', Description)!.text).toBe('a 的描述');
    expect(w.getComponent('a', Exits)!).toEqual({ east: 'b' });
    expect(w.getComponent('a', Coordinates)!).toEqual({ x: 0, y: 0 });
    expect(w.getComponent('b', Coordinates)!).toEqual({ x: 1, y: 0 });
  });
});
