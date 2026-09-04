# quickmud

**单机、事件驱动、ECS 架构的 TypeScript 文字 MUD 游戏引擎。**

[![CI](https://github.com/fangcun11/quickmud/actions/workflows/ci.yml/badge.svg)](https://github.com/fangcun11/quickmud/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A518-brightgreen.svg)](https://nodejs.org)
[![Dependencies](https://img.shields.io/badge/dependencies-zero-success.svg)](#设计取舍)

写文字冒险游戏的难点从来不是"打印一段描述"，而是**状态一旦复杂起来就再也收拾不住**：
存档无从下手、NPC 行为和玩家操作互相踩、改一处坏三处、出了 bug 无法复现。

quickmud 的解法是把游戏拆成一条**单向流水线**，并让整条流水线**确定性可重放**——
于是存档、回滚、录像、AI 预演都变成了同一件事的副产品。

---

## 它跑起来长什么样

以下是仓库内 `example/mini-rpg` 的**真实终端输出**（`pnpm --filter mini-rpg dev`）：

```
> 【村庄】
晨光里的村庄安静而破败。村口的老槐树下站着村长，东侧屋檐下是药婆的药摊。一条小路向东伸进森林。

> 任务：
- 巨蛛悬赏（0/1）
- 狼皮褥子（0/2）

> east
你来到了森林小径。
浓密的树冠遮住了半边天。灌木丛里传来窸窸窣窣的动静——绿油油的眼睛正盯着你。

> attack 野狼
你攻击了「野狼」，造成 10 点伤害。
「野狼」倒下了。
「野狼」倒下，掉了狼皮。

> take 狼皮
你拿起了「狼皮」。

> map
【野地】
·—@
图例：@ 当前位置 · 已探明（未探明区域留白）

> worldmap
·—@
图例：@ 当前位置 · 已探明区域（未探明区域留白）
```

地图不是画出来的，是**从房间的出口拓扑自动推断**的——你只写"森林在村庄东边"，
坐标和连线由 `layoutWorld()` 算出来；每个区域是一张独立平面，`map` 画当前区域、
`worldmap` 画区域之间的连接，迷雾由 `Visited` 组件决定。

第二个示例 `example/tide-cellar` 是一个**内容验证包**：三层三区域的小世界，
把 v0.9 的房间行为 API（守卫、生命周期、房间心跳、区域实体状态）全部用上一遍：

```
> down
你来到了台阶。
十二级石阶。往下是地窖的黑暗，往上能看见井口割出来的一小块天。东边是闸门房，南边是蓄水池。

> south
水还漫着门槛，下去就是齐腰深——等退干净了再说。        ← canEnter 守卫：不落位

> up
退路被水封死了——台阶下面翻涌着黑水，你上不去。        ← canLeave 守卫：只封 up

> turn
你咬牙拧动铁轮，地下的水闸「哐」地落下一半——潮水再也漫不上来了，可它也退不干净：水位卡在门槛上，进蓄水池还是过不去。管口的汽也停了。

> worldmap
·

@

·
图例：@ 当前位置 · 已探明区域（未探明区域留白）        ← 三层剖面：钟楼 / 废墟 / 地窖
```

潮汐水位挂在**区域实体**上而不是任何房间里，房间只在守卫和 `look` 里读它；
关闸（`turn`）保住退路却进不去蓄水池，敲钟（`ring`）只开一个几秒的窗口——
两条解法各管一头，缺一不可。详见 [example/tide-cellar](./example/tide-cellar/README.md)。

---

## 30 秒理解设计

玩家敲下 `attack 野狼` 之后：

```
玩家输入 "attack 野狼"
      │
      ▼
┌─ 命令 (Command) ─┐   解析动词和参数，只负责"翻译意图"
│  emit(Attack)   │   发出一个事件，不做任何具体逻辑
└────────┬────────┘
         ▼
┌─ 事件泵 (EventPump) ─┐  按优先级派发给订阅者
└────────┬────────────┘
         ▼
┌─ 系统 (System) ──┐   唯一允许修改状态的地方
│ 扣血 → 判死 → 掉落 │   多个系统可对同一事件各司其职
└────────┬─────────┘
         ▼
┌─ 输出 (OutputCollector) ─┐  所有给玩家看的文字都汇到这里
└──────────────────────────┘
```

**三条铁律**：

1. **命令不改状态，系统不解析输入**——命令只 emit 事件，系统只消费事件。
2. **状态只活在组件里**——实体（Entity）只是个 ID，数据全挂在组件（Component）上。
3. **所有玩家可见的文字走输出收集器**——不要在系统里 `console.log`。

**分层**：引擎（`packages/engine`）只提供**能力原语**，不内置任何领域内容——
它不知道什么是"房间"或"背包"。MUD 的常用件在 `packages/prefabs` 里。
换一个游戏，引擎不用动；想换个玩法规则，prefabs 可以整个不用。

---

## 快速开始

```bash
npm install @mud/ecs-engine @mud/prefabs
```

三十行搭出一个能存档的世界：

```ts
import { World, trait, defineEvent, defineSystem, defineCommand, Name } from '@mud/ecs-engine';

// 1. 组件（ECS 的 C）——trait 即组件定义
const Health = trait('health', () => ({ current: 100, max: 100 }));

// 2. 事件——命令与系统之间的唯一信使
const Healed = defineEvent('healed')<{ target: string; amount: number }>();

// 3. 系统——唯一能改状态的地方
const HealSystem = defineSystem<{ target: string; amount: number }>({
  name: 'heal',
  on: [Healed],
  handle(event, ctx) {
    const hp = ctx.getComponent(event.data.target, Health);
    if (!hp) return;
    hp.current = Math.min(hp.max, hp.current + event.data.amount);
    ctx.output.narrative([{ text: `你恢复了 ${event.data.amount} 点生命。` }]);
  },
});

// 4. 命令——只翻译意图，不做逻辑
const RestCommand = defineCommand({
  verbs: ['rest', '休息'],
  args: { minutes: { type: 'word' } },
  handle({ args, player, world }) {
    world.emit(Healed, { target: player, amount: Math.min(50, Number(args.minutes) || 10) });
    return null;
  },
});

const world = new World();
world.register(HealSystem);
world.registerCommands(RestCommand);

const player = world.entities.createWithId('player-1');
world.entities.addComponent(player, Health, { current: 60, max: 100 });
world.entities.addComponent(player, Name, { text: '勇者', aliases: [] });

await world.execute('休息 30', player);   // → "你恢复了 30 点生命。"
```

只需 prefabs 的话，房间/移动/背包/战斗/任务/地图全是现成的：

```ts
import { World } from '@mud/ecs-engine';
import {
  MovementSystem, DescriptionSystem, VisitationSystem,
  GoCommand, createDirectionCommand, LookCommand, MapCommand,
  defineRoom, layoutRooms, buildRooms,
} from '@mud/prefabs';

// 只写出口，坐标自动推断（重复 id / 悬空出口 / 撞格 / 孤岛一律启动时报错）
const layout = layoutRooms([
  defineRoom({ id: 'town', name: '城镇广场', description: '广场中央有一口古井。',
               exits: { north: 'tavern' } }),
  defineRoom({ id: 'tavern', name: '酒馆', description: '吧台后面站着一位酒保。',
               exits: { south: 'town' } }),
], { entry: 'town' });

const world = new World();
world.register(MovementSystem, DescriptionSystem, VisitationSystem);
world.registerCommands(
  GoCommand, createDirectionCommand('north', ['north', 'n', '北']),
  LookCommand, MapCommand,
);
buildRooms(world, layout);
```

---

## 包结构

| 包 | 版本 | 说明 |
| --- | --- | --- |
| [`@mud/ecs-engine`](./packages/engine/README.md) | 0.6.0 | 引擎核心：ECS、事件泵、命令、快照/回滚、录像重放、确定性时钟、对话树。**零第三方依赖**，ESM + CJS 双产物 |
| [`@mud/prefabs`](./packages/prefabs/README.md) | 0.8.0 | 领域预制件：移动/房间/地图、查看、物品/背包、战斗/掉落/死亡、任务、Buff、NPC 巡逻 |
| `example/mini-rpg` | — | 完整小游戏：村庄 → 森林 → 沼泽 → 洞穴，含战斗、掉落、双任务、地图迷雾 |
| `example/tide-cellar` | — | 内容验证包：潮汐地窖，三层三区域 + 守卫 + 房间心跳 + 区域实体状态 |
| `example/demo-adventure` | — | 引擎能力演示：对话树、物品、开发者命令、终端 REPL |

## 能力矩阵

| | 能力 | 说明 |
| --- | --- | --- |
| 核心 | 事件驱动 ECS | 实体只是 ID，数据全在组件上；系统按事件订阅 |
| | 确定性 | 引擎内禁用 `Math.random` / `Date.now`（ESLint 强制），同输入 ⇒ 同状态 |
| | 快照 / 回滚 | 组件纯数据，整世界可 JSON 序列化 |
| | 录像重放 | `record()` → `verifyReplay()`，确定性回归测试与 bug 复现 |
| | 世界分叉 | `world.fork()` 试跑 NPC 决策、技能预演，主世界不受影响 |
| | 可控时钟 | `every` 周期系统 + `ctx.after` 延时，测试里 `clock.advance()` 真实驱动 |
| 领域 | 房间与地图 | `defineRoom` + 坐标自动推断 + ASCII 地图 + 迷雾 |
| | 区域与世界 | `defineArea` + 区域出口自动反推 + 每区域独立坐标系 + `worldmap` 区域迷雾 |
| | 自包含房间 | 守卫（canEnter/canLeave）、生命周期（enter/firstEnter/every）、房间命令、`state` 组件——行为是代码，状态是数据 |
| | 物品与容器 | `Located` 单源位置（房间/背包/箱子同一套语义） |
| | 战斗与掉落 | 伤害结算 → 死亡事件 → 掉落结算 → 清场，各阶段独立可插拔 |
| | 任务 | 进度追踪 + 交付发奖，事件驱动 |
| | 对话树 | 分支、`requires` 门控、`remember` 记忆，状态可进快照 |
| | Buff | 定时效果（如毒雾每 2 秒掉血），到期自动清理 |
| 输出 | 语义化渲染 | `renderAnsi` / `renderSemanticHtml` / `renderPlainText` 纯函数，一套消息三种终端 |

## 文档

| 文档 | 内容 |
| --- | --- |
| [新手指南](./docs/guide.md) | 从零搭出可存档游戏的完整教程（文中代码全部经过实测） |
| [引擎 README](./packages/engine/README.md) | 引擎 API 与测试支持 |
| [预制件 README](./packages/prefabs/README.md) | 领域件用法与已知边界 |
| [文档示例](./docs/examples) | 6 个可运行示例，`strict` 类型检查 + 运行双验证 |
| [CHANGELOG](./CHANGELOG.md) | 逐版本变更明细 |
| [路线图](./docs) | `roadmap-0.6` ~ `roadmap-0.10` 的设计定稿与实现记录 |
| [引擎 API 审查](./docs/engine-api-review.md) | v0.10 后的引擎层体检：分级发现、修法与实施状态 |

## 设计取舍

- **引擎不内置领域内容**。想做文字冒险之外的玩法（如 Roguelike 回合制），
  引擎照样能用，只是不用 prefabs。代价是上手时多一层概念。
- **确定性优先于便利**。引擎内禁用随机与真实时钟——需要随机就自己注入种子，
  需要时间就走 `clock`。换来的是录像重放和世界分叉。
- **冲突在定义期 fail-fast**。房间重复 id、悬空出口、坐标撞格这类错误，
  宁可启动时崩溃，也不运行时静默出错。
- **零第三方依赖**。运行时与编译期都不依赖外部包——一个库最持久的部分是它没有的部分。
- **暂不支持**：i18n、数据驱动内容加载（YAML 等，内容当前内联在代码中）、
  多人联网、纵向跨层地图的连接线绘制（层与层之间用 up/down 连通，但剖面图上暂以留白表示）。

## 开发

```bash
pnpm install                    # 安装依赖
pnpm build                      # 构建两个包（tsc + esbuild 双格式）
pnpm test                       # 全部单测（engine 112 / prefabs 134 / mini-rpg 7 / tide-cellar 10）
pnpm test:contract              # ESM + CJS + TS strict 契约测试
node docs/examples/verify-doc-examples.mjs   # 文档示例双验证

pnpm --filter mini-rpg dev      # 试玩完整小游戏
pnpm --filter tide-cellar dev   # 试玩潮汐地窖（内容验证包）
pnpm --filter tide-cellar walk  # 潮汐地窖通关录像：八幕一路打到底
pnpm --filter demo-adventure dev             # 试玩能力演示
```

要求 Node.js ≥ 18、pnpm 8。

## 贡献

欢迎 Issue 与 PR。改动请先跑通上面四条验证命令；新增能力请同时补上契约测试与文档示例
（文档里的代码是要被机器验证的，不是摆设）。详见 [CONTRIBUTING.md](./CONTRIBUTING.md)。

## 许可证

[MIT](./LICENSE)
