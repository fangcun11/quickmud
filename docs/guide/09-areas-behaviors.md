# 09 · 区域与房间行为

> **本章你会学到**：房间之上的"区域"层级、自包含房间模块（守卫 / 生命周期 /
> 房间命令 / 房间状态）。v0.9 让房间从静态数据块升级为**内容模块**。
> 本章代码对应验证示例 [06-area-room-behavior.mts](../examples/06-area-room-behavior.mts)。

---

## 两个升级一次到位

- **房间之上有了"区域"这一级**——每个区域是一张独立平面（塔顶、洞穴各自成区域），
  v0.8"非四方向出口拿不到坐标"的边界自然消失；
- **房间从静态数据块升级为自包含内容模块**——守卫、生命周期、房间命令、自己的状态。

## 定义：区域 + 房间状态 + 房间命令

```ts
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
```

## 单一真相：区域出口是反推的

```ts
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
```

房间声明 `area`，区域**不抄** rooms 反表；改房间忘改区域不可能发生。
校验同样是定义期 fail-fast：空区域 / 孤岛区域 / 区内孤岛（多半是 `area` 标错了）/
区域出口冲突（同方向通向两个区域）。

## 注入与体验闭环

```ts
const w = new World();
w.register(MovementSystem, VisitationSystem, ItemSystem);
w.registerCommands(
  GoCommand, TakeCommand, MapCommand, WorldMapCommand,
  createDirectionCommand('east', ['east']), createDirectionCommand('west', ['west']),
  createDirectionCommand('south', ['south']), createDirectionCommand('north', ['north']),
);
buildRooms(w, layout);
buildAreas(w, layout);          // 区域是实体：能挂天气/危险度等自己的组件，进快照
buildRoomBehaviors(w, rooms);   // 行为注册（必须在 buildRooms 之后）
```

验证闭环里的关键行为（完整代码见示例文件）：

- **守卫拒绝不落位**——`canEnter` 返回理由后玩家留在原地，无 `Moved`、不记 `Visited`；
- **房间命令的返回值经 OutputCollector 输出**，`state` 组件记账（第二次 `search`
  是"已经被你翻遍了"）；
- **spawn 出来的东西真捡得走**——`take 火把` 后 `Located.at` 指向玩家；
- **有火把守卫放行**，`enter` 在真正落位后触发；
- **`map` 自动按当前区域过滤**（抬头带【区域名】），`worldmap` 的战争迷雾口径 =
  区域内去过任意一间房。

## 房间心跳：every

```ts
const CandleState = trait('candle_state', () => ({ fuel: 3 }));
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
// …注入后：
tw.advance(4500); // 跨过 2000ms 与 4000ms 两个网格；剩余 500ms 不够一格（drift-free）
assert.equal(
  tw.getComponent('shrine', CandleState)!.fuel,
  1,
  'every 应恰好在每个网格点触发一次，不漂移不多烧',
);
```

间隔必须是 tick 间隔的整数倍（定义期 fail-fast），`RoomClock` 记账，drift-free。

## 为什么房间行为是"代码 + 组件"而不是把一切塞进快照

函数进不了快照（`structuredClone` 直接抛 `DataCloneError`），把行为藏进闭包等于
告别存档。`defineRoom` 的答案是：**行为是代码（回滚后重新可用），状态是数据
（`state` 组件，随快照走）**。未声明 `state` 却摸 `ctx.state` 会直接报人话错误。
跨房间的机制不要塞给单个房间——那是区域或全局系统的职责。

派发架构上，所有房间由**同一对系统查表服务**（不是一房一系统）——故障域 = 单房间，
一个房间的 bug 不连坐全世界。

---

[← 上一篇：08 房间与地图](./08-rooms-maps.md) | [下一篇：10 物品、战斗与任务 →](./10-items-combat-quests.md) | [目录](./index.md)
