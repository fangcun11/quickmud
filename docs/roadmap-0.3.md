# v0.3 路线图：预制件 + 内容表达力

> 规划日期：2026-09-02。承接 v0.2（基建 + 确定性能力，tag v0.2.0）。
> 原则不变：先红后绿、金测试护航、全量验证后才提交。

---

## B0. 蓝图预制件（blueprint / spawn）★ 公共前置

最重用实体创建的声明化：蓝图是纯数据，spawn 是确定性的 addComponent 序列。

**设计要点**：
- `blueprint({ name?, components, tags? })`：纯对象，无逻辑；
  `components` 为 `[trait, data]` 或调用 trait 工厂的结果
- `world.spawn(blueprint, { id?, patch? })`：内部即 createWithId + addComponent；
  `name` 自动挂 Name trait（findEntity 可查）；`patch` 支持组件级覆盖
- 确定性：同蓝图 + 同 id ⇒ 完全相同的实体（D1 录像重放要求初始世界一致）
- 与命名约定协同：挂 position/health/inventory 的实体自动被开发者命令识别
- 不做：继承树、序列化格式、延迟解析（引用未注册 trait 时 fail-fast）

**验收标准**：
- [x] spawn 产出的实体与手写 addComponent 逐组件等价
- [x] patch 覆盖生效且不污染蓝图本身（蓝图不可变）
- [x] 同 id 重复 spawn 快照恒等；确定性金测试无回归
- [x] 蓝图引用未注册 trait 时 fail-fast（patch 拼错键名同样 fail-fast）
- [x] 同蓝图多次 spawn 实体互不共享组件引用（深拷贝隔离，改 A 不污染 B）

## B. 对话与 NPC ★ 已完成核心（2026-09-02）

**已落地**（对应 CHANGELOG [Unreleased] 新增）：
- `Dialogue` trait（对话树 + 活动指针）+ `Memory` trait（记忆 flags）
- `DialogueSystem` + `createDialogueCommands()`（talk/ask/说/对话 + 选项序号）
- 分支模型：`requires`（flags 门，过滤不可见选项）/ `remember`（写记忆）/
  `to`（节点跳转）/ `reply`（收尾语）——纯数据，无 DSL 无函数，组件可 JSON
- `DialogueChoiceMade` 事件：选项生效时 emit，效果系统（给物品/发任务）经事件链接入
- demo：酒馆酒保对话（问名字→买麦酒→解锁传闻分支），REPL 冒烟通过
- 新测试 15 个（内容校验 / talk / choose / 门控 / 记忆 / 快照 round-trip / 录像重放）

**设计决策（与 0.1 砍 YAML 一脉相承）**：对话树内联在代码里作为纯数据；
条件/记忆用 flags 而不用函数或 DSL——组件数据因此保持可序列化、可快照、确定性。
函数式条件与多段语义文本（Segment）留待真实需求。

**后续候选**（按需）：效果系统示范（经 DialogueChoiceMade 给物品）、
多轮记忆记录（时间戳/历史栈）、对话树复用与共享（内容外置注册表）。

## D. 领域预制件包（@mud/prefabs）★ 已完成第一版（2026-09-02）

分层决策：引擎只保留**能力原语**（ECS/确定性/快照/对话机制），**领域常用件外置**。

- `@mud/prefabs` 0.1.0：移动/房间（MovementSystem + Moved + Go/方向命令）、查看/描述
  （DescriptionSystem + Look）、背包（Inventory）、状态（Score）——从 demo 上移并产品化
- 组件名即约定：`position/inventory/health` 等 trait 的正式主人，引擎开发者命令依赖它们
- 质量门与 engine 同标准：确定性 ESLint 禁令、9 集成测试、双格式构建、外部契约测试
- demo 改为消费该包（bootstrap 只留世界观内容），REPL/Web 回归通过

后续预制件候选：实体容器/拾取（C 路线 A 已定规格，见下）、战斗/伤害、任务进度、NPC 巡逻
（复用 engine every/错误策略）。

## C. 容器与物品系统 ★ 已完成（2026-09-02，路线 A）

### 目标

让物品成为**真实存在于世界的实体**：能放在房间地上、能被拾起/放下、能被装进背包与容器、
能被对话效果送出——形成完整可玩闭环。当前 `Inventory.items: string[]` 只是物品名字，谈不上物品。

### 数据模型（路线 A：语义放 prefabs，引擎核心零改动）

- **新增 `Located { at: EntityId | null }`**（prefabs trait）：物品实体的**单源位置**。
  `at` = 所在容器实体 id（房间/玩家/箱子都只是普通实体，均可作容器）。
  `null` = 虚无（预留，一般不用）
- **移除 `Inventory { items: string[] }`**：玩家背包 = "`Located.at == 玩家` 的物品集合"。
  查询用 `entities.findByComponent(Located)` 过滤 + 取 `Name`，O(n) 对 demo/中型世界足够
- breaking 成本 ≈ 0：prefabs 还是 0.1.0 未发布；改动面 = prefabs + demo + 引擎 dev-commands

### 分层修正（关键决策，需确认）

`createDeveloperCommands` 的 `/give` 按 `inventory.items` 写字符串——在新模型下该组件不复存在，
**引擎实现无法（也不该）依赖 prefabs 的 Located 语义**。方案：

- `/give` 从 engine 的 `createDeveloperCommands()` 移除（0.3.0 刚 tag 未 publish npm，
  实际影响为零），记录为 breaking
- 物品版开发者命令（如 `/make <name> [n]`：创建实体并放入玩家容器）放 prefabs，
  作为"物品开箱即用"的一部分
- engine 保留 `/tp /heal`（health/position 约定不变）与 `/dev-help`

### 命令与事件（prefabs 新增）

| 命令 | 语义 |
| --- | --- |
| `take <物品>` | 物品实体 `Located.at` = 当前房间 && Portable → 改为玩家 id；emit `ItemTaken` |
| `drop <物品>` | 背包中物品 → `Located.at` 改为当前房间；emit `ItemDropped` |
| `inventory` | 列出玩家容器中的物品名（替代读 Inventory.items） |
| `look`（增强） | 当前房间内可拾取物品列表追加到描述输出 |

### demo 闭环（对话效果第一次真正落地）

- 酒馆容器预置"麦酒"实体；`BarkeepEffectsSystem` 订阅 `DialogueChoiceMade`，
  玩家点了"来一杯麦酒"→ 把麦酒移到玩家容器
- 广场预置剑/金币 → look 可见 → take → inventory 可见 → drop 回地面

### 质量门

Located 只是组件数据，快照/回滚/录像天然一致。测试覆盖：拾取/放下转移、
房间物品列表、take 不存在的物品、容器间转移、快照 round-trip、录像重放、
dev-commands 变更回归。demo REPL + Web 双端回归。

## 排期

B0（0.5 天）→ B 核心（2026-09-02 完成）→ D 预制件包第一版（2026-09-02 完成）
→ C 容器与物品（2026-09-02 完成，路线 A：Located 实体物品 + take/drop + 对话给物）
→ 候选：NPC 巡逻/战斗伤害/任务进度（复用 engine every/错误策略）
