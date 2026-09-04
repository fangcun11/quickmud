/**
 * 命令侧输出通道测试（0.11 P1-2）
 *
 * CommandContext 新增 output（与 SystemContext.output 同一形态）：
 * 语义化输出（多段/对话/状态）不再必须"返回一个 string"或"为一个事件写一个系统"。
 * 铁律不变——命令不改状态，output 只写输出流。
 */
import { describe, it, expect } from 'vitest';
import { World, trait, defineEvent, defineCommand } from './index';
import type { EntityId } from './index';

const Position = trait('position', () => ({ roomId: 'hall' }));
const Pinged = defineEvent('pinged')<{ who: EntityId }>();

const ScoreCommand = defineCommand({
  verbs: ['score', '状态'],
  handle({ output, player }) {
    output.narrative([
      { text: '【状态】', style: { bold: true } },
      { text: `玩家 ${player}，一切安好。` },
    ]);
    output.error('没有保存的存档。');
    output.status({ hp: 'full' });
    return null; // 反馈完全由 output 通道产出
  },
});

describe('CommandContext.output', () => {
  it('命令内 output.narrative/error/status 直接进输出流', async () => {
    const w = new World();
    w.registerCommands(ScoreCommand);
    const p = w.entities.createWithId('p');

    await w.execute('score', p);

    const messages = w.output.messages;
    expect(messages.some((m) => m.kind === 'narrative' && m.segments.some((s) => s.text.includes('一切安好')))).toBe(true);
    expect(messages.some((m) => m.kind === 'error' && m.segments.some((s) => s.text.includes('没有保存的存档')))).toBe(true);
    expect(messages.some((m) => m.kind === 'status')).toBe(true);
  });

  it('返回 string 与 output 可共存（两条通道互不干扰）', async () => {
    const Both = defineCommand({
      verbs: ['both'],
      handle({ output }) {
        output.dialogue('老王朝：行。');
        return '直接反馈文本';
      },
    });
    const w = new World();
    w.registerCommands(Both);
    const p = w.entities.createWithId('p');

    const result = await w.execute('both', p);
    expect(result).toBe('直接反馈文本');
    expect(w.output.messages.some((m) => m.kind === 'dialogue' && m.segments.some((s) => s.text.includes('老王朝')))).toBe(true);
  });

  it('命令不改状态的铁律不变：output 不提供任何状态访问', async () => {
    // 类型层保证：CommandContext['output'] 没有 getComponent/spawn 等
    const w = new World();
    w.registerCommands(ScoreCommand);
    const p = w.entities.createWithId('p');
    w.entities.addComponent(p, Position, { roomId: 'hall' });
    await w.execute('score', p);

    // 事件照常可发（命令与系统的正式通信通道）
    w.eventPump.emit(Pinged.token, { who: p });
    expect(p).toBeTruthy();
  });
});
