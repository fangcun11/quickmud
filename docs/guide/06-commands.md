# 06 · 命令

> **本章你会学到**：args 五种参数类型与类型推导、动词冲突 fail-fast、
> v0.11 的命令输出通道、开发者命令。本章代码对应验证示例
> [08-commands-output.mts](../examples/08-commands-output.mts)。

---

## 命令：输入的"翻译官"

命令解析动词和参数，**只 emit 事件，不做具体逻辑**（要给玩家的直接反馈可以 return 字符串）：

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

## args 五种类型与推导结果

这是本引擎类型化的核心卖点，**运行时行为与类型严格一致**（下面的验证示例实跑过）：

| type | 吃掉输入 | 推导类型 | 缺省值 |
| --- | --- | --- | --- |
| `word` | 一个词 | `string` | `''` |
| `direction` | 一个词 | `string` | `''` |
| `rest` | 剩余所有词 | `string` | `''` |
| `entity` | 一个词 | `string \| null` | `null` |
| `optional_entity` | 一个词 | `string \| null` | `null` |

参数按**声明顺序**依次吃词，`rest` 吃掉后不再有后续参数。

```ts
const ProbeCommand = defineCommand({
  verbs: ['probe'],
  args: {
    action: { type: 'word' }, // 一个词 → string
    dir: { type: 'direction' }, // 一个词 → string
    target: { type: 'entity' }, // 一个词 → string | null（原始词，未解析成实体 id）
    holder: { type: 'optional_entity' }, // 一个词 → string | null
    note: { type: 'rest' }, // 剩余所有词 → string
  },
  handle({ args, output }) {
    // 编译器已知道 args.action: string、args.target: string | null——没有 as
    output.status({ ...args }); // v0.11 命令输出通道：结构化数据直接进输出流
    return null;
  },
});

// …注册、创建玩家后：
// 按声明顺序依次吃词；entity 类型给的是原始词（要实体用 world.findEntity）
await w.world.execute('probe move north 金币 酒保 剩下的全都进 note', player);
const status = w.world.output.ofKind('status')[0];
assert.deepEqual(status!.meta, {
  action: 'move',
  dir: 'north',
  target: '金币',
  holder: '酒保',
  note: '剩下的全都进 note',
});

// 词不够时：word/direction/rest 缺省 ''，entity/optional_entity 缺省 null
await w.world.execute('probe', player);
assert.deepEqual(w.world.output.ofKind('status')[0]!.meta, {
  action: '',
  dir: '',
  target: null,
  holder: null,
  note: '',
});
```

## 返回串与 output 通道（v0.11）

命令有两种给玩家话的方式，v0.11 起可以**同时用**：

- **返回串**——`return '拿什么？'`，直接作为命令反馈（一锤子买卖）；
- **输出通道**——`handle` 的 context 里有 `output`（与系统同款 `OutputView`），
  语义化输出直接进输出流（铁律"命令不改状态"不变，`output` 只写输出流）。

```ts
const ScoreCommand = defineCommand({
  verbs: ['score'],
  handle({ output }) {
    output.narrative('【状态】生命 80/100'); // 字符串自动包装为 narrative 段
    output.error('存档功能未开启。');
    return '—— score 完毕 ——'; // 返回串 = 命令自己的文字反馈
  },
});

w.world.drainOutput(); // 0.12 起 execute 不再自动清空输出：渲染完一轮显式接管
const feedback = await w.world.execute('score', player);
assert.strictEqual(feedback, '—— score 完毕 ——');
assert.deepEqual(
  w.world.output.getAll().map((m) => m.kind),
  ['narrative', 'error'],
  'drainOutput() 接管后，缓冲里只有本轮 score 写入的两条',
);
```

什么时候用哪个？纯文本一句话用返回串；要分段、带样式、带结构化数据（`status`）
的输出走 `output` 通道。在此之前，为一条语义化输出"专门写一个系统"是常见绕路，
v0.11 之后不必了。

## 动词冲突：定义期 fail-fast

两个命令的 verbs/abbrev 撞车会**直接抛错**，后注册者不会静默覆盖前者——
两个内容包撞了动词会当场暴露，而不是悄悄吞掉功能：

```ts
assert.throws(
  () => w.world.registerCommands(defineCommand({ verbs: ['probe'], handle: () => null })),
  /命令动词冲突/,
);
```

这是故意的。改名，或复用同一命令。

## 开发者命令

开发者套件提供 `/tp`、`/heal`、`/dev-help`（按 `position`/`health` 组件命名约定
工作），调试用，随包分发。0.12 起**命令走事件链**——命令只翻译意图（读状态拼
反馈 + emit `dev_teleported`/`dev_healed` 事件），写状态的是内置
`DeveloperEffectSystem`，一步注册：

```ts
import { registerDeveloperKit } from '@mud/ecs-engine';

registerDeveloperKit(world); // 命令 + 效果系统
```

只注册命令组（`world.registerCommands(...createDeveloperCommands())`）依然合法，
但事件悬空——反馈照给、状态不落（fail-safe，也是"改状态的唯一通道是系统"
铁律的自然示范）。

---

[← 上一篇：05 系统](./05-systems.md) | [下一篇：07 输出与渲染 →](./07-output.md) | [目录](./index.md)
