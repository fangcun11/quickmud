/**
 * A4 开发者命令测试：/tp /heal（0.3-C：/give 已移除——Inventory 随
 * @mud/prefabs 的 Located 实体物品模型退役）
 * 走标准 execute 流水线；组件缺失时友好反馈不炸
 */
import { describe, it, expect } from 'vitest';
import { World, registerDeveloperKit } from './index';
import { trait } from './core/trait';

const Position = trait('position', () => ({ roomId: 'hall' }));
const Health = trait('health', () => ({ current: 30, max: 100 }));
const Name = trait('name', () => ({ text: '', aliases: [] as string[] }));

function setup() {
  const w = new World();
  registerDeveloperKit(w);
  const player = w.entities.createWithId('dev-player');
  w.addComponent(player, Position, { roomId: 'hall' });
  w.addComponent(player, Health, { current: 30, max: 100 });
  w.addComponent(player, Name, { text: '勇者', aliases: [] });
  return { w, player };
}

describe('A4 开发者命令', () => {
  it('/tp 修改 position.roomId 并返回反馈', async () => {
    const { w, player } = setup();
    const out = await w.execute('/tp dungeon', player);
    expect(out).toContain('hall → dungeon');
    expect(w.getComponent(player, Position)!.roomId).toBe('dungeon');
  });

  it('/heal 默认自己，支持按名字指定目标', async () => {
    const { w, player } = setup();
    const npc = w.entities.create();
    w.addComponent(npc, Health, { current: 1, max: 50 });
    w.addComponent(npc, Name, { text: '酒保', aliases: [] });

    expect(await w.execute('/heal', player)).toContain('30 → 100');
    expect(w.getComponent(player, Health)!.current).toBe(100);

    expect(await w.execute('/heal 酒保', player)).toContain('1 → 50');
    expect(w.getComponent(npc, Health)!.current).toBe(50);
  });

  it('/give 已移除（Inventory 退役），不再注册', async () => {
    const { w, player } = setup();
    // /give 不再是可执行命令 → 走未识别动词分支
    expect(await w.execute('/give sword', player)).toBe('我不明白你的意思。');
  });

  it('组件缺失时友好反馈，不抛错', async () => {
    const w = new World();
    registerDeveloperKit(w);
    const bare = w.entities.createWithId('bare');
    expect(await w.execute('/tp anywhere', bare)).toContain('没有 position 组件');
    expect(await w.execute('/heal', bare)).toContain('没有 health 组件');
  });

  it('开发者命令产物可被快照/回滚捕获（走标准流水线）', async () => {
    const { w, player } = setup();
    await w.execute('/tp dungeon', player);
    const snap = w.createSnapshot();

    w.getComponent(player, Position)!.roomId = 'elsewhere';
    w.rollbackWorld(snap);
    expect(w.getComponent(player, Position)!.roomId).toBe('dungeon');
  });
});

describe('P1-6 开发者命令走事件（铁律示范位）', () => {
  it('/tp /heal 只 emit 事件，写状态的是内置效果系统', async () => {
    const { w, player } = setup();
    await w.execute('/tp dungeon', player);
    expect(w.eventPump.queueLength).toBe(0); // 事件链已排水

    // 事件路径可观测：命令只翻译意图，效果系统消费事件
    // （DevTeleported/DevHealed 的 token 见 developer.ts；此处经组件效果间接验证——
    //   状态确实变了，而命令本身没有改组件的通道）
    expect(w.getComponent(player, Position)!.roomId).toBe('dungeon');

    await w.execute('/heal', player);
    expect(w.getComponent(player, Health)!.current).toBe(100);
  });

  it('不注册效果系统时事件悬空，但命令不炸、状态不变（fail-safe）', async () => {
    const { createDeveloperCommands } = await import('./index');
    const w = new World();
    w.registerCommands(...createDeveloperCommands()); // 只注册命令
    const player = w.entities.createWithId('dev-player');
    w.addComponent(player, Position, { roomId: 'hall' });
    w.addComponent(player, Health, { current: 30, max: 100 });

    expect(await w.execute('/tp dungeon', player)).toContain('hall → dungeon');
    expect(w.getComponent(player, Position)!.roomId).toBe('hall'); // 未落位
  });
});
