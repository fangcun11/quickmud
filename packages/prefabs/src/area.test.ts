/**
 * 区域层测试（v0.9-B）——TDD 锁死区域语义
 *
 * 锁死六件事：
 * 1. 每个区域是**一张独立平面**：两个区域的锚点都从 (0,0) 起铺，坐标系互不干扰
 * 2. 区域出口由**跨区域房间出口反推**（单一真相）：区域不抄反表；up/down 只保证连通不进平面
 * 3. 校验全 fail-fast：区域不存在 / 空区域 / 区内孤岛 / 孤岛区域 / 出口冲突 / 锚不了坐标系
 * 4. 不传 areas 退化成 v0.8 单一平面（向后兼容）
 * 5. buildAreas：区域是**实体**（Name/Exits 指实体 id/Coordinates），归属靠查询不靠反表
 * 6. MapCommand 按当前区域过滤（防跨区域坐标撞车）+ WorldMapCommand 区域级战争迷雾
 */
import { describe, it, expect } from 'vitest';
import { World, Name } from '@mud/ecs-engine';
import {
  MovementSystem,
  VisitationSystem,
  MapCommand,
  WorldMapCommand,
  createDirectionCommand,
  Position,
  Visited,
  Exits,
  Coordinates,
  defineRoom,
  defineArea,
  layoutWorld,
  buildRooms,
  buildAreas,
  buildRoomBehaviors,
  markVisited,
  renderAsciiWorldMap,
  roomsOfArea,
  areaOf,
} from './index.js';
import type { WorldQuery } from './index.js';

const room = (id: string, area: string, exits: Record<string, string>) =>
  defineRoom({ id, name: id, description: id, exits, area });

/** 两区域直线世界：v1 — v2 ‖ w1 — w2（v2 -east-> w1 是跨区域边） */
function twoAreaRooms() {
  return [
    room('v1', 'village', { east: 'v2' }),
    room('v2', 'village', { west: 'v1', east: 'w1' }),
    room('w1', 'wilds', { west: 'v2', east: 'w2' }),
    room('w2', 'wilds', { west: 'w1' }),
  ];
}

const twoAreaDefs = () => [defineArea({ id: 'village', name: '村庄' }), defineArea({ id: 'wilds', name: '荒野' })];

const twoAreaLayout = () =>
  layoutWorld(twoAreaRooms(), { entry: 'v1', entryArea: 'village', areas: twoAreaDefs() });

describe('layoutWorld · 无区域世界（v0.8 向后兼容）', () => {
  it('不传 areas：退化成单一平面，areas 为空、entryArea 缺省', () => {
    const layout = layoutWorld(
      [
        defineRoom({ id: 'a', name: 'a', description: '', exits: { east: 'b' } }),
        defineRoom({ id: 'b', name: 'b', description: '', exits: { west: 'a' } }),
      ],
      { entry: 'a' },
    );
    expect(layout.areas).toEqual([]);
    expect(layout.entryArea).toBeUndefined();
    expect(layout.rooms.map((r) => r.coords)).toEqual([
      { x: 0, y: 0 },
      { x: 1, y: 0 },
    ]);
  });
});

describe('layoutWorld · 区域坐标系与出口推断', () => {
  it('每个区域一张独立平面：两个区域的锚点都从 (0,0) 起铺', () => {
    const layout = twoAreaLayout();
    const coords = Object.fromEntries(layout.rooms.map((r) => [r.id, r.coords]));
    expect(coords).toEqual({
      v1: { x: 0, y: 0 },
      v2: { x: 1, y: 0 },
      w1: { x: 0, y: 0 }, // 荒野自己的原点，不接村庄的坐标系
      w2: { x: 1, y: 0 },
    });
  });

  it('区域出口由跨区域房间出口反推，双向一致（单一真相）', () => {
    const layout = twoAreaLayout();
    expect(layout.areas.map((a) => ({ id: a.id, exits: a.exits }))).toEqual([
      { id: 'village', exits: { east: 'wilds' } },
      { id: 'wilds', exits: { west: 'village' } },
    ]);
  });

  it('区域坐标也是推出来的：入口区域 (0,0)，东边区域 (1,0)', () => {
    const layout = twoAreaLayout();
    expect(layout.areas.map((a) => ({ id: a.id, coords: a.coords }))).toEqual([
      { id: 'village', coords: { x: 0, y: 0 } },
      { id: 'wilds', coords: { x: 1, y: 0 } },
    ]);
  });

  it('up/down 跨层边保证连通但不进区域平面（没四方向边的区域没有平面坐标）', () => {
    const layout = layoutWorld(
      [
        room('v1', 'village', { east: 'w1', up: 't1' }),
        room('w1', 'wilds', { west: 'v1' }),
        room('t1', 'tower', { down: 'v1' }),
      ],
      {
        entry: 'v1',
        entryArea: 'village',
        areas: [
          defineArea({ id: 'village', name: '村庄' }),
          defineArea({ id: 'wilds', name: '荒野' }),
          defineArea({ id: 'tower', name: '高塔' }),
        ],
      },
    );
    const byId = Object.fromEntries(layout.areas.map((a) => [a.id, a]));
    expect(byId.village!.exits).toEqual({ east: 'wilds' }); // up 不进平面
    expect(byId.wilds!.exits).toEqual({ west: 'village' });
    expect(byId.tower!.exits).toEqual({});
    expect(byId.tower!.coords).toBeUndefined(); // 平面上没有位置 → 世界地图不画它
  });

  it('跨层区域可以显式 coords 钉进世界地图', () => {
    const layout = layoutWorld(
      [
        room('v1', 'village', { east: 'w1', up: 't1' }),
        room('w1', 'wilds', { west: 'v1' }),
        room('t1', 'tower', { down: 'v1' }),
      ],
      {
        entry: 'v1',
        entryArea: 'village',
        areas: [
          defineArea({ id: 'village', name: '村庄' }),
          defineArea({ id: 'wilds', name: '荒野' }),
          defineArea({ id: 'tower', name: '高塔', coords: { x: 0, y: -1 } }),
        ],
      },
    );
    const tower = layout.areas.find((a) => a.id === 'tower');
    expect(tower!.coords).toEqual({ x: 0, y: -1 });
  });

  it('世界地图渲染：区域图与房间图同构，直接复用同一套渲染', () => {
    expect(renderAsciiWorldMap(twoAreaLayout().areas)).toBe('·—·');
  });
});

