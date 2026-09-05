/**
 * 中文粘连输入解析（M5 配套引擎件）：
 * 买馒头 = 买 + 馒头 —— 无空格输入按 CJK 动词前缀拆词；
 * 英文永不劈裂（gofast ≠ go + fast），已注册完整动词优先于拆词。
 */
import { describe, it, expect } from 'vitest';
import { World, defineCommand } from './index';

describe('中文粘连输入（买馒头 = 买 + 馒头）', () => {
  it('CJK 动词前缀自动拆词，剩余整体作参数；带空格输入原样不受影响', async () => {
    const w = new World();
    let seen: string | null = null;
    const Buy = defineCommand({
      describe: '买东西',
      verbs: ['buy', '买'],
      args: { item: { type: 'word' } },
      handle({ args }) {
        seen = args.item as string;
        return `buy ${seen}`;
      },
    });
    w.registerCommands(Buy);

    expect(await w.execute('买馒头', 'p1')).toBe('buy 馒头');
    expect(seen).toBe('馒头');

    expect(await w.execute('买 金创药', 'p1')).toBe('buy 金创药');
    expect(seen).toBe('金创药');
  });

  it('最长前缀优先；非 CJK 动词不参与拆词', async () => {
    const w = new World();
    const Walk3 = defineCommand({ describe: '三字动词', verbs: ['往北走'], handle: () => 'walk3' });
    const Walk2 = defineCommand({ describe: '两字动词', verbs: ['往北'], handle: () => 'walk2' });
    const Go = defineCommand({
      describe: '方向',
      verbs: ['go'],
      args: { dir: { type: 'word' } },
      handle: ({ args }) => `go ${args.dir}`,
    });
    w.registerCommands(Walk3, Walk2, Go);

    expect(await w.execute('往北走啊', 'p1')).toBe('walk3'); // 拆成 往北走 + 啊，不落到 往北
    expect(await w.execute('往北啊', 'p1')).toBe('walk2');

    // go 是动词但非 CJK：gofast 不劈裂成 go + fast
    expect(await w.execute('gofast', 'p1')).toContain('我不明白你的意思');
  });
});
