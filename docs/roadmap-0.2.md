# v0.2 路线图：基建补全 + 确定性能力

> 规划日期：2026-09-02。方向 A（骨架补完）+ 方向 D（确定性用户能力）。
> 原则：每个任务先红后绿（测试先行），全量验证（单测 + 契约测试 + 示例）后才提交。
> 对话/NPC 与容器/物品系统明确推迟到 v0.3，依赖本版的定时系统与错误策略先稳定。

---

## 方向 A：骨架补完

### A1. 定时系统（every / after / delay）

**现状**：`SystemDefinition` 仅支持 `name / on / priority / handle`；`World.tick()` 是空壳。

**设计要点**：
- `SystemDefinition` 新增 `every?: number`（毫秒，tick 间隔触发）
- 事件新增一次性调度：`ctx.after(ms, token, data)` → 事件泵延时队列（按触发时间排序的优先队列，ManualClock 可推进）
- `World.tick()` 调用由时钟驱动：到达 `tickInterval` 时触发所有 `every` 系统与到期延时事件
- 确定性约束：延时事件入队时记录 tick 序号，回滚快照需包含延时队列状态（快照格式新增 `scheduledEvents` 字段 → 需要 0.1→0.2 迁移链，正好实践 SavePort）

**验收标准**：
- [ ] `every` 系统：ManualClock 推进 N 秒后触发 ⌈N/interval⌉ 次，顺序符合 priority
- [ ] `after(ms)` 事件：到期前不触发、到期后按 priority 与即时事件混排执行
- [ ] 快照 round-trip 包含未触发的延时事件；回滚后延时不丢失、不重复
- [ ] 0.1 存档（无 scheduledEvents 字段）经迁移链可加载
- [ ] 事件预算（maxEventsPerCommand）覆盖延时事件触发

### A2. 系统错误策略（onError）

**现状**：系统 handle 抛异常直接炸穿 execute()。

**设计要点**：
- `SystemDefinition.onError?: 'propagate' | 'skip' | 'isolate'`（默认 `propagate` 保持现状）
  - `skip`：记录错误、跳过该事件、链继续
  - `isolate`：记录错误、跳过该事件，且该系统本次链内不再被调用（防雪崩）
- 错误收集到 `world.errors`（带系统名、事件 token、时间戳），供上层 UI 展示

**验收标准**：
- [ ] 三种模式各有单测：propagate 上抛、skip 后续事件照常、isolate 本系统本链静默
- [ ] 默认行为与 0.1 完全一致（不破坏现有用户）
- [ ] `world.errors` 可清空、包含定位信息（system.name + token）

### A3. 输出渲染参考实现

**现状**：`OutputCollector` 只有语义分段（narrative/system/dialogue/error/status），无落地渲染。

**设计要点**：
- 新增子路径导出 `@mud/ecs-engine/render`：
  - `renderAnsi(messages): string`——终端 ANSI 颜色（error 红、system 暗灰、dialogue 青）
  - `renderPlain(messages): string`——纯文本（Web 端自己做映射）
  - 渲染器是**纯函数**，不碰 World 状态
- 语义色板：`SemanticColor` 已有定义，映射表集中一处

**验收标准**：
- [ ] ESM/CJS 双产物均可 import（进契约测试）
- [ ] 渲染纯函数：相同输入恒等输出（快照测试）
- [ ] demo-adventure 接入 renderAnsi，REPL 可见颜色

### A4. 开发者命令（/give、/tp、/spawn）

**现状**：速查表中标注"未实现"。

**设计要点**：
- 独立入口导出 `@mud/ecs-engine/dev`：`createDevCommands(): CommandDefinition[]`
- 用户显式注册 `world.registerCommands(...createDevCommands())`——不默认注入
- `/give <entity> <component> <json>`、`/tp <entity> <roomId>`、`/spawn <id> <componentJson>`
- 全部走 emit 事件（DevGive/DevTeleport），保持"命令不碰状态"铁律

**验收标准**：
- [ ] 三个命令各有单测（成功 + 实体不存在 + 非法 JSON）
- [ ] 未注册时对普通玩家零影响；文档标注"仅调试用"

---

## 方向 D：确定性用户能力

### D1. 输入录像与重放（World.record / replay）

**设计要点**：
- `world.startRecording()` / `stopRecording(): InputLog`——记录 `{ tick, input, playerId }` 序列
- 独立函数 `replay(log): World`——新建世界按序执行输入，返回终态
- 断言工具 `replayEquals(log, snapshot): boolean`
- 存档格式：录像可序列化（InputLog → JSON），可作为"存档+操作历史"的完整存档

**验收标准**：
- [ ] 同一 InputLog 重放两次 → 逐组件状态深度相等
- [ ] demo 录制一段交互、保存、重放、校验通过（示例脚本）
- [ ] 录像含非确定输入（用户输入外的系统时间？）时**显式报错**而不是静默分叉

### D2. 世界分叉（World.fork）

**设计要点**：
- `world.fork(): World`——基于当前快照创建沙盒世界，共享组件定义，互不影响
- 用途：NPC AI 决策试跑、技能预演、UI 预览"如果走这条路会怎样"
- fork 世界的事件输出需可标记来源（避免串到主世界输出流）

**验收标准**：
- [ ] fork 后在沙盒内任意操作（含存档级变更），主世界快照不变（深度比较）
- [ ] fork 世界可独立快照/回滚
- [ ] 性能基线：1000 实体 fork 耗时 < 50ms（快照拷贝，暂不做 COW，写进已知限制）

### D3. 确定性回归防护

**设计要点**：
- 引擎 CI 测试新增"确定性金测试"：固定输入序列跑 200 步，全量快照做文件快照断言
- 任何 PR 若改变模拟结果，测试红——防止无意引入非确定性（Math.random/Date.now 均已在引擎内禁用约定，加 ESLint 规则强制）

**验收标准**：
- [ ] 金测试存在且通过；人为注入 `Math.random` 后测试红、ESLint 红
- [ ] `pnpm test` 一条命令跑完全部（单测 + 金测试 + 文档示例）

---

## 排期建议（依赖关系）

```
A2(错误策略) ──┐
A1(定时系统) ──┼──→ A4(开发者命令)
A3(渲染) ──────┘（独立，可随时插队）
D3(金测试) ←── 最先做！后续所有提交都被它保护
D1(录像重放) → D2(fork)（D2 依赖 D1 的快照比较基建）
```

**推荐顺序**：D3 → A2 → A1 → A3 → D1 → A4 → D2

规模估计：A ≈ 8 个任务日，D ≈ 5 个任务日，合计 2~3 周单人。

## 发布清单（0.2）

- [ ] 全部验收标准打勾
- [ ] guide.md / README 更新新特性章节
- [ ] SavePort 0.1→0.2 迁移链 + 契约测试过
- [ ] CHANGELOG.md 建立，语义化版本
