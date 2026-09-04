// 文档「领域篇 · 对话与 NPC」示例：对话树 / requires 门控 / remember 记忆 / 副作用事件
// 由 verify-doc-examples.mjs 实测（strict tsc 类型检查 + 运行断言）
import assert from 'node:assert';
import {
  Name,
  Dialogue,
  Memory,
  defineDialogue,
  DialogueSystem,
  DialogueChoiceMade,
  createDialogueCommands,
  createTestWorld,
  defineSystem,
} from '@mud/ecs-engine';

// ---- 1. 定义对话树：分支（to）/ 门控（requires）/ 记忆（remember）/ 收尾（reply） ----
const tavernTree = defineDialogue('start', [
  {
    id: 'start',
    text: '欢迎光临酒馆。你要点什么？',
    options: [
      { text: '打听传闻', to: 'rumor', requires: ['patron'] }, // 买过酒才可见
      { text: '你是谁？', to: 'who', remember: ['asked_name'] }, // 选中后 NPC 记住
      { text: '来杯麦酒。', to: 'beer', remember: ['patron'] }, // 买酒 = 解锁钥匙
      { text: '再见。', reply: '慢走。' }, // 无 to → 说完收尾即结束
    ],
  },
  { id: 'who', text: '我叫老王，在这儿看了半辈子吧台。' }, // 无 options → 说完自动结束
  { id: 'beer', text: '酒来了，慢用。' },
  { id: 'rumor', text: '北边矿洞夜里会发光，邪门得很。' },
]);

// ---- 2. 副作用钩子：效果系统订阅 DialogueChoiceMade（对话模块只管说，不改世界） ----
const chosenTexts: string[] = [];
const EffectSystem = defineSystem({
  name: 'dialogue-effects',
  on: [DialogueChoiceMade],
  handle(event) {
    chosenTexts.push(event.data.optionText); // event.data 类型自动贯通
  },
});

const w = createTestWorld({ commands: createDialogueCommands() });
w.world.register(DialogueSystem, EffectSystem);

const barman = w.entities.createWithId('barman');
w.entities.addComponent(barman, Name, { text: '酒保', aliases: [] });
w.entities.addComponent(barman, Dialogue, tavernTree); // 对话树挂在 NPC 上
w.entities.addComponent(barman, Memory, { flags: [] }); // 有 Memory 才支持 remember

const player = w.entities.createWithId('player-1');

const dialogueLines = () =>
  w.world.output.ofKind('dialogue').map((m) => m.segments.map((s) => s.text).join(''));

// ---- 3. 首次对话：requires 不满足的选项不可见（编号列表里没有它） ----
await w.world.execute('talk 酒保', player);
assert.deepEqual(dialogueLines(), [
  '欢迎光临酒馆。你要点什么？',
  '1. 你是谁？',
  '2. 来杯麦酒。',
  '3. 再见。',
], '「打听传闻」被 requires: patron 门控，不占编号');

// 门控选项不在编号内 → 选越界序号只会得到人话错误
await w.world.execute('talk 酒保 9', player);
assert.ok(w.world.output.ofKind('error').length > 0, '没有听懂你的选择');

// ---- 4. 选 1：「你是谁？」→ remember 写入 NPC 记忆，落点无选项自动结束 ----
await w.world.execute('talk 酒保 1', player);
assert.ok(dialogueLines().includes('我叫老王，在这儿看了半辈子吧台。'));
assert.deepEqual(
  w.entities.getComponent(barman, Memory)!.flags,
  ['asked_name'],
  'remember 在选中时写入 Memory.flags',
);

// ---- 5. 对话结束后必须先重启（talk 不带序号），才能继续选选项 ----
await w.world.execute('talk 酒保', player); // who 无选项已自动结束 → 重新进入 start
await w.world.execute('talk 酒保 2', player); // 来杯麦酒 → patron 记忆解锁传闻门
assert.ok(dialogueLines().includes('酒来了，慢用。'));
assert.deepEqual(w.entities.getComponent(barman, Memory)!.flags, ['asked_name', 'patron']);

// ---- 6. 门开之后：门控选项出现在编号 1，选中即听到传闻 ----
await w.world.execute('talk 酒保', player); // beer 也无选项 → 再次重启
assert.ok(dialogueLines().includes('1. 打听传闻'), 'requires 满足后选项可见');
await w.world.execute('talk 酒保 1', player);
assert.ok(dialogueLines().includes('北边矿洞夜里会发光，邪门得很。'));

// ---- 7. 对话状态全在组件上：flags/active 进快照，快照/回滚/录像天然一致 ----
assert.deepEqual(chosenTexts, ['你是谁？', '来杯麦酒。', '打听传闻'], '副作用事件每次选择都触发');

console.log('09-dialogue ✓ 对话树 / 门控 / 记忆 / 副作用事件 全通过');
