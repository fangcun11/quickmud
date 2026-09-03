# v0.9.0 设计定稿：区域（Area）+ 自包含房间模块

- 日期：2026-09-04 · 基线：v0.8.0（engine 0.6.0 / prefabs 0.6.0）
- 状态：**已实现**（v0.9.0，prefabs 0.7.0；实现记录见 CHANGELOG 0.9.0 条目）
- 主题：**内容模块框架**——房间从"静态数据块"升级为"自包含内容模块"，并补上 MUD
  经典分层中缺失的"区域"层
- 起点：用户两轮提问：①「房间上面还有区域、房间该有生命周期与订阅触发」
  ②「`defineRoom` 不该只定义实体，而是把实体、系统、命令、事件全封装起来」

---

## 一、现状与动机

| 现状（v0.8） | 问题 |
| --- | --- |
| `defineRoom` 返回纯数据，只有 `Name`/`Description`/`Exits`/`Coordinates` | 一个"陷阱房"要写**三处**：房间数据 + 自定义系统 + 可能的命令；改一个房间跳三个文件 |
| 动态房间 = 手写一个系统订阅 `Moved` | mini-rpg 的沼泽毒雾就是这么来的：系统里硬编码房间 id，房间与行为**物理分离** |
| 没有区域层 | MUD 经典三层（Area → Room → Object）缺了中间一层；跨房间机制（区域天气、区域封锁）无处安放 |
| v0.8 遗留边界：`up/down` 跨层房间无坐标、地图不画 | 二维平面装不下跨层空间。**区域正是这个问题的正解**（见 §六） |

**动机一句话**：内容作者想的是"这个房间有什么"，不是"哪个系统处理这个房间"。
现在的架构强迫作者按引擎的实现结构来组织内容，而不是按内容本身的边界。

## 二、边界（本版不做，进缺口清单）

| 不做 | 理由 |
| --- | --- |
| 区域嵌套（区域内含子区域） | 先单层。两层已能表达 99% 的 MUD 结构 |
| 运行时动态创建房间 | 需要把房间模块蓝图化（序列化 + spawn），v0.10+ 议题 |
| 描述式触发器 DSL（`{ on: 'enter', effect: {...} }`） | **先跑通代码回调的架构**。DSL 是语法糖，等真要做 YAML 数据驱动内容时再加，现在加是过度设计 |
| 区域间自动寻路 | 房间级 `findPath` 都还没做，区域级的更不急 |
| 触发器调试面板 / 可视化 | 等房间数量多到需要工具时才做 |
| 守卫的"组合条件"（钥匙 **或** 撬棍） | 先支持代码自由判定；条件 DSL 与上面的触发器 DSL 一起做 |

## 三、两个必须先定的架构决策

### 决策 1：定义层 vs 状态层——函数不进快照，但它们本来也不需要进

这是本方案的立身之本。**分层是清楚的**：

| 层 | 内容 | 进快照吗 | 读档时从哪来 |
| --- | --- | --- | --- |
| **定义层**（build time） | 实体、系统、命令、事件定义 | ❌ | 游戏代码重新执行 `defineRoom` |
| **状态层**（runtime） | 实体上挂的组件数据 | ✅ | 快照 |

`MovementSystem`、`GoCommand`、`Moved` 从来就不进快照——房间自带的系统与命令凭什么要进？
`defineRoom` 是个**工厂**：启动时执行，吐出实体（数据）+ 系统/命令/事件（代码），吐完即完成使命。

**唯一会真正破坏快照的情况**（必须写进文档、lint 尽量兜）：

```ts
// ❌ 闭包捕获：快照存不到，fork 出去与主世界脱钩
let collapsed = false;
defineRoom({ on: { enter: () => { collapsed = true; } } });

// ✅ 状态走组件：进快照、fork/回滚天然一致
const TrapState = trait('trap_room_state', () => ({ collapsed: false }));
defineRoom({ state: TrapState, on: { enter: (ctx) => { ctx.state.collapsed = true; } } });
```

> 一句话规则：**函数可以是代码，但状态必须在组件里。**

### 决策 2：`Moved` 语义必须拆成"意图"与"结果"——这是被正确性逼出来的

