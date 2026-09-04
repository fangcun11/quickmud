# 引擎层 API 审查（v0.10 后）

- 日期：2026-09-04 · 对象：`packages/engine`（0.6.0，3322 行源码 / 11 个测试文件）
- 方法：通读全部源码 → 以 `@mud/prefabs` 与三个 example 为消费者取证 → 微基准校准性能判断
- 视角：易用性（DX）/ 类型友好 / 高效性 / 缺漏

## 总评

骨架是好的：三铁律自洽、`MoveRequested/Moved` 语义拆分、快照-回滚-分叉-重放同源、
确定性契约有 ESLint 双重防护。问题**不在架构**，集中在四件事：

1. **类型贯通断在一处**——`defineSystem` 单泛型，多事件系统全部退化成 `.token` + `as` 断言（prefabs 3 个系统 7 处断言）
2. **错误包装丢栈**——两处 `throw new Error('Event handler error: ' + msg)`，上轮调 tide-cellar 的 `.id` 报错时直接受害
3. **命令侧没有输出通道**——`CommandContext.world` 无 output，逼出"返回 string"单通道，语义化输出（status/segment）全生态零使用
4. **测试工具吸引力弱**——8 个 prefabs/示例测试文件里 6 个绕开 TestWorld 直用原生 World

性能现状健康（实测数据见下），只有一个规模化门槛记录在案。

---

## P0 · 正确性与契约（建议下版必修）

### P0-1 错误包装丢原始堆栈
- **证据**：`event-pump.ts:212` 与 `world.ts:529` —— `throw new Error(\`Event handler error: ${message}\`)`
- **影响**：`error.stack` 指向 throw 点，根因堆栈全丢。skip/degrade 策略下 `getSystemErrors()` 只剩 message 字符串，连原始 error 类型都没有
- **修法**：`throw new Error(msg, { cause: error })`（ES2022）；`SystemErrorRecord` 增加 `cause?: unknown` 字段

### P0-2 事件 `timestamp` 一个字段两种语义
- **证据**：普通事件 timestamp = `EventPump.now()`（单调计数器 0,1,2…，`event-pump.ts:57`）；`World.tick` 合成的 TICK 事件 timestamp = 世界毫秒（`world.ts:516`）
- **影响**：系统内读 `event.timestamp` 无法分辨拿到的是计数还是毫秒——类型相同的字段语义随事件来源漂移
- **修法**：TICK 事件把时间放 `data.time`（已是），timestamp 统一为单调计数；或全部统一为世界毫秒。二选一，写进类型注释

### P0-3 `verifyReplay` 不校验版本兼容
- **证据**：`recorder.ts` 注释称"跨引擎版本的录像据此判断兼容性"，但 `verifyReplay()` 从未比较 `recording.engineVersion` 与当前 `ENGINE_VERSION`
- **影响**：跨版本重放静默进行，分叉结果无意义还误导排查方向
- **修法**：版本不一致时在 `ReplayResult` 加 `versionMismatch: true`（或直接抛错）

### P0-4 `deterministicId` 哈希碰撞无检测（实测可复现）
- **证据**：`trait.ts:djb2` 32 位哈希无碰撞断言。实测 10 万个组件名找到 3 对碰撞：
  `comp_1r_x` 与 `comp_30_x` → 同一 ID `ci5d8b1`
- **影响**：两个不同 trait 静默共享同一存储槽，组件数据互相覆盖——无报错、极难排查。当前规模概率低（500 组件 ≈ 3×10⁻⁵），但代价是"确定性世界悄悄变成不确定"
- **修法**（一行级别）：模块级 `Map<id, name>` 注册表，`trait()` 里发现同 id 不同名即抛错

---

## P1 · 易用性（高收益批）

### P1-1 多事件系统的类型贯通断裂（类型层第一优先）
- **证据**：prefabs 三处 `on: [A.token, B.token]`——`systems.ts:237`（ItemSystem，2 处 as）、`systems.ts:418`（QuestSystem，**4 处 as**）、`behavior.ts:385`（RoomEventSystem）
- **根因**：`defineSystem<T>` 单泛型；`defineEvent` 又把 token 字面量显式擦掉（`define-event.ts:15` `name as unknown as EventToken`）
- **修法**：`EventDefinition<T, TName>` 保留 token 字面量；`defineSystem` 的 `on` 接受 `EventDefinition` 数组，`handle` 收到 discriminated union，`event.token === A.token` 自动收窄 `event.data`。prefabs 顺势删掉 7 处断言
- **收益/成本比最高的一条**

### P1-2 命令侧没有输出通道
- **证据**：`CommandContext.world` 只有 emit/查询四件；`OutputCollector.status()` 全生态（prefabs + 3 个 example）**零调用**，`score` 命令靠 `lines.join('\n')` 拼字符串（`prefabs/commands.ts:141`）
- **影响**：多段/语义化输出必须"为一个事件写一个系统"，或退回拼接字符串——三铁律对内容作者的代价过高
- **修法**：`CommandContext` 增加 `output`（复用 `SystemContext.output` 的 string|Segment 包装）；铁律表述改为"命令不改状态、只发事件（输出除外）"

