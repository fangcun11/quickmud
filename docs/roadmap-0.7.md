# v0.7.0 设计定稿：最小 Buff + 小型 RPG（mini-rpg）

- 日期：2026-09-02 深夜 · 基线：v0.6.0（engine 0.6.0 / prefabs 0.4.0）
- 主题：**机制与内容同窗互相验证**——最小 Buff（定时效果层）+ 首个"纯内容"游戏
- 起点：用户决定写小型 RPG，并指出缺 Buff；本版 = 两者同窗发版（v0.5 战斗+巡逻、
  v0.6 掉落+任务的既定节奏）

---

## 边界（本版不做，进缺口清单）

| 不做 | 理由 |
| --- | --- |
| StatModifier（+攻/-防属性修正） | base vs effective 结算模型是经典分叉，等 RPG 内容逼出需求，v0.8 一次做对 |
| 叠加 / 互斥 / 驱散 / 免疫 | 同上，属于"属性层"复杂度 |
| Consumable / use 命令 | RPG 里药水效果走对话选项触发（酒保模式已验证）；`use <物品>` 留缺口清单 |
| 概率掉落 | 沿袭 v0.6 决策，等确定性伪随机设计 |

## A · 最小 Buff（@mud/prefabs，引擎零改动）

### 数据模型：Buff 是**实体**（与 Located 同哲学）

```ts
/** 挂在 buff 实体上：指向受害者 + 效果 + 起始时间 */
export const Afflicted = trait('afflicted', () => ({
  victim: null as EntityId | null,
  effect: { type: 'damage', amount: 0, every: 1000 } as BuffEffect,
  startedAt: 0,            // 世界时间（快照天然一致）
}));

/** 持续时间（与 Afflicted 分离：瞬时效果可无持续时间） */
export const Duration = trait('duration', () => ({
  lasts: 5000,             // 毫秒，自 startedAt 起
}));

export type BuffEffect =
  | { type: 'damage'; amount: number; every: number }
  | { type: 'heal'; amount: number; every: number };
```

**为什么是实体不是列表组件**：
- "谁身上有什么 buff" = `findByComponent(Afflicted)`，与 `itemsInContainer` 同款查询
- 无共享引用/嵌套列表的快照陷阱，structuredClone 天然安全
- 未来的叠加/互斥（v0.8）= 查询同 victim 同名 buff 实体，不用改数据结构
- 死亡清场 = 订阅 `Died` 销毁死者身上的 buff 实体，与死亡管线无缝

### 系统与事件

`BuffSystem`（`every: 1000`，与 NpcWanderSystem 同款 every 网格模式）：

1. 遍历所有 `Afflicted` 实体
2. **到期判定**：`worldTime - startedAt >= lasts` → emit `BuffExpired` → `ctx.destroy(buff 实体)`
3. **结算**：按 `effect.every` 网格（`floor(worldTime/every) > floor(startedAt/every)` 派生，
   防止挂上瞬间立刻结算）执行：
   - `damage`：victim 的 `Health.current = max(0, ...)`；**归零时 emit `Died`
     （killer = buff 的施加者 `source`）→ 毒杀走完整死亡管线**（掉落/任务/清场全生效）
   - `heal`：`min(max, ...)`，不 emit（静默回复）
   - 默认输出一行结算文案（中毒：`毒素侵蚀了你（-3 生命）。`；回春同理）

| 事件 | 载荷 |
| --- | --- |
| `BuffExpired` | `{ buff, victim }` |
| `BuffApplied` | `{ buff, victim }`（内容层播报/任务钩子） |

死亡清场：`BuffCleanupSystem`（`on: [Died]`，priority 50，管线中段）——
销毁 `Afflicted.victim === 死者` 的 buff 实体。victim 死了 buff 没意义，
且避免悬挂引用（与 Located 已知边界同款处理）。

### 内容侧入口：蓝图工厂

```ts
/** 构造一个 buff 实体蓝图（每次调用新建，供 ctx.spawn / world.spawn 使用） */
export function buffBlueprint(opts: {
  victim: EntityId;
  effect: BuffEffect;
  lasts: number;
  source?: EntityId;   // 毒杀归功/归咎的对象
}): EntityBlueprint;
```

内容层（对话效果、区域触发、boss 技能）拿到的是**蓝图**，spawn 与否由内容决定；
不提供"直接往目标身上塞"的全局函数——保持"系统唯一改状态、spawn 走上下文"。

---

## B · mini-rpg：第一个"纯内容"游戏（example/mini-rpg）

