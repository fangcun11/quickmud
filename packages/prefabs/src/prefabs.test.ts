/**
 * @mud/prefabs 集成测试：移动 / 查看 / 物品（Located 容器模型）/ 状态
 */
import { describe, it, expect } from 'vitest';
import { World, Name, createDeveloperCommands, record, verifyReplay } from '@mud/ecs-engine';
import type { OutputMessage } from '@mud/ecs-engine';
import {
  MovementSystem,
  DescriptionSystem,
  ItemSystem,
} from './systems.js';
import {
  GoCommand,
  createDirectionCommand,
  LookCommand,
  InventoryCommand,
  ScoreCommand,
  TakeCommand,
  DropCommand,
} from './commands.js';
import {
  Health,
  Position,
  Description,
  Exits,
  Portable,
  Weapon,
  Located,
} from './traits.js';

/** 按 kind 提取消息纯文本 */
function textOf(messages: OutputMessage[], kind: string): string[] {
  return messages
    .filter((m) => m.kind === kind)
    .map((m) => m.segments.map((s) => s.text).join(''));
}

/** 组装一个可玩的最小世界（房间 + 玩家 + 物品实体） */
function buildWorld() {
  const w = new World({ tickInterval: 500 });
  w.register(MovementSystem, DescriptionSystem, ItemSystem);
  w.registerCommands(
    ...createDeveloperCommands(),
    GoCommand,
    createDirectionCommand('north', ['north', 'n', '北']),
    createDirectionCommand('south', ['south', 's', '南']),
    LookCommand,
    InventoryCommand,
    ScoreCommand,
    TakeCommand,
    DropCommand,
  );

  const player = w.entities.createWithId('player-1');
  w.entities.addComponent(player, Health, { current: 80, max: 100 });
  w.entities.addComponent(player, Position, { roomId: 'town_square' });
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

  // 物品实体：单源位置 Located.at == 所在容器（房间/玩家）
  const sword = w.entities.createWithId('sword');
  w.entities.addComponent(sword, Name, { text: '生锈的剑', aliases: ['剑', 'sword'] });
  w.entities.addComponent(sword, Description, { text: '一把生锈的旧剑。' });
  w.entities.addComponent(sword, Portable);
  w.entities.addComponent(sword, Weapon, { damage: 6 });
  w.entities.addComponent(sword, Located, { at: 'town_square' });

  const gold = w.entities.createWithId('gold');
  w.entities.addComponent(gold, Name, { text: '金币', aliases: ['coin'] });
  w.entities.addComponent(gold, Portable);
  w.entities.addComponent(gold, Located, { at: 'town_square' });

  // 固定物（无 Portable）：演示"拿不动"
  const statue = w.entities.createWithId('statue');
  w.entities.addComponent(statue, Name, { text: '石像' });
  w.entities.addComponent(statue, Located, { at: 'town_square' });

  // 酒馆里的东西：不在广场，演示 take 校验"必须在当前房间"
  const mug = w.entities.createWithId('mug');
  w.entities.addComponent(mug, Name, { text: '麦酒', aliases: ['ale'] });
  w.entities.addComponent(mug, Portable);
  w.entities.addComponent(mug, Located, { at: 'tavern' });

  return { w, player, sword, gold, statue, mug };
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

  it('出口方向不存在时拒绝移动且不落位', async () => {
    const { w, player } = buildWorld();
    await w.execute('go east', player);
    expect(w.entities.getComponent(player, Position)!.roomId).toBe('town_square');
    expect(textOf(w.output.getAll(), 'narrative')[0]).toBe('你不能往east走。');
  });
});

describe('prefabs 查看与物品', () => {
  it('look 输出房间描述并列出地上可拾取物', async () => {
    const { w, player } = buildWorld();
    await w.execute('look', player);
    const lines = textOf(w.output.getAll(), 'narrative');
    expect(lines[0]).toBe('【城镇广场】');
    expect(lines[1]).toBe('你站在城镇广场上。北面是酒馆。');
    // 石像不可拾取 → 不在列表
    expect(lines[2]).toBe('你可以看到：生锈的剑、金币。');
  });

  it('take 把当前房间的可携物放入背包，inventory 可见', async () => {
    const { w, player, sword } = buildWorld();
    await w.execute('take 剑', player); // 别名解析

    expect(w.entities.getComponent(sword, Located)!.at).toBe(player);
    expect(textOf(w.output.getAll(), 'narrative')).toContain('你拿起了「生锈的剑」。');
    expect(await w.execute('inventory', player)).toBe('你的背包里有：生锈的剑');
  });

  it('take 不在当前房间的物品 → 错误反馈且不转移', async () => {
    const { w, player, mug } = buildWorld();
    // 麦酒在 tavern，玩家在 town_square → 命令在房间作用域内解析不到
    expect(await w.execute('take 麦酒', player)).toBe('这里没有「麦酒」。');
    expect(w.entities.getComponent(mug, Located)!.at).toBe('tavern');
  });

  it('take 不可携带物（无 Portable）→ 拿不动', async () => {
    const { w, player, statue } = buildWorld();
    await w.execute('take 石像', player);
    expect(textOf(w.output.getAll(), 'error')).toContain('你拿不动「石像」。');
    expect(w.entities.getComponent(statue, Located)!.at).toBe('town_square');
  });

  it('drop 把背包物品放到当前房间；未持有则报错', async () => {
    const { w, player, sword } = buildWorld();

    expect(await w.execute('drop 剑', player)).toBe('你没有「剑」。'); // 还没拿

    await w.execute('take 剑', player);
    await w.execute('north', player); // 去酒馆再丢
    await w.execute('drop 剑', player);
    expect(w.entities.getComponent(sword, Located)!.at).toBe('tavern');
    expect(await w.execute('inventory', player)).toBe('你的背包是空的。');
  });

  it('开发者命令 /tp /heal 仍按约定生效，/give 不再注册', async () => {
    const { w, player } = buildWorld();
    await w.execute('/heal', player);
    expect(w.entities.getComponent(player, Health)!.current).toBe(100);
    await w.execute('/tp tavern', player);
    expect(w.entities.getComponent(player, Position)!.roomId).toBe('tavern');
    expect(await w.execute('/give sword', player)).toBe('我不明白你的意思。');
  });
});

