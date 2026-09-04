/**
 * 同名消歧与实体列示测试（0.13，P3）——xkx「店小二2」惯例
 *
 * 锁死契约：
 * 1. 同名实体默认取创建序第一个（向后兼容）
 * 2. 「名字N」序号取同名候选中第 N 个（1 起）；越界取最末
 * 3. 名字本身带数字的实体：原文直接命中时**不拆**序号
 * 4. 别名同样可带序号（狼2）
 */
import { describe, it, expect } from 'vitest';
import { World, Name } from '@mud/ecs-engine';
import { Position } from './traits.js';
import { resolveOccupantIn } from './queries.js';

function wolfWorld() {
  const world = new World();
  const room = world.entities.createWithId('den');
  world.addComponent(room, Name, { text: '狼穴', aliases: [] });
  const player = world.entities.createWithId('hero');
  world.addComponent(player, Position, { roomId: 'den' });
  world.addComponent(player, Name, { text: '少年侠客', aliases: [] });
  // 两只同名野狼：创建序 wolf-1 在前
  for (const id of ['wolf-1', 'wolf-2']) {
    const wolf = world.entities.createWithId(id);
    world.addComponent(wolf, Name, { text: '野狼', aliases: ['狼', 'wolf'] });
    world.addComponent(wolf, Position, { roomId: 'den' });
  }
  // 名字本身带数字的实体（不拆序号的守护用例）
  const gun = world.entities.createWithId('gun-98k');
  world.addComponent(gun, Name, { text: '98k', aliases: [] });
  world.addComponent(gun, Position, { roomId: 'den' });
  return world;
}

describe('同名消歧', () => {
  it('默认取创建序第一个（向后兼容）', () => {
    const w = wolfWorld();
    expect(resolveOccupantIn(w, 'den', '野狼')).toBe('wolf-1');
    expect(resolveOccupantIn(w, 'den', '狼')).toBe('wolf-1');
  });

  it('「名字N」取同名候选中创建序第 N 个', () => {
    const w = wolfWorld();
    expect(resolveOccupantIn(w, 'den', '野狼2')).toBe('wolf-2');
    expect(resolveOccupantIn(w, 'den', '狼2')).toBe('wolf-2');
    expect(resolveOccupantIn(w, 'den', '野狼1')).toBe('wolf-1');
  });

  it('序号越界取最末一个', () => {
    const w = wolfWorld();
    expect(resolveOccupantIn(w, 'den', '野狼9')).toBe('wolf-2');
  });

  it('名字本身带数字：原文直接命中时不拆序号', () => {
    const w = wolfWorld();
    expect(resolveOccupantIn(w, 'den', '98k')).toBe('gun-98k');
  });

  it('基础名完全无命中 → undefined（序号拆分不越权）', () => {
    const w = wolfWorld();
    expect(resolveOccupantIn(w, 'den', '蜘蛛')).toBeUndefined();
  });
});