describe('layoutWorld · fail-fast 校验', () => {
  it('房间的 area 指向没声明的区域', () => {
    expect(() =>
      layoutWorld([room('a', 'nope', {})], {
        entry: 'a',
        areas: [defineArea({ id: 'village', name: '村庄' })],
      }),
    ).toThrow(/区域不存在.*nope/);
  });

  it('空区域：没有任何房间属于它', () => {
    expect(() =>
      layoutWorld([room('a', 'village', {})], {
        entry: 'a',
        entryArea: 'village',
        areas: [defineArea({ id: 'village', name: '村庄' }), defineArea({ id: 'wilds', name: '荒野' })],
      }),
    ).toThrow(/空区域.*wilds/);
  });

  it('区内孤岛房间：同区域却从锚点走不到（多半是 area 标错了）', () => {
    expect(() =>
      layoutWorld(
        [room('v1', 'village', { east: 'w1' }), room('v2', 'village', {}), room('w1', 'wilds', {})],
        {
          entry: 'v1',
          entryArea: 'village',
          areas: [defineArea({ id: 'village', name: '村庄' }), defineArea({ id: 'wilds', name: '荒野' })],
        },
      ),
    ).toThrow(/区内孤岛.*v2/);
  });

  it('孤岛区域：从入口区域走不到', () => {
    expect(() =>
      layoutWorld([room('v1', 'village', {}), room('w1', 'wilds', {})], {
        entry: 'v1',
        entryArea: 'village',
        areas: [defineArea({ id: 'village', name: '村庄' }), defineArea({ id: 'wilds', name: '荒野' })],
      }),
    ).toThrow(/孤岛区域.*wilds/);
  });

  it('区域出口冲突：同方向通向两个区域（一张平面装不下）', () => {
    expect(() =>
      layoutWorld(
        [
          room('v0', 'village', { east: 'v1', south: 'v2' }),
          room('v1', 'village', { west: 'v0', east: 'w1' }),
          room('v2', 'village', { north: 'v0', east: 'l1' }),
          room('w1', 'wilds', { west: 'v1' }),
          room('l1', 'lair', { west: 'v2' }),
        ],
        {
          entry: 'v0',
          entryArea: 'village',
          areas: [
            defineArea({ id: 'village', name: '村庄' }),
            defineArea({ id: 'wilds', name: '荒野' }),
            defineArea({ id: 'lair', name: '巢穴' }),
          ],
        },
      ),
    ).toThrow(/区域出口冲突.*wilds.*lair/);
  });

  it('有区域但锚不了坐标系：入口房间没 area 也没指定 entryArea', () => {
    expect(() =>
      layoutWorld([defineRoom({ id: 'a', name: 'a', description: '', exits: {} })], {
        entry: 'a',
        areas: [defineArea({ id: 'village', name: '村庄' })],
      }).entryArea,
    ).toThrow(/无法锚定区域坐标系/);
  });
});

describe('layoutWorld · entryArea 回退', () => {
  it('entryArea 作默认区域：没声明 area 的房间都归它', () => {
    const layout = layoutWorld(
      [
        defineRoom({ id: 'a', name: 'a', description: '', exits: { east: 'b' } }),
        defineRoom({ id: 'b', name: 'b', description: '', exits: { west: 'a' } }),
      ],
      { entry: 'a', entryArea: 'field', areas: [defineArea({ id: 'field', name: '原野' })] },
    );
    expect(layout.entryArea).toBe('field');
    expect(layout.rooms.every((r) => r.area === 'field')).toBe(true);
  });

  it('entryArea 省略时回退到入口房间的 area', () => {
    expect(twoAreaLayout().entryArea).toBe('village');
  });
});

