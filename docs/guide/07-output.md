# 07 · 输出与渲染

> **本章你会学到**：四类输出的语义分工、为什么"收集"而不是"打印"、
> 三种渲染纯函数。本章代码对应验证示例
> [08-commands-output.mts](../examples/08-commands-output.mts) 的第 5 节。

---

## 输出收集器：玩家看到的一切

```ts
world.output.narrative([{ text: '旁白文字' }]);   // 旁白
world.output.dialogue([{ text: '"你好。"' }]);   // 对白
world.output.error('这里过不去。');               // 错误（纯文本快捷方式）
world.output.status({ hp: 80 });                 // 状态数据（前端自行渲染）

world.output.ofKind('narrative');   // 按种类取
world.output.getAll();              // 全量消息（不清空）
world.output.count;                 // 条数
world.drainOutput();                // 取走全部并复位缓冲（0.12 起）
```

**为什么要收集而不是直接打印？——渲染与逻辑解耦。** 同一个世界，终端可以打印纯文本，
Web 前端可以拿 `segments` 里的语义标签渲染颜色和动效。

**输出跨命令累积（0.12 起的行为）。** `execute` 不再自动清空输出——多次执行的
消息都在缓冲里。单轮场景（每轮渲染后复位）用 `drainOutput()`：一次取走全部并清空，
下一轮从干净状态开始；只读检查用 `getAll() / ofKind() / last()`。
批量处理、回合结算等"攒一批再渲染"的场景直接受益。

## 消息的形状

每条消息是 `{ kind, segments, meta? }`，segment 可以带样式与实体引用：

```ts
type OutputKind = 'narrative' | 'system' | 'error' | 'dialogue' | 'title' | 'prompt' | 'status';

interface Segment {
  text: string;
  style?: { color?: SemanticColor; bold?: boolean; italic?: boolean; tag?: SegmentTag };
  entityRef?: EntityId;  // 点谁跳谁，前端自己决定
}
```

`status` 消息的数据放 `meta`（`JSON.stringify` 后也进 `segments` 便于纯文本终端显示）。

## 三种渲染纯函数

同一批消息，终端 / Web / 日志各取所需——渲染是**纯函数**，没有隐藏状态：

```ts
const messages = w.world.output.getAll();
const text = renderPlainText(messages); // 日志：纯文本逐行
const html = renderSemanticHtml(messages); // Web：语义化 <p class="mud-*">
const ansi = renderAnsi(messages, { noColor: true }); // 终端：ANSI 颜色（可关）

assert.ok(text.includes('【状态】生命 80/100'), 'plainText 保留原文');
assert.ok(text.includes('存档功能未开启。'));
assert.ok(html.includes('<p class="mud-narrative">'), 'HTML 带语义类名');
assert.ok(html.includes('&lt;') === false && html.includes('【状态】'), 'HTML 已转义并保留内容');
assert.strictEqual(ansi, text, 'noColor 模式下 ANSI 渲染退化为纯文本');
```

## OutputView：系统与命令共用的输出接口

系统（`ctx.output`）与命令（v0.11 起的 `handle({ output })`）拿到的是同一个
**`OutputView`** 接口：`narrative / dialogue / error / status` 四个方法，
字符串自动包装为单段，`Segment[]` 原样透传：

```ts
ctx.output.narrative('纯文本也行');          // 自动包装
ctx.output.narrative([{ text: '重击', style: { bold: true } }]);  // 带样式
```

`world.output` 则是完整的 `OutputCollector`（含 `title / prompt / system` 等全部
kind 与读取 API）。

---

[← 上一篇：06 命令](./06-commands.md) | [下一篇：08 房间与地图 →](./08-rooms-maps.md) | [目录](./index.md)
