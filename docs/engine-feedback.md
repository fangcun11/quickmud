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
| F2 | `execute` 兜底文案不带建议：未识别输入一律「我不明白你的意思。」，不提示相近动词（实测输「上」想爬楼时，玩家不知道该敲什么） | M0 体验批 | engine | 兜底时对注册表动词做近似匹配（前缀/编辑距离），文案附「你是想…？」；代价是十余处 `toBe` 精确断言要适配 | 攒批评估 |
| F3 | 错误通道语义未约定：命令失败反馈有的走返回 string、有的走 output error 通道，两条路径混用无规则，宿主渲染无法统一着色/过滤 | M0 体验批 | engine | 错误通道语义重设计（返回值 vs `OutputCollector` 分工），牵动命令层契约，单独立项 | ✅ 定约落地（0.13）：7 通道语义写进 `OutputView` 类型契约，prefabs 使用类失败迁 error 通道；guide 06 同步。全量命令层清点（含第三方内容包的返回值习惯）留待收口 |
| F4 | 无回退命令：玩家想原路返回只能重敲方向；「回/退」需要来路记录（`Visited` 只记房间集合无顺序） | M0 体验批 | prefabs | 新增来路 trait（栈式，进快照）+ `back/回/退` 命令 emit 意图，MovementSystem 消费 | 待拍板 |
| F5 | web-client 零测试：渲染器 ~450 行纯 DOM 逻辑无任何自动化测试，本批 4 个缺陷（↑ 历史边界、重开输入残留、地图换行折叠、VerboseSystem 漏注册的误报路径）全是浏览器实测才暴露 | M0 体验批 | web-client | 引入 jsdom/happy-dom 测 `handleInput`/`recallHistory`/`tryRestore`/重开状态机；DOM 渲染断言覆盖 pre-wrap 与实体点击 | ✅ 已落地（web-client 0.3.0，vitest+happy-dom 14 例） |
| F6 | 引擎无公开的命令枚举 API：`World.commands` 私有，宿主想知道"注册了哪些动词/参数形状"只能游戏侧从命令常量二次枚举（命令建议器现状）。注册表与建议源理论上可漂移 | M1 体验批 | engine | `world.listCommands(): { verbs, abbrev, args, describe }[]` 元数据只读接口；建议器改吃它即可删除"命令表单一数据源"约定。注意与 F2（兜底近似匹配同样需要动词全集）是同一个缺口的两个症状 | ✅ 已落地（0.14/0.15：listCommands + describe 必填 + 兜底近似匹配；建议器/help 换装在 0.15 批） |

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

### F2 · execute 兜底文案不带建议

**现象**：M0 体验批浏览器实测，在只有水平出口的房间里敲「上」，
回应是「我不明白你的意思。」——没告诉玩家引擎认识哪些动词、离输入
最近的动词是什么。移动口语别名（往东/向东/东边…）缓解了方向这一类，
但「看看/瞅瞅/观察」「拿/取/捡」这些非方向的近义输入依然撞墙。

**为什么是引擎问题**：兜底文案由 `World.execute` 的命令注册表查找
失败路径给出，只有注册表知道全部动词——prefabs 无从给出全局建议。

**阻碍**：文案从固定串变为动态建议后，全仓十余处对兜底文案的 `toBe`
精确断言需要适配（`toContain` 类不受影响）。

**建议**：查找失败时对注册表动词做廉价近似匹配（前缀命中优先，
必要时编辑距离 ≤2），兜底文案附「你是想「看看」吗？」；无命中保持
原文案。与 F3 一起做可以少动一轮断言。

### F3 · 错误通道语义未约定

**现象**：同样是"命令没成功"，`VerboseCommand` 用**返回值**给反馈、
撞墙走 `MovementSystem` 的 **output.narrative**、参数解析失败走
**output.error**——三条通道混用，宿主无法统一决定"失败反馈要不要
红色、要不要进历史"。

**为什么是引擎问题**：`execute` 的返回值语义（`string | null`）与
`OutputCollector` 的分工从未定过规则，各命令各凭手感。

**建议**：单独立项定约——建议方向：返回值 = 命令级即时反馈（一句话），
事件链输出 = 系统产生的世界叙事，error 通道 = 真错误（玩家输入无法
解析）；guide 补决策表。牵动命令层契约与全部示例，攒批评估。