**现状**：`GoCommand` emit `Moved { entity, to(方向) }`——`Moved` 其实是**移动意图**。
`MovementSystem` 与 `VisitationSystem` 都订阅它。

**问题**：一旦房间行为（`onEnter`）也订阅 `Moved`，撞墙时会怎样？

```
玩家在村庄输入 north（没有北出口）
  → MovementSystem：出口不存在 → 输出"你不能往北走"，不落位
  → VisitationSystem：订阅到 Moved，用 Exits['north'] 反查 → undefined → 不记账 ✓（侥幸）
  → RoomEventSystem：订阅到 Moved → 触发 onEnter('north')  ✗ 房间行为被凭空触发
```

侥幸只对撞墙成立（因为 `Exits` 查不到）。一旦守卫否决（门关着），出口**存在**但走不过去：

```
玩家走向锁着的门
  → MovementSystem：出口存在，但守卫否决 → 不落位
  → VisitationSystem：Exits 查得到 → 记账 ✗ 玩家没进去却被记为"去过"
  → RoomEventSystem：触发 onEnter ✗ 人没进去，房间效果先响了
```

**这不是可选的改进，是正确性的前提。** 因此本版引入：

| 事件 | 语义 | 谁 emit | 谁订阅 |
| --- | --- | --- | --- |
| `MoveRequested { entity, to }` | 移动**意图**（方向） | 命令 | `MovementSystem`（唯一） |
| `Moved { entity, from, to }` | 移动**结果**（房间 id） | `MovementSystem` 落位后 | 一切"人真的到了"才该发生的事 |

订阅 `Moved` 的现有系统语义随之**变得更正确**：mini-rpg 的毒雾系统原本就想要"实际落位后"触发，
现在从"订阅意图"变成"订阅结果"。

> 向后兼容：`Moved` 事件仍然存在，只是语义从"意图"收窄为"已完成"。
> 内容层若手写过订阅 `Moved` 并假设它会因撞墙而触发——那本来就是 bug，本版顺手修正。

## 四、数据模型（prefabs，engine 零改动）

### 区域

```ts
/** 房间归属（挂在房间实体上；值是区域实体 id） */
export const Area = trait('area', () => ({ id: '' as EntityId }));
```

**区域是实体，不是字符串标签**——因为区域要有自己的状态（天气、危险等级、封锁）。
做成实体就能挂组件，快照/fork/回滚全都白拿。

**单一真相（与 `Coordinates` 同款）**：房间声明自己属于哪个区域，区域**不维护 rooms 数组**；
"这个区域有哪些房间" 用 `findByComponent(Area)` 反查。

### 房间状态

内容层自带 trait（类型安全 + 可 JSON），`defineRoom` 不发明新的状态容器：

```ts
const TrapState = trait('trap_room_state', () => ({ collapsed: false }));
defineRoom({ id: 'trap', state: TrapState, /* ... */ });
```

### 房间时钟（prefabs 内部组件）

```ts
/** 周期触发的记账（声明了 `every` 的房间由 buildRoomBehaviors 自动挂载） */
export const RoomClock = trait('room_clock', () => ({ lastTickedAt: 0 }));
```

内容层不直接碰它——它是 prefabs 为了 drift-free 周期判定而存在的实现细节，
但**必须进快照**（否则读档后周期节奏错乱），所以放在组件里而不是模块级变量里。

### 行为注册表

房间行为（函数）**不进组件**——放在由 `buildRoomBehaviors` 填充的模块级 `Map<roomId, RoomBehavior>`。
`fork` 出去的世界共享同一份代码表，这是对的（代码不是状态）。

## 五、API 规格