**定位**：验证 prefabs 分层的终极命题——**内容全程不碰两个包的源码**。
这是首个不是 demo-adventure 的内容包，顺便验证 workspace 的 example/* 约定。

### 世界与流程（纵向切片）

```
村庄(村长·任务) → 森林小径(野狼×掉狼皮) → 沼泽(进房上毒·内容系统示范)
      ↑                                            ↓
   终局(交任务+结局文案) ← 洞穴(巨蛛 boss·毒攻击·掉传家宝)
```

| 内容点 | 用到的能力 | 验证的设计 |
| --- | --- | --- |
| 村长悬赏「夺回传家宝」 | `QuestGiver`(kill 巨蛛) + `turnin` | v0.6 任务 |
| 森林野狼 | `Wander` 巡逻 + `Loot` 掉狼皮 | v0.5/v0.6 |
| **沼泽毒雾** | 内容系统订阅 `Moved` → 玩家进入沼泽房间 → `ctx.spawn(buffBlueprint(中毒))` | buff 的内容侧用法 + 一次性区域效果 |
| **巨蛛 boss** | 内容系统订阅 `Attack`（attacker 是巨蛛）→ 给玩家上毒；`Loot` 掉传家宝 | buff 的战斗应用；boss 战差异化 |
| 篝火/药铺 | 对话选项触发 `ctx.spawn(buffBlueprint(回春))` | 酒保模式 + heal buff |
| 终局 | 交任务后 `QuestTurnedIn` → 内容系统输出结局文案 | 事件钩子的内容用法 |

### 验证方式：**自动通关测试**

`content.test.ts` 用真实 `World` + `execute` 序列跑通整条游戏线：
进沼泽必中毒、boss 毒攻、击杀掉宝、交任务、终局 flag——**测试即通关录像**。
内容回归不再靠手玩，这是内容包的 CI。

附带：REPL（复用 demo 的队列+串行排水模式）供真人试玩。

---

## 验证门

- prefabs 单测（TDD 先红后绿）：挂/结算/到期/毒杀走 Died 管线（掉落+任务联动）、
  死亡清 buff、快照 round-trip、录像重放、可控时钟精确断言（v0.6 的
  `clock.advance` 第一次真正用在 prefabs 测试里——P1-4 修复的价值闭环）
- mini-rpg：content.test.ts 全线通关
- 契约测试、demo 回归、文档双验证照旧

## 发版

`v0.7.0`（prefabs 0.5.0；**engine 不发新版本**——本版引擎零改动，若无意外
engine 停在 0.6.0，这是分层成功的一个标志）。

---

## 实现记录（2026-09-02 交付）

### 验证结果

- prefabs 50/50（buff.test.ts 10 用例：毒/回春结算、到期、毒杀走 Died 管线
  （掉落+任务联动）、死亡清 buff、快照 round-trip、录像重放、永久 buff、
  可控时钟精确断言——v0.6 的 `clock.advance` 第一次真正用在 prefabs 测试里）
- mini-rpg content.test.ts 6/6 全线通关；engine 101/101 回归；双包契约通过
  （契约补 buff 毒杀链路）；mini-rpg tsc + REPL 冒烟通过
- **engine 零改动**：diff 全在 prefabs 与 example，engine 停 0.6.0——分层成功

### 过程中的坑（都修了）

1. **`Moved.to` 是方向不是房间 id**（MovementSystem 契约：载荷 `{ from: 房间, to: 方向 }`）。
   沼泽毒雾初版写 `to === 'swamp'` 永远不触发。修正：读 `from` 房间的 `Exits`，
   `exits[to] === 'swamp'` 判定"真的走进了沼泽"——顺带免疫出口校验失败的假 Moved，
   也不依赖系统注册顺序。**内容层订阅 `Moved` 做区域效果时这是标准姿势。**
2. **事件包归属**：`DialogueChoiceMade` 属于 `@mud/ecs-engine`（对话机制），
   不在 `@mud/prefabs`——demo 的 effects.ts 一直这么导入，写内容时凭印象放错包。
3. **反咬目标写反**：SpiderRevengeSystem 初版 emit
   `{ attacker: SPIDER, target }`——`target` 是蛛自己！巨蛛一击开始自杀
   （6 点自咬 ×6 次归零），killer=蛛又让 kill 任务不记账，一次错误串出三个失败。
   修正为 `{ attacker: SPIDER, target: attacker }`。
   **教训：emit 事件前把载荷语义重读一遍——"反咬"= 咬攻击者。**
4. **BuffSystem 遍历中实体被删**：毒杀时 `Died` 同步排水，`BuffCleanupSystem`
   会中途销毁后续 buff 实体，循环内非空断言踩 undefined → `if (!buff) continue` 防御。
5. **Buff 固定网格重复结算**：`floor(time/every) > floor(startedAt/every)` 在
   `effect.every` 与结算粒度不对齐时同窗口结算两次 → 改 `lastTickedAt` 自相对计时。

### mini-rpg 的内容验证价值

- 沼泽毒雾 ⇒ 区域效果 = 内容系统订阅移动事件 + `ctx.spawn(buffBlueprint(...))`
- 巨蛛反击 ⇒ boss AI 可以纯内容实现（emit 标准 Attack，CombatSystem 的同房校验/
  伤害/Died 管线全部复用，内容只表达"意图"）
- 药婆茶 ⇒ 对话选项是 buff 的自然入口（酒保模式 + heal）
- 自动通关 ⇒ 真实 World 的 `world.tick()` 手动推进即可确定性测试时间驱动内容
  （不必用 TestWorld；契约冒烟同款用法）——**测试即通关录像成立**

### 缺口清单（本版不做，等真实需求）

| 缺口 | 触发条件 |
| --- | --- |
| StatModifier（属性修正层） | RPG 出现"+攻/-防"类装备/技能 |
| Buff 叠加/互斥/驱散/免疫 | 同名 buff 需要叠加规则时 |
| Consumable / `use <物品>` 命令 | 玩家可自由使用药水时（本版药水效果走对话） |
| 概率掉落 | 确定性伪随机（seed 来源）设计定稿后 |
| 区域效果"离开即散" | 出现"离开沼泽毒就停"类需求（本版挂上就走完） |
