# mud-engine API 评审报告（合理性 / 易用性）

- 评审日期：2026-09-02 · 评审对象：`@mud/ecs-engine` v0.4.0 / `@mud/prefabs` v0.2.0
- 视角：**下游开发者**（非正确性——正确性审查已于同日完成并修复）
- 方法：双路并行（引擎/prefabs 全部公开 API 签名通读 + 三组运行时/类型探针 + 文档示例 strict 编译实测）

> 结论先行：分层与概念模型是好的，但**文档承诺普遍超前于类型现实**，且
> 一个核心能力（系统/命令内创建实体）缺失，导致正常玩法必须绕路。
> 公开面离"开箱即用"还差一个版本的距离。

---

## P0 · 会直接卡住/误导用户

### P0-1 README 教坏 trait 形态（与 guide/prefabs 互斥示范）

`packages/engine/README.md:26` 写 `trait('health', { current: 100, max: 100 })`（**对象**），
而实现签名是工厂 `() => T`（`core/trait.ts:25`）。guide、docs/examples、@mud/prefabs 全部用工厂形态。

**探针实锤**（对象形态转译后运行）：
- `Health.create` 直接**不是函数**（defaults 对象被赋给 create 字段）→ 省略 data 的
  `addComponent` / 蓝图 spawn 一调就 TypeError
- 即便侥幸通过，create() 每次都返回**同一个共享对象**（组件引用交叉污染）

新用户照 README 抄，编辑器 strict 下 TS2345，转译下运行时炸。两处官方文档对同一 API 给出互斥示范。

### P0-2 文档示例在 strict TS 下全部编译不过（"实测"名不副实）

`docs/guide.md:4` 声称"文中所有代码块均经过实测"、`docs/examples` 示例"防腐烂"，
但 `verify-doc-examples.mjs` 只用 tsx **转译运行**、从不 `tsc`。

**实测** `tsc -p docs/examples/tsconfig.json --noEmit`：
- `01-minimal.mts:15/17/18`、`03-test.mts:13/15`：`'event.data' is of type 'unknown'`
- `02-save.mts:42`：组件展开 unknown

根因：guide 示例用 `on: [Healed.token]`（**token** 订阅）→ `defineSystem<T>` 无从推断 T
→ handle 里 `event.data` 是 unknown。而 `systems/types.ts:9` 却宣称"无需断言"。
**新用户第一天照文档写代码，满屏红。**

### P0-3 系统/命令内无法创建实体（能力缺口 → 被迫 hack）

`SystemContext` / `CommandContext.world` 只读 + emit，**无 `spawn`/`createEntity`**。
文档主流程"对话给物品/掉落/任务奖励"需要运行时造物，现实只能：
- **闭包捕获模块级 world** → 违反 fork 的"系统 = 无 World 闭包的纯声明"（`world.ts:198` 注释），
  分叉世界会隔空写主世界
- 或世界构建期**预置实体池**（demo 的 effects.ts 就这么干：写死 `getComponent('ale', Located)`）

demo 的买酒效果靠"预置固定实体 'ale'"而非真实创建——API 缺口直接导致示例变丑。

---

## P1 · 设计不自洽 / 文档误导

### P1-1 token 订阅让"类型贯通"形同虚设，正常代码被迫 as

引擎自己都在示范坏写法：`dialogue/system.ts`、`prefabs/systems.ts`、`demo/effects.ts`
全部 `event.data as {...}`。文档从未讲清两条订阅路线的类型分叉：
`on: [Moved]`（事件定义）贯通载荷类型 vs `on: ['moved']`（token）T 断链成 unknown。

### P1-2 "诚 types"未做净（同类死承诺残留）

| 字段 | 现状 |
| --- | --- |
| `ComponentDefinition.validate` | 全仓库无调用点 |
| `EventDefinition.schema` | 只存不验（emit 从不校验） |
| `SnapshotData.quests` / `QuestSnapshot` | 无人产无人销 |
| `OutputPort`（output/types.ts） | 孤儿接口，却从主入口导出 |

### P1-3 测试工具双出口，分工叙事不成立

`index.ts` 与 `/testing` 子路径**同时**导出 createTestWorld/TestWorld/ManualClock；
engine README 教从 `@mud/ecs-engine/testing` 导入，guide 却从主入口导入。
record/replay 更只在主入口。README/guide 互相矛盾。

