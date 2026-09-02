# Changelog

本项目遵循[语义化版本](https://semver.org/)。

## [Unreleased]

### 新增

- **对话与 NPC（0.3-B 核心）**
  - `Dialogue` trait（对话树 + 活动指针）与 `Memory` trait（记忆 flags），组件数据纯 JSON 可序列化
  - `defineDialogue(entry, nodes)`：内容定义 + 校验（entry/to 引用、id 唯一，fail-fast）
  - `DialogueSystem`：唯一推进对话状态的手。talk/choose 展示文本与"可用选项"
    （`requires` flags 门过滤）、选项推进（`remember` 写记忆、跳转 to / reply 收尾）、
    无可用选项自动结束；随快照/回滚/存档走
  - `createDialogueCommands()`：`talk/ask/说/对话 <npc> [序号]`，动词冲突 fail-fast 同引擎惯例
  - `DialogueChoiceMade` 事件：选项生效时 emit，供游戏层效果系统订阅
    （给物品、发任务等副作用走事件链，不在对话模块内实现）
- **蓝图 spawn 隔离性**：同蓝图多次 spawn 的实体组件数据深拷贝隔离
  （此前直接挂引用，改 A 组件会"隔空"污染 B，破坏蓝图不可变承诺）

### 修复

- **every 系统时相改为由世界时间派生的固定网格（drift-free）**：原"自上次触发起算"依赖
  游离于快照之外的 `lastRunAt`——`rollbackWorld` 回滚后 every 系统静默失联（时相指向未来，
  长时间不再触发）；`fork()` 出的沙盒因 lastRun=0，在 `timeMs` 已推进的主世界上 fork 后首个
  tick 会立即误触发全部周期系统。现改为按 `k * every` 网格跨点触发，时相随 `worldTime`
  走，快照 / 回滚 / fork / 录像重放天然一致，且长期无漂移（10 tick×100ms / every=250ms
  下由触发 3 次变为精确 4 次）。此变更属行为语义调整：触发时刻可能平移至网格承接点。
- `Recording.engineVersion` 硬编码 `'engine'` → `ENGINE_VERSION`（版本单一事实源 = package.json）
- `createTestWorld()` 工厂签名补齐 `commands`：与构造器共用 `TestWorldConfig` 类型，
  杜绝两份签名再次漂移（此前运行时支持、类型层未兑现）
- `TestWorld.runChain()` 空转忙等死循环风险 → 改为显式调用 `EventPump.drain()`
- `EventPump.processEvent` 移除恒返回 `undefined` 的 `getEntity` 死 context
  （破坏性：直接经 `EventPump.on` 订阅收到的 `EventContext` 现在只含 `emit`；
  经 `defineSystem`+`World.register` 的系统不受影响，仍收到完整 `SystemContext`）
- `findEntityByName` 改为分级匹配（精确优先）：主名精确 > 别名精确 > 主名子串 >
  别名子串 > 输入反包含。先注册的长名不再用子串包含抢走后注册的精确同名实体
- `World.spawn` 的 `patch` 引用蓝图中不存在的组件时 fail-fast 抛错（不再静默失效）
- `EventPump` 新增公开 `drain()` 方法（测试工具显式排水的官方通道）
- Web demo 构建回归：`build-html.js` external 清单缺 `node:` 前缀（FsBackend 的
  `import('node:path')` 在 esbuild 无法解析，浏览器打包失败）——补 `node:path`/`node:fs/promises`

## [0.2.0] - 2026-09-02

主题：**基建补全 + 确定性能力**。路线图见 `docs/roadmap-0.2.md`。

### 新增

- **定时系统**（A1）
  - `defineSystem({ every: ms })`：周期系统，由 `World.tick()` 驱动，载荷 `{ token: 'engine:tick', data: { time } }`
  - `ctx.after(delayMs, event, data)`：调度一次性延时事件
  - 延时事件纳入快照，回滚不丢失、不重复；`SnapshotData.worldTime` 字段（0.1 存档免迁移）
- **系统错误策略**（A2）
  - `defineSystem({ onError })`：`propagate`（默认，fail-fast）/ `skip`（记录继续）/ `degrade`（记录+隔离禁用）
  - `world.getSystemErrors()` / `clearSystemErrors()`
- **输出渲染参考实现**（A3）
  - `renderAnsi`（终端，kind 默认色 + segment 覆盖，`noColor` 选项）
  - `renderSemanticHtml`（`<p class="mud-{kind}"><span data-...>`，HTML 转义，`data-entity-ref` 交互）
  - `renderPlainText`（纯文本兜底）
- **开发者命令**（A4）
  - `createDeveloperCommands()`：`/tp` `/give` `/heal` `/dev-help`，按组件命名约定
    （position/inventory/health）操作；走标准流水线，受快照/回滚/录像覆盖
- **录像重放**（D1）
  - `record(world)` → `stop()` 产出可 JSON 序列化的录像
  - `replay` / `verifyReplay`：全新世界重放并逐字段比对，`firstDiff` 定位首个分叉路径
- **世界分叉**（D2）
  - `world.fork()`：快照深拷贝的沙盒世界（含系统/命令），与主世界零共享；
    适合 NPC AI 决策试跑、技能预演。无 COW（已文档化），1000 实体 < 100ms
- **确定性防护体系**（D3）
  - 金测试：200 步固定场景，双跑深度相等 + 快照基线 + 回滚重放一致性
  - ESLint 强制禁用 `Math.random` / `Date.now` / `new Date` / `performance.now` / crypto / nanoid

### 修复

- `EntityManager.create()` 弃用随机 ID（nanoid）→ 确定性计数器 ID（碰撞保护）
- `EventPump` 默认时间源 `Date.now()` → 内部单调计数器（可注入 `now`）
- `SavePort.migrate` 迁移后未推进 `engineVersion` 导致死循环；现按 `migration.to`
  推进并校验 `to > from`
- `createSnapshot` 组件数据浅引用——后续突变会反向污染过去快照；改 `structuredClone`
- `CommandDefinition.handle` 返回 `void` 类型不合法（纯 emit 型命令需 `return null`）
- `.d.ts` 相对导入无扩展名，node16 解析下外部 TS 消费者编译失败（build 后处理补 `.js`）
- `ManualClock` / `TestWorld` 被误导出为纯类型，运行时不可用

### 变更

- 实体 ID 格式：nanoid 12 位随机串 → `e<n>` 计数器格式（确定性；读档恢复的旧 ID 照常工作）
- 引擎依赖清零：nanoid 移除，运行时/编译期零第三方依赖（Node 内置除外）
- `execute()` 移除 `/` 前缀硬编码拦截，开发者命令走标准注册表
- `createTestWorld` 支持 `commands` 注册

### 基础设施

- 外部消费者契约测试 `pnpm test:contract`：pack → 全新安装 → ESM/CJS 运行时 → TS strict
- 文档示例验证脚本：`docs/examples/` 全部实测防腐烂

## [0.1.0] - 2026-09-01

首个可用版本：事件驱动 ECS 核心、命令系统、快照/回滚、SavePort 持久化与迁移链、
测试工具（createTestWorld/ManualClock）、demo-adventure 示例。
