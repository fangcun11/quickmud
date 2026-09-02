# @mud/ecs-engine 新手使用指南

> 面向第一次接触本引擎的开发者。读完本文，你能独立搭出一个可存档的文字冒险游戏骨架。
> 文档中所有代码块均经过实测（验证方式见文末）。

---

## 1. 引擎是什么：三分钟建立心智模型

传统写法里，玩家输入"拿起剑"后，你会在一个巨大的 if/else 里直接改状态、直接打印文字。状态散落各处，存档无从下手，测试更是灾难。

本引擎把这件事拆成一条**单向流水线**：

```
玩家输入 "rest 30"
      │
      ▼
┌─ 命令 (Command) ─┐   解析动词和参数，只负责"翻译意图"
│  emit(Heal, …)  │   发出一个事件，不做任何具体逻辑
└────────┬────────┘
         ▼
┌─ 事件泵 (EventPump) ─┐  把事件按优先级派发给订阅者
└────────┬────────────┘
         ▼
┌─ 系统 (System) ──┐   唯一允许修改状态的地方
│ 修改 Health 组件 │   并向输出收集器写反馈
└────────┬────────┘
         ▼
┌─ 输出 (OutputCollector) ─┐  所有要展示给玩家的文字都在这里
└──────────────────────────┘
```

三条铁律，记住就够了：

1. **命令不发状态、系统不解析输入**——命令只 emit 事件，系统只消费事件。
2. **状态只活在组件里**——实体（Entity）只是一个 ID，一切数据都是挂在它身上的组件（Component）。
3. **所有玩家可见文字走输出收集器**——不要在系统里 `console.log`。

为什么要这么绕？因为**状态集中**才可能做快照存档，**事件驱动**才可能做回滚、录像、多事件联动。前期觉得绕的地方，后期都会还你自由。

---

## 2. 安装

要求 Node.js ≥ 18。

```bash
# 从 npm 安装（发布后）
npm install @mud/ecs-engine

# 或从仓库源码打包安装
cd packages/engine && pnpm pack
npm install ./mud-ecs-engine-0.1.0.tgz
```

零运行时依赖。ESM / CJS 双产物，TypeScript 类型开箱即用（`strict` + `node16` 模块解析均验证过）。

---

## 3. 五分钟最小可运行示例

把这个存成 `demo.mts`，`npx tsx demo.mts` 直接跑：

```ts
import {
  World, trait, defineEvent, defineSystem, defineCommand, Name,
} from '@mud/ecs-engine';

// ── 组件：纯数据，没有任何行为 ──────────────────────
const Health = trait('health', () => ({ current: 100, max: 100 }));

// ── 事件：发生过的事，过去时态命名 ────────────────────
// 注意柯里化语法：defineEvent('名字')<载荷类型>()，结尾有 ()
const Healed = defineEvent('healed')<{ target: string; amount: number }>();

// ── 系统：订阅事件，修改状态，产出输出 ─────────────────
const HealSystem = defineSystem({
  name: 'heal',
  on: [Healed.token],          // 订阅事件 token
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
  console.log(msg.segments.map(s => s.text).join(''));  // → 你恢复了 30 点生命。
}
```

跑通了？你已经用上了引擎的全部四个核心概念。下面逐个展开。

---

## 4. 核心概念详解

### 4.1 组件（trait）：实体的"器官"

```ts
const Position = trait('position', () => ({ roomId: 'town_square' }));
const Locked  = trait('locked');   // 无数据组件（标记用），如"门已上锁"
```

- `trait(name, defaults)`：`name` 用于生成**确定性 ID**（同名组件永远同 ID，存档不会漂移）；`defaults` 是默认值工厂。
- 组件是**纯数据**，不放方法。行为写在系统里。
- 读取/写入：

```ts
const hp = world.entities.getComponent(player, Health);  // → { current, max } | undefined
if (hp) hp.current -= 10;                                // 直接改，引擎不做代理
```

**永远用 `trait()` 的返回值作为 key**，不要手写字符串 ID——那会绕过确定性 ID 机制。

### 4.2 实体（Entity）：只是一张"身份证"

```ts
const id1 = world.entities.create();                 // 自动 ID
const id2 = world.entities.createWithId('goblin-1'); // 指定 ID（可复现存档的关键）
world.entities.addComponent(id2, Health, { current: 30, max: 30 });
world.entities.addComponent(id2, Name, { text: '哥布林', aliases: ['小怪'] });
```

- 实体本身没有数据，只是组件的挂载点。
- `Name` 是引擎内置组件（`{ text, aliases }`），**命令参数按名字找实体靠它**。想被 `look goblin` 找到，就必须挂 `Name`。
- 玩家（player）也只是一个普通实体，命令执行时通过 `player` 参数传入它的 ID。

### 4.3 事件（defineEvent）：系统之间的"官方公报"

```ts
// 柯里化三段式：名字 → 载荷类型 → 调用
const Attacked = defineEvent('attacked')<{ attacker: string; target: string }>();
```