describe('buildAreas · 区域是实体', () => {
  function world() {
    const w = new World();
    w.register(MovementSystem, VisitationSystem);
    w.registerCommands(
      MapCommand,
      WorldMapCommand,
      createDirectionCommand('east', ['east']),
      createDirectionCommand('west', ['west']),
    );
    const layout = twoAreaLayout();
    buildRooms(w, layout);
    buildAreas(w, layout);
    buildRoomBehaviors(w, twoAreaRooms()); // 房间是静态的，这里只为走同一条构建路径
    const player = w.entities.createWithId('player');
    w.entities.addComponent(player, Position, { roomId: 'v1' });
    return { w, player };
  }

  it('区域实体带 Name/Exits/Coordinates，出口指向区域实体 id', () => {
    const { w } = world();
    expect(w.entities.getComponent('area:village', Name)!.text).toBe('村庄');
    expect(w.entities.getComponent('area:village', Exits)).toEqual({ east: 'area:wilds' });
    expect(w.entities.getComponent('area:wilds', Exits)).toEqual({ west: 'area:village' });
    expect(w.entities.getComponent('area:village', Coordinates)).toEqual({ x: 0, y: 0 });
  });

  it('roomsOfArea / areaOf：归属永远是查出来的，不维护反表', () => {
    const { w, player } = world();
    // WorldQuery 形状兼容系统/命令上下文；测试里用 entities 适配出同款只读查询
    const q: WorldQuery = {
      findByComponent: (c) => w.entities.findByComponent(c),
      getComponent: (id, c) => w.entities.getComponent(id, c),
    };
    expect(roomsOfArea(q, 'area:village').sort()).toEqual(['v1', 'v2']);
    expect(roomsOfArea(q, 'area:wilds').sort()).toEqual(['w1', 'w2']);
    expect(areaOf(q, player)).toBe('area:village');
  });
});

describe('MapCommand · 按当前区域过滤', () => {
  function world(withVisited: boolean) {
    const w = new World();
    w.register(MovementSystem, VisitationSystem);
    w.registerCommands(
      MapCommand,
      WorldMapCommand,
      createDirectionCommand('east', ['east']),
      createDirectionCommand('west', ['west']),
    );
    const layout = twoAreaLayout();
    buildRooms(w, layout);
    buildAreas(w, layout);
    const player = w.entities.createWithId('player');
    w.entities.addComponent(player, Position, { roomId: 'v1' });
    if (withVisited) {
      w.entities.addComponent(player, Visited);
      markVisited(w, player);
    }
    return { w, player };
  }

  it('map 只画当前区域的房间，带【区域名】抬头', async () => {
    const { w, player } = world(true);
    expect(await w.execute('map', player)).toBe(
      '【村庄】\n@\n图例：@ 当前位置 · 已探明（未探明区域留白）',
    );

    await w.execute('east', player); // v2，仍在村庄
    expect(await w.execute('map', player)).toBe(
      '【村庄】\n·—@\n图例：@ 当前位置 · 已探明（未探明区域留白）',
    );
  });

  it('跨过区域边界后，map 换成新区域的平面（两套坐标不相撞）', async () => {
    const { w, player } = world(true);
    await w.execute('east', player); // v2
    await w.execute('east', player); // w1，跨区域边
    expect(await w.execute('map', player)).toBe(
      '【荒野】\n@\n图例：@ 当前位置 · 已探明（未探明区域留白）',
    );
  });

  it('没挂 Visited：渲染当前区域全图（不迷雾）', async () => {
    const { w, player } = world(false);
    expect(await w.execute('map', player)).toBe(
      '【村庄】\n@—·\n图例：@ 当前位置 · 已探明（未探明区域留白）',
    );
  });
});

describe('WorldMapCommand · 区域级战争迷雾', () => {
  function world(withVisited: boolean) {
    const w = new World();
    w.register(MovementSystem, VisitationSystem);
    w.registerCommands(
      MapCommand,
      WorldMapCommand,
      createDirectionCommand('east', ['east']),
      createDirectionCommand('west', ['west']),
    );
    const layout = twoAreaLayout();
    buildRooms(w, layout);
    buildAreas(w, layout);
    const player = w.entities.createWithId('player');
    w.entities.addComponent(player, Position, { roomId: 'v1' });
    if (withVisited) {
      w.entities.addComponent(player, Visited);
      markVisited(w, player);
    }
    return { w, player };
  }

  it('没挂 Visited → 渲染全部区域', async () => {
    const { w, player } = world(false);
    expect(await w.execute('worldmap', player)).toBe(
      '@—·\n图例：@ 当前位置 · 已探明区域（未探明区域留白）',
    );
  });

  it('挂了 Visited：区域内去过任意一间房就算探明该区域', async () => {
    const { w, player } = world(true);
    expect(await w.execute('wmap', player)).toBe(
      '@\n图例：@ 当前位置 · 已探明区域（未探明区域留白）',
    );
  });

  it('走进新区域后，世界地图点亮它', async () => {
    const { w, player } = world(true);
    await w.execute('east', player); // v2
    await w.execute('east', player); // w1：荒野探明
    expect(await w.execute('世界地图', player)).toBe(
      '·—@\n图例：@ 当前位置 · 已探明区域（未探明区域留白）',
    );
  });
});
