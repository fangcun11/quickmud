# 14 · 测试

> **本章你会学到**：`createTestWorld` 测试世界、同步事件链断言、可控时钟。
> 引擎自带测试工具，**不必启动游戏循环**。本章代码对应验证示例
> [03-test.mts](../examples/03-test.mts)。

---

## 基本姿势：emit → runChain → 断言

```ts
import assert from 'node:assert';
import { trait, defineEvent, defineSystem } from '@mud/ecs-engine';
import { createTestWorld } from '@mud/ecs-engine/testing';

const Health = trait('health', () => ({ current: 100, max: 100 }));
const Healed = defineEvent('healed')<{ target: string; amount: number }>();

const HealSystem = defineSystem({
  name: 'heal',
  on: [Healed],
  priority: 10,
  handle(event, ctx) {
    const hp = ctx.getComponent(event.data.target, Health);
    if (!hp) return;
    hp.current = Math.min(hp.max, hp.current + event.data.amount);
  },
});

// 确定性：不启动游戏循环、不依赖真实时间——
// w.emit + w.runChain() 同步驱动事件链，断言可直接跟在后面
const w = createTestWorld({ systems: [HealSystem] });
const p = w.entities.create();
w.entities.addComponent(p, Health, { current: 90, max: 100 });

w.emit(Healed.token, { target: p, amount: 30 });
w.runChain(); // 手动驱动事件链，同步执行

assert.strictEqual(w.entities.getComponent(p, Health)!.current, 100, '回血不超过上限');
assert.ok(w.getLog().includes(Healed.token), '事件日志可断言');
```

- `w.runChain()` 同步跑完整个事件链，**没有隐藏的异步**，断言可以紧跟其后；
- `w.getLog()` 拿事件日志——事件驱动架构里，"发生了什么"本身就是断言材料；
- `createTestWorld` 接受 `systems` / `commands` / `entities` / `clock` /
  `tickInterval`。

## 测命令与输出

测命令就直接 `await w.world.execute('rest 30', p)`，断言 `w.world.output`：

```ts
const feedback = await w.world.execute('score', player);
assert.strictEqual(feedback, '—— 完毕 ——');
assert.ok(w.world.output.ofKind('narrative').length > 0);
```

（v0.11 起命令也有 `output` 通道，见 [06 命令](./06-commands.md)。）

## 可控时钟：世界时间是唯一真相

测基于世界时钟的行为（every 周期 / 延时事件）用 `clock.advance(ms)`——
它**真的驱动世界时间**（按 tickInterval 循环 tick），或直接 `w.tick(n)` /
`w.advance(ms)`：

```ts
const clock = new ManualClock();
const w = createTestWorld({ systems: [NpcWanderSystem], clock, tickInterval: 100 });
clock.advance(3000); // 世界时间到 3000，every:3000 的巡逻系统触发 1 次
assert.strictEqual(w.currentTime, 3000); // 世界时间是唯一真相，clock 与之同步
```

0.5 及更早版本 `clock.advance` 只改自己的计数器、不驱动世界；0.6 起兑现。
结合 Buff 的网格结算实例见 [10 物品、战斗与任务](./10-items-combat-quests.md)。

## 更硬的回归：录像重放

对"整局行为"做确定性回归，用 `record` / `verifyReplay`（见
[13 确定性与录像重放](./13-determinism.md)）——录像可以进 git 当 fixture。

---

[← 上一篇：13 确定性与录像重放](./13-determinism.md) | [下一篇：15 常见坑 →](./15-pitfalls.md) | [目录](./index.md)
