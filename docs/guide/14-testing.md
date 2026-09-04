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
w.addComponent(p, Health, { current: 90, max: 100 });

w.emit(Healed.token, { target: p, amount: 30 });
w.runChain(); // 手动驱动事件链，同步执行

assert.strictEqual(w.getComponent(p, Health)!.current, 100, '回血不超过上限');
assert.ok(w.getLog().includes(Healed.token), '事件日志可断言');
```

- `w.runChain()` 同步跑完整个事件链，**没有隐藏的异步**，断言可以紧跟其后；
- `w.getLog()` 拿事件日志——事件驱动架构里，"发生了什么"本身就是断言材料；
- `w.emit(Healed, {...})` 事件定义直传（0.12 起，token 字符串也行）；
- `createTestWorld` 接受 `systems` / `commands` / `entities` / `clock` /
  `tickInterval`；`entities` 夹具支持元组形态 `[[Health, { current: 30 }]]`
  （0.12 起，data 省略用组件默认值；哈希形态 `{ [Health.id]: ... }` 仍兼容）。

## 测命令与输出

测命令用 `w.run(input, player)`（0.12 起，`world.execute` 的直通委托）：

```ts
const feedback = await w.run('score', player);
assert.strictEqual(feedback, '—— 完毕 ——');
assert.ok(w.output.ofKind('narrative').length > 0);
```

（v0.11 起命令也有 `output` 通道，见 [06 命令](./06-commands.md)；
`drainOutput()` 的取舍见 [07 输出与渲染](./07-output.md)。）

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

## fork 出的世界也要探针

`world.fork()` 的产物用 `TestWorld.wrap`（别名 `fromWorld`）接手（0.12 起）——
eventLog 拦截、clock 接管、`run/emit` 便利全套照装；系统与命令随 fork 继承，
不重复注册：

```ts
const forked = TestWorld.wrap(base.world.fork());
forked.emit(Attack, { attacker: a, target: b });
forked.runChain();
assert.ok(forked.getLog().includes('died'), '分叉世界里的事件同样可断言');
```

## 更硬的回归：录像重放

对"整局行为"做确定性回归，用 `record` / `verifyReplay`（见
[13 确定性与录像重放](./13-determinism.md)）——录像可以进 git 当 fixture。

---

[← 上一篇：13 确定性与录像重放](./13-determinism.md) | [下一篇：15 常见坑 →](./15-pitfalls.md) | [目录](./index.md)
