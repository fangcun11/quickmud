/**
 * @mud/prefabs 集成测试：移动 / 查看 / 背包 / 状态
 */
import { describe, it, expect } from 'vitest';
import { World, Name, createDeveloperCommands } from '@mud/ecs-engine';
import type { OutputMessage } from '@mud/ecs-engine';
import { MovementSystem, DescriptionSystem } from './systems.js';
import {
  GoCommand,
  createDirectionCommand,
  LookCommand,
  InventoryCommand,
  ScoreCommand,
} from './commands.js';
import { Health, Position, Inventory, Description, Exits, Portable, Weapon } from './traits.js';

/** 按 kind 提取消息纯文本 */
function textOf(messages: OutputMessage[], kind: string): string[] {
  return messages
    .filter((m) => m.kind === kind)
    .map((m) => m.segments.map((s) => s.text).join(''));
}

/** 组装一个可玩的最小世界（房间 + 玩家） */
function buildWorld() {
  const w = new World({ tickInterval: 500 });
  w.register(MovementSystem, DescriptionSystem);
  w.registerCommands(
    ...createDeveloperCommands(),
    GoCommand,
    createDirectionCommand('north', ['north', 'n', '北']),
    createDirectionCommand('south', ['south', 's', '南']),
    LookCommand,
    InventoryCommand,
    ScoreCommand,
  );

  const player = w.entities.createWithId('player-1');
  w.entities.addComponent(player, Health, { current: 80, max: 100 });
  w.entities.addComponent(player, Position, { roomId: 'town_square' });
  w.entities.addComponent(player, Inventory, { items: ['金币'] });
  w.entities.addComponent(player, Name, { text: '冒险者' });

  // 房间：town_square ⇄ tavern
  for (const room of [
    {
      id: 'town_square',
      name: { text: '城镇广场' },
      desc: { text: '你站在城镇广场上。北面是酒馆。' },
      exits: { north: 'tavern' },
    },
    {
      id: 'tavern',
      name: { text: '酒馆' },
      desc: { text: '你走进热闹的酒馆。' },
      exits: { south: 'town_square' },
    },
  ]) {
    const rid = w.entities.createWithId(room.id);
    w.entities.addComponent(rid, Name, room.name);
    w.entities.addComponent(rid, Description, room.desc);
    w.entities.addComponent(rid, Exits, room.exits);
  }

  return { w, player };
}

describe('prefabs 移动', () => {
  it('go north 沿出口移动并输出目标房间描述', async () => {
    const { w, player } = buildWorld();
    await w.execute('go north', player);

    const pos = w.entities.getComponent(player, Position)!;
    expect(pos.roomId).toBe('tavern');
    const lines = textOf(w.output.getAll(), 'narrative');
    expect(lines[0]).toContain('你来到了酒馆');
    expect(lines[1]).toBe('你走进热闹的酒馆。');
  });

  it('north（单字动词命令）同样可移动', async () => {
    const { w, player } = buildWorld();
    await w.execute('north', player);
    expect(w.entities.getComponent(player, Position)!.roomId).toBe('tavern');
  });

  it('出口方向不存在时拒绝移动且不落位', async () => {
    const { w, player } = buildWorld();
    await w.execute('go east', player);
    expect(w.entities.getComponent(player, Position)!.roomId).toBe('town_square');
    expect(textOf(w.output.getAll(), 'narrative')[0]).toBe('你不能往east走。');
  });

  it('南字归一化：从酒馆往南回广场', async () => {
    const { w, player } = buildWorld();
    await w.execute('north', player);
    await w.execute('south', player);
    expect(w.entities.getComponent(player, Position)!.roomId).toBe('town_square');
  });
});

describe('prefabs 查看/背包/状态', () => {
  it('look 输出所在房间标题与描述', async () => {
    const { w, player } = buildWorld();
    await w.execute('look', player);
    const lines = textOf(w.output.getAll(), 'narrative');
    expect(lines[0]).toBe('【城镇广场】');
    expect(lines[1]).toBe('你站在城镇广场上。北面是酒馆。');
  });

  it('inventory 显示持有物品，空背包给提示', async () => {
    const { w, player } = buildWorld();
    expect(await w.execute('inventory', player)).toBe('你的背包里有：金币');

    w.entities.getComponent(player, Inventory)!.items = [];
    expect(await w.execute('i', player)).toBe('你的背包是空的。');
  });

  it('score 输出生命与位置', async () => {
    const { w, player } = buildWorld();
    const out = await w.execute('score', player);
    expect(out).toContain('生命值：80/100');
    expect(out).toContain('位置：town_square');
  });

  it('开发者命令与 prefabs trait 约定协同（/heal /tp 直接生效）', async () => {
    const { w, player } = buildWorld();
    expect(w.entities.getComponent(player, Health)!.current).toBe(80);
    await w.execute('/heal', player);
    expect(w.entities.getComponent(player, Health)!.current).toBe(100);

    await w.execute('/tp tavern', player);
    expect(w.entities.getComponent(player, Position)!.roomId).toBe('tavern');
  });
});

describe('prefabs traits 形状', () => {
  it('组件默认值符合命名约定', () => {
    // 直接构造验证 trait 默认工厂
    const inv = Inventory.create();
    expect(inv).toEqual({ items: [] });
    const hp = Health.create();
    expect(hp).toEqual({ current: 100, max: 100 });
    const weapon = Weapon.create();
    expect(weapon).toEqual({ damage: 0 });
    // Portable 是无数据标记组件
    expect(() => Portable.create()).not.toThrow();
  });
});
