// 文档 §区域与房间行为：区域层 + 自包含房间模块（v0.9）
// 由 verify-doc-examples.mjs 实测（strict tsc 类型检查 + 运行断言）
import assert from 'node:assert';
import { World, Name, trait, blueprint, ManualClock, createTestWorld } from '@mud/ecs-engine';
import {
  // 系统
  MovementSystem,
  VisitationSystem,
  ItemSystem,
  // 命令
  GoCommand,
  TakeCommand,
  MapCommand,
  WorldMapCommand,
  createDirectionCommand,
  // 组件
  Position,
  Visited,
  Located,
  Portable,
  // v0.8 房间 API
  defineRoom,
  layoutRooms,
  buildRooms,
  markVisited,
  // v0.9 区域与房间行为 API
  defineArea,
  layoutWorld,
  buildAreas,
  buildRoomBehaviors,
} from '@mud/prefabs';

// ---- 1. 区域：房间之上的一级。作者只声明房间属于哪个区域，其余全是推出来的 ----
// 房间状态走组件（进快照、可回滚）；闭包变量才是快照的敌人
const HayState = trait('hay_state', () => ({ searched: false }));

const rooms = [
  defineRoom({
    id: 'square',
    name: '村口广场',
    description: '广场角落堆着一个干草堆。',
    area: 'village',
    exits: { east: 'path' },
    state: HayState,
    commands: [
      {
        verbs: ['search', '搜索'],
        handle(ctx) {
          if (ctx.state.searched) return '干草堆已经被你翻遍了。';
          ctx.state.searched = true;
          // 房间命令有系统特权：spawn 出来的东西真的存在于世界里
          ctx.spawn(
            blueprint({
              components: [
                [Name, { text: '火把' }],
                [Located, { at: ctx.roomId }],
                [Portable],
              ],
            }),
          );
          return '你从干草堆里翻出一支火把。';
        },
      },
    ],
  }),
  defineRoom({
    id: 'path',
    name: '荒野小径',
    description: '杂草没膝，南边隐约有绿雾流动。',
    area: 'wilds',
    exits: { west: 'square', south: 'mire' },
  }),
  defineRoom({
    id: 'mire',
    name: '毒雾泥沼',
    description: '绿雾贴着地面涌动。',
    area: 'wilds',
    exits: { north: 'path' },
    on: {
      // 守卫是同步查询：拒绝 = 不落位、无 Moved、不记 Visited
      canEnter(ctx) {
        const hasTorch = ctx.findByComponent(Name).some(
          (id) =>
            ctx.getComponent(id, Name)?.text === '火把' &&
            ctx.getComponent(id, Located)?.at === ctx.entity,
        );
        return hasTorch ? undefined : '泥沼入口漆黑一片，没有火把寸步难行。';
      },
      // 生命周期在真正落位后触发（Moved 是结果不是意图）
      enter(ctx) {
        ctx.output.narrative('毒雾无声无息地缠了上来……');
      },
    },
  }),
];

const areas = [
  defineArea({ id: 'village', name: '村庄' }),
  defineArea({ id: 'wilds', name: '荒野' }),
];

const layout = layoutWorld(rooms, { entry: 'square', entryArea: 'village', areas });

// 区域出口由跨区域的房间出口**反推**（区域不抄反表：单一真相）
assert.deepEqual(
  layout.areas.map((a) => [a.id, a.exits, a.coords]),
  [
    ['village', { east: 'wilds' }, { x: 0, y: 0 }],
    ['wilds', { west: 'village' }, { x: 1, y: 0 }],
  ],
  '区域拓扑与坐标应自动推断',
);

// 每个区域是**一张独立平面**：荒野从自己的 (0,0) 起铺，不接村庄的坐标系
assert.deepEqual(
  layout.rooms.map((r) => [r.id, r.area, r.coords]),
  [
    ['square', 'village', { x: 0, y: 0 }],
    ['path', 'wilds', { x: 0, y: 0 }],
    ['mire', 'wilds', { x: 0, y: 1 }],
  ],
  '各区域坐标系应相互独立',
);