### P1-4 测试工具空承诺

`createTestWorld({ clock }).clock.advance(ms)` 只改 clock 内部值，**不驱动世界时间**
（世界时间只由 tick/tickInterval 推进）——README "手动时钟，确定性测试"是空头支票。

### P1-5 SavePort 第二个参数语义混乱

参数名 `engineVersion`，实现却用它**覆写**快照真实 `ENGINE_VERSION`（`save-port.ts:47`）；
guide 又让用户传"**游戏版本**"。版本号到底跟 engine 还是 game？两文档无一致答案，示例还停留在 0.1.0。

### P1-6 命令形态分裂

- `createDeveloperCommands` / `createDialogueCommands` 返回**数组**（必须 `...` 展开）
- prefabs 导出单对象（GoCommand 等）
- `registerCommands`/`register` 忘展开数组时，数组被当命令对象 → 原生 TypeError，
  无重载、无提示

---

## P2 · 观感 / 低危

- **defineEvent 三层柯里化**易漏尾括号（guide FAQ 已覆盖，保留并给理由：TS 无法部分泛型实参）
- **Look 事件 target 刚落地**（本轮修复）；go 命令 vs 方向命令职责重复属可用性冗余但无害
- **prefabs queries 工具**进入主导出（itemsInContainer 等）——公开面卫生可接受，注意保持 JSDoc

---

## 最卡新用户的三个点（第一印象）

1. 文档示例粘下来**编译不过**（event.data unknown）
2. `trait` 有两种写法且一种会坏（README vs guide）
3. 想做"给东西/造怪/掉落"——**不知道去哪创建实体**

---

## 修复路线建议（按性价比排序）

| 批次 | 内容 | 性质 |
| --- | --- | --- |
| **A. 文档真实化**（今天可做，价值最高） | ① README trait 改工厂形态；② docs/examples 改 `on:[事件定义]` + 显式泛型，verify 脚本加 `tsc --noEmit`（防腐烂）；③ guide 澄清 token vs 事件定义类型分叉；④ SavePort 参数语义统一并更新示例 | 文档/示例，低风险 |
| **B. API 形态修正**（下一个发版窗口） | ① `trait` 支持对象模板形态（运行时归一为"每次 create 返回深拷贝新实例"，类型签名收窄）；② `SystemContext`/`CommandContext` 注入 `spawn`（桥接 World.spawn）——补上造物能力，demo 效果系统改真创建；③ 测试工具统一从 `/testing` 子路径导出，主入口清理；④ `registerCommands`/`register` 支持数组参数（flatten） | 含 breaking（未 publish 区间可做） |
| **C. 诚实化清理**（随手） | validate/schema/quests/OutputPort 四类死承诺：实现或删除 | 与「诚 types」一贯 |

> 说明：本报告为评审交付物，尚未实施任何修改。B 批涉及 breaking，建议与下一主线
> （战斗/NPC 巡逻）一起进 v0.5.0 窗口，A/C 批可立即执行。

---

## 修复状态

| 批次 | 状态 | 内容 |
| --- | --- | --- |
| **A 批（文档真实化）** | ✅ 已执行（2026-09-02） | ① engine README trait 改工厂形态并加警示注释；② docs/examples 三示例改为 `on:[事件定义]`+显式泛型、02-save 修复 spread unknown 与内容版本语义；`verify-doc-examples.mjs` 加入 **strict tsc** 前置检查（类型+运行双验证）；③ guide §3/§4.3/§4.4/§6 示例同步 + token vs 事件定义类型分叉专门章节 + §5 SavePort 内容版本语义澄清 + §7 常见坑补三条 + §8 ManualClock 空承诺修正；④ `TestWorldConfig.systems` 类型放宽（`SystemDefinition<any>` 收敛，与 `World.register` 同款——顺带暴露并修复 `createTestWorld({ systems:[具体载荷系统] })` 编译不过的真实类型缺陷） |
| B 批（形态修正：trait 对象模板 / ctx.spawn / testing 出口 / register 数组） | ⏳ 排入 v0.5.0 | — |
| C 批（死承诺清理：validate/schema/quests/OutputPort） | ⏳ 待排 | — |