**落地**（2026-09-05，0.13）：
- 7 通道语义定约写进 `OutputView` 类型注释（narrative/title/system/dialogue/
  error/status/prompt 各管一类，status 是机器数据通道不是玩家文案）；
  `OutputView` 放行 `title`/`system`（此前房间标题只能 narrative+bold 硬凑）
- 返回值收窄为**确认型反馈**；prefabs go/take/drop/attack/turnin 的使用类
  失败迁 `error` 通道（十余处断言跟进，比预估的少——`toContain` 类确实不受影响）
- guide 06 补决策表；web 渲染补齐 7 通道配色
- 与 F2 的关联不变：兜底近似匹配（F2）仍需动词全集，等 F6 的
  `listCommands()` 一起做

### F4 · 无回退命令

**现象**：M0 体验批实测，从狼穴原路返回青石镇要连敲六次方向；玩家
本能的「回」「退」无命令。

**建议**：prefabs 新增来路记录 trait（栈式，进快照——`Visited` 是
集合语义不记顺序，不能复用）+ `back/回/退` 命令只发意图，由
MovementSystem 消费（等同 `MoveRequested` 的另一来源）；有守卫的房间
后退照走守卫。拍板时机随 M1 移动相关改动一起。

### F5 · web-client 零测试

**现象**：M0 体验批给 web-client 加了存档/历史/重开状态机后行数
翻倍（~450 行），而该包没有任何自动化测试——四个缺陷全部靠浏览器
实测暴露：↑ 历史首按永远无效（`historyIndex=-1` 起步的边界）、重开
确认后输入框残留「重开」致第二段永远拼成「重开重开」、ASCII 地图
换行被 HTML 空白折叠吞掉、（配合 prefabs 侧）VerboseSystem 漏注册被
误报成「没有详略开关」。单测绿 ≠ 能玩，DOM 层是盲区。

**建议**：引入 jsdom/happy-dom，优先测纯逻辑面：`handleInput` 的
重开两段状态机、`recallHistory` 全路径、`tryRestore` 成功/脏数据
两分支、pre-wrap 渲染、实体点击 → `runCommand('look X')`。
时机：M1 前补齐，避免战斗 UI（M1 起状态栏会动）继续裸奔。

**落地**（2026-09-05，web-client 0.3.0）：vitest + happy-dom，14 例。
主战场是键盘契约——Enter 永远执行当前输入（候选选中也不执行）、
↑↓ 开=候选导航/关=历史召回、Tab/点击补全不执行、Esc 收起重现、
IME 组合期 `isComposing` 防护、无顶部状态栏（MUD 传统）、实体点击
→ look。重开状态机与 pre-wrap 的显式断言留待后续批次。

### F6 · 引擎无公开的命令枚举 API

**现象**：网页版命令建议（web-client 0.3）需要"注册了哪些动词、
参数是什么形状"。`World.commands` 私有，宿主拿不到——只能在游戏侧
把注册的命令常量再收进一个数组传给建议器（两个 example 的 bootstrap
因此导出 `commands` + `directionWords`，并约定"注册与建议同一份数组"）。
约定能防漂移，但它是口头约定，不是 API 保证。

**为什么是引擎问题**：命令注册表只有 `World` 知道；F2（兜底文案近似
匹配）同样需要动词全集——两个症状一个缺口。

**建议**：`world.listCommands(): { verbs, abbrev, args }[]` 只读元数据
接口（args 只暴露类型名，不暴露 handle）。建议器与 F2 的近似匹配改吃
它，游戏侧的"单一数据源"约定即可退役。与 F3 一样攒批评估。

**落地**（2026-09-05，0.14/0.15）：
- `listCommands()` 元数据（verbs/abbrev/args 类型形状 + describe），
  World 顶层与 CommandContext.world 双入口
- F2 同批落地：未识别动词的兜底文案近似匹配（前缀/编辑距离 ≤2）
- 0.15 批：defineCommand 必填 describe（fail-fast）+ prefabs
  createAutoHelpCommand——help 从注册表实时渲染，永不漂移；
  侠客行 bootstrap 的"命令表单一数据源"约定仍保留（建议器用），
  待建议器换吃 listCommands 后退役