### P1-3 `execute()` 开头清空输出，吞掉 tick 产出
- **证据**：`world.ts:246` `this.output.clear()`；mini-rpg/tide-cellar 的 REPL 都是 execute→drain 顺序，一旦"先 tick 后 execute"，tick 期间的 every 系统输出被静默清掉
- **修法**：默认不清（调用方显式 drain/clear），或 `clear` 移到"命令返回后由调用方决定"；至少在 `execute` 的 JSDoc 里写明清空语义

### P1-4 延时事件无法取消
- **证据**：`ctx.after(delay, token, data)` 无返回句柄；`EventPump.schedule` 无 cancel
- **影响**：死亡取消已调度的报复事件、离开房间取消陷阱——现在只能靠内容在触发时自查（绕行）
- **修法**：`after` 返回句柄；`ctx.cancel(handle)`；句柄进快照（`scheduled` 已在快照里，加个 `cancelled` 标记即可保持确定性）

### P1-5 TestWorld 吸引力不足（8 个测试文件 6 个绕开它）
- **证据**：只有 `buff.test.ts`、`behavior.test.ts` 用 TestWorld
- 痛点清单：① fixture 的 components 按**哈希 ComponentId** 作键（`test-world.ts:136`），只能写 `{ [Health.id]: {...} }`；② 无 `execute` 委托（要 `w.world.execute`）；③ `emit` 只收 token 不收 EventDefinition；④ **eventLog 拦不住 `emitImmediate` 路径**（monkey-patch 只包了 `emit`）；⑤ fork 出的世界没有探针
- **修法**：fixture 接受 `ComponentDefinition`/blueprint；补 `run(input, player)` 委托与 `emit(EventDef, data)` 重载；`emitImmediate` 同样包一层；`fork()` 提供探针挂载

### P1-6 引擎自己的开发者命令违反自家铁律
- **证据**：`developer.ts` `/tp` 直接写 `pos.roomId`、`/heal` 直接写 `health.current`，全文件 `as never` 硬转 ×4
- **影响**："命令不改状态"的第一示范位是反面教材
- **修法**：改走事件（`DevTeleported`/`DevHealed` + 引擎内置小系统），或文档明确豁免并说明理由

### P1-7 `'entity'` 参数名不副实
- **证据**：`commands/types.ts` 注释承认"原始 token，未解析为实体ID"；`developer.ts:53` `world.findEntity(args.target)` 消费方自行解析
- **修法**：二选一——改名为 `phrase`/`token`（诚实）；或解析进引擎（按 `findEntityByName` 分级匹配返回 `EntityId | null`），内容少一层样板

### P1-8 `defineEvent` 两段柯里化形态
- **证据**：`defineEvent('damage')<{ amount: number }>()` —— payload 藏在第二层调用
- **修法**：改为 `defineEvent<TName, T>(name, options?)` 一步到位（与 P1-1 的泛型改造合并做）

### P1-9 参数系统缺能力
- **缺**：`number` 类型（现在内容自己 `parseInt`）、带空格实体名（"小 铁剑"被空白切碎）、flag（`-v`）
- **修法**：`ArgumentDefinition` 增加 `number`（解析失败给 `null`）与 quoted-phrase 规则

---

## P2 · 高效性（诚实校准：当前规模全部无感，按规模化排序）

**实测基准**（本机，5000 实体 / 命中 2500）：`findByComponent` 单次全扫 **0.055ms**；
每 tick 三次全扫（事件+周期+内容）@ 1 tick/s ≈ 每秒 0.17ms。**当前不是问题**。

| # | 发现 | 证据 | 现实影响 | 建议 |
| --- | --- | --- | --- | --- |
| P2-1 | 队列 `shift()` O(n) | `event-pump.ts:161,134,243` | 事件风暴 1000 事件 ≈ O(n²)，毫秒级 | 头指针替代 shift，零语义变化，无脑改 |
| P2-2 | `makeSystemContext()` 每事件每系统重建 | `world.ts:152-158,517` | 热路径纯分配（context+output 包装+emit 闭包均无 per-call 状态） | 缓存单个 context 实例复用 |
| P2-3 | `processEvent` 每订阅新建 payload+emit 闭包 | `event-pump.ts:179-193` | 同上 | 同上，提升到循环外 |
| P2-4 | `schedule` 每次全排序 | `event-pump.ts:236` | scheduled 通常 <100，无感 | 改有序插入（顺带） |
| P2-5 | 组件查询无反向索引 | `entity.ts:230-258` | 万级实体+高频 tick 才可感 | **记为规模化门槛**，触发条件写进注释，暂不动 |
| P2-6 | 快照 structuredClone 全世界 | `world.ts:403` | 已知，注释声明 COW 留后续 | 维持 |
| P2-7 | `FsBackend` 固定 2 空格缩进序列化 | `save-port.ts` | 大存档体积 ×1.5~2 | 可配置 `pretty?: boolean` |

---

## P3 · 缺漏与清理

