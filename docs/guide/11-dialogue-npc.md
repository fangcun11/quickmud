# 11 · 对话与 NPC

> **本章你会学到**：分支对话树、`requires` 门控与 `remember` 记忆、
> 对话副作用的正确姿势（订阅事件而非改世界）。本章代码对应验证示例
> [09-dialogue.mts](../examples/09-dialogue.mts)。

---

## 分支对话开箱即用（0.3-B）

对话内容内联代码（纯数据），条件与记忆用 flags，组件可快照/回滚/存档：

```ts
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
```

- **分支**：`requires` 不满足的选项直接不可见；`remember` 在选中时写入
  `Memory.flags`；
- **收尾**：`reply` 是无 `to` 时 NPC 的回应；节点无 `options`（或全部被门控）
  说完自动结束；
- **副作用**：选项生效会 emit `DialogueChoiceMade`，给物品/发任务等效果由游戏层
  系统订阅该事件实现——**对话模块只管说，不改世界**。

## 挂载与驱动

```ts
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
w.addComponent(barman, Name, { text: '酒保', aliases: [] });
w.addComponent(barman, Dialogue, tavernTree); // 对话树挂在 NPC 上
w.addComponent(barman, Memory, { flags: [] }); // 有 Memory 才支持 remember

const player = w.entities.createWithId('player-1');
```

对话命令是 `talk / ask / 说 / 对话`，两种用法：

- `talk 酒保` → 搭话 / 重启对话；
- `talk 酒保 2` → 选第 2 个**可见**选项（1-based）。

## 完整对话流程（实测）

```ts
const dialogueLines = () =>
  w.world.output.ofKind('dialogue').map((m) => m.segments.map((s) => s.text).join(''));

// 首次对话：requires 不满足的选项不可见（编号列表里没有它）
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

// 选 1：「你是谁？」→ remember 写入 NPC 记忆，落点无选项自动结束
await w.world.execute('talk 酒保 1', player);
assert.ok(dialogueLines().includes('我叫老王，在这儿看了半辈子吧台。'));
assert.deepEqual(
  w.getComponent(barman, Memory)!.flags,
  ['asked_name'],
  'remember 在选中时写入 Memory.flags',
);

// 对话结束后必须先重启（talk 不带序号），才能继续选选项
await w.world.execute('talk 酒保', player); // who 无选项已自动结束 → 重新进入 start
await w.world.execute('talk 酒保 2', player); // 来杯麦酒 → patron 记忆解锁传闻门
assert.ok(dialogueLines().includes('酒来了，慢用。'));
assert.deepEqual(w.getComponent(barman, Memory)!.flags, ['asked_name', 'patron']);

// 门开之后：门控选项出现在编号 1，选中即听到传闻
await w.world.execute('talk 酒保', player); // beer 也无选项 → 再次重启
assert.ok(dialogueLines().includes('1. 打听传闻'), 'requires 满足后选项可见');
await w.world.execute('talk 酒保 1', player);
assert.ok(dialogueLines().includes('北边矿洞夜里会发光，邪门得很。'));

// 副作用事件每次选择都触发（给物品/发任务挂在这里）
assert.deepEqual(chosenTexts, ['你是谁？', '来杯麦酒。', '打听传闻']);
```

两个新手最容易撞的语义，这里点透：

1. **门控选项不占编号**——`requires` 不过滤后重排，被挡的选项从编号列表里消失，
   选越界序号只会得到错误，不会"选到下一个"；
2. **对话结束（节点无选项）后 `talk npc N` 无效**——先 `talk npc` 重启再选序号。

## 确定性

对话状态全部在组件上（`Dialogue.active` 指针 + `Memory.flags`），快照/回滚/fork/
录像重放天然一致。

---

[← 上一篇：10 物品、战斗与任务](./10-items-combat-quests.md) | [下一篇：12 存档与回滚 →](./12-save-rollback.md) | [目录](./index.md)
