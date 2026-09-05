/**
 * listCommands 元数据与兜底近似匹配测试（0.14，F6/F2 落地）
 */
import { describe, it, expect } from 'vitest';
import { World, defineCommand } from './index';

const Look = defineCommand({
    describe: '测试用命令',
  verbs: ['look', '看'],
  args: { target: { type: 'optional_entity' } },
  handle: () => null,
});
const Go = defineCommand({
    describe: '测试用命令',
  verbs: ['go', '走'],
  args: { direction: { type: 'direction' } },
  handle: () => null,
});
const North = defineCommand({ describe: '测试用命令', verbs: ['north', 'n', '北'], handle: () => null });

describe('world.listCommands（F6）', () => {
  it('返回去重后的元数据：动词/缩写/参数类型形状', () => {
    const w = new World();
    w.registerCommands(Look, Go, North, Look); // 重复注册同一命令 → 去重
    const metas = w.listCommands();
    expect(metas).toHaveLength(3);
    const look = metas.find((m) => m.verbs.includes('look'))!;
    expect(look.verbs).toEqual(['look', '看']);
    expect(look.args.target).toEqual({ type: 'optional_entity' });
    const go = metas.find((m) => m.verbs.includes('go'))!;
    expect(go.args.direction).toEqual({ type: 'direction' });
    const north = metas.find((m) => m.verbs.includes('north'))!;
    expect(north.abbrev).toEqual([]);
    expect(north.args).toEqual({});
  });

  it('不暴露 handle（元数据面，非可执行面）', () => {
    const w = new World();
    w.registerCommands(Look);
    for (const m of w.listCommands()) {
      expect(m).not.toHaveProperty('handle');
    }
  });
});

describe('兜底近似匹配（F2）', () => {
  it('前缀命中 → 「你是想…？」', async () => {
    const w = new World();
    w.registerCommands(Look, North);
    expect(await w.execute('lo', 'p1')).toBe('我不明白你的意思。你是想「look」吗？');
    expect(await w.execute('nort', 'p1')).toBe('我不明白你的意思。你是想「north」吗？');
  });

  it('编辑距离 ≤2 命中', async () => {
    const w = new World();
    w.registerCommands(Look, North);
    expect(await w.execute('lok', 'p1')).toBe('我不明白你的意思。你是想「look」吗？');
  });

  it('无相近动词 → 保持原文案', async () => {
    const w = new World();
    w.registerCommands(Look, North);
    expect(await w.execute('xyzzy', 'p1')).toBe('我不明白你的意思。');
  });
});