```ts
export interface RoomModuleDef<S = unknown> {
  // ── 数据部分（与 v0.8 RoomDef 完全一致，供 layoutRooms 使用）──
  id: string;
  name: string;
  aliases?: string[];
  description: string;
  exits: Record<string, string>;
  coords?: { x: number; y: number };
  area?: string;                       // 新增：所属区域 id

  // ── 行为部分（定义层，不进快照）──
  /** 房间状态组件（可传数组；数据可 JSON，进快照） */
  state?: ComponentDefinition<S> | Array<ComponentDefinition<any>>;
  on?: RoomHandlers<S>;
  /** 房间专属命令（自动附加"玩家须在本房间"校验） */
  commands?: RoomCommandDef[];
  /** 房间自定义事件（自动加 `room:<id>:` 命名空间前缀） */
  events?: Record<string, EventDefinition<any>>;
}

export interface RoomHandlers<S = unknown> {
  /** 进入后（落位之后触发） */
  enter?(ctx: RoomEventContext<S>): void;
  /** 离开后（落位之后触发） */
  leave?(ctx: RoomEventContext<S>): void;
  /** 首次进入（一次性；由 state 之外的 visited 标记控制） */
  firstEnter?(ctx: RoomEventContext<S>): void;
  /** 查看时（DescriptionSystem 输出描述之后） */
  look?(ctx: RoomEventContext<S>): void;
  /** 周期触发；ms 必须是 RoomTickSystem 的 every 整数倍（否则定义期 fail-fast） */
  every?: { ms: number; handle(ctx: RoomEventContext<S>): void };
  /** 进入守卫：返回字符串 = 否决（并作为理由输出），返回 undefined = 放行 */
  canEnter?(ctx: RoomGateContext<S>): string | void;
  /** 离开守卫：同上 */
  canLeave?(ctx: RoomGateContext<S>): string | void;
}

/** 效果上下文（系统特权：可改状态） */
export interface RoomEventContext<S> {
  roomId: EntityId;
  entity: EntityId;                 // 触发者（玩家/NPC 皆可）
  state: S;                         // 类型化的房间状态（读不到 = 未声明 state）
  emit: TypedEmit;
  getComponent: SystemContext['getComponent'];
  findByComponent: SystemContext['findByComponent'];
  spawn: SystemContext['spawn'];
  destroy: SystemContext['destroy'];
  output: SystemContext['output'];
}

/** 守卫上下文（只读：只回答 yes/no，不改状态） */
export interface RoomGateContext<S> {
  roomId: EntityId;
  entity: EntityId;
  state: S;
  getComponent: SystemContext['getComponent'];
  findByComponent: SystemContext['findByComponent'];
  /** 守卫期间禁止输出——理由通过返回值交给 MovementSystem 统一播报 */
}
```

### 工厂与构建

```ts
/** 返回 RoomModule：同时携带 def（纯数据）与行为 */
export function defineRoom<S>(def: RoomModuleDef<S>): RoomModule<S>;

/** 取出数据部分（layoutRooms 只吃纯数据） */
export function roomDefs(rooms: RoomModule[]): RoomDef[];

// 现有 API 保持不变（RoomDef / layoutRooms / buildRooms / renderAsciiMap / markVisited）

/** 新增：注入区域实体 */
export function buildAreas(world: World, areas: AreaDef[]): void;

/** 新增：注册 RoomEventSystem + RoomTickSystem（各一个）+ 房间命令 + 房间事件 */
export function buildRoomBehaviors(world: World, rooms: RoomModule[]): void;
```

**为什么不把行为塞进 `buildRooms`**：`layoutRooms` 需要纯数据才能做坐标推断（要遍历、要比较），
带上函数会污染这条纯函数链路。两段式构建让"几何"和"行为"各自保持纯粹。

### 房间命令

```ts
commands: [{
  verbs: ['撬石板', 'pry'],
  /** 玩家不在本房间时的提示（缺省用通用文案） */
  unavailable?: '这里没有可撬的石板。',
  handle(ctx) { /* 命令上下文：只能 emit，不能改状态 */ },
}]
```

- 命令**全局注册**（命令系统没有作用域概念），handle 由 prefabs 自动包一层位置校验
- **同名 verb 冲突 → fail-fast**（与坐标冲突同脾气：启动时炸，而不是运行时随机生效一个）
- 房间命令的 handle 拿不到 `spawn/destroy`——引擎的 `CommandContext` 本来就只给 `emit`，
  守着"命令只翻译意图"这条铁律

## 六、区域与分层地图

**核心洞察：区域是 v0.8 跨层遗留问题的正解。**

- 一个区域 = **一张二维地图**，区域内坐标自洽（就是现在的 `layoutRooms`）
- 跨层 = 跨区域，各算各的坐标系——`up/down` 不再需要塞进同一平面
- 世界地图 = 以区域为节点的图

**而且坐标推断算法可以完全复用**：区域图与房间图是同构的（节点 + 四方向边 + BFS）。
同一套 BFS 跑两遍——先算区域内房间坐标，再算区域间区域坐标。

