// 文档 §房间与地图：defineRoom 定义 + 坐标自动推断 + 冲突 fail-fast + ASCII 地图 + 迷雾（v0.8）
// 由 verify-doc-examples.mjs 实测（strict tsc 类型检查 + 运行断言）
import assert from 'node:assert';
import { World } from '@mud/ecs-engine';
import {
  // 系统
  MovementSystem,
  VisitationSystem,
  // 命令
  MapCommand,
  createDirectionCommand,
  // 组件
  Position,
  Visited,
  // v0.8 房间与地图 API
  defineRoom,
  layoutRooms,
  buildRooms,
  renderAsciiMap,
  markVisited,
} from '@mud/prefabs';

// ---- 1. 只写拓扑，坐标从入口自动推断 ----
// 村庄(0,0) —东→ 森林(1,0) —南→ 沼泽(1,1) —东→ 洞穴(2,1)
const layout = layoutRooms(
  [
    defineRoom({
      id: 'village',
      name: '村庄',
      description: '安静的小村，一条小路向东伸进森林。',
      exits: { east: 'forest' },
    }),
    defineRoom({
      id: 'forest',
      name: '森林小径',
      description: '树影幢幢，南边的空气越来越潮。',
      exits: { west: 'village', south: 'swamp' },
    }),
    defineRoom({
      id: 'swamp',
      name: '沼泽',
      description: '腐臭的泥浆没过脚踝。',
      exits: { north: 'forest', east: 'cave' },
    }),
    defineRoom({
      id: 'cave',
      name: '蛛巢洞穴',
      description: '深不见底。',
      exits: { west: 'swamp' },
    }),
  ],
  { entry: 'village' },
);

assert.deepEqual(
  layout.rooms.map((room) => [room.id, room.coords]),
  [
    ['village', { x: 0, y: 0 }],
    ['forest', { x: 1, y: 0 }],
    ['swamp', { x: 1, y: 1 }],
    ['cave', { x: 2, y: 1 }],
  ],
  '坐标应四方向自动推断',
);

// ---- 2. 拓扑写错 → 定义期 fail-fast（不是运行时才炸）----
assert.throws(
  () =>
    layoutRooms(
      [
        defineRoom({ id: 'a', name: 'A', description: '', exits: { east: 'b' } }),
        defineRoom({ id: 'b', name: 'B', description: '', exits: { east: 'a' } }),
      ],
      { entry: 'a' },
    ),
  /反向出口不自洽/,
  '方向写反应在启动时被抓住',
);

// ---- 3. 全图渲染（纯函数，可逐行断言）----
assert.equal(
  renderAsciiMap(layout.rooms, { entry: 'village', current: 'cave' }),
  ['S—·', '  │', '  ·—@'].join('\n'),
  '全图应正确绘出四方向连线与当前位置（入口标 S）',
);

// ---- 4. 迷雾：只画去过的房间，且连线两端都探明才画 ----
assert.equal(
  renderAsciiMap(layout.rooms, { visited: ['village', 'forest', 'swamp'] }),
  ['·—·', '  │', '  ·'].join('\n'),
  '未探明的洞穴不应出现',
);

// ---- 5. 注入世界 + map 命令：探索驱动地图展开 ----
const w = new World();
w.register(MovementSystem, VisitationSystem);
w.registerCommands(
  MapCommand,
  createDirectionCommand('east', ['east']),
  createDirectionCommand('south', ['south']),
);
buildRooms(w, layout);

const player = w.entities.createWithId('player');
w.entities.addComponent(player, Position, { roomId: 'village' });
w.entities.addComponent(player, Visited);
markVisited(w, player); // seed 入口（初始位置没有 Moved 事件可订阅）

// 出生点：地图只有自己
assert.equal(
  await w.execute('map', player),
  '@\n图例：@ 当前位置 · 已探明（未探明区域留白）',
  '初始地图只有出生房间',
);

await w.execute('east', player); // 森林
await w.execute('south', player); // 沼泽
const explored = (await w.execute('map', player))!;
assert.ok(explored.startsWith('·—·\n  │\n  @'), '探索过森林与沼泽后地图应展开，当前在沼泽');
console.log('05-room-map ✓ 房间定义 + 坐标推断 + ASCII 地图 + 迷雾 全通过');
