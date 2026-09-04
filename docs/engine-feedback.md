# 引擎 / 工具集改进记录（侠客行开发过程）

> 来源：侠客行（`example/xiake-xing`）开发过程中发现的引擎（`@mud/ecs-engine`）
> 与工具集（`@mud/prefabs`）不完善处。
>
> 处置原则（与 roadmap §0 的反馈纪律一致）：
>
> 1. **通用件触碰即下沉**——实现中确认某领域件其实是通用能力（如 M4 计划的
>    `Consumable`），直接进 prefabs 带真实消费者落地，不为它单开一版；
> 2. **领域件留游戏包**——武侠特有概念（内力、经脉、武学）不抽 `@mud/wuxia`（YAGNI）；
> 3. **引擎缺口攒批评估**——记录在案的引擎层问题，按期收口（M2/M6）时统一评估
>    实施或明确放弃，不在当期顺手改引擎。

## 记录

| # | 发现 | 所在期 | 层 | 建议处置 | 状态 |
| --- | --- | --- | --- | --- | --- |
| F1 | example 间样板逐字复制：`main.ts` 终端 REPL（「队列 + 串行排水」模式，tide-cellar 自注"与 mini-rpg 同款"）、`walk.ts` 通关录像三件套（drain/act/scene）、`commands/help.ts` 每包一份、玩家出生拼装（Position/Name/Visited + markVisited）在 tide-cellar / mini-rpg / demo-adventure / 侠客行间重复 | M0 | prefabs | 抽 `createRepl()` / `createWalkScript()` / `spawnPlayer()` 脚手架进 prefabs（或独立 example 基建），迁移三个存量 example | 待拍板 |

## 条目展开

### F1 · example 脚手架样板复制

**现象**：每个 example 包都要抄一遍约 90 行的 REPL `main.ts`（入队 + drain 循环 +
EOF 干净退出）、约 50 行的 `walk.ts`（drain/act/scene 三件套）、help 命令、玩家出生
四件套（`Position`/`Name`/`Visited` + `markVisited`）。这些代码在
tide-cellar / mini-rpg / demo-adventure 三包间只有横幅文案不同，且被复制时改错了
注释也会一起传下去（mini-rpg 注释里写的"与 demo-adventure 同款"、tide-cellar 写
"与 mini-rpg 同款"，互相引用而不是引用一份真相）。

**为什么是工具集问题**：REPL 的「队列 + 串行排水」模式是引擎事件管线（`'line'`
宏任务内批量派发）的正确配套，不是游戏逻辑——每写一个新游戏手动重抄一遍，
等于把引擎的一个使用要领变成口口相传的 folklore。

**建议**：prefabs 加 `createRepl({ world, playerId, banner })`（REPL + 输出排水 +
quit）、`spawnPlayer(world, opts)`（出生四件套）、可选 `walkScript` 辅助。
迁移时机：不影响 M0~M2 主线，可放在 M2 收口后或与下一批 example 需求一起做。
