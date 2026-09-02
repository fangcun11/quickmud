/**
 * 共享引导逻辑 - 消除 main.ts 与 main-web.ts 之间的重复代码
 *
 * 本文件只做"组装"，通用件全部来自预制件包：
 * - 引擎能力：World / Name / 开发者命令 / 对话系统（@mud/ecs-engine）
 * - 领域预制件：移动·房间 / 查看 / 背包 / 状态（@mud/prefabs）
 * demo 剩下的只有世界观内容（房间、物品、酒保对话）与 HelpCommand。
 */
import {
  World,
  Name,
  createDeveloperCommands,
  createDialogueCommands,
  DialogueSystem,
  Dialogue,
  Memory,
} from '@mud/ecs-engine';
import {
  MovementSystem,
  DescriptionSystem,
  ItemSystem,
  CombatSystem,
  NpcWanderSystem,
  Health,
  Position,
  Description,
  Exits,
  Portable,
  Weapon,
  Located,
  Wander,
  GoCommand,
  createDirectionCommand,
  LookCommand,
  InventoryCommand,
  ScoreCommand,
  TakeCommand,
  DropCommand,
  AttackCommand,
} from '@mud/prefabs';
import { HelpCommand } from '../commands/help';
import { BarkeepDialogue } from './dialogue';
import { BarkeepEffectsSystem } from './effects';

export interface BootstrapResult {
  world: World;
  playerId: string;
}

export function bootstrap(): BootstrapResult {
  const world = new World({
    tickInterval: 500,
    maxEventsPerCommand: 1000,
  });

  // 注册系统（prefabs 移动/描述/物品/战斗/巡逻 + 引擎对话 + demo 效果）
  world.register(
    MovementSystem,
    DescriptionSystem,
    ItemSystem,
    CombatSystem,
    NpcWanderSystem,
    DialogueSystem,
    BarkeepEffectsSystem,
  );

  // 注册命令：开发者命令 + 对话 + prefabs 通用命令 + 四方向 + demo help
  world.registerCommands(
    ...createDeveloperCommands(),
    ...createDialogueCommands(),
    GoCommand,
    LookCommand,
    InventoryCommand,
    ScoreCommand,
    TakeCommand,
    DropCommand,
    AttackCommand,
    HelpCommand,
    createDirectionCommand('north', ['north', 'n', '北']),
    createDirectionCommand('south', ['south', 's', '南']),
    createDirectionCommand('east', ['east', 'e', '东']),
    createDirectionCommand('west', ['west', 'w', '西']),
  );

  // 创建玩家
  const playerId = world.entities.create();
  world.entities.addComponent(playerId, Health, { current: 100, max: 100 });
  world.entities.addComponent(playerId, Position, { roomId: 'town_square' });
  world.entities.addComponent(playerId, Name, { text: '冒险者' });

  // 创建房间
  const rooms = [
    {
      id: 'town_square',
      name: { text: '城镇广场', aliases: ['广场'] },
      desc: { text: '你站在城镇广场上。北面是酒馆，东面是铁匠铺。广场中央有一口古井。' },
      exits: { north: 'tavern', east: 'smithy' } as Record<string, string>,
    },
    {
      id: 'tavern',
      name: { text: '酒馆', aliases: ['酒吧'] },
      desc: { text: '你走进了热闹的酒馆。空气中弥漫着麦酒的香气。吧台后面站着一位酒保。' },
      exits: { south: 'town_square' } as Record<string, string>,
    },
    {
      id: 'smithy',
      name: { text: '铁匠铺', aliases: ['锻造坊'] },
      desc: { text: '你走进了铁匠铺。炉火熊熊燃烧，铁锤敲击铁砧的声音不绝于耳。铁匠正在工作。' },
      exits: { west: 'town_square' } as Record<string, string>,
    },
  ];

  for (const room of rooms) {
    const roomId = world.entities.createWithId(room.id);
    world.entities.addComponent(roomId, Name, room.name);
    world.entities.addComponent(roomId, Description, room.desc);
    world.entities.addComponent(roomId, Exits, room.exits);
  }

  // 创建物品实体（0.3-C 容器模型：Located 单源位置，物品真实存在于世界）
  const sword = world.entities.createWithId('sword');
  world.entities.addComponent(sword, Name, {
    text: '生锈的剑',
    aliases: ['剑', 'sword'],
  });
  world.entities.addComponent(sword, Description, {
    text: '一把生锈的旧剑，但仍然锋利。',
  });
  world.entities.addComponent(sword, Portable);
  world.entities.addComponent(sword, Weapon, { damage: 6 });
  world.entities.addComponent(sword, Located, { at: 'town_square' });

  const gold = world.entities.createWithId('gold');
  world.entities.addComponent(gold, Name, { text: '金币', aliases: ['coin'] });
  world.entities.addComponent(gold, Description, { text: '一枚闪闪发光的金币。' });
  world.entities.addComponent(gold, Portable);
  world.entities.addComponent(gold, Located, { at: 'town_square' });

  // 广场游荡的野狗：带 Wander + Position + Health，由 NpcWanderSystem 驱动巡逻，
  // 玩家可以攻击它（CombatSystem）。demo REPL 每 500ms tick → 每 3 秒跳一次房。
  const dog = world.entities.createWithId('dog');
  world.entities.addComponent(dog, Name, { text: '野狗', aliases: ['狗', 'dog'] });
  world.entities.addComponent(dog, Description, { text: '一条瘦骨嶙峋的野狗，正警惕地盯着你。' });
  world.entities.addComponent(dog, Position, { roomId: 'town_square' });
  world.entities.addComponent(dog, Health, { current: 20, max: 20 });
  world.entities.addComponent(dog, Wander);

  // 创建 NPC（0.3-B 对话）：酒馆的酒保
  // 注：NPC 不带 Position / Located —— 实体与容器的归属可视作"常驻"，容器模型
  // 主要用于物品流转，NPC 归属留待有移动 NPC 需求时再扩展。
  const barmanId = world.entities.createWithId('barman');
  world.entities.addComponent(barmanId, Name, {
    text: '酒保',
    aliases: ['bartender', '老王'],
  });
  world.entities.addComponent(barmanId, Description, {
    text: '一个系着围裙的中年男人，正用抹布擦着杯子。',
  });
  world.entities.addComponent(barmanId, Dialogue, BarkeepDialogue);
  world.entities.addComponent(barmanId, Memory, { flags: [] });

  return { world, playerId };
}
