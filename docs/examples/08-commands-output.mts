// 文档「基础篇 · 命令 / 输出」示例：args 五型推导、动词冲突 fail-fast、
// 命令输出通道（v0.11）、三种渲染纯函数
// 由 verify-doc-examples.mjs 实测（strict tsc 类型检查 + 运行断言）
import assert from 'node:assert';
import {
  Name,
  defineCommand,
  createTestWorld,
  renderPlainText,
  renderAnsi,
  renderSemanticHtml,
} from '@mud/ecs-engine';

// ---- 1. args 五型：类型推导与运行时行为严格一致 ----
const ProbeCommand = defineCommand({ describe: '测试用命令',
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

// ---- 2. 返回串与 output 共存（v0.11）：命令可以又写流、又给反馈 ----
const ScoreCommand = defineCommand({ describe: '测试用命令',
  verbs: ['score'],
  handle({ output }) {
    output.narrative('【状态】生命 80/100'); // 字符串自动包装为 narrative 段
    output.error('存档功能未开启。');
    return '—— score 完毕 ——'; // 返回串 = 命令自己的文字反馈
  },
});

const w = createTestWorld({ commands: [ProbeCommand, ScoreCommand] });
const player = w.entities.createWithId('player-1');
w.addComponent(player, Name, { text: '勇者', aliases: [] });

// 按声明顺序依次吃词；entity 类型给的是原始词（要实体用 world.findEntity）
// （新建世界首轮 execute 前缓冲为空，[0] 即本轮消息；多轮场景见下文 drainOutput）
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
// 0.12 起 execute 不再自动清空输出：多轮输出在缓冲里累积，
// 渲染/断言完一轮就用 drainOutput() 取走全部并复位——下一轮从干净状态开始
w.world.drainOutput();
await w.world.execute('probe', player);
assert.deepEqual(w.world.output.ofKind('status')[0]!.meta, {
  action: '',
  dir: '',
  target: null,
  holder: null,
  note: '',
});

// ---- 3. 返回串进反馈，output 消息进输出流，两不耽误 ----
w.world.drainOutput();
const feedback = await w.world.execute('score', player);
assert.strictEqual(feedback, '—— score 完毕 ——');
assert.deepEqual(
  w.world.output.getAll().map((m) => m.kind),
  ['narrative', 'error'],
  'drainOutput() 接管后，缓冲里只有本轮 score 写入的两条',
);
assert.strictEqual(
  w.world.output.ofKind('narrative')[0]!.segments[0]!.text,
  '【状态】生命 80/100',
);

// ---- 4. 动词冲突：定义期 fail-fast，绝不静默覆盖 ----
assert.throws(
  () => w.world.registerCommands(defineCommand({ describe: '测试用命令', verbs: ['probe'], handle: () => null })),
  /命令动词冲突/,
);

// ---- 5. 三种渲染纯函数：同一批消息，终端 / Web / 日志各取所需 ----
const messages = w.world.output.getAll();
const text = renderPlainText(messages); // 日志：纯文本逐行
const html = renderSemanticHtml(messages); // Web：语义化 <p class="mud-*">
const ansi = renderAnsi(messages, { noColor: true }); // 终端：ANSI 颜色（可关）

assert.ok(text.includes('【状态】生命 80/100'), 'plainText 保留原文');
assert.ok(text.includes('存档功能未开启。'));
assert.ok(html.includes('<p class="mud-narrative">'), 'HTML 带语义类名');
assert.ok(html.includes('&lt;') === false && html.includes('【状态】'), 'HTML 已转义并保留内容');
assert.strictEqual(ansi, text, 'noColor 模式下 ANSI 渲染退化为纯文本');

console.log('08-commands-output ✓ args 五型 / 输出通道 / 动词冲突 / 三渲染 全通过');
