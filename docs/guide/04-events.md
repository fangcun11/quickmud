# 04 · 事件

> **本章你会学到**：`defineEvent` 的柯里化语法与命名约定、v0.11 的类型贯通
> （多事件系统告别 `as` 断言）、事件链。本章代码对应验证示例
> [07-systems.mts](../examples/07-systems.mts) 的第 2 节。

---

## 定义事件：柯里化三段式

```ts
// 名字 → 载荷类型 → 调用（结尾的 () 不能漏！）
const Attacked = defineEvent('attacked')<{ attacker: string; target: string }>();
```

- **过去时态命名**：`Healed`、`Attacked`、`ItemTaken`。事件是"已发生的事实"，
  不是"请你做某事"的请求——这决定了谁是事件的发出者。
- 事件沿命令→系统、系统→系统传播（系统内 `ctx.emit` 也能发新事件，形成事件链）。

> **为什么是柯里化**：第一层把名字推断为**字面量类型**（token 携带 `'attacked'`
> 而非 `string`，多事件系统靠它收窄），第二层显式载荷类型。TypeScript 没有
> "部分泛型推断"——写成一步到位的 `defineEvent<载荷>('名字')` 会让名字退化为
> `string`，token 的字面量类型就丢了。

## 类型贯通：on 传事件定义，别传 token 字符串

**订阅的两种写法类型上分叉**：

- `on: [Attacked]`（推荐）——传**事件定义**，`handle` 里 `event.data` 就是载荷类型；
- `on: [Attacked.token]`——传 **token 字符串**，运行时等价，但引擎无法从字符串反推
  载荷类型，`event.data` 是 `unknown`。

v0.11 起，多事件订阅传定义数组时，`handle` 收到**按 token 可收窄的 union**：

```ts
const Killed = defineEvent('killed')<{ victim: string; killer?: string }>();
const Looted = defineEvent('looted')<{ item: string }>();

// 编译期自证：token 携带字面量类型 'killed' 而非 string
const _literal: EventDefinition<{ victim: string; killer?: string }, 'killed'> = Killed;

const journal: string[] = [];
const JournalSystem = defineSystem({
  name: 'journal',
  on: [Killed, Looted], // 传事件定义（而非 .token 字符串）——类型贯通的关键
  handle(event) {
    if (event.token === Killed.token) {
      // 这个分支里 event.data 自动收窄为 { victim; killer? }——没有 as
      journal.push(`${event.data.victim} 倒下了`);
    } else {
      journal.push(`捡到了 ${event.data.item}`); // else 分支即 Looted，同样有类型
    }
  },
});

const w1 = createTestWorld({ systems: [JournalSystem] });
w1.emit(Killed.token, { victim: '野狼', killer: '勇者' });
w1.emit(Looted.token, { item: '狼皮' });
w1.runChain(); // 同步跑完整条事件链，断言紧跟其后
assert.deepEqual(journal, ['野狼 倒下了', '捡到了 狼皮']);
```

0.11 之前，这个系统需要两处 `as` 断言；现在一个都没有。

## 事件链：系统 emit 新事件

事件不是一次性的——系统在 `handle` 里可以 `ctx.emit` 新事件，形成管道式协作：

```ts
const DamageDealt = defineEvent('damage-dealt')<{ target: string; amount: number }>();
const ArmorBroken = defineEvent('armor-broken')<{ target: string }>();

const trace: string[] = [];
const DamageSystem = defineSystem({
  name: 'damage',
  on: [DamageDealt],
  priority: 10, // 同一事件多个订阅者时，小值先执行
  handle(event, ctx) {
    if (event.data.amount >= 20) {
      trace.push(`重击 ${event.data.target}`);
      ctx.emit(ArmorBroken, { target: event.data.target }); // 发新事件 → 链式传播
    }
  },
});
const ArmorSystem = defineSystem({
  name: 'armor',
  on: [ArmorBroken],
  handle(event) {
    trace.push(`护甲碎裂：${event.data.target}`);
  },
});

const w2 = createTestWorld({ systems: [DamageSystem, ArmorSystem] });
w2.emit(DamageDealt.token, { target: '哥布林', amount: 25 });
w2.runChain(); // 链上所有事件（含系统中途 emit 的）一次排水到空
assert.deepEqual(trace, ['重击 哥布林', '护甲碎裂：哥布林']);
```

战斗 → 掉落 → 死亡清场这条 prefabs 的死亡管线（见
[10 物品、战斗与任务](./10-items-combat-quests.md)）就是靠事件链组装的。

## 事件的两种发射方式

| 方式 | 场景 | 位置 |
| --- | --- | --- |
| `world.emit(定义或token, data)` | 命令翻译玩家输入 | `CommandContext.world` |
| `ctx.emit(定义或token, data)` | 系统间协作 | `SystemContext` |

两种都支持传事件定义（类型化）或 token 字符串（`data` 退化为 `unknown`）。

---

[← 上一篇：03 组件与实体](./03-entities-components.md) | [下一篇：05 系统 →](./05-systems.md) | [目录](./index.md)
