# v0.6.0 设计定稿：闭环（掉落 + 任务进度 + 时间可控）

- 日期：2026-09-02 · 基线：v0.5.0（engine 0.5.0 / prefabs 0.3.0）
- 主题：**让世界形成第一个完整循环** `击杀 → 掉落 → 拾取 → 交任务 → 奖励`
- 性质：A 主线纯 prefabs + demo（引擎零改动）；B 搭车项动引擎测试工具

---

## 为什么是这两件事

1. **`Died` 是悬空承诺**：v0.5.0 的 CHANGELOG 写着"`Died` 为掉落/任务效果系统的钩子"，
   但全仓库该事件**零消费者**。杀了野狗，它凭空消失——玩家没有"为什么而战"。
2. **`ManualClock` 是空头支票**：API 评审 P1-4 记录了 `clock.advance(ms)` 不驱动世界时间，
   当时只把文档改成诚实说法。现在 `every` 系统（NPC 巡逻）已上生产，后面任务冷却、
   刷怪还会加——**欠债利息随 every 系统数量线性上涨**，越拖越贵。

## 不做（本版边界）

| 不做 | 理由 |
| --- | --- |
| 概率掉落 | `Math.random` 违反引擎铁律；确定性伪随机需要设计 seed 来源，单开一版 |
| 任务链 / 分支剧情 | 先跑通单任务闭环，链式留 v0.7 |
| 引擎级 quest 注册表 | 曾删除 `SnapshotData.quests` 死承诺，不再回引擎；任务状态全放组件 |
| NPC 主动反击（仇恨/追击） | 属战斗手感，排在闭环之后（v0.7） |

---

## A1 · 掉落系统（@mud/prefabs）

### 组件

```ts
export const Loot = trait('loot', () => ({ drops: [] as LootEntry[] }));

/** 掉落条目：纯数据（可 JSON），不含函数/类 */
export type LootEntry = {
  name: string;              // 掉落物名字（同时是 Name.text）
  aliases?: string[];        // 别名，供 take/look 解析
  description?: string;      // 掉落物描述
  portable?: boolean;        // 默认 true —— 掉落物就是要能被捡起
  damage?: number;           // >0 时挂 Weapon（掉落武器）
};
```

**为什么是数据而不是蓝图引用**：组件数据必须可 JSON（引擎铁律，快照走 `structuredClone`）。
`LootEntry` 是 plain object，进快照/回滚/fork 天然安全；蓝图对象带 `ComponentDefinition`
（含函数），塞进组件数据会破坏这条约束。掉落时由 `LootSystem` 用 `blueprint()` **运行时构造**
蓝图——`blueprint()` 是纯函数，运行时调用没有任何问题。

### 事件与系统

| 事件 | 载荷 | 时机 |
| --- | --- | --- |
| `LootDropped` | `{ entity, roomId, items: EntityId[] }` | 掉落物已创建并落入房间容器后 |

`LootSystem`（`on: [Died]`，priority 0）：

1. 读死者 `Loot`（`CombatSystem` 是"先 emit `Died` 再 destroy"，所以此刻实体仍在，
   组件可读——**这个顺序是契约，测试里锁死**）
2. 逐个 entry 构造蓝图 → `ctx.spawn(bp, { patch: { located: { at: roomId } } })`
3. 输出 `「野狗」倒下，掉了一块生肉。`（掉落物名拼接，中文无空格）
4. emit `LootDropped`（任务系统的 kill 型目标与后续统计的钩子）

无 `Loot` 组件 → 静默返回（不是错误，大部分实体本来就不掉东西）。
死亡房间取 `Died.roomId`（由 `CombatSystem` 填充），不反查死者 `Position`——
实体可能已被销毁，且 `Died` 的 roomId 才是语义上的"倒下地点"。

---

## A2 · 任务进度系统（@mud/prefabs）

### 组件

```ts
/** 挂 NPC：ta 能提供什么任务 */
export const QuestGiver = trait('quest_giver', () => ({ quests: [] as QuestDef[] }));

export type QuestDef = {
  id: string;
  title: string;
  objective:
    | { type: 'collect'; target: string; count: number }   // target = 物品名
    | { type: 'kill'; target: string; count: number };      // target = 生物名
  reward?: { items?: LootEntry[]; heal?: number };
};

/** 挂玩家：任务进度（纯数据，进快照） */
export const QuestLog = trait('quest_log', () => ({
  active: {} as Record<string, number>,   // questId → 已达成数量
  completed: [] as string[],              // 已达标的 questId
  turnedIn: [] as string[],               // 已交任务的 questId
}));
```

### 目标类型（v0.6 只做两种）

| 类型 | 推进事件 | 匹配 | 说明 |
| --- | --- | --- | --- |
| `collect` | `ItemTaken` | 被拾取物品的 `Name.text` 与 `objective.target` **包含匹配** | `实际拿到手的物品名.includes(target)` —— 与 take 的名称解析方向一致，不做别名展开（掉落物名字由内容作者写全） |
| `kill` | `Died` | 死者 `Name.text` 与 target 包含匹配，且 `killer` 是该玩家 | 掉落在 `Died` 之前发生（LootSystem 的 priority 与 QuestSystem 相同，注册序在后即可保证先后） |

**为什么按名字匹配而不是实体 id**：掉落物是运行时 `spawn` 的新实体，id 由计数器生成、
不可预知；名字才是内容作者能写进 `QuestDef` 的稳定锚点。这与 `look <目标>` / `take <物品>`
的名称解析路线一致。