```ts
export function layoutWorld(
  rooms: RoomDef[],
  opts: { entry: string; entryArea?: string },
): { areas: AreaLayout[]; roomsByArea: Map<string, LayoutResult> };
```

| 地图 | 输入 | 说明 |
| --- | --- | --- |
| 区域图 | 该区域的房间子集 | 就是现在的 `renderAsciiMap(areaRooms, {...})`，零改动 |
| 世界图 | 区域为节点 | 新增 `renderAsciiWorldMap(areas, {...})`；区域坐标由区域级 BFS 推断 |

迷雾沿用现有规则：区域图按 `Visited` 过滤；世界图上未探明区域整块留白。

## 七、生命周期与调度

### 调度：作者视角分散，运行时集中

100 个房间各带 `onEnter`，若各自注册成系统，一次事件要过 100 个系统的过滤——EventPump 变筛子。
因此**行为不是系统，而是由两个 `Room*System` 查表分发**：

```ts
/** 事件类行为：enter / leave / firstEnter / look */
export const RoomEventSystem = defineSystem({
  name: 'prefab.room.event',
  on: [Moved, Look],
  priority: 0,
  onError: 'degrade',
  handle(event, ctx) { /* 按 roomId 查 behaviors 表分发 */ },
});

/** 周期类行为：every */
export const RoomTickSystem = defineSystem({
  name: 'prefab.room.tick',
  every: ROOM_TICK_MS,            // 基础粒度，如 1000
  onError: 'degrade',
  handle(payload, ctx) { /* 遍历在场房间，按各自 every.ms 判断是否到期 */ },
});
```

**为什么必须拆成两个**（引擎机制决定的，不是风格选择）：

| 机制 | 驱动方式 |
| --- | --- |
| `on` 系统 | 由 EventPump 在事件 emit 时调用 handle |
| `every` 系统 | 由 `World.tick()` **直接调用 handle**（传 `TICK_TOKEN` 载荷），**不走 EventPump** |

一个系统若同时写 `on` 与 `every`，两种触发会**共用同一个 handle**，只能靠
`payload.token === TICK_TOKEN` 分支——可行但脏。拆开后各自的 handle 只认一种载荷。

EventPump 永远只看到一个事件系统。顺带保住"系统是唯一改状态的地方"——所有房间行为
都在系统内执行，边界清晰，也便于统一做错误降级与性能优化。

**周期粒度约束**：房间声明的 `every.ms` 必须是 `ROOM_TICK_MS` 的整数倍，
否则 `buildRoomBehaviors` 时 **fail-fast**（静默降频会让作者以为周期生效了）。
到点判定沿用引擎的 drift-free 思路：`floor(time / ms) > floor(lastTickedAt / ms)`，
`lastTickedAt` 存在 prefabs 内部的 `RoomClock` 组件上（声明 `every` 时自动挂载，见 §四）。

### 移动流程（改造后）

```
命令 emit MoveRequested { entity, to（方向）}
      │
      ▼
MovementSystem（唯一订阅者）
  ├─ 查 Exits[to]，无 → "你不能往X走" → return          （撞墙，现有行为）
  ├─ canLeave(当前房间) → 有理由 → 播报理由 → return     （新增）
  ├─ canEnter(目标房间) → 有理由 → 播报理由 → return     （新增）
  ├─ 落位 pos.roomId = target
  ├─ emit Moved { entity, from, to（房间 id）}           （新增：结果事件）
  └─ 输出房间名 + 描述
      │
      ▼
Moved 的订阅者（顺序无关，各自独立）
  ├─ VisitationSystem：记入 Visited（只有真落位才记账 ✓）
  ├─ RoomEventSystem：leave(旧房间) → enter/firstEnter(新房间)
  └─ 内容层系统（毒雾等）
```

**关键约束（已验证）：引擎的事件泵没有取消机制**——`EventContext` 只有 `emit`。
所以守卫**不能**做成"高优先级系统否决后续处理"（没有取消的手段），
必须在 `MovementSystem` 内部**同步查询**。这也正好符合守卫的语义：纯查询、无副作用。

### 周期触发的性能

