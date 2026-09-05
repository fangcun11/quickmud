/**
 * @mud/prefabs 集成测试：移动 / 查看 / 物品（Located 容器模型）/ 状态
 */
import { describe, it, expect } from 'vitest';
import { World, Name, registerDeveloperKit, record, verifyReplay } from '@mud/ecs-engine';
import type { OutputMessage } from '@mud/ecs-engine';
import {
  MovementSystem,
  DescriptionSystem,
  ItemSystem,
  CombatSystem,
  DeathSystem,
  NpcWanderSystem,
  VerboseSystem,
  VisitationSystem,
  MiniMapSystem,
} from './systems.js';
import { layoutNeighborMiniMap, markVisited } from './room.js';
import {
  GoCommand,
  createDirectionCommand,
  LookCommand,
  InventoryCommand,
  ScoreCommand,
  TakeCommand,
  DropCommand,
  AttackCommand,
  VerboseCommand,
  MiniMapCommand,
} from './commands.js';
import {
  Health,
  Position,
  Description,
  Short,
  Pose,
  Exits,
  Portable,
  Weapon,
  Located,
  Wander,
  Visited,
  Verbose,
  MiniMap,
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
  registerDeveloperKit(w); // 开发者命令 + 效果系统（0.12 起写状态走事件链）
  w.registerCommands(
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
  w.addComponent(player, Health, { current: 80, max: 100 });
  w.addComponent(player, Position, { roomId: 'town_square' });
  w.addComponent(player, Name, { text: '冒险者' });

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
    w.addComponent(rid, Name, room.name);
    w.addComponent(rid, Description, room.desc);
    w.addComponent(rid, Exits, room.exits);
  }

  // 物品实体：单源位置 Located 关系 → 所在容器（房间/玩家）
  const sword = w.entities.createWithId('sword');
  w.addComponent(sword, Name, { text: '生锈的剑', aliases: ['剑', 'sword'] });
  w.addComponent(sword, Description, { text: '一把生锈的旧剑。' });
  w.addComponent(sword, Portable);
  w.addComponent(sword, Weapon, { damage: 6 });
  w.addComponent(sword, Located, { targets: ['town_square'] });

  const gold = w.entities.createWithId('gold');
  w.addComponent(gold, Name, { text: '金币', aliases: ['coin'] });
  w.addComponent(gold, Portable);
  w.addComponent(gold, Located, { targets: ['town_square'] });

  // 固定物（无 Portable）：演示"拿不动"
  const statue = w.entities.createWithId('statue');
  w.addComponent(statue, Name, { text: '石像' });
  w.addComponent(statue, Located, { targets: ['town_square'] });

  // 酒馆里的东西：不在广场，演示 take 校验"必须在当前房间"
  const mug = w.entities.createWithId('mug');
  w.addComponent(mug, Name, { text: '麦酒', aliases: ['ale'] });
  w.addComponent(mug, Portable);
  w.addComponent(mug, Located, { targets: ['tavern'] });

  return { w, player, sword, gold, statue, mug };
}

describe('prefabs 移动', () => {
  it('go north 沿出口移动并输出目标房间描述', async () => {
    const { w, player } = buildWorld();
    await w.execute('go north', player);

    const pos = w.getComponent(player, Position)!;
    expect(pos.roomId).toBe('tavern');
    // 首次进入 = xkx 式房间块：【名】(title 通道) + 描述 + 出口
    expect(textOf(w.output.getAll(), 'title')).toEqual(['【酒馆】']);
    const lines = textOf(w.output.getAll(), 'narrative');
    expect(lines[0]).toBe('　　你走进热闹的酒馆。'); // xkx 惯例：描述全角两格缩进
    expect(lines[1]).toBe('出口：南。');
  });

  it('出口方向不存在时拒绝移动且不落位', async () => {
    const { w, player } = buildWorld();
    await w.execute('go east', player);
    expect(w.getComponent(player, Position)!.roomId).toBe('town_square');
    // 文案说人话：方向 id（east）不该原样拼进中文句子；
    // v0.11 起撞墙还附上当前可用出口，玩家不用回 look 查
    expect(textOf(w.output.getAll(), 'narrative')[0]).toBe(
      '你不能往东走。这里的出口：北。',
    );
  });
});

