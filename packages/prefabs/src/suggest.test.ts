/**
 * 命令建议器测试（0.13）——TDD 先红后绿
 *
 * 锁死契约：
 * 1. 第一词 = 全部动词（去重、含方向别名）；空输入/第三词不给
 * 2. go <方向>（direction 参数）→ 方向词；entity/optional_entity 参数
 *    → 房间实体名（Position 活体 + Located 地上物，主名+别名去重，排除玩家与别房）
 * 3. 无参数命令的第二词不给；未注册动词不给
 */
import { describe, it, expect } from 'vitest';
import { World, defineCommand, Name } from '@mud/ecs-engine';
import { Position, Located } from './traits.js';
import { createSuggester } from './suggest.js';

const Go = defineCommand({
    describe: '测试用命令',
  verbs: ['go', '走'],
  args: { direction: { type: 'direction' } },
  handle: () => null,
});
const Attack = defineCommand({
    describe: '测试用命令',
  verbs: ['attack', '攻击'],
  args: { target: { type: 'entity' } },
  handle: () => null,
});
const Look = defineCommand({
    describe: '测试用命令',
  verbs: ['look', '看'],
  args: { target: { type: 'optional_entity' } },
  handle: () => null,
});
const Meditate = defineCommand({ describe: '测试用命令', verbs: ['meditate', '打坐'], handle: () => null });
const North = defineCommand({ describe: '测试用命令', verbs: ['north', '北'], handle: () => null });

function suggestWorld() {
  const world = new World();
  const room = world.entities.createWithId('room-1');
  world.addComponent(room, Name, { text: '密林', aliases: [] });
  const player = world.entities.createWithId('hero');
  world.addComponent(player, Position, { roomId: 'room-1' });
  world.addComponent(player, Name, { text: '少年侠客', aliases: [] });
  // 同房 NPC（Position）+ 别房同名 NPC（不该出现）
  const wolf = world.entities.createWithId('wolf-1');
  world.addComponent(wolf, Name, { text: '野狼', aliases: ['狼', 'wolf'] });
  world.addComponent(wolf, Position, { roomId: 'room-1' });
  const wolf2 = world.entities.createWithId('wolf-2');
  world.addComponent(wolf2, Name, { text: '野狼', aliases: [] });
  world.addComponent(wolf2, Position, { roomId: 'room-2' });
  // 地上物品（Located 关系）
  const skin = world.entities.createWithId('skin-1');
  world.addComponent(skin, Name, { text: '狼皮', aliases: ['皮'] });
  world.addRelation(skin, Located, 'room-1');

  const suggest = createSuggester({
    commands: [Go, Attack, Look, Meditate, North],
    query: world,
    playerId: 'hero',
    directions: ['north', '北', 'north'], // 重复项应被去重
  });
  return { world, suggest, player };
}

describe('createSuggester · 第一词', () => {
  it('空输入不给建议', () => {
    const { suggest } = suggestWorld();
    expect(suggest('')).toEqual([]);
    expect(suggest('   ')).toEqual([]);
  });

  it('敲第一个词时给全部动词（去重、含方向别名、动词带 describe 提示）', () => {
    const { suggest } = suggestWorld();
    const verbs = suggest('at');
    expect(verbs.map((v) => v.text)).toContain('attack');
    expect(verbs.map((v) => v.text)).toContain('打坐');
    expect(verbs.map((v) => v.text)).toContain('北');
    // 动词候选带 describe 提示（候选条渲染用）
    expect(verbs.find((v) => v.text === 'attack')?.hint).toBeTruthy();
    // 去重：'north' 在 Go 命令与方向命令里各出现一次，只留一份
    expect(verbs.filter((v) => v.text === 'north')).toHaveLength(1);
  });
});

describe('createSuggester · 第二词', () => {
  it('go <方向> → 方向词（canonical 在前、去重）', () => {
    const { suggest } = suggestWorld();
    expect(suggest('go ')).toEqual([{ text: 'north' }, { text: '北' }]);
    expect(suggest('走 x')).toEqual([{ text: 'north' }, { text: '北' }]);
  });

  it('entity 参数命令 → 房间实体名（活体+地上物，主名+别名，去重）', () => {
    const { suggest } = suggestWorld();
    expect(suggest('attack ')).toEqual([
      { text: '野狼' }, { text: '狼' }, { text: 'wolf' }, { text: '狼皮' }, { text: '皮' },
    ]);
  });

  it('optional_entity 参数命令同样补房间实体', () => {
    const { suggest } = suggestWorld();
    expect(suggest('look ').map((v) => v.text)).toContain('野狼');
    expect(suggest('看 ').map((v) => v.text)).toContain('狼皮');
  });

  it('排除玩家自己与别房实体', () => {
    const { suggest } = suggestWorld();
    const names = suggest('attack ').map((v) => v.text);
    expect(names).not.toContain('少年侠客');
    expect(names.filter((n) => n === '野狼')).toHaveLength(1);
  });

  it('无参数命令（打坐）第二词不给；未注册动词不给；第三词不给', () => {
    const { suggest } = suggestWorld();
    expect(suggest('打坐 ')).toEqual([]);
    expect(suggest('zzz ')).toEqual([]);
    expect(suggest('attack 狼 now')).toEqual([]);
  });
});
