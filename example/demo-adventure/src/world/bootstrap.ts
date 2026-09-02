/**
 * 共享引导逻辑 - 消除 main.ts 与 main-web.ts 之间的重复代码
 */
import {
  World,
  createDeveloperCommands,
  createDialogueCommands,
  DialogueSystem,
  Dialogue,
  Memory,
} from '@mud/ecs-engine';
import { BarkeepDialogue } from './dialogue';
import { GoCommand, createDirectionCommand } from '../commands/movement';
import { LookCommand, InventoryCommand, ScoreCommand, HelpCommand } from '../commands/info';
import { MovementSystem } from '../systems/movement';
import { DescriptionSystem } from '../systems/description';
import { Health, Position, Inventory, Name, Description, Exits, Portable, Weapon } from './traits';

export interface BootstrapResult {
  world: World;
  playerId: string;
}

export function bootstrap(): BootstrapResult {
  const world = new World({
    tickInterval: 500,
    maxEventsPerCommand: 1000,
  });

  // 注册系统
  world.register(MovementSystem, DescriptionSystem, DialogueSystem);

  // 注册命令
  world.registerCommands(
    ...createDeveloperCommands(),
    ...createDialogueCommands(),
    GoCommand,
    createDirectionCommand('north', ['north', 'n', '北']),
    createDirectionCommand('south', ['south', 's', '南']),
    createDirectionCommand('east', ['east', 'e', '东']),
    createDirectionCommand('west', ['west', 'w', '西']),
    LookCommand,
    InventoryCommand,
    ScoreCommand,
    HelpCommand,
  );

  // 创建玩家
  const playerId = world.entities.create();
  world.entities.addComponent(playerId, Health, { current: 100, max: 100 });
  world.entities.addComponent(playerId, Position, { roomId: 'town_square' });
  world.entities.addComponent(playerId, Inventory, { items: [] });
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

  // 创建物品
  const items = [
    {
      name: { text: '金币', aliases: ['银子', 'coin'] },
      desc: { text: '一枚闪闪发光的金币。' },
    },
    {
      name: { text: '生锈的剑', aliases: ['剑', 'sword'] },
      desc: { text: '一把生锈的旧剑，但仍然锋利。' },
      weapon: { damage: 6 },
    },
  ];

  for (const item of items) {
    const itemId = world.entities.create();
    world.entities.addComponent(itemId, Name, item.name);
    world.entities.addComponent(itemId, Description, item.desc);
    world.entities.addComponent(itemId, Portable);
    if ('weapon' in item) {
      world.entities.addComponent(itemId, Weapon, item.weapon);
    }
  }

  // 创建 NPC（0.3-B 对话）：酒馆的酒保
  // 注意：NPC 实体不带 Position —— 房间与其中的实体分离是引擎的职责边界，
  // 归属关系（C 容器与物品系统）是 roadmap 0.3 的后续项。
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
