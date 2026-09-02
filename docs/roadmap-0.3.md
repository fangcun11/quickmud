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
- [ ] spawn 产出的实体与手写 addComponent 逐组件等价
- [ ] patch 覆盖生效且不污染蓝图本身（蓝图不可变）
- [ ] 同 id 重复 spawn 快照恒等；确定性金测试无回归
- [ ] 蓝图引用未注册 trait 时 fail-fast

## B. 对话与 NPC

- `Dialogue` trait（树状节点 + 条件跳转）+ `DialogueSystem`
- 选项走命令系统（`ask`/选项序号），复用 args 类型推导
- NPC 记忆：`Memory` trait 记录对话历史，条件分支可查
- 依赖：B0 蓝图（定义 NPC）、0.2 定时/错误策略（已就绪）

## C. 容器与物品系统

- `relation()` 的系统级支持：容器/背包/房间归属
- 涉及：实体生命周期（容器内实体激活语义）、`findEntity` 层级查找、快照对关系的序列化
- 依赖：B0 蓝图（物品定义）；风险较高（可能牵动核心数据结构），放 B 之后
- 候选特性（按需评估）：`LocalStorageBackend` 浏览器端到端验证、输出渲染的 Web demo

## 排期

B0（0.5 天）→ B（1~1.5 周）→ C（1~1.5 周）
