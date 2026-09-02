/**
 * 0.3-B 对话与 NPC 测试
 */
import { describe, it, expect } from 'vitest';
import {
  World,
  Name,
  Dialogue,
  Memory,
  defineDialogue,
  DialogueSystem,
  createDialogueCommands,
  record,
  verifyReplay,
} from '../index';
import type { OutputMessage } from './output/types';

/** 对话测试夹具：flags 门控分支 */
function tavernDialogue() {
  return defineDialogue('start', [
    {
      id: 'start',
      text: '欢迎光临酒馆。',
      options: [
        // requires: 'trusted' → 初始不可见；信任酒保后解锁
        { text: '打听传闻', to: 'rumor', requires: ['trusted'] },
        { text: '你是谁？', to: 'who', remember: ['asked_who'] },
        { text: '再见。', reply: '慢走，欢迎再来。' },
      ],
    },
    {
      id: 'who',
      text: '我是这里的酒保，见过无数冒险者。',
      options: [{ text: '报上你的名字。', to: 'name', remember: ['trusted'] }],
    },
    { id: 'name', text: '我叫老王。' }, // 无 options → 说完自动结束
    { id: 'rumor', text: '据说北边山洞里藏着宝藏。' },
  ]);
}

function buildWorld() {
  const w = new World();
  w.register(DialogueSystem);
  w.registerCommands(...createDialogueCommands());

  const player = w.entities.create();
  const npc = w.entities.createWithId('barkeep');
  w.entities.addComponent(npc, Name, { text: '酒保', aliases: ['bartender'] });
  w.entities.addComponent(npc, Dialogue, tavernDialogue());
  w.entities.addComponent(npc, Memory, { flags: [] });
  return { w, player, npc };
}

/** 提取某类输出的纯文本 */
function textOf(messages: OutputMessage[], kind: string): string[] {
  return messages
    .filter((m) => m.kind === kind)
    .map((m) => m.segments.map((s) => s.text).join(''));
}

describe('B1 对话内容校验（defineDialogue）', () => {
  it('空节点表 fail-fast', () => {
    expect(() => defineDialogue('start', [])).toThrow(/至少需要一个对话节点/);
  });

  it('entry 引用不存在的节点时 fail-fast', () => {
    expect(() => defineDialogue('missing', [{ id: 'a', text: 'hi' }])).toThrow(/missing/);
  });

  it('option.to 引用不存在的节点时 fail-fast', () => {
    expect(() =>
      defineDialogue('start', [
        { id: 'start', text: 'hi', options: [{ text: 'x', to: 'ghost' }] },
      ]),
    ).toThrow(/ghost/);
  });

  it('节点 id 重复时 fail-fast', () => {
    expect(() =>
      defineDialogue('a', [
        { id: 'a', text: '1' },
        { id: 'a', text: '2' },
      ]),
    ).toThrow(/重复/);
  });
});