// ---- 2. 注入世界 + 一条完整的体验闭环 ----
const w = new World();
w.register(MovementSystem, VisitationSystem, ItemSystem);
w.registerCommands(
  GoCommand,
  TakeCommand,
  MapCommand,
  WorldMapCommand,
  createDirectionCommand('east', ['east']),
  createDirectionCommand('west', ['west']),
  createDirectionCommand('south', ['south']),
  createDirectionCommand('north', ['north']),
);
buildRooms(w, layout);
buildAreas(w, layout);
buildRoomBehaviors(w, rooms);

const player = w.entities.createWithId('player');
w.entities.addComponent(player, Position, { roomId: layout.entry });
w.entities.addComponent(player, Visited);
markVisited(w, player); // seed 出生房间（初始位置没有 Moved 事件）

// map 只画当前区域，抬头是【区域名】（跨区域坐标不该撞进同一张图）
assert.equal(
  await w.execute('map', player),
  '【村庄】\n@\n图例：@ 当前位置 · 已探明（未探明区域留白）',
  '区域地图应按当前区域过滤',
);

// worldmap 画区域之间的连接（战争迷雾：区域内去过任意一间房才算探明）
assert.equal(
  await w.execute('worldmap', player),
  '@\n图例：@ 当前位置 · 已探明区域（未探明区域留白）',
  '出生时世界地图应只点亮出生区域',
);

// 守卫：没火把，泥沼进不去
await w.execute('east', player); // 村口广场 → 荒野小径
await w.execute('south', player); // 想进毒雾泥沼
assert.equal(
  w.entities.getComponent(player, Position)!.roomId,
  'path',
  '守卫拒绝后不应落位（无 Moved，更无 enter）',
);

// 房间命令：search 挖火把，state 组件记账（可快照、可回滚）
// 返回值语义：在房间内时翻译层返回 null，真实文案走 OutputCollector
const narrate = async (input: string) => {
  w.output.clear();
  await w.execute(input, player);
  return w.output
    .getAll()
    .map((m) => m.segments.map((s) => s.text).join(''))
    .join('\n');
};

await w.execute('west', player); // 回村口广场
assert.ok(
  (await narrate('search')).includes('你从干草堆里翻出一支火把。'),
  '房间命令应经 OutputCollector 输出结果',
);
assert.ok(
  (await narrate('search')).includes('干草堆已经被你翻遍了。'),
  'state 持久：第二次搜空',
);

// 房间命令有系统特权：spawn 出来的东西真捡得走
await w.execute('take 火把', player);
const held = w.entities
  .findByComponent(Located)
  .some((id) => w.entities.getComponent(id, Located)?.at === player);
assert.ok(held, 'spawn 出的火把应在玩家背包里');

// 有火把了：守卫放行，enter 生命周期在真正落位后触发
await w.execute('east', player);
assert.ok(
  (await narrate('south')).includes('毒雾无声无息'),
  'enter 应在真正落位后触发（Moved 是结果不是意图）',
);
assert.equal(w.entities.getComponent(player, Position)!.roomId, 'mire', '守卫放行后应落位');

// 走进荒野后，世界地图点亮它
assert.equal(
  await w.execute('世界地图', player),
  '·—@\n图例：@ 当前位置 · 已探明区域（未探明区域留白）',
  '探索应驱动世界地图展开',
);

// ---- 3. every：世界时间驱动的房间心跳（drift-free，间隔必须是 tick 的整数倍）----
const CandleState = trait('candle_state', () => ({ fuel: 3 }));
const tw = createTestWorld({
  tickInterval: 1000,
  clock: new ManualClock(),
  systems: [MovementSystem, VisitationSystem],
  commands: [GoCommand],
});
const candleRooms = [
  defineRoom({
    id: 'shrine',
    name: '荒废神龛',
    description: '一支蜡烛在角落燃烧。',
    exits: {},
    state: CandleState,
    on: {
      every: {
        ms: 2000,
        handle(ctx) {
          ctx.state.fuel -= 1;
        },
      },
    },
  }),
];
buildRooms(tw.world, layoutRooms(candleRooms, { entry: 'shrine' }));
buildRoomBehaviors(tw.world, candleRooms);

tw.advance(4500); // 跨过 2000ms 与 4000ms 两个网格；剩余 500ms 不够一格（drift-free）
assert.equal(
  tw.entities.getComponent('shrine', CandleState)!.fuel,
  1,
  'every 应恰好在每个网格点触发一次，不漂移不多烧',
);

console.log('06-area-room-behavior ✓ 区域层 + 自包含房间模块（state/命令/守卫/生命周期/every） 全通过');