| # | 发现 | 说明 | 建议 |
| --- | --- | --- | --- |
| P3-1 | `SnapshotData.registry` 死字段 | `createSnapshot` 恒写 `{}`（`world.ts:411`），类型承诺无现实 | 删除 |
| P3-2 | `relation()` 死 API | 全生态零消费者，实现是半成品（`target: ''`），`target` 还是 string 非 EntityId | 删除（要时再按真需求设计） |
| P3-3 | `SystemErrorRecord` 未导出 | `index.ts` 缺该类型，`getSystemErrors()` 返回值在外部无法命名 | 补导出 |
| P3-4 | 时间 API 不对称 | `world.currentTime`（getter）vs `world.getTickCount()`（方法） | 统一为 getter |
| P3-5 | 无受控随机源 | 确定性禁 `Math.random`，但引擎无种子随机（文档说"自己注入"，没给注入点） | `WorldConfig.seed` + `ctx.random()`（确定性 PRNG，状态进快照）——需设计，列为候选 |
| P3-6 | 无系统/命令反注册 | `EventPump.on` 返回退订函数但 `World.register` 不透传 | `register` 返回退订句柄（低优先） |
| P3-7 | `deepClone` 定义重复 4 处 | world/entity/trait/blueprint 各一份 | 提取 `internal/clone.ts` |
| P3-8 | `FsBackend` 混在主入口 | 浏览器 bundle 带着动态 `import('node:fs')`（运行时调用才炸，打包不报错） | 拆子路径 `@mud/ecs-engine/node` |
| P3-9 | `SavePort` 手传 engineVersion | 已有 `ENGINE_VERSION` 单一事实源，还要调用方传 | 参数缺省取 `ENGINE_VERSION` |
| P3-10 | `destroy` 悬空引用 | 注释承认不级联；内容清理全靠自觉 | 可选 `Destroyed` 事件（内容订阅清理），或仅文档化 |

---

## 建议的修复切分

- **第一批（小改动高收益，全部向后兼容）**：P0-1/P0-3/P0-4、P1-1（含 P1-8）、P1-2、P2-1/P2-2/P2-3、P3-1/P3-3/P3-7——prefabs 顺势删 7 处断言
- **第二批（有行为变化，等拍板）**：P0-2（timestamp 语义）、P1-3（execute 清空契约）、P1-4（cancel）、P1-5（TestWorld 重做）、P1-6（dev 命令走事件）、P3-8（子路径）
- **记录不动**：P2-5（规模化门槛）、P3-5（随机源，需要设计轮）、P2-6（COW）

---

## 实施状态（v0.11.0 收口，2026-09-04）

**第一批已全部落地**（CHANGELOG `[0.11.0]`）：P0-1/P0-3/P0-4、P1-1、P1-2、
P2-1/P2-2/P2-3、P3-1/P3-3/P3-7 ✓。prefabs 实删 `as` 断言 **12 处**
（比本报告的"7 处"估算多——第 7 条之外还漏数了 DeathSystem/LootSystem/
BuffCleanupSystem 的单事件断言与 3 处 every 载荷断言），examples 删 5 处
显式载荷泛型。四包 263 例全绿。

一处与报告建议的偏差：

- **P1-8 未按"一步到位"实施**。`defineEvent<TName, T>(name)` 需要调用方
  显式写两个泛型实参（重复且易错）；而 `defineEvent<T>(name)` 形态下
  显式载荷实参会跳过名字推断、token 退化为 string——**P1-1 的收窄随之
  失效**（TS 无部分泛型推断，实测验证）。保留两段柯里化，第一层
  `const TName` 推断字面量、第二层显式载荷，P1-1 完整达成。

第二批（P0-2/P1-3/P1-4/P1-5/P1-6/P3-8）仍待拍板。

---

## 实施状态（v0.12.0 收口，2026-09-04）

**第二批已全部落地**（CHANGELOG `[0.12.0]`，engine 0.8.0 / prefabs 停 0.9.0）：
P0-2、P1-3、P1-4、P1-5、P1-6、P3-8 ✓。红测试先行（timestamp/cancel/dev 命令
事件化三组先写先失败），实现后 277 例全绿（engine 126 / prefabs 134 /
examples 17）+ 文档示例双验证 10/10 + 外部消费者契约测试（`./node` 子路径
三路覆盖）通过。

两处与报告建议的偏差：

- **P1-5 取"增强"而非"重做"**。报告痛点 ①~⑤ 全部解决（元组夹具、`run`
  委托、`emit(EventDef)` 重载、`emitImmediate` 进日志、`TestWorld.wrap`
  接手 fork 产物），但保留 TestWorld 现有骨架与哈希夹具兼容——重做
  成本高、收益集中在缺失能力上。
- **P1-6 事件 token 命名跟随 prefabs 惯例**（`dev_teleported`/`dev_healed`
  snake_case），事件定义与效果系统从 `commands/developer.ts` 导出、经
  `registerDeveloperKit(world)` 一步装配；只注册命令组时事件悬空、状态不落
  （fail-safe），比报告设想的"文档豁免"更彻底地落实了铁律。
