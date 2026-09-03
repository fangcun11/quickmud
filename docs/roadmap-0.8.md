# v0.8.0 设计定稿：房间定义封装 + 隐式坐标 + ASCII 地图

- 日期：2026-09-03 · 基线：v0.7.0（engine 0.6.0 / prefabs 0.5.0）
- 主题：**内容作者体验（DX）**——房间这个唯一的"裸奔"领域对象终于有封装
- 起点：用户提出「`defineRoom` + 入口房间配坐标、其余隐式推断 + 自动生成 ASCII 地图」；
  评估后确认可行（已用两个现有 example 的真实房间图跑通推断与渲染，零冲突）

---

## 一、现状与动机

| 现状 | 问题 |
| --- | --- |
| 引擎有 `defineCommand`/`defineSystem`/`defineEvent`/`defineDialogue` | **房间是唯一没有 `define*` 封装的领域对象** |
| 房间 = 手写 `Name` + `Description` + `Exits` 三件套 | mini-rpg 的 bootstrap 里 30 行样板循环；20 房间内容会失控 |
| 房间没有坐标概念 | 无法画地图；`Exits` 的拓扑关系只存在于数据里，人眼不可验证 |
| 玩家没有探索状态 | 地图只能全图输出（等于送图） |

**实证（v0.7 基线）**：对 mini-rpg（4 房间）与 demo-adventure（3 房间）跑 BFS 推断 +
反向出口自洽检查，两者**零冲突**，ASCII 渲染符合直觉：

```
mini-rpg（入口 village）      demo-adventure（入口 town_square）
  S—·                          ·
    │                          │
    ·—·                        S—·
```

## 二、边界（本版不做，进缺口清单）

| 不做 | 理由 |
| --- | --- |
| z 轴 / 楼层 | 先二维。`Coordinates` 将来加可选 `z` 字段不算 breaking |
| 非四方向出口的几何表达 | `up/down/in/out` 参与可达性判定，但**不参与坐标推断**——跨层可达的房间在二维平面上无处安放，因此**没有坐标、地图不画**（不硬塞 `(0,0)` 导致重叠覆盖） |
| 自动寻路 `findPath` | 有了坐标才有需求，等真实内容（"带我去酒馆"）逼出来 |
| 大地图视口裁剪 / 滚动 | 本版全量输出；地图大到需要裁剪时再设计视口 |
| 地图格子上标房间名 | 用符号 + 图例；名字标注交给内容层自己扩展 |
| 房间内子区域（房间里的"东南角"） | 属于坐标粒度细化，暂不需要 |

## 三、数据模型（prefabs，engine 零改动）

```ts
/** 房间坐标（由 Exits 派生，定义期一次性算好写入） */
export const Coordinates = trait('coordinates', () => ({ x: 0, y: 0 }));

/** 探索记录（挂玩家/有探索概念的实体；可 JSON、进快照、去重） */
export const Visited = trait('visited', () => ({ rooms: [] as string[] }));
```

**单一真相铁律**：`Exits` 是拓扑的唯一真相，坐标是它的**派生产物**。
不允许"两处各写一遍"——否则 20 房间时必然漂移。显式 `coords` 只是 escape hatch
（非欧空间 / 作者想精确控制），且必须与推断结果一致，否则 fail-fast。

## 四、API

```ts
export interface RoomDef {
  id: string;
  name: string;
  aliases?: string[];
  description: string;
  exits: Record<string, string>;      // 方向 → 房间 id（拓扑真相）
  coords?: { x: number; y: number };  // 可选：显式钉住，默认由推断得出
}

/** 房间定义（与 defineDialogue 同款：校验 + 返回纯数据，可 JSON） */
export function defineRoom(def: RoomDef): RoomDef;

export interface LayoutOptions {
  entry: string;                          // 入口房间 id（必填，坐标系锚点）
  entryCoords?: { x: number; y: number }; // 默认 { x: 0, y: 0 }
  checkReverseExits?: boolean;            // 默认 true
}
export interface LayoutResult {
  entry: string;
  rooms: Array<RoomDef & { coords: { x: number; y: number } }>;
}

/** 推断坐标：BFS 从入口铺开，冲突一律 fail-fast（定义期，不是运行时） */
export function layoutRooms(defs: RoomDef[], opts: LayoutOptions): LayoutResult;

/** 注入世界：为每个房间 createWithId + Name/Description/Exits/Coordinates */
export function buildRooms(world: World, layout: LayoutResult): void;

/** 地图渲染纯函数（无副作用、可单测、可直接断言每一行） */
export function renderAsciiMap(
  rooms: Array<{ id: string; coords: { x: number; y: number }; exits: Record<string, string> }>,
  opts?: { entry?: string; current?: string; visited?: string[] },
): string;

/** 探索记录工具：seed 入口房间（玩家初始位置没有 Moved 事件可订阅） */
export function markVisited(world: World, entity: EntityId, roomId?: EntityId): void;

export const VisitationSystem;  // on: [Moved] —— 落位后记入 Visited
export const MapCommand;        // map / 地图
```