- **过去时态命名**：`Healed`、`Attacked`、`ItemTaken`。事件是"已发生的事实"，不是"请你做某事"的请求——这决定了谁是事件的发出者。
- 事件沿命令→系统、系统→系统传播（系统内 `ctx.emit` 也能发新事件，形成事件链）。
- 订阅用 `on: [Attacked.token]`。token 就是事件名字符串，类型安全由 `defineEvent` 的泛型保证。

### 4.4 系统（defineSystem）：唯一动状态的手

```ts
const CombatSystem = defineSystem({
  name: 'combat',
  on: [Attacked.token],
  priority: 10,
  handle(event, ctx) {
    // ctx.getComponent  / ctx.emit  / ctx.output.narrative(...)
  },
});
world.register(CombatSystem);
```

- **系统是唯一允许修改组件的地方**。命令里直接改组件？编译不拦你，但你会失去存档一致性和可测试性。
- `priority`：同一事件有多个订阅者时，小值先执行。不确定就别写，默认 0，按注册顺序。
- `handle` 允许 async。

### 4.5 命令（defineCommand）：输入的"翻译官"

```ts
const TakeCommand = defineCommand({
  verbs: ['take', 'get', '拿', '拾取'],  // 同义词全写这，多语言随意
  abbrev: ['t'],                         // 可选缩写
  args: {
    item: { type: 'entity' },            // 第 1 个词
    from:  { type: 'optional_entity' },  // 第 2 个词，可缺省
  },
  handle({ args, raw, player, world }) {
    // args 类型自动推导：item: string | null，from: string | null
    // 运行时给的是原始词（未解析成实体ID），需要实体时用 world.findEntity(args.item)
    if (!args.item) return '拿什么？';     // 返回 string → 直接作为反馈
    world.emit(ItemTaken, { player, item: args.item });
    // 不写 return（void）→ 反馈由事件链上的系统产出
  },
});
```

**args 五种类型与推导结果**（这是本引擎类型化的核心卖点，运行时行为与类型严格一致）：

| type | 吃掉输入 | 推导类型 | 缺省值 |
|---|---|---|---|
| `word` | 一个词 | `string` | `''` |
| `direction` | 一个词 | `string` | `''` |
| `rest` | 剩余所有词 | `string` | `''` |
| `entity` | 一个词 | `string \| null` | `null` |
| `optional_entity` | 一个词 | `string \| null` | `null` |

参数按**声明顺序**依次吃词，`rest` 吃掉后不再有后续参数。

**动词冲突会直接抛错**（`命令动词冲突`），后注册者不会静默覆盖前者——两个内容包撞了动词会当场暴露，而不是悄悄吞掉功能。

### 4.6 输出收集器：玩家看到的一切

```ts
world.output.narrative([{ text: '旁白文字' }]);   // 旁白
world.output.dialogue([{ text: '"你好。"' }]);   // 对白
world.output.error('这里过不去。');               // 错误（纯文本快捷方式）
world.output.status({ hp: 80 });                 // 状态数据（前端自行渲染）

world.output.ofKind('narrative');   // 按种类取
world.output.count;                 // 条数
```

为什么要收集而不是直接打印？——**渲染与逻辑解耦**。同一个世界，终端可以打印纯文本，Web 前端可以拿 `segments` 里的语义标签渲染颜色和动效。每次 `execute` 前输出自动清空，一轮输入对应一批输出。

---

## 5. 存档与回滚

```ts
import { SavePort, FsBackend } from '@mud/ecs-engine';

const save = new SavePort(new FsBackend(), '0.1.0'); // 第二个参数=当前引擎/游戏版本

// 存：快照是纯 JSON（engineVersion/tickCount/entities），FsBackend 自动建目录
await save.save('./saves/slot1.json', world.createSnapshot());

// 读：文件不存在返回 null？不——load 抛 "Save file not found"；
// 想先探测用 exists；JSON 损坏会原样抛错，不会被吞成"无存档"
if (await save.exists('./saves/slot1.json')) {
  const data = await save.load('./saves/slot1.json');
}

// 回滚（不落盘的"读档"）：恢复实体+组件+tick，清空事件队列
world.rollbackWorld(world.createSnapshot());
```

**版本迁移**：游戏版本升级后旧存档怎么办？注册迁移链，`load` 会自动逐版本推进：

```ts
save.registerMigrations({
  from: '0.1.0',
  to: '0.2.0', // 必填：迁移后版本，load 据此推进版本号
  migrate: (snap) => ({
    ...snap,
    entities: snap.entities.map(e =>
      // 快照里组件按确定性 ID（Health.id）键控，不是名字
      e.components[Health.id] ? { ...e, components: { ...e.components, [Health.id]: { ...e.components[Health.id], max: 150 } } } : e
    ),
  }),
});
// load 时：0.1.0 的存档自动跑完迁移链变成 0.2.0 的形状
```

存档兼容性是文字游戏的命根子，建议**每次改组件结构都写一条迁移**，版本号跟 `package.json`。

浏览器环境用 `LocalStorageBackend` 替换 `FsBackend` 即可，`SavePort` 的 API 完全一致。

---

## 6. 写测试

引擎自带测试工具，**不必启动游戏循环**：