### 归属与接取（关键简化）

- **不设接取步骤**：任务对所有挂了 `QuestLog` 的玩家开放，首次产生进度时写入
  `QuestLog.active` 并 emit `QuestStarted`。少一个命令，少一条出错路径
  （接取仪式 / 前置任务链留 v0.7）。
- **进度全局追踪**：推进**不比较房间**——在酒馆接任务、去广场杀怪是常态，
  按房间记账会让任务永远记不上功。房间只在**交付**时有意义。
- **房间归属**：新增查询工具 `containerOf(q, entity)` —— 优先 `Position.roomId`，
  回退 `Located.at`（常驻 NPC 挂在房间里）。demo 的酒保此前**两个组件都没有**，
  接入时补 `Located { at: 'tavern' }`。
- **交任务**：`turnin` 命令找**同房间** `QuestGiver`，取"已完成且未交"且归属 ta 的任务 →
  emit `QuestTurnedIn`；系统与命令双重校验房间。奖励物品 `ctx.spawn` 直接进玩家容器；
  `heal` 直接加 HP（上限 max）。

> 实现期修正：初稿把"同房间"也写进了推进条件，测试阶段发现这让任务完全不可用
> （玩家在酒馆接任务、去广场杀狗 → 永远 0 进度），遂改为全局追踪 + 回程交付。

### 事件与命令

| 事件 | 载荷 |
| --- | --- |
| `QuestStarted` | `{ player, questId, giver }` |
| `QuestProgressed` | `{ player, questId, progress, count }` |
| `QuestCompleted` | `{ player, questId, giver }` |
| `QuestTurnedIn` | `{ player, questId, giver }` |

| 命令 | 语义 |
| --- | --- |
| `quests` / `任务` | 列出**当前房间 NPC 提供**的任务及进度（进行中 x/y、已完成待交、已交），无内容时提示去别处打听 |
| `turnin` / `交任务` | 向同房间的发任务者交付已完成任务，领奖 |

---

## B · ManualClock 真正驱动世界时间（@mud/ecs-engine）

### 现状

`tick()` 只做 `timeMs += tickInterval`，**从不读时钟**——世界时间本来就与真实时间无关，
是纯确定性的。`ManualClock` 是游离的计数器，`advance(ms)` 与世界毫无连接。

### 改法

1. `ManualClock` 增加一个**推进槽位**（sink）：`advance(ms)` 先 `time += ms`，再调用 sink
2. `TestWorld` 构造时把 sink 装到 clock 上：`clock.advance(ms)` → 目标时间 = 当前世界时间 + ms，
   循环 `world.tick()` 直到 `world.currentTime >= target`
3. 每 tick 后把 `clock` 同步为世界时间（tickInterval 不整除时世界时间会略超，以世界为准）
4. `TestWorldConfig` 补 `tickInterval`（默认 100，测试里推进更精细）
5. 便捷 API：`TestWorld.advance(ms)`、`TestWorld.tick(n = 1)`
6. 防护：`tickInterval <= 0` 时抛显式错误，绝不退化成死循环

### API 形态

```ts
const clock = new ManualClock();
const tw = createTestWorld({ systems: [NpcWanderSystem], clock, tickInterval: 100 });

clock.advance(3000);   // → 30 次 tick，every:3000 的巡逻系统触发 1 次
tw.currentTime;        // 3000（与世界时间一致）
```

`ManualClock` 仍可独立使用（不装 sink 时退化为纯计数器），不破坏既有测试。

---

## 验证门（结果，2026-09-02）

- **prefabs 单测**：40/40（物品 22 + 掉落 7 + 任务 11），TDD 先红后绿；
  含快照 round-trip 与录像重放
- **engine 单测**：101/101（含 `test-world.test.ts` 10 条时钟契约）
- **契约测试**：双包全新安装通过；prefabs 冒烟补掉落 + 任务链路
  （杀狗 → 掉狗肉 → 拾取 → 跨房间交付被拒 → 回酒馆交付 → 奖励入包）
- **demo REPL**：杀野狗 → 掉狗肉/项圈 → 捡起 → 酒保连交两任务 → 领陈酿麦酒/金币；
  web 构建 79.2 KB 通过
- **文档**：`verify-doc-examples` 四示例 strict tsc + 运行双通过
  （04-loot-quest 为新增）；guide/README 同步

### 实现期修正（与初稿设计的差异）

1. **死亡管线**：初稿假设"CombatSystem 先 emit Died 再 destroy，LootSystem 在
   destroy 前读得到组件"——错。处理中 emit 只入队，等 Died 排到时实体已销毁，
   掉落静默失效。改为 CombatSystem 只 emit、`DeathSystem`（priority 100）末端清场
2. **任务进度全局追踪**：初稿把"同房间"写进推进条件，测试阶段发现这让任务
   完全不可用（在酒馆接任务、去广场杀狗永远 0 进度）。改为推进不看房间、
   交付必须回发任务者身边

## 发版

`v0.6.0`（engine 0.6.0 / prefabs 0.4.0）。B 属 bug-fix 级行为修正（空承诺兑现），
A 为新增能力；均未 publish，无 breaking 顾虑。CombatSystem 不再自带清场属
**行为变更**（需搭配 DeathSystem），已在 CHANGELOG 与 prefabs README 显著标注。