### 推断算法

BFS 从 `entry` 出发，四方向偏移：`north (0,-1)`、`south (0,1)`、`east (1,0)`、`west (-1,0)`。
非四方向键（`up/down/in/out`…）**跳过，不参与几何**。

**为什么在定义期而不是运行时**：
1. 冲突在启动阶段就炸，玩家不会走到第三个房间才发现地图崩了；
2. 运行时零推断开销、零非确定性；
3. 快照里坐标只是普通数据（与结构体完全一样安全）。

**`checkReverseExits` 是诊断开关，不是放行开关**：四方向拓扑下"反向写反"几乎必然
伴随坐标冲突（几何自洽本身就隐含回边方向正确），关掉它只是不再优先给出
「A east→B，但 B 用 east→ 指回 A」这条最可读的诊断——几何冲突照旧 fail-fast。

### 冲突清单（全部 fail-fast，抛带房间 id 的明确错误）

| 冲突 | 触发条件 |
| --- | --- |
| 重复 id | 两个房间同 id |
| 入口不存在 | `entry` 不在 defs 中 |
| 悬空出口 | `exits[d]` 指向不存在的房间 id |
| 坐标冲突 | 推断出的坐标与该房间已定坐标不一致，或该格子已被别的房间占用（图无法嵌入平面） |
| 显式坐标冲突 | 显式 `coords` 与推断不一致；或两个显式坐标重叠 |
| 反向不自洽 | `A -d-> B`，而 B 存在指回 A 的**四方向**边却不是 `opposite(d)`（手滑最常见的形态） |
| 孤岛房间 | 从入口 BFS 不可达（内容 bug，地图会缺一块） |

校验顺序：结构（重复 id / 入口 / 悬空出口 / 显式坐标重叠）→ BFS 推断
（坐标冲突 / 显式不一致 / 反向）→ 孤岛。

## 五、ASCII 地图

**网格**：房间占 `(2x, 2y)`，连线占其间的奇数格；`W = 2*(xmax-xmin)+1`、`H` 同理。

**字符表**：

| 字符 | 含义 |
| --- | --- |
| `S` | 入口房间 |
| `@` | 当前所在（覆盖 `S`/`·`） |
| `·` | 已探明房间 |
| （空格） | 空 / 未探明区域 |
| `—` `│` | 东西向 / 南北向连接 |

**迷雾规则（关键取舍）**：
- 传 `visited` 时只渲染**已访问房间**及其**互相之间**的连线；未探明区域一律空白。
  即**两端都已访问才画连线**——从已探明房间指向未知房间的连线会暴露邻接信息，
  不画（最保守、行为最可预测，不需要 stub 开关）。
- 不传 `visited`（玩家没挂 `Visited`）→ 渲染全图（内容没声明要迷雾就不要迷雾）。
- 因此迷雾模式下不出现"已知存在但没去过"的房间——本版没有这种信息源。

**`VisitationSystem` 的顺序陷阱**（v0.7 毒雾同款）：`Moved.to` 是**方向**不是房间 id，
用 `Exits[to]` 反查目标房间，而不是读 `Position`——后者依赖"注册在 MovementSystem 之后"，
前者与注册顺序无关。

## 六、验证门