describe('prefabs 物品确定性', () => {
  it('快照 round-trip：take 之后回滚，物品回到地面', async () => {
    const { w, player, sword } = buildWorld();
    await w.execute('take 剑', player);
    expect(w.entities.getComponent(sword, Located)!.at).toBe(player);

    const snap = w.createSnapshot();
    // 再转移到酒馆，然后回滚到 take 后的状态
    await w.execute('north', player);
    await w.execute('drop 剑', player);
    w.rollbackWorld(snap);
    expect(w.entities.getComponent(sword, Located)!.at).toBe(player);
    expect(w.entities.getComponent(player, Position)!.roomId).toBe('town_square');
  });

  it('录像重放：take/drop 操作序列确定性一致', async () => {
    const world = buildWorld();
    const rec = record(world.w);
    await rec.execute('take 剑', world.player);
    await rec.execute('north', world.player);
    await rec.execute('drop 剑', world.player);

    const result = await verifyReplay(rec.stop(), () => buildWorld().w);
    expect(result.ok).toBe(true);
    expect(result.diff).toBeUndefined();
  });
});

describe('prefabs traits 形状', () => {
  it('Located 默认 at=null；Health/Position 默认值符合约定', () => {
    expect(Located.create()).toEqual({ at: null });
    expect(Health.create()).toEqual({ current: 100, max: 100 });
    expect(Position.create()).toEqual({ roomId: 'town_square' });
  });
});

describe('R3 审查修复（作用域解析与 look target）', () => {
  it('take 在同名物品存在时拿到当前房间那份，不被其他房间先建者遮蔽', async () => {
    const w = new World();
    w.register(ItemSystem);
    w.registerCommands(TakeCommand, DropCommand, InventoryCommand);

    const player = w.entities.createWithId('player');
    w.entities.addComponent(player, Position, { roomId: 'town' });

    for (const room of ['town', 'tavern']) {
      const rid = w.entities.createWithId(room);
      w.entities.addComponent(rid, Name, { text: room });
    }

    // 关键布置：tavern 的先创建、town 的后创建（全局 findEntity 会错选前者）
    const coinT = w.entities.createWithId('coin-t');
    w.entities.addComponent(coinT, Name, { text: '金币', aliases: ['coin'] });
    w.entities.addComponent(coinT, Portable);
    w.entities.addComponent(coinT, Located, { at: 'tavern' });

    const coinS = w.entities.createWithId('coin-s');
    w.entities.addComponent(coinS, Name, { text: '金币', aliases: ['coin'] });
    w.entities.addComponent(coinS, Portable);
    w.entities.addComponent(coinS, Located, { at: 'town' });

    await w.execute('take 金币', player);
    // 修复前：解析到先建的 coin-t（不在当前房间）→ 永久拿不到眼前的 coin-s
    expect(w.entities.getComponent(coinS, Located)!.at).toBe(player);
    expect(w.entities.getComponent(coinT, Located)!.at).toBe('tavern');
    expect(await w.execute('inventory', player)).toBe('你的背包里有：金币');
  });

  it('drop 只从自己背包解析，同名物在地上不干扰', async () => {
    const w = new World();
    w.register(ItemSystem);
    w.registerCommands(TakeCommand, DropCommand, InventoryCommand);
    const player = w.entities.createWithId('player');
    w.entities.addComponent(player, Position, { roomId: 'town' });
    const roomId = w.entities.createWithId('town');
    w.entities.addComponent(roomId, Name, { text: 'town' });

    // 背包里没有金币；地上有一枚 → drop 金币应报"你没有"，而非把地上的拿走
    const ground = w.entities.createWithId('ground-coin');
    w.entities.addComponent(ground, Name, { text: '金币' });
    w.entities.addComponent(ground, Portable);
    w.entities.addComponent(ground, Located, { at: 'town' });

    expect(await w.execute('drop 金币', player)).toBe('你没有「金币」。');
    expect(w.entities.getComponent(ground, Located)!.at).toBe('town');
  });

  it('look <目标> 输出容器内物品描述', async () => {
    const { w, player } = buildWorld();
    await w.execute('look 剑', player);
    const lines = textOf(w.output.getAll(), 'narrative');
    expect(lines[0]).toBe('一把生锈的旧剑。');

    // 无描述的物品给默认反馈
    w.output.clear();
    await w.execute('look 石像', player);
    expect(textOf(w.output.getAll(), 'narrative')[0]).toBe('「石像」看起来没什么特别的。');
  });

  it('look 房间里没有的目标给出错误反馈', async () => {
    const { w, player } = buildWorld();
    await w.execute('look 幽灵', player);
    expect(textOf(w.output.getAll(), 'error')).toContain('这里没有「幽灵」。');
  });

  it('玩家无 Position 时 take/drop 有明确反馈（不再静默）', async () => {
    const { w } = buildWorld();
    const bare = w.entities.createWithId('bare');
    expect(await w.execute('take 剑', bare)).toBe('你不在任何地方。');
    expect(await w.execute('drop 剑', bare)).toBe('你不在任何地方。');
  });
});