```ts
import { createTestWorld, ManualClock } from '@mud/ecs-engine';
import { expect, it } from 'vitest';

it('休息回血不超过上限', () => {
  const w = createTestWorld({ systems: [HealSystem] });
  const p = w.entities.create();
  w.entities.addComponent(p, Health, { current: 90, max: 100 });

  w.emit(Healed.token, { target: p, amount: 30 });
  w.runChain();   // 手动驱动事件链，同步、确定

  expect(w.entities.getComponent(p, Health)!.current).toBe(100);
  expect(w.getLog()).toContain(Healed.token);  // 事件日志断言
});
```

要点：

- `w.runChain()` 同步跑完整个事件链，**没有隐藏的异步**，断言可以紧跟其后。
- `createTestWorld` 接受 `entities`（夹具数据）和 `clock: new ManualClock()`——时间由你拨动，测试永远确定性。
- 测命令就直接 `await w.world.execute('rest 30', p)`，断言 `w.world.output`。

---

## 7. 常见坑（新手 90% 会踩）

| 症状 | 原因 | 解法 |
|---|---|---|
| 命令执行了，什么都没输出 | 命令返回了 null，事件链上也没有系统产出 narrative | 检查系统是否 `ctx.output.narrative(...)`；输出要自己从 `world.output` 取 |
| `world.execute()` 返回了"我不明白你的意思" | 动词没注册，或大小写/全半角不一致 | 动词统一小写注册；`execute` 内部会 lowercase，但全角空格不行 |
| `defineEvent` 编译报错 | 漏了结尾的 `()`：柯里化是 `defineEvent('x')<T>()` | 补上 `()` |
| args 拿到 `null` 却当 string 用 | `entity` 类型的词可能缺省 | 判空后再用；需要实体用 `world.findEntity(name)` |
| 两个命令的动词报"命令动词冲突" | verbs/abbrev 撞了 | 这是故意的。改名，或复用同一命令 |
| 改了组件结构，旧存档读出来是乱的 | 没写迁移 | 见 §5 的 `registerMigrations` |
| 快照回滚后实体不见了 | 快照是在创建该实体**之前**拍的 | 快照时机问题，不是引擎 bug |
| `rewriteRelativeImportExtensions` 没生效 | 它只重写显式 `.ts` 后缀的导入 | 扩展名导入由 build 脚本后处理 `.d.ts`（本仓库已内置，无需操心） |

---

## 8. API 速查表

| 类别 | API | 说明 |
|---|---|---|
| 世界 | `new World({ tickInterval?, maxEventsPerCommand? })` | 核心入口 |
| | `world.register(...systems)` | 注册系统 |
| | `world.registerCommands(...commands)` | 注册命令（动词冲突即抛错） |
| | `await world.execute(input, playerId)` | 执行玩家输入 → `string \| null` |
| | `world.createSnapshot()` / `world.rollbackWorld(snap)` | 快照 / 回滚 |
| | `world.start()` / `world.stop()` / `world.tick()` | 游戏循环 |
| 实体 | `entities.create()` / `entities.createWithId(id)` | 创建实体 |
| | `entities.addComponent(id, comp, data)` | 挂组件 |
| | `entities.getComponent(id, comp)` | 读组件 → `T \| undefined` |
| 定义 | `trait(name, defaults?)` / `relation(name)` | 组件 / 关系 |
| | `defineEvent(name)<T>()` / `defineSystem({...})` / `defineCommand({...})` | 事件 / 系统 / 命令 |
| 输出 | `world.output.narrative/error/status/dialogue(...)` | 各类输出 |
| | `world.output.ofKind(kind)` / `.count` | 读取 |
| 存档 | `new SavePort(backend, version)` | `save/load/exists/delete` |
| | `save.registerMigrations(...)` | 版本迁移链 |
| | `FsBackend` / `LocalStorageBackend` | Node / 浏览器 |
| 测试 | `createTestWorld({ systems?, entities?, clock? })` | 测试世界 |
| | `w.emit(token, data)` / `w.runChain()` / `w.getLog()` | 驱动与断言 |
| | `ManualClock` / `w.clock.advance(ms)` | 手动时钟 |

**0.2 已实现**（写作时"尚未实现"的清单，现已全部落地）：定时系统（every + ctx.after）、逐系统错误策略（onError 三模式）、开发者命令（/tp /give /heal /dev-help）。另有录像重放（record/verifyReplay）与世界分叉（world.fork）两项确定性新能力——细节见 `packages/engine/README.md` 的 0.2 速览与 `CHANGELOG.md`。

---

## 9. 下一步

- 完整参考例题：`example/demo-adventure/`（房间移动、查看、背包、帮助，REPL 交互）
- 本文档示例验证脚本：`docs/examples/`（见下）
- 有疑问先看 `docs/code-review-2026-09-01.md` 里的设计权衡说明

---

### 附：本文档示例的验证方式

`docs/examples/` 下每个 `.mts` 文件对应正文一个可运行示例，
`node scripts/verify-doc-examples.mjs` 会逐一执行并断言输出，保证文档不腐烂。
