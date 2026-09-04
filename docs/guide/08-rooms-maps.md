# 08 · 房间与地图

> **本章你会学到**：`@mud/prefabs` 的房间定义、坐标自动推断、ASCII 地图与迷雾。
> 从这一章起进入领域篇——引擎核心 + 预制件一起用。
> 本章代码对应验证示例 [05-room-map.mts](../examples/05-room-map.mts)。

---

## 只写拓扑，地图是免费赠品

房间曾是唯一没有 `define*` 封装的领域对象。v0.8 补上，并让地图成为**免费赠品**：
你只写"森林在村庄东边"，二维坐标和连线由 `layoutRooms()` 从入口 BFS 自动推断。

```ts
import {
  MovementSystem,
  VisitationSystem,
  MapCommand,
  createDirectionCommand,
  Position,
  Visited,
  defineRoom,
  layoutRooms,
  buildRooms,
  renderAsciiMap,
  markVisited,
} from '@mud/prefabs';

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
```

## 拓扑写错 → 定义期 fail-fast

重复 id / 悬空出口 / 坐标撞格 / 显式坐标不一致 / **反向出口不自洽**
（A east→B 但 B 用 east→ 指回 A）/ 孤岛房间——全在 `layoutRooms` 时抛错，
启动即炸，玩家不会走进第三个房间才发现地图像鬼画符：

```ts
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
```

## 渲染与迷雾

`renderAsciiMap` 是**纯函数**（坐标 → 字符串），测试可直接逐行断言；
每个地点画自己的名字，当前所在的名字后缀标 `(你)`。迷雾只画已探明房间——
指向未探明/图外的出口画一小段**断线**（暗示这边有路，不剧通向哪）：

```ts
// 全图渲染：地名直书，(你) 标当前位置
assert.equal(
  renderAsciiMap(layout.rooms, { current: 'cave' }),
  ['村庄 ─── 森林小径', '             │', '           沼泽 ─── 蛛巢洞穴(你)'].join('\n'),
);

// 迷雾：没探明的洞穴不出现，但沼泽东侧画断线暗示洞口方向
assert.equal(
  renderAsciiMap(layout.rooms, { visited: ['village', 'forest', 'swamp'] }),
  ['村庄 ─── 森林小径', '             │', '           沼泽──'].join('\n'),
);
```

## 注入世界：探索驱动地图展开

```ts
const w = new World();
w.register(MovementSystem, VisitationSystem);
w.registerCommands(
  MapCommand,
  createDirectionCommand('east', ['east']),
  createDirectionCommand('south', ['south']),
);
buildRooms(w, layout); // 注入：Name / Description / Exits / Coordinates

const player = w.entities.createWithId('player');
w.addComponent(player, Position, { roomId: 'village' });
w.addComponent(player, Visited);
markVisited(w, player); // seed 出生房间（初始位置没有 Moved 事件可订阅）

// 出生点：地图只有自己
assert.equal(
  await w.execute('map', player),
  '村庄(你)──',
);

await w.execute('east', player); // 森林
await w.execute('south', player); // 沼泽
const explored = (await w.execute('map', player))!;
assert.ok(
  explored.startsWith('村庄 ─── 森林小径') && explored.includes('沼泽(你)'),
  '探索过森林与沼泽后地图应展开，当前在沼泽',
);
```

## 规则一览

| 规则 | 说明 |
| --- | --- |
| 坐标推断 | BFS 从入口铺开，四方向偏移；`up/down` 等非四方向出口可达但**无坐标**（二维平面装不下，地图不画）。v0.9 的区域层解掉了这个边界，见下一章 |
| 显式 coords | escape hatch（非欧空间），必须与推断一致，否则报错 |
| 迷雾 | 未探明区域留白——那是信息，不是空白 |
| 字符 | `名字(你)` 当前位 / `─` `───` `│` 连线 / 悬空的短线与竖线 = **断线**（出口指向未探明或图外） |

**为什么坐标在定义期推断而不是运行时**：冲突在启动阶段就炸、运行时零推断开销、
快照里坐标只是普通数据。`Coordinates` 是 `Exits` 的**派生产物**，不是第二份真相——
拓扑改了地图跟着变。

---

[← 上一篇：07 输出与渲染](./07-output.md) | [下一篇：09 区域与房间行为 →](./09-areas-behaviors.md) | [目录](./index.md)
