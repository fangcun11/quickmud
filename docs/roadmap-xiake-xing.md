# 侠客行 · 开发路线与规格（M0~M2 定稿）

> 用 `@mud/ecs-engine 0.12.0` + `@mud/prefabs 0.10.0` 构建的武侠题材文字 RPG。
> 本文档是 M0~M2 的实施规格；M3~M6 只保留概览，开期前再细化。

## 0. 已拍板的决策

| 决策点 | 结论 | 理由 |
| --- | --- | --- |
| 战斗模型 | **指令回合制**：玩家下指令一回合，NPC 自动还手 | MUD 传统；与引擎事件驱动管线天然契合；快照/录像/回滚零成本 |
| 判定随机性 | **纯公式**：命中/格挡/伤害完全由属性差决定，零随机 | 引擎铁律无随机源；完全确定、平衡可推演 |
| 首期范围 | **M0~M2** 一起规划实施 | 走通「练功 → 学武 → 战斗升级」完整核心循环 |
| 分层纪律 | 武侠领域件先写在游戏包内，**不抽 `@mud/wuxia` 包** | YAGNI；与 prefabs 诞生的历史一致，等第二个游戏再下沉 |
| 反馈纪律 | 编码中遇到引擎/工具集不完善处，随手记入 `docs/engine-feedback.md`；适合下沉的通用件进 prefabs 复用，领域件留游戏包 | 复用先于复制；反馈有处可查，按期收口时攒批评估 |

## 1. 核心循环（全部版本服务的这条主线）

```
打坐练内力 ──→ 学武学/招式 ──→ 打怪涨经验/熟练度 ──→ 升级解锁新招式
     ↑                                                      │
     └────────── 内力上限 ← 经脉(M4) ← 丹药(M4) ← 战利品 ←──┘
                    装备(M3) 强化攻防 ──→ 打更强的怪
```

## 2. M0 · 骨架（v0.1.0）

**范围**：项目包结构、世界脚手架、构建与测试管线。零新系统。

| 项 | 内容 |
| --- | --- |
| 包 | `example/xiake-xing/`，仿 tide-cellar 骨架（package.json / tsconfig / vitest / 通关测试位） |
| 世界 | 三区域：**青石镇**（安全区：悦来客栈·出生点、杂货铺、武馆）、**终南山道**（过渡）、**野狼林**（野怪区），约 12 间房 |
| 系统 | 只注册 prefabs 基础件：Movement/Visitation/Description + 移动与查看命令 |
| 验收 | 走遍三区域、`map`/`世界地图` 正常、冒烟测试绿 |

## 3. M1 · 内功根基（v0.2.0）

### 3.1 新组件

| 组件 | 数据形状 | 说明 |
| --- | --- | --- |
| `Energy` | `{ current, max }` | 内力资源，打坐恢复、出招消耗 |
| `Stats` | `{ atk, def, dodge }` | 裸属性（装备/经脉加成走聚合函数，不写回） |
| `Cultivating` | `{ lastTickedAt }` | 打坐中标记；时间账本走组件（快照/回滚一致，与 RoomClock 同款理由） |

### 3.2 新命令

| 命令 | 动词 | 行为 |
| --- | --- | --- |
| 打坐 | `打坐` / `meditate` | 挂 `Cultivating`；移动/受击自动打断 |
| 停 | `停` / `stop` | 摘 `Cultivating` |
| 状态 | `状态` / `stats` | 生命/内力/攻击/防御/身法一览（替换 ScoreCommand 注册） |

### 3.3 新系统

| 系统 | 触发 | 行为 |
| --- | --- | --- |
| `MeditationSystem` | `every: 1000` | 有 `Cultivating` 的实体：内力 +meditate 回复量；用 `Cultivating.lastTickedAt` 做无漂移网格 |
| `CombatInterruptSystem` | `on: Attacked` | 打断被命中者的修炼（摘组件 + 输出一句） |

### 3.4 战斗内核（回合制、纯公式）

复用 prefabs 的 `Attack` / `Died` 事件与死亡管线（白得掉落/任务/清 buff），**替换结算内核**（不注册 prefabs `CombatSystem`，自建 `WuxiaCombatSystem`）：

```
attack <目标>（攻击，自动用普通攻击）
  校验：同房间、目标有 Health
  命中判定（纯公式三态）：
    dodge 差 = 攻方 dodge − 守方 dodge
    差 ≥ 2  → 命中（全额）
    −1..1   → 命中（七成，"被格挡"）
    ≤ −2    → 被闪避（零伤，输出"被 X 轻巧闪过"）
  伤害 = max(1, round(atk × 系数(1.0) − def))；格挡则 ×0.7
  emit Attacked { attacker, target, damage, result: 'hit'|'blocked'|'dodged' }
  HP 归零 → emit Died（现有管线接管）
```

