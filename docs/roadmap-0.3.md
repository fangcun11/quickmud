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

## C. 容器与物品系统

- `relation()` 的系统级支持：容器/背包/房间归属
- 涉及：实体生命周期（容器内实体激活语义）、`findEntity` 层级查找、快照对关系的序列化
- 依赖：B0 蓝图（物品定义）；风险较高（可能牵动核心数据结构），放 B 之后
- 候选特性（按需评估）：`LocalStorageBackend` 浏览器端到端验证、输出渲染的 Web demo

## 排期

B0（0.5 天）→ B 核心（2026-09-02 当日完成）→ C（1~1.5 周）