describe('B2 对话系统与命令', () => {
  it('talk 进入对话：输出节点文本与可见选项（requires 门过滤）', async () => {
    const { w, player } = buildWorld();
    await w.execute('talk 酒保', player);

    const lines = textOf(w.output.getAll(), 'dialogue');
    expect(lines[0]).toBe('欢迎光临酒馆。');
    // requires: trusted 未满足 → 打听传闻不可见，只剩 2 个
    expect(lines).toEqual([
      '欢迎光临酒馆。',
      '1. 你是谁？',
      '2. 再见。',
    ]);
  });

  it('talk 找不到实体 / 目标不可对话时给出反馈', async () => {
    const { w, player } = buildWorld();
    expect(await w.execute('talk 幽灵', player)).toBe('这里没有「幽灵」。');

    // 无 Dialogue 组件的实体
    const { w: w2, player: p2, npc } = buildWorld();
    w2.entities.removeComponent(npc, Dialogue);
    expect(await w2.execute('talk 酒保', p2)).toBe('ta 看起来不想和你说话。');
  });

  it('别名与 findEntity 集成：talk bartender 同样可对话', async () => {
    const { w, player } = buildWorld();
    await w.execute('talk bartender', player);
    expect(textOf(w.output.getAll(), 'dialogue')[0]).toBe('欢迎光临酒馆。');
  });

  it('choose 推进：remember 写入 flags，无选项节点说完自动结束', async () => {
    const { w, player, npc } = buildWorld();

    await w.execute('talk 酒保', player);
    await w.execute('talk 酒保 1', player); // 你是谁？

    const memory = w.entities.getComponent(npc, Memory)!;
    expect(memory.flags).toContain('asked_who');
    expect(textOf(w.output.getAll(), 'dialogue').slice(-2)).toEqual([
      '我是这里的酒保，见过无数冒险者。',
      '1. 报上你的名字。',
    ]);
  });

  it('requires 解锁：信任酒保后，隐藏选项在下次对话出现', async () => {
    const { w, player, npc } = buildWorld();
    const dialogue = () => w.entities.getComponent(npc, Dialogue)!;

    await w.execute('talk 酒保', player); // start
    expect(dialogue()!.active).toBe('start');
    await w.execute('talk 酒保 1', player); // → who（active=who）
    await w.execute('talk 酒保 1', player); // → name，无选项 → 结束
    expect(dialogue()!.active).toBeNull();
    expect(w.entities.getComponent(npc, Memory)!.flags).toEqual(['asked_who', 'trusted']);

    // 重新搭话：打听传闻现在可见（requires: trusted）
    await w.execute('talk 酒保', player);
    const lines = textOf(w.output.getAll(), 'dialogue');
    expect(lines[0]).toBe('欢迎光临酒馆。');
    expect(lines[1]).toBe('1. 打听传闻');
  });

  it('reply 结束语：无 to 的选项在结束时输出 NPC 回应', async () => {
    const { w, player, npc } = buildWorld();
    await w.execute('talk 酒保', player);
    await w.execute('talk 酒保 2', player); // 再见。

    expect(textOf(w.output.getAll(), 'dialogue')).toContain('慢走，欢迎再来。');
    expect(w.entities.getComponent(npc, Dialogue)!.active).toBeNull();
  });

  it('非法选项序号：反馈错误且对话状态不变', async () => {
    const { w, player, npc } = buildWorld();

    // 序号非法（非数字）
    expect(await w.execute('talk 酒保 abc', player)).toBe('没有「abc」这个选项。');
    // 序号超范围（当前只有 2 个可见选项）
    await w.execute('talk 酒保', player);
    await w.execute('talk 酒保 5', player);
    expect(textOf(w.output.getAll(), 'error')).toContain('ta 没有听懂你的选择。');
    expect(w.entities.getComponent(npc, Dialogue)!.active).toBe('start');
  });

  it('没在对话中却选序号时给出反馈', async () => {
    const { w, player } = buildWorld();
    await w.execute('talk 酒保 1', player); // active 为 null（从未 talk），走 choose
    expect(textOf(w.output.getAll(), 'error')).toContain('ta 现在没有在和你说话。');
  });

  it('choice-made 事件可供效果系统订阅（给物品等副作用走事件链）', async () => {
    const seen: string[] = [];
    const w = new World();
    const Listener = {
      name: 'reaction',
      on: ['dialogue:choice-made'],
      handle(event: { data: { npc: string; optionText: string } }) {
        seen.push(event.data.optionText);
      },
    };
    w.register(DialogueSystem, Listener as never);
    w.registerCommands(...createDialogueCommands());
    const player = w.entities.create();
    const npc = w.entities.createWithId('barkeep');
    w.entities.addComponent(npc, Name, { text: '酒保' });
    w.entities.addComponent(npc, Dialogue, tavernDialogue());
    w.entities.addComponent(npc, Memory, { flags: [] });

    await w.execute('talk 酒保', player);
    await w.execute('talk 酒保 1', player);
    expect(seen).toEqual(['你是谁？']);
  });

  it('快照 round-trip：进行中的对话与记忆随回滚还原', async () => {
    const { w, player, npc } = buildWorld();

    await w.execute('talk 酒保', player);
    await w.execute('talk 酒保 1', player); // 停 in who 节点，flags=[asked_who]

    const snap = w.createSnapshot();
    const dialogueBefore = w.entities.getComponent(npc, Dialogue)!;
    expect(dialogueBefore.active).toBe('who');

    // 继续推进到结束，然后回滚
    await w.execute('talk 酒保 1', player);
    expect(w.entities.getComponent(npc, Dialogue)!.active).toBeNull();

    w.rollbackWorld(snap);
    expect(w.entities.getComponent(npc, Dialogue)!.active).toBe('who');
    expect(w.entities.getComponent(npc, Memory)!.flags).toEqual(['asked_who']);
  });

  it('录像重放：对话与记忆操作序列确定性一致', async () => {
    const world = buildWorld();
    const { player } = world;
    const rec = record(world.w);
    await rec.execute('talk 酒保', player);
    await rec.execute('talk 酒保 1', player);

    const result = await verifyReplay(rec.stop(), () => {
      const { w } = buildWorld();
      return w;
    });
    expect(result.ok).toBe(true);
    expect(result.diff).toBeUndefined();
  });
});