| 系统 | 触发 | 行为 |
| --- | --- | --- |
| `WuxiaCombatSystem` | `on: Attack` | 上述结算内核 |
| `NpcRetaliateSystem` | `on: Attacked`（priority 低） | NPC 存活且未死 → 对攻击者自动还手一击（emit Attack 走同一内核） |
| `FleeSystem` | `on: Fled` | `逃/flee` 命令发意图；dodge 对比成功 → 移回来路房间；失败 → 原地挨 NPC 一击 |

### 3.5 内容与验收

- 野狼林放 3 只**野狼**（`{ hp 25, atk 6, def 1, dodge 2 }`），掉落「狼皮」（M3 卖钱）
- **验收通关测试**：出生 → 打坐 5 tick 内力满 → 去野狼林 → 公式三态各触发一次（属性构造好分别构造 hit/blocked/dodged）→ 击杀 → 拾取狼皮 → `Died` 管线产出正常
- 数值原则：小数值起步（属性 1~20、生命/内力 10~200），M6 统一平衡

## 4. M2 · 武学与秘籍（v0.3.0）

### 4.1 新组件

| 组件 | 数据形状 | 说明 |
| --- | --- | --- |
| `Arsenal` | `{ arts: Record<artId, { level, exp }> }` | 已习武学进度（键控数组组件；等出现"武学实例需要被指向"的真实需求再实体化） |
| `Channeling` | `{ artId, lastTickedAt }` | 当前运转的心法（**同时只能运转一门**，打坐时加速该心法熟练度） |
| 物品侧 `Scripture` | `{ artId }` | 秘籍标记：`学/learn <秘籍>` → 消耗物品、Arsenal 写入 1 级 |

### 4.2 武学定义表（内容层纯数据，`arts.ts`）

```ts
{ id: 'wolf_fist', name: '开山拳', school: '拳掌', maxLevel: 5,
  moves: [
    { id: 'fist_basic', name: '直拳', tier: 0, cost: 0,  mult: 1.0 },   // tier = 解锁等级
    { id: 'fist_heavy', name: '崩拳', tier: 2, cost: 8,  mult: 1.7 },
    { id: 'fist_aoe',   name: '横扫', tier: 4, cost: 15, mult: 2.4 },
  ] }
```

M2 提供 3 门武学：**开山拳**（出生默认 1 级）、**基础剑法**（秘籍：武馆购买或野狼掉落）、**吐纳术**（内功心法秘籍：运转时打坐内力回复翻倍 + 熟练度增长）。

### 4.3 新命令与系统

| 项 | 行为 |
| --- | --- |
| `学/learn <秘籍>` | 背包内找 `Scripture` → 写入 Arsenal → 消耗秘籍物品 |
| `use <招式> [目标]` | 校验：招式已解锁（level ≥ tier）、内力足 → 走 M1 战斗内核（mult 换招式系数）+ 扣内力 |
| `attack`（增强） | 自动选：已解锁且内力够的**最高 mult** 招式；全不够内力则普通攻击 |
| `武学/arts` | 列已学武学：等级/经验进度/已解锁招式 |
| `ExperienceSystem`（`on: Died`） | killer 获得经验 → 记入其攻击所用武学（Arsenal.exp）；exp 满 → level+1 → 输出「崩拳悟了！」+ 解锁提示 |
| `ChannelExpSystem`（every） | 运转中心法在打坐时随 tick 涨熟练度 |

### 4.4 验收通关测试

出生（已会开山拳 1 级）→ 武馆买基础剑法秘籍 → `learn` → `use 崩拳 杀狼` 若干 → exp 满 level 2 解锁新招 → 换用新招验证伤害变化 → 全程录像重放一致。

## 5. M3~M6 概览（开期前细化）

| 期 | 主题 | 要点 |
| --- | --- | --- |
| M3 | 装备 | `Equipment { weapon?, armor?, trinket? }` 键控槽位 + 物品 `Bonus`；聚合函数进战斗公式；铁匠铺买卖（碎银） |
| M4 | 经脉与丹药 | 经脉静态定义表（十二正经+奇经八脉，前置链）+ `Meridians { opened }`；打通提升上限；`Consumable` 进 prefabs（通用件） |
| M5 | 江湖 | 门派拜师（师承关系用 `relation`）、声望、好感度、支线 |
| M6 | 收口 | 30-60 分钟通关流程、数值平衡、存档/录像全量验证 |

## 6. 开放问题（不阻塞 M0~M2）

1. **格挡/闪避文案层次**：三态输出已定，但"破防"（atk 溢出 def 的额外表现）是否需要——M1 实施时看手感
2. **CombatArt 实体化时机**：若 M5 师承需要"这门武学是谁传的"，Arsenal 数组要升实体+关系——留到真实需求出现
3. **死亡惩罚**：玩家 HP 归零现在只是死了（无 Died 消费者）——M3 前决定（回客栈复活扣碎银 / 原地重生）