describe('prefabs 查看与物品', () => {
  it('look 输出房间描述、出口与地上可拾取物', async () => {
    const { w, player } = buildWorld();
    await w.execute('look', player);
    expect(textOf(w.output.getAll(), 'title')).toEqual(['【城镇广场】']);
    const lines = textOf(w.output.getAll(), 'narrative');
    expect(lines[0]).toBe('　　你站在城镇广场上。北面是酒馆。');
    expect(lines[1]).toBe('出口：北。'); // 出口行恒显（v0.11：清单来自 Exits 数据）
    // 石像不可拾取但也**可见**（xkx 惯例）：全列 + 拿不动标注；别名跟在主名后
    expect(lines[2]).toBe('你可以看到：生锈的剑(剑、sword)、金币(coin)、石像（拿不动）。');
  });

  it('take 把当前房间的可携物放入背包，inventory 可见', async () => {
    const { w, player, sword } = buildWorld();
    await w.execute('take 剑', player); // 别名解析

    expect(w.getRelations(sword, Located)[0]).toBe(player);
    expect(textOf(w.output.getAll(), 'narrative')).toContain('你拿起了「生锈的剑」。');
    expect(await w.execute('inventory', player)).toBe('你的背包里有：生锈的剑');
  });

  it('take 不在当前房间的物品 → 错误反馈且不转移', async () => {
    const { w, player, mug } = buildWorld();
    // 麦酒在 tavern，玩家在 town_square → 命令在房间作用域内解析不到
    // F3 定约：意图不成立走 error 通道，返回值只留确认型反馈
    expect(await w.execute('take 麦酒', player)).toBeNull();
    expect(textOf(w.output.getAll(), 'error')).toContain('这里没有「麦酒」。');
    expect(w.getRelations(mug, Located)[0]).toBe('tavern');
  });

  it('take 不可携带物（无 Portable）→ 拿不动', async () => {
    const { w, player, statue } = buildWorld();
    await w.execute('take 石像', player);
    expect(textOf(w.output.getAll(), 'error')).toContain('你拿不动「石像」。');
    expect(w.getRelations(statue, Located)[0]).toBe('town_square');
  });

  it('drop 把背包物品放到当前房间；未持有则报错', async () => {
    const { w, player, sword } = buildWorld();

    expect(await w.execute('drop 剑', player)).toBeNull(); // 还没拿
    expect(textOf(w.output.getAll(), 'error')).toContain('你没有「剑」。');
    w.output.clear();

    await w.execute('take 剑', player);
    await w.execute('north', player); // 去酒馆再丢
    await w.execute('drop 剑', player);
    expect(w.getRelations(sword, Located)[0]).toBe('tavern');
    expect(await w.execute('inventory', player)).toBe('你的背包是空的。');
  });

  it('开发者命令 /tp /heal 仍按约定生效，/give 不再注册', async () => {
    const { w, player } = buildWorld();
    await w.execute('/heal', player);
    expect(w.getComponent(player, Health)!.current).toBe(100);
    await w.execute('/tp tavern', player);
    expect(w.getComponent(player, Position)!.roomId).toBe('tavern');
    expect(await w.execute('/give sword', player)).toBe('我不明白你的意思。');
  });
});

