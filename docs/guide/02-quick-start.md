# 02 · 快速上手

> **本章你会学到**：安装 quickmud，用 30 行跑通一个"休息回血"的最小世界——
> 一口气用上全部四个核心概念（组件、事件、系统、命令）。
> 本章代码对应验证示例 [01-minimal.mts](../examples/01-minimal.mts)。

---

## 安装

要求 Node.js ≥ 18。

```bash
npm install @mud/ecs-engine @mud/prefabs

# 或从仓库源码打包安装
cd packages/engine && pnpm pack
npm install ./mud-ecs-engine-0.7.0.tgz
```

零运行时依赖。ESM / CJS 双产物，TypeScript 类型开箱即用（`strict` + `node16`
模块解析均验证过）。本章只用引擎核心 `@mud/ecs-engine`。

## 30 行最小世界

把这个存成 `demo.mts`，`npx tsx demo.mts` 直接跑：

```ts
import {
  World, trait, defineEvent, defineSystem, defineCommand, Name,
} from '@mud/ecs-engine';

// ── 组件：纯数据，没有任何行为 ──────────────────────
const Health = trait('health', () => ({ current: 100, max: 100 }));

// ── 事件：发生过的事，过去时态命名 ────────────────────
// 注意柯里化语法：defineEvent('名字')<载荷类型>()，结尾有 ()。
const Healed = defineEvent('healed')<{ target: string; amount: number }>();

// ── 系统：订阅事件，修改状态，产出输出 ─────────────────
// 要点：on 传事件定义 Healed（而非 token 字符串）——载荷类型自动贯通，
// handle 里 event.data 带类型，无需断言。
const HealSystem = defineSystem({
  name: 'heal',
  on: [Healed],
  priority: 10,                // 数字越小越先执行
  handle(event, ctx) {
    const hp = ctx.getComponent(event.data.target, Health);
    if (!hp) return;           // 目标没有血条，静默跳过
    hp.current = Math.min(hp.max, hp.current + event.data.amount);
    ctx.output.narrative([{ text: `你恢复了 ${event.data.amount} 点生命。` }]);
  },
});

// ── 命令：把玩家输入翻译成事件 ───────────────────────
// args 类型由声明自动推导：type: 'word' → string，无断言
const RestCommand = defineCommand({
  verbs: ['rest', '休息'],
  args: { minutes: { type: 'word' } },
  handle({ args, player, world }) {
    const amount = Math.min(50, Number(args.minutes) || 10);
    world.emit(Healed, { target: player, amount });
    return null;  // 返回 null/void = 反馈交给事件链末端的系统产出
  },
});

// ── 组装世界 ────────────────────────────────────────
const world = new World();
world.register(HealSystem);
world.registerCommands(RestCommand);

const player = world.entities.createWithId('player-1');
world.entities.addComponent(player, Health, { current: 60, max: 100 });
world.entities.addComponent(player, Name, { text: '勇者', aliases: [] });

// ── 跑起来 ──────────────────────────────────────────
const feedback = await world.execute('休息 30', player);
if (feedback) console.log(feedback);            // 命令自己的文字反馈
for (const msg of world.output.ofKind('narrative')) {
  console.log(msg.segments.map((s) => s.text).join(''));  // → 你恢复了 30 点生命。
}
```

跑通了？你已经用上了引擎的全部四个核心概念。接下来五章逐个展开。

## 这 30 行里各归其位的东西

| 概念 | 上面代码里的角色 | 细讲 |
| --- | --- | --- |
| 组件 `trait()` | `Health`——纯数据 | [03 组件与实体](./03-entities-components.md) |
| 事件 `defineEvent()` | `Healed`——已发生的事实 | [04 事件](./04-events.md) |
| 系统 `defineSystem()` | `HealSystem`——唯一动状态的手 | [05 系统](./05-systems.md) |
| 命令 `defineCommand()` | `RestCommand`——输入的翻译官 | [06 命令](./06-commands.md) |
| 输出收集器 | `world.output`——玩家看到的一切 | [07 输出与渲染](./07-output.md) |

---

[← 上一篇：01 认识 quickmud](./01-introduction.md) | [下一篇：03 组件与实体 →](./03-entities-components.md) | [目录](./index.md)