- prefabs 单测（TDD 先红后绿）：推断（直线 / 分叉 / 回路 / 非四方向跳过）、
  七类冲突各一条 fail-fast 用例、显式 coords、渲染快照（全图 / 迷雾 / 当前位置 / 入口）、
  `Visited` 记录与去重、`MapCommand` 输出、确定性（同输入同字符串）
- mini-rpg：初始只见村庄 → 走过后地图展开；`?`/未探明区域确认为空白
- demo-adventure 迁移回归（v0.6 内容照旧可玩）
- 契约测试：ESM 冒烟（`defineRoom`/`layoutRooms`/`buildRooms`/`renderAsciiMap` + `map` 命令）、
  TS strict 类型契约
- 新增 `docs/examples/05-room-map.mts`（房间定义 + 地图 + 迷雾），纳入 strict tsc + 运行双验证
- **engine 零改动**：全部落在 prefabs + example

## 七、发版

`v0.8.0`（prefabs 0.6.0；**engine 停在 0.6.0**——连续两版引擎零改动，是分层成功的标志）。

---

## 实现记录（2026-09-03 交付）

### 验证结果

- prefabs 86/86（room.test.ts 19 + map.test.ts 17：推断、七类冲突各一条 fail-fast、
  渲染快照、迷雾、VisitationSystem、MapCommand、确定性）
- mini-rpg content.test.ts 7/7（新增地图两幕：出生点迷雾只亮自己 → 终局全图展开）、
  demo-adventure tsc + REPL 冒烟（酒馆在广场北正确渲染、撞墙不记账）
- 双包契约通过（新增：拓扑冲突 fail-fast、`buildRooms` 坐标、`map` 命令、`renderAsciiMap`
  迷雾、CJS/TS strict 类型）；docs 示例 01–05 双验证通过（新增 05-room-map.mts）
- **engine 零改动**：diff 全在 prefabs + example + docs

### 与定稿不同的决策（都是实现中被测试逼出来的）

1. **非四方向可达的房间没有坐标**（定稿原拟"跳过几何不画"）：测试发现给它硬塞
   `(0,0)` 会让两个房间同格、地图互相覆盖。正确模型是 `coords?: undefined`——
   跨层/非欧可达的房间二维平面装不下，地图不画它。
2. **`checkReverseExits` 是诊断开关，不是放行开关**：四方向拓扑下"反向写反"
   几乎必然伴随坐标冲突（几何自洽本身隐含回边正确），关掉它只意味着不再优先给出
   「A east→B，但 B 用 east→ 指回 A」这条最可读的错误——几何冲突照旧 fail-fast。
3. **反向检查要扫对端全部回边，不能只看 `opposite` 一个方向**：初版漏掉
   `A east→B` + `B east→A` 这种"双向同方向"的写反（A 没有 west 边可查），
   被"坐标冲突"兜底但诊断不可读。修正：检查对端所有**四方向**指向本房间的边，
   任一方向非 `opposite` 即报错。
4. **坐标冲突要查格子占用表**：初版只在目标"已有坐标"时比对，两个房间同时被推断
   进同一格（图无法嵌入平面）时漏网。修正：维护 `"x,y" → 房间` 占用表，谁先占格
   谁说话。
5. **迷雾地图的坐标系按全图定 bounds**：初版只按已访问房间算网格，地图会随探索
   "跳动"（每次移动房间相对位置都变）。改为坐标固定、只裁尾部空行。

### mini-rpg / demo 迁移的附带修正

- mini-rpg 森林的描述原文案"北面回村庄"与拓扑（west）不符——顺手改对。
  这类文案漂移正是"定义期校验"想抓的；出口与描述目前仍需人工对齐
  （缺口清单候选：校验描述中提到的方向都存在？）。
- 玩家出生点改用 `layout.entry`——房间拓扑与初始位置不可能写歪。

### 缺口清单（本版不做，等真实需求）

| 缺口 | 触发条件 |
| --- | --- |
| z 轴 / 楼层 | 地图需要表达纵向连接时 |
| 地图视口裁剪 / 滚动 | 地图大到终端放不下时 |
| 房间名直接标注在地图上 | 想在地图上认路而不是靠图例 |
| 已知存在但未探明的房间（`?` 格） | 出现"从 NPC 听说某地"的信息源时 |
| 自动寻路 `findPath` | 出现"带我去酒馆"类需求时 |