describe('prefabs 物品确定性', () => {
  it('快照 round-trip：take 之后回滚，物品回到地面', async () => {
    const { w, player, sword } = buildWorld();
    await w.execute('take 剑', player);
    expect(w.getRelations(sword, Located)[0]).toBe(player);

    const snap = w.createSnapshot();
    // 再转移到酒馆，然后回滚到 take 后的状态
    await w.execute('north', player);
    await w.execute('drop 剑', player);
    w.rollbackWorld(snap);
    expect(w.getRelations(sword, Located)[0]).toBe(player);
    expect(w.getComponent(player, Position)!.roomId).toBe('town_square');
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
  it('Located 默认零目标；Health/Position 默认值符合约定', () => {
    expect(Located.create()).toEqual({ targets: [] });
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
    w.addComponent(player, Position, { roomId: 'town' });

    for (const room of ['town', 'tavern']) {
      const rid = w.entities.createWithId(room);
      w.addComponent(rid, Name, { text: room });
    }

    // 关键布置：tavern 的先创建、town 的后创建（全局 findEntity 会错选前者）
    const coinT = w.entities.createWithId('coin-t');
    w.addComponent(coinT, Name, { text: '金币', aliases: ['coin'] });
    w.addComponent(coinT, Portable);
    w.addComponent(coinT, Located, { targets: ['tavern'] });

    const coinS = w.entities.createWithId('coin-s');
    w.addComponent(coinS, Name, { text: '金币', aliases: ['coin'] });
    w.addComponent(coinS, Portable);
    w.addComponent(coinS, Located, { targets: ['town'] });

    await w.execute('take 金币', player);
    // 修复前：解析到先建的 coin-t（不在当前房间）→ 永久拿不到眼前的 coin-s
    expect(w.getRelations(coinS, Located)[0]).toBe(player);
    expect(w.getRelations(coinT, Located)[0]).toBe('tavern');
    expect(await w.execute('inventory', player)).toBe('你的背包里有：金币');
  });

  it('drop 只从自己背包解析，同名物在地上不干扰', async () => {
    const w = new World();
    w.register(ItemSystem);
    w.registerCommands(TakeCommand, DropCommand, InventoryCommand);
    const player = w.entities.createWithId('player');
    w.addComponent(player, Position, { roomId: 'town' });
    const roomId = w.entities.createWithId('town');
    w.addComponent(roomId, Name, { text: 'town' });

    // 背包里没有金币；地上有一枚 → drop 金币应报"你没有"，而非把地上的拿走
    const ground = w.entities.createWithId('ground-coin');
    w.addComponent(ground, Name, { text: '金币' });
    w.addComponent(ground, Portable);
    w.addComponent(ground, Located, { targets: ['town'] });

    expect(await w.execute('drop 金币', player)).toBeNull();
    expect(textOf(w.output.getAll(), 'error')).toContain('你没有「金币」。');
    w.output.clear();
    expect(w.getRelations(ground, Located)[0]).toBe('town');
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
    expect(await w.execute('take 剑', bare)).toBeNull();
    expect(await w.execute('drop 剑', bare)).toBeNull();
    expect(textOf(w.output.getAll(), 'error')).toEqual([
      '你不在任何地方。',
      '你不在任何地方。',
    ]);
  });
});

describe('V2 战斗与死亡（v0.5）', () => {
  /** 玩家 + 一只同房间野狗 */
  function combatWorld() {
    const w = new World({ tickInterval: 500 });
    w.register(ItemSystem, CombatSystem, DeathSystem);
    w.registerCommands(TakeCommand, DropCommand, InventoryCommand, AttackCommand);

    const player = w.entities.createWithId('player');
    w.addComponent(player, Position, { roomId: 'town' });
    w.addComponent(player, Name, { text: '勇者' });

    const town = w.entities.createWithId('town');
    w.addComponent(town, Name, { text: '城镇' });
    w.addComponent(town, Exits, { north: 'cave' });

    const cave = w.entities.createWithId('cave');
    w.addComponent(cave, Name, { text: '洞穴' });
    w.addComponent(cave, Exits, {});

    const mob = w.entities.createWithId('mob');
    w.addComponent(mob, Name, { text: '野狗', aliases: ['狗'] });
    w.addComponent(mob, Position, { roomId: 'town' });
    w.addComponent(mob, Health, { current: 20, max: 20 });
    return { w, player, mob };
  }

  it('attack 造成伤害；HP 归零时目标被销毁并 emit Died', async () => {
    const deaths: string[] = [];
    const { w, player, mob } = combatWorld();
    // Died 监听
    w.register({ name: 'deathwatch', on: ['died'], handle: (e: { data: { entity: string } }) => deaths.push(e.data.entity) } as never);

    await w.execute('attack 野狗', player);
    expect(w.getComponent(mob, Health)!.current).toBe(10);
    expect(w.entities.has(mob)).toBe(true);
    expect(deaths).toEqual([]);

    await w.execute('attack 野狗', player);
    expect(w.entities.has(mob)).toBe(false); // 已销毁
    expect(deaths).toEqual(['mob']);
    expect(textOf(w.output.getAll(), 'narrative')).toContain('「野狗」倒下了。');
  });

  it('attack 不在同房间的目标 → 命令层拒绝', async () => {
    const { w, player } = combatWorld();
    // 洞穴里放另一只野狗
    const caveMob = w.entities.createWithId('cave-mob');
    w.addComponent(caveMob, Name, { text: '洞狼' });
    w.addComponent(caveMob, Position, { roomId: 'cave' });
    w.addComponent(caveMob, Health, { current: 10, max: 10 });

    expect(await w.execute('attack 洞狼', player)).toBeNull();
    expect(textOf(w.output.getAll(), 'error')).toContain('这里没有「洞狼」。');
    expect(w.getComponent(caveMob, Health)!.current).toBe(10);
  });

  it('attack 无 Health 的同房目标 → 系统反馈', async () => {
    const { w, player } = combatWorld();
    const stone = w.entities.createWithId('stone');
    w.addComponent(stone, Name, { text: '石像' });
    w.addComponent(stone, Position, { roomId: 'town' });

    await w.execute('attack 石像', player);
    expect(textOf(w.output.getAll(), 'error')).toContain('ta 身上没有可伤害的生命。');
  });

  it('录像重放：attack 序列确定性一致', async () => {
    const world = combatWorld();
    const rec = record(world.w);
    await rec.execute('attack 野狗', world.player);
    await rec.execute('attack 野狗', world.player);

    const result = await verifyReplay(rec.stop(), () => combatWorld().w);
    expect(result.ok).toBe(true);
    expect(result.diff).toBeUndefined();
  });
});

describe('V3 NPC 巡逻（v0.5）', () => {
  it('Wander 实体沿出口确定性移动（世界时间驱动）', () => {
    const w = new World({ tickInterval: 500 });
    w.register(NpcWanderSystem);
    const town = w.entities.createWithId('town');
    w.addComponent(town, Name, { text: '城镇' });
    w.addComponent(town, Exits, { north: 'cave' });
    const cave = w.entities.createWithId('cave');
    w.addComponent(cave, Name, { text: '洞穴' });
    w.addComponent(cave, Exits, { south: 'town' });

    const npc = w.entities.createWithId('wanderer');
    w.addComponent(npc, Name, { text: '流浪商人' });
    w.addComponent(npc, Position, { roomId: 'town' });
    w.addComponent(npc, Wander);

    // every=3000，tick=500 → 第 6 个 tick（t=3000）跨过网格点触发
    for (let i = 0; i < 6; i++) w.tick();
    expect(w.getComponent(npc, Position)!.roomId).toBe('cave');

    // 再走一轮回到 town（确定性往返）
    for (let i = 0; i < 6; i++) w.tick();
    expect(w.getComponent(npc, Position)!.roomId).toBe('town');
  });

  it('无 Exits 的房间中 Wander 实体原地停留', () => {
    const w = new World({ tickInterval: 500 });
    w.register(NpcWanderSystem);
    const deadEnd = w.entities.createWithId('dead-end');
    w.addComponent(deadEnd, Name, { text: '死胡同' });
    w.addComponent(deadEnd, Exits, {});
    const npc = w.entities.createWithId('trapped');
    w.addComponent(npc, Name, { text: '迷路的猫' });
    w.addComponent(npc, Position, { roomId: 'dead-end' });
    w.addComponent(npc, Wander);

    for (let i = 0; i < 18; i++) w.tick(); // 3 个周期
    expect(w.getComponent(npc, Position)!.roomId).toBe('dead-end');
  });
});

describe('详略模式与出口提示（v0.11）', () => {
  /** 两间互通房 + 挂好 Visited/Verbose 的玩家 */
  function buildTwoRooms() {
    const w = new World({ tickInterval: 500 });
    w.register(MovementSystem, DescriptionSystem, VisitationSystem, VerboseSystem);
    w.registerCommands(
      GoCommand,
      createDirectionCommand('north', ['north']),
      createDirectionCommand('south', ['south']),
      LookCommand,
      VerboseCommand,
    );
    const player = w.entities.createWithId('player-1');
    w.addComponent(player, Position, { roomId: 'room_a' });
    w.addComponent(player, Visited, { rooms: [] });
    w.addComponent(player, Verbose, { on: false });
    for (const room of [
      { id: 'room_a', name: '甲房', desc: '甲房的描述。', exits: { south: 'room_b' } },
      { id: 'room_b', name: '乙房', desc: '乙房的描述。', exits: { north: 'room_a' } },
    ]) {
      w.entities.createWithId(room.id);
      w.addComponent(room.id, Name, { text: room.name });
      w.addComponent(room.id, Description, { text: room.desc });
      w.addComponent(room.id, Exits, room.exits);
    }
    return { w, player };
  }

  it('重复进房自动简略：描述只在首次出现，look 随时看全，详细命令切回', async () => {
    const { w, player } = buildTwoRooms();

    // 首次进入：xkx 式房间块（【名】走 title 通道）+ 描述缩进 + 出口
    await w.execute('south', player);
    expect(textOf(w.output.getAll(), 'title')).toEqual(['【乙房】']);
    expect(textOf(w.output.getAll(), 'narrative')).toEqual(['　　乙房的描述。', '出口：北。']);
    w.output.clear();

    // 折返再进：只报地名（Visited 里已有，自动简略）
    await w.execute('north', player);
    w.output.clear();
    await w.execute('south', player);
    // 乙房没写 short → 回退旧行为：报名一行 + 出口行（出口恒显，0.14）
    expect(textOf(w.output.getAll(), 'narrative')).toEqual(['你来到了乙房。', '出口：北。']);
    w.output.clear();

    // look 随时能重看全部细节（+出口清单）
    await w.execute('look', player);
    const looked = textOf(w.output.getAll(), 'narrative').join('\n');
    expect(looked).toContain('乙房的描述。');
    expect(looked).toContain('出口：北。');
    w.output.clear();

    // 详细命令切回：重复进房恢复全量
    expect(await w.execute('详细', player)).toContain('详细模式');
    await w.execute('north', player);
    w.output.clear();
    await w.execute('south', player);
    expect(textOf(w.output.getAll(), 'narrative')).toEqual(['　　乙房的描述。', '出口：北。']);
    // 再切回自动简略
    expect(await w.execute('verbose', player)).toContain('自动简略');
  });

  it('没预挂 Verbose 的世界：移动不简略（无 Visited 视为首次），切换命令明说没开关', async () => {
    const w = new World({ tickInterval: 500 });
    w.register(MovementSystem, DescriptionSystem, VerboseSystem);
    w.registerCommands(GoCommand, createDirectionCommand('south', ['south']), VerboseCommand);
    const player = w.entities.createWithId('player-1');
    w.addComponent(player, Position, { roomId: 'room_a' });
    w.entities.createWithId('room_a');
    w.addComponent('room_a', Name, { text: '甲房' });
    w.addComponent('room_a', Description, { text: '甲房的描述。' });
    w.addComponent('room_a', Exits, { south: 'room_b' });
    w.entities.createWithId('room_b');
    w.addComponent('room_b', Name, { text: '乙房' });
    w.addComponent('room_b', Description, { text: '乙房的描述。' });

    expect(await w.execute('详细', player)).toContain('没有详略开关');

    await w.execute('south', player);
    // 没挂 Visited：seenBefore 恒 false ⇒ 每次全量（内容没声明探索就不简略）
    expect(textOf(w.output.getAll(), 'title')).toEqual(['【乙房】']);
    expect(textOf(w.output.getAll(), 'narrative')).toEqual(['　　乙房的描述。', '这里没有任何出口。']);
  });
});

describe('进房信息呈现（xkx 长短双描述,0.14）', () => {
  /** 甲房(有 short+金币+石像+带姿态的狼) ⇄ 乙房(无 short) → 丙房(死路) */
  function buildShortWorld() {
    const w = new World({ tickInterval: 500 });
    w.register(MovementSystem, DescriptionSystem, VisitationSystem);
    w.registerCommands(
      GoCommand,
      createDirectionCommand('north', ['north']),
      createDirectionCommand('south', ['south']),
      createDirectionCommand('east', ['east']),
      LookCommand,
    );
    const player = w.entities.createWithId('player-1');
    w.addComponent(player, Position, { roomId: 'room_a' });
    w.addComponent(player, Visited, { rooms: [] });
    w.addComponent(player, Name, { text: '冒险者', aliases: [] });
    markVisited(w, player); // 出生房也要记账（真实游戏同款），否则折返出生房不算"来过"
    const rooms = [
      { id: 'room_a', name: '甲房', desc: '甲房的长描述。', short: '甲房的一行短氛围。', exits: { south: 'room_b' } },
      { id: 'room_b', name: '乙房', desc: '乙房的长描述。', exits: { north: 'room_a', east: 'room_c' } },
      { id: 'room_c', name: '丙房', desc: '丙房的长描述。', exits: {} },
    ];
    for (const room of rooms) {
      w.entities.createWithId(room.id);
      w.addComponent(room.id, Name, { text: room.name });
      w.addComponent(room.id, Description, { text: room.desc });
      if (room.short) w.addComponent(room.id, Short, { text: room.short });
      w.addComponent(room.id, Exits, { ...room.exits });
    }
    const coin = w.entities.createWithId('coin');
    w.addComponent(coin, Name, { text: '金币', aliases: [] });
    w.addComponent(coin, Portable);
    w.addComponent(coin, Located, { targets: ['room_a'] });
    const statue = w.entities.createWithId('statue');
    w.addComponent(statue, Name, { text: '石像', aliases: [] });
    w.addComponent(statue, Located, { targets: ['room_a'] });
    const wolf = w.entities.createWithId('wolf-1');
    w.addComponent(wolf, Name, { text: '野狼', aliases: ['狼'] });
    w.addComponent(wolf, Pose, { text: '压低前身，喉咙里滚出低低的呜声' });
    w.addComponent(wolf, Position, { roomId: 'room_a' });
    return { w, player };
  }

  it('重复进房（有 short）：【名】+ 一行短氛围 + 出口，不再是孤零零一行', async () => {
    const { w, player } = buildShortWorld();
    await w.execute('south', player); // 乙房（首次，全量块）
    w.output.clear();
    await w.execute('north', player); // 折返回甲房（已来过 → 短描述档）
    expect(textOf(w.output.getAll(), 'title')).toEqual(['【甲房】']);
    expect(textOf(w.output.getAll(), 'narrative')).toEqual(['　　甲房的一行短氛围。', '出口：南。']);
  });

  it('首次进房仍是完整房间块；死路房明说「这里没有任何出口」', async () => {
    const { w, player } = buildShortWorld();
    await w.execute('south', player);
    w.output.clear();
    await w.execute('east', player); // 丙房：首次 + 死路
    expect(textOf(w.output.getAll(), 'title')).toEqual(['【丙房】']);
    expect(textOf(w.output.getAll(), 'narrative')).toEqual([
      '　　丙房的长描述。',
      '这里没有任何出口。',
    ]);
  });

  it('重复进房（无 short）：回退报名一行，但出口行恒显', async () => {
    const { w, player } = buildShortWorld();
    await w.execute('south', player); // 乙房首次
    w.output.clear();
    await w.execute('north', player); // 甲房（短描述档）
    w.output.clear();
    await w.execute('south', player); // 乙房重复（无 short）
    expect(textOf(w.output.getAll(), 'narrative')).toEqual(['你来到了乙房。', '出口：北、东。']);
  });

  it('look：活体逐行带姿态短语；地上物全列（场景物标注拿不动）', async () => {
    const { w, player } = buildShortWorld();
    await w.execute('look', player);
    const lines = textOf(w.output.getAll(), 'narrative');
    expect(lines).toContain('　　甲房的长描述。');
    expect(lines).toContain('你可以看到：金币、石像（拿不动）。');
    expect(lines).toContain('「野狼」(狼)压低前身，喉咙里滚出低低的呜声。');
  });
});

describe('进房邻接小图（0.14 方案二）', () => {
  /** 甲房 ⇄ 乙房(东通死路丙房);玩家预挂 MiniMap(on 由参数定) */
  function buildMiniWorld(on: boolean) {
    const w = new World({ tickInterval: 500 });
    w.register(MovementSystem, DescriptionSystem, VisitationSystem, MiniMapSystem);
    w.registerCommands(
      GoCommand,
      createDirectionCommand('south', ['south']),
      createDirectionCommand('east', ['east']),
      LookCommand,
      MiniMapCommand,
    );
    const player = w.entities.createWithId('player-1');
    w.addComponent(player, Position, { roomId: 'room_a' });
    w.addComponent(player, Visited, { rooms: ['room_a'] });
    w.addComponent(player, MiniMap, { on });
    w.addComponent(player, Name, { text: '冒险者', aliases: [] });
    const rooms = [
      { id: 'room_a', name: '甲房', desc: '甲房的长描述。', exits: { south: 'room_b' } },
      { id: 'room_b', name: '乙房', desc: '乙房的长描述。', exits: { north: 'room_a', east: 'room_c' } },
      { id: 'room_c', name: '丙房', desc: '丙房的长描述。', exits: {} },
    ];
    for (const room of rooms) {
      w.entities.createWithId(room.id);
      w.addComponent(room.id, Name, { text: room.name });
      w.addComponent(room.id, Description, { text: room.desc });
      w.addComponent(room.id, Exits, { ...room.exits });
    }
    return { w, player };
  }

  it('略图命令翻转开关；没预挂的世界明说没有', async () => {
    const { w, player } = buildMiniWorld(false);
    expect(await w.execute('略图', player)).toContain('已开启');
    expect(w.getComponent(player, MiniMap)!.on).toBe(true);
    expect(await w.execute('小图', player)).toContain('已关闭');
    expect(w.getComponent(player, MiniMap)!.on).toBe(false);

    const bare = w.entities.createWithId('bare');
    w.addComponent(bare, Name, { text: '裸奔者', aliases: [] });
    expect(await w.execute('略图', bare)).toContain('没有进房略图开关');
  });

  it('进房渲染小图：当前房是独立红色段；已探明邻房显名、未探明显示 ?', async () => {
    const { w, player } = buildMiniWorld(true);
    await w.execute('south', player); // 乙房：北邻甲房（已探明）、东邻丙房（未探明）
    const mini = w.output
      .getAll()
      .find((m) => m.segments.some((s) => s.style?.color === 'red' && s.text === '乙房'));
    expect(mini).toBeDefined();
    const text = mini!.segments.map((s) => s.text).join('');
    expect(text).toBe('甲房\n  │\n乙房──?'); // 北邻已探明显名；东邻未探明 → ?
  });

  it('死路的小图只有当前房自己', async () => {
    const { w, player } = buildMiniWorld(true);
    await w.execute('south', player);
    w.output.clear();
    await w.execute('east', player); // 丙房：无任何出口
    const mini = w.output
      .getAll()
      .find((m) => m.segments.some((s) => s.style?.color === 'red' && s.text === '丙房'));
    expect(mini!.segments.map((s) => s.text).join('')).toBe('丙房');
  });

  it('关闭开关：进房不渲染小图', async () => {
    const { w, player } = buildMiniWorld(false);
    await w.execute('south', player);
    const joined = w.output.getAll().map((m) => m.segments.map((s) => s.text).join('')).join('\n');
    expect(joined).not.toContain('──');
  });
});

describe('layoutNeighborMiniMap（邻接小图布局）', () => {
  it('西邻带名字与连线；东邻对称', () => {
    const l = layoutNeighborMiniMap('甲房', { west: '乙房', east: '丙房' });
    expect(l.midWest).toBe('乙房──');
    expect(l.midEast).toBe('──丙房');
    // 无北/南邻：不占行
    expect(l.top).toBe('');
    expect(l.bottom).toBe('');
  });

  it('北/南邻按当前房中心对齐（CJK 双宽）', () => {
    const l = layoutNeighborMiniMap('青石街', { north: '杂货铺', south: '武馆' });
    // 当前房 6 列，中心在第 3 列（0 起）
    const dw = (t: string) => [...t].reduce((w, ch) => w + (ch.codePointAt(0)! >= 0x2e80 ? 2 : 1), 0);
    const northStart = l.top.indexOf('杂');
    const southStart = l.bottom.indexOf('武');
    const center = Math.floor(dw('青石街') / 2); // 6 列 → 中心 3
    expect(northStart).toBe(Math.max(0, center - Math.floor(dw('杂货铺') / 2)));
    expect(southStart).toBe(Math.max(0, center - Math.floor(dw('武馆') / 2)));
    expect(l.vTop).toBe(' '.repeat(center) + '│');
    expect(l.vBottom).toBe(' '.repeat(center) + '│');
  });
});
