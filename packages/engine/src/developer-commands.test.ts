/**
 * A4 开发者命令测试：/tp /heal（0.3-C：/give 已移除——Inventory 随
 * @mud/prefabs 的 Located 实体物品模型退役）
 * 走标准 execute 流水线；组件缺失时友好反馈不炸
 */
import { describe, it, expect } from 'vitest';
import { World, createDeveloperCommands } from './index';
import { trait } from './core/trait';

const Position = trait('position', () => ({ roomId: 'hall' }));
const Health = trait('health', () => ({ current: 30, max: 100 }));
const Name = trait('name', () => ({ text: '', aliases: [] as string[] }));

function setup() {
  const w = new World();
  w.registerCommands(...createDeveloperCommands());
  const player = w.entities.createWithId('dev-player');
  w.entities.addComponent(player, Position, { roomId: 'hall' });
  w.entities.addComponent(player, Health, { current: 30, max: 100 });
  w.entities.addComponent(player, Name, { text: '勇者', aliases: [] });
  return { w, player };
}

describe('A4 开发者命令', () => {
  it('/tp 修改 position.roomId 并返回反馈', async () => {
    const { w, player } = setup();
    const out = await w.execute('/tp dungeon', player);
    expect(out).toContain('hall → dungeon');
    expect(w.entities.getComponent(player, Position)!.roomId).toBe('dungeon');
  });

  it('/heal 默认自己，支持按名字指定目标', async () => {
    const { w, player } = setup();
    const npc = w.entities.create();
    w.entities.addComponent(npc, Health, { current: 1, max: 50 });
    w.entities.addComponent(npc, Name, { text: '酒保', aliases: [] });

    expect(await w.execute('/heal', player)).toContain('30 → 100');
    expect(w.entities.getComponent(player, Health)!.current).toBe(100);

    expect(await w.execute('/heal 酒保', player)).toContain('1 → 50');
    expect(w.entities.getComponent(npc, Health)!.current).toBe(50);
  });

  it('/give 已移除（Inventory 退役），不再注册', async () => {
    const { w, player } = setup();
    // /give 不再是可执行命令 → 走未识别动词分支
    expect(await w.execute('/give sword', player)).toBe('我不明白你的意思。');
  });

  it('组件缺失时友好反馈，不抛错', async () => {
    const w = new World();
    w.registerCommands(...createDeveloperCommands());
    const bare = w.entities.createWithId('bare');
    expect(await w.execute('/tp anywhere', bare)).toContain('没有 position 组件');
    expect(await w.execute('/heal', bare)).toContain('没有 health 组件');
  });

  it('开发者命令产物可被快照/回滚捕获（走标准流水线）', async () => {
    const { w, player } = setup();
    await w.execute('/tp dungeon', player);
    const snap = w.createSnapshot();

    w.entities.getComponent(player, Position)!.roomId = 'elsewhere';
    w.rollbackWorld(snap);
    expect(w.entities.getComponent(player, Position)!.roomId).toBe('dungeon');
  });
});