`every` 只处理**有实体在场的房间**（用 `findByComponent(Position)` 求在场房间集合），
不对全图房间做无用功。粒度受 `RoomTickSystem` 的 `every` 限制（与 `BuffSystem` 同款约束）。

### 三层归属（防止过度内聚）

| 层 | 承载什么 |
| --- | --- |
| `defineRoom` | 房间局部行为：陷阱、门锁、查看触发、房间专属命令 |
| `defineArea` | 跨房间机制：区域天气、区域封锁、遭遇率、区域级 buff |
| 全局系统 | 世界级规则：战斗结算、任务链、掉落 |

"整个废墟区的毒雾"属于**区域**不属于单个房间；"护送任务"横跨五个房间，属于全局系统。
**不要让房间吃掉跨房间的机制**——这是 MUD 的 room proc 烂掉的老路。

## 八、冲突清单（fail-fast 扩展）

在 v0.8 的七类之上新增：

| 冲突 | 触发条件 |
| --- | --- |
| 区域不存在 | 房间 `area` 指向未定义的区域 id |
| 区域孤岛 | 某区域从入口区域不可达（内容 bug） |
| 区域内孤岛 | 区域内某房间从该区域入口不可达 |
| 房间命令 verb 冲突 | 两个房间注册了相同 verb |
| 房间事件名冲突 | 同 id 房间重复注册（等价重复 id，由既有检查覆盖） |
| state 重复 | 同一房间的多个 state trait 定义了同名字段（无法静态检查，运行时以第一个为准并告警） |

校验顺序：结构（重复 id / 区域存在性 / 悬空出口）→ 区域级 BFS → 区域内 BFS → 孤岛 → 命令冲突。

## 九、迁移

| 目标 | 改动 |
| --- | --- |
| mini-rpg 沼泽毒雾 | 从"独立系统硬编码房间 id"改为沼泽房间的 `on.enter` / `on.every`——**这是本方案价值的直接演示** |
| mini-rpg / demo 的 `Moved` 订阅 | 语义收窄为"结果"，行为只会更正确 |
| `renderAsciiMap` | 零改动（区域图复用它，只传子集） |
| `layoutRooms` | 保持导出与行为不变（区域内布局仍是它）；新增 `layoutWorld` 包一层 |

## 十、验证门

- prefabs 单测（TDD 先红后绿）：
  - 区域：区域实体注入、`Area` 归属、区域图/世界图渲染、区域级 BFS 冲突（区域不存在/区域孤岛/区域内孤岛）
  - 生命周期：`enter`/`leave`/`firstEnter`/`look`/`every` 各自一条；**守卫否决时不落位、不记账、不触发 onEnter**（这是决策 2 的核心回归）
  - 撞墙时不触发 `onEnter`
  - 房间命令：位置校验、verb 冲突 fail-fast
  - 状态隔离：`fork` 后改房间 state，主世界不受影响
  - 确定性：同输入序列 ⇒ 同输出
- 契约测试：ESM（区域 + 房间行为 + 守卫）、CJS（新导出）、TS strict（`ctx.state` 类型推导）
- 新增 `docs/examples/06-area-room-behavior.mts`（区域 + 陷阱房 + 守卫 + 周期触发），纳入双验证
- mini-rpg：沼泽毒雾改用房间行为重写，7 幕通关测试**行为不变**
- engine 零改动（连续三版）

## 十一、发版

`v0.9.0`（prefabs 0.7.0；engine 停在 0.6.0）。若 §三决策 2 的落地风险超预期，
则拆为：v0.9 只做「区域 + 分层地图 + `MoveRequested` 拆分」，v0.10 做「自包含房间模块」。

---

## 缺口清单（本版不做，等真实需求）

| 缺口 | 触发条件 |
| --- | --- |
| 区域嵌套 | 出现"大陆 → 王国 → 地区"三级结构时 |
| 描述式触发器 DSL | 要上 YAML/JSON 数据驱动内容时 |
| 运行时动态房间（蓝图化 + spawn） | 出现"生成地下城"需求时 |
| 守卫条件组合（与/或/非） | 门锁逻辑复杂到代码写起来啰嗦时 |
| 区域间寻路 | 需要"带我去酒馆"跨区域时 |
| 房间行为热重载 | 内容量大到不能每次改一行就重启时 |
