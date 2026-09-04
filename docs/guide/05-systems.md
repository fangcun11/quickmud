# 05 · 系统

> **本章你会学到**：系统的完整配置（priority / every / onError）、定时系统与
> 延时事件、系统特权（spawn / destroy）。本章代码对应验证示例
> [07-systems.mts](../examples/07-systems.mts) 的第 4、5 节。

---

## 系统是唯一动状态的手

```ts
const CombatSystem = defineSystem({
  name: 'combat',
  on: [Attacked],            // 传事件定义：event.data 直接带类型
  priority: 10,
  handle(event, ctx) {
    // event.data.attacker / event.data.target —— 有类型，无需断言
    // ctx.getComponent / ctx.emit / ctx.output.narrative(...)
  },
});
world.register(CombatSystem);
```

- **系统是唯一允许修改组件的地方**。命令里直接改组件？编译不拦你，但你会失去
  存档一致性和可测试性。
- `priority`：同一事件有多个订阅者时，小值先执行。不确定就别写，默认 0，按注册顺序。
- `handle` 允许 async。

## 定时系统：every 周期 + ctx.after 延时

不写 `on`、只写 `every` 的系统是**定时系统**，由 `World.tick` 按世界时间驱动
（进快照、可回滚），handle 收到 tick 载荷 `{ token: 'engine:tick', data: { time } }`：

```ts
const Explosion = defineEvent('explosion')<{ room: string }>();
const fired: string[] = [];

const RainSystem = defineSystem({
  name: 'rain',
  every: 300, // 每 300ms 一跳，由 World.tick 驱动（进快照、可回滚）
  handle(payload, ctx) {
    // every 系统（不写 on）的 payload 自动是 tick 载荷：data.time 有类型，无断言
    fired.push(`rain@${payload.data.time}`);
    if (payload.data.time >= 600) {
      ctx.after(100, Explosion, { room: 'hall' }); // 100ms 后补发一个延时事件
    }
  },
});
const BoomSystem = defineSystem({
  name: 'boom',
  on: [Explosion],
  handle(event) {
    fired.push(`boom@${event.data.room}`);
  },
});

const clock = new ManualClock();
const w3 = createTestWorld({ systems: [RainSystem, BoomSystem], clock, tickInterval: 100 });
clock.advance(700); // 真的驱动世界时间：rain 在 300/600 两跳，600 时排下 after(100)
assert.strictEqual(w3.currentTime, 700, '世界时间被推进');
const rainCount = fired.filter((f) => f.startsWith('rain@')).length;
assert.strictEqual(rainCount, 2, `every:300 在 700ms 内触发 2 次：${fired.join(', ')}`);
assert.ok(fired.includes('boom@hall'), 'after 延时事件到点触发');
```

延时事件返回**句柄**，随时可取消（0.12 起）——取消只是打标记，随快照走，
回滚/录像/分叉后语义保持；已触发或已取消时 `cancel` 返回 `false`（幂等无害）：

```ts
const fuse = ctx.after(3000, Explosion, { room: 'hall' });
ctx.cancel(fuse); // 拆除引信：到点不再触发、不占事件预算
```

要点：

- **世界时间是唯一时钟**——`Date.now` 被禁用，测试里 `clock.advance(ms)` 真实驱动
  tick（见 [14 测试](./14-testing.md)）。
- `every` 与 `after` 的计时全部进快照：存档、回滚、录像重放、fork 后定时行为依然一致。
- `ctx.after` 返回句柄（`ScheduledEventHandle`），`ctx.cancel(handle)` 幂等取消；
  句柄是纯数据，可以存进组件、随快照走（0.12 起）。

## 错误策略：一个系统炸了，不炸整条链

真实游戏里总有"渲染一下"、"顺手记个日志"这类不该连累主逻辑的系统。
`onError` 三种策略：

| 策略 | 行为 | 适用 |
| --- | --- | --- |
| `'propagate'`（默认） | 抛出并中止整条事件链 | 状态正确性攸关的核心系统 |
| `'skip'` | 记录错误，继续执行同事件的后续系统 | 外围系统（渲染、统计） |
| `'degrade'` | 记录错误并继续，但该系统此后被隔离禁用 | 坏了就不该再跑的系统 |

```ts
const errorsSeen: string[] = [];
const BombSystem = defineSystem({
  name: 'bomb',
  on: [Looted],
  onError: 'skip', // 默认 propagate（抛出中止整链）；skip = 记录后继续后续系统
  handle() {
    throw new Error('渲染管线炸了');
  },
});
const DownstreamSystem = defineSystem({
  name: 'downstream',
  on: [Looted],
  handle(event) {
    errorsSeen.push(`照常处理：${event.data.item}`);
  },
});

const w4 = createTestWorld({ systems: [BombSystem, DownstreamSystem] });
w4.emit(Looted.token, { item: '金币' });
w4.runChain(); // 不抛——skip 策略把错误拦在系统层
assert.deepEqual(errorsSeen, ['照常处理：金币'], '后面的系统没有被连坐');

const errors = w4.world.getSystemErrors();
assert.strictEqual(errors.length, 1);
assert.match(errors[0]!.message, /渲染管线炸了/);
assert.ok(errors[0]!.cause instanceof Error, 'v0.11：SystemErrorRecord.cause 保留原始错误');
```

v0.11 起 `SystemErrorRecord.cause` 保留原始错误对象——调 bug 时拿得到根因
堆栈与类型，不再只剩一条 message 字符串。

## 系统特权：spawn 与 destroy

`SystemContext` 注入 `spawn(bp, opts)` 与 `destroy(id)`——系统是唯一改状态的手，
命令仍只 emit：

```ts
// 掉落/产出/刷怪：从蓝图现造一个实体（确定性：同蓝图 ⇒ 同组件）
const drop = ctx.spawn(CoinBp, { patch: { located: { at: roomId } } });

// 死亡清场等（删除成功即发射引擎合成事件 entity_destroyed，可订阅做清扫）
ctx.destroy(target);

// 建立关系（0.15）：写特权五件 addRelation / removeRelation /
// getRelations / hasRelation / findRelated（读三件命令侧也可用）
ctx.addRelation(killer, Kills, victim);
```

> 注意：destroy 不级联清理其他实体的引用（如 `Located` 指向被删容器会悬挂）。
> 但删除本身**可订阅**——订阅 `EntityDestroyed`（v0.14）在这里放清扫逻辑；
> 回滚 / fork / 读档的实体重建不会误发它。关系同样悬挂保留，不级联。

## 批量迭代：ctx.each（v0.14）

遍历"同时拥有这组组件"的实体（内连接，缺任一跳过），组件元组自动映射为
数据元组——`ctx.each` / `world.each` / 命令侧 `world.each` 三层同名：

```ts
const PoisonTick = defineSystem({
  name: 'poison-tick',
  every: 1000,
  handle(_payload, ctx) {
    ctx.each([Health, Poisoned], (id, hp, poison) => {
      hp.current -= poison.damage;      // 活引用，原地改即生效
      if (hp.current <= 0) ctx.destroy(id);
    });
  },
});
```

底层走组件反查索引（以候选集最小的组件为主扫描），大世界比手写
`findByComponent(...).filter(...)` 快且意图直白。

---

[← 上一篇：04 事件](./04-events.md) | [下一篇：06 命令 →](./06-commands.md) | [目录](./index.md)
