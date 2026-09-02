/**
 * mini-rpg 共享引导逻辑（v0.7-B）
 *
 * 「纯内容」包：通用件全部来自预制件包，本文件只剩世界观内容——
 * 4 个房间、2 个 NPC、2 只狼、1 只 boss、2 条任务、5 个内容系统。
 *
 * 世界流程（纵向切片）：
 *   村庄(村长·任务/药婆·回春) →east→ 森林小径(野狼×2·掉狼皮)
 *   →south→ 沼泽(毒雾) →east→ 洞穴(巨蛛 boss·毒攻·掉传家宝) →回村交任务→ 终局
 */
import {
  World,
  Name,
  createDeveloperCommands,
  createDialogueCommands,
  DialogueSystem,
  Dialogue,
} from '@mud/ecs-engine';
import {
  MovementSystem,
  DescriptionSystem,
  ItemSystem,
  CombatSystem,
  LootSystem,
  DeathSystem,
  NpcWanderSystem,
  QuestSystem,
  BuffSystem,
  BuffCleanupSystem,
  Health,
  Position,
  Description,
  Exits,
  Portable,
  Weapon,
  Located,
  Wander,
  Loot,
  QuestGiver,
  QuestLog,
  GoCommand,
  createDirectionCommand,
  LookCommand,
  InventoryCommand,
  ScoreCommand,
  TakeCommand,
  DropCommand,
  AttackCommand,
  QuestCommand,
  TurnInCommand,
} from '@mud/prefabs';
import {
  SwampMiasmaSystem,
  SpiderRevengeSystem,
  SpiderVenomSystem,
  HerbalistEffectsSystem,
  EndingSystem,
} from './content';
import { ElderDialogue, HerbalistDialogue } from './dialogue';
import { HelpCommand } from '../commands/help';

export interface BootstrapResult {
  world: World;
  playerId: string;
}

export function bootstrap(): BootstrapResult {
  const world = new World({
    tickInterval: 500,
    maxEventsPerCommand: 1000,
  });

  // 注册系统：prefabs 全家桶（移动/描述/物品/战斗/掉落/清场/巡逻/任务/buff）
  // + 引擎对话 + mini-rpg 内容系统
  world.register(
    MovementSystem,
    DescriptionSystem,
    ItemSystem,
    CombatSystem,
    LootSystem,
    DeathSystem,
    NpcWanderSystem,
    QuestSystem,
    BuffSystem,
    BuffCleanupSystem,
    DialogueSystem,
    SwampMiasmaSystem,
    SpiderRevengeSystem,
    SpiderVenomSystem,
    HerbalistEffectsSystem,
    EndingSystem,
  );

  // 注册命令：开发者 + 对话 + prefabs 通用 + 四方向 + help
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
    QuestCommand,
    TurnInCommand,
    HelpCommand,
    createDirectionCommand('north', ['north', 'n', '北']),
    createDirectionCommand('south', ['south', 's', '南']),
    createDirectionCommand('east', ['east', 'e', '东']),
    createDirectionCommand('west', ['west', 'w', '西']),
  );

  // ---- 玩家（QuestLog 是参与任务的前提）----
  const playerId = world.entities.create();
  world.entities.addComponent(playerId, Health, { current: 100, max: 100 });
  world.entities.addComponent(playerId, Position, { roomId: 'village' });
  world.entities.addComponent(playerId, Name, { text: '冒险者' });
  world.entities.addComponent(playerId, QuestLog);

  // ---- 房间 ----
  const rooms = [
    {
      id: 'village',
      name: { text: '村庄', aliases: ['村子'] },
      desc: {
        text: '晨光里的村庄安静而破败。村口的老槐树下站着村长，东侧屋檐下是药婆的药摊。一条小路向东伸进森林。',
      },
      exits: { east: 'forest' } as Record<string, string>,
    },
    {
      id: 'forest',
      name: { text: '森林小径', aliases: ['森林'] },
      desc: {
        text: '浓密的树冠遮住了半边天。灌木丛里传来窸窸窣窣的动静——绿油油的眼睛正盯着你。北面回村庄，南边的空气越来越潮。',
      },
      exits: { west: 'village', south: 'swamp' } as Record<string, string>,
    },
    {
      id: 'swamp',
      name: { text: '沼泽', aliases: ['湿地'] },
      desc: {
        text: '腐臭的泥浆没过脚踝，灰绿色的雾气贴着水面翻涌。北面是森林，东边的岩壁下裂开一道洞口，深不见底。',
      },
      exits: { north: 'forest', east: 'cave' } as Record<string, string>,
    },
    {
      id: 'cave',
      name: { text: '蛛巢洞穴', aliases: ['洞穴'] },
      desc: {
        text: '洞壁上挂满厚重的蛛网，地面散落着白森森的兽骨。洞穴深处，八只眼睛在黑暗里反着光。西面是唯一的退路。',
      },
      exits: { west: 'swamp' } as Record<string, string>,
    },
  ];

  for (const room of rooms) {
    const roomId = world.entities.createWithId(room.id);
    world.entities.addComponent(roomId, Name, room.name);
    world.entities.addComponent(roomId, Description, room.desc);
    world.entities.addComponent(roomId, Exits, room.exits);
  }

  // ---- 村长：挂两条任务（主线 kill 巨蛛 / 支线 collect 狼皮）----
  const elderId = world.entities.createWithId('elder');
  world.entities.addComponent(elderId, Name, { text: '村长', aliases: ['长老', 'elder'] });
  world.entities.addComponent(elderId, Description, {
    text: '佝偻着背的老人，手里攥着一根磨得发亮的拐杖，眼神里全是心事。',
  });
  world.entities.addComponent(elderId, Located, { at: 'village' });
  world.entities.addComponent(elderId, QuestGiver, {
    quests: [
      {
        id: 'spider-bounty',
        title: '巨蛛悬赏',
        objective: { type: 'kill', target: '洞穴巨蛛', count: 1 },
        reward: { heal: 20 },
      },
      {
        id: 'wolf-pelts',
        title: '狼皮褥子',
        objective: { type: 'collect', target: '狼皮', count: 2 },
        reward: { items: [{ name: '银币', description: '一枚成色不错的银币，村长的赏钱。' }] },
      },
    ],
  });
  world.entities.addComponent(elderId, Dialogue, ElderDialogue);

  // ---- 药婆：讨茶回春（HerbalistEffectsSystem）----
  const herbalistId = world.entities.createWithId('herbalist');
  world.entities.addComponent(herbalistId, Name, { text: '药婆', aliases: ['药师', 'herbalist'] });
  world.entities.addComponent(herbalistId, Description, {
    text: '干瘦的老妇人，面前的粗布上摊着成捆的草药，空气里都是苦味。',
  });
  world.entities.addComponent(herbalistId, Located, { at: 'village' });
  world.entities.addComponent(herbalistId, Dialogue, HerbalistDialogue);

  // ---- 野狼×2：森林游荡（v0.5 Wander），死后掉狼皮（v0.6 Loot）----
  const wolves = [
    {
      id: 'wolf',
      name: { text: '野狼', aliases: ['狼', 'wolf'] },
      desc: { text: '一头精瘦的灰狼，肋骨根根分明——这个冬天的猎物也不多了。' },
      hp: 15,
    },
    {
      id: 'old-wolf',
      name: { text: '独眼老狼', aliases: ['老狼', 'old wolf'] },
      desc: { text: '左眼是一道狰狞的旧疤。它不急着扑上来，在等你先犯错。' },
      hp: 20,
    },
  ];
  for (const w of wolves) {
    const id = world.entities.createWithId(w.id);
    world.entities.addComponent(id, Name, w.name);
    world.entities.addComponent(id, Description, w.desc);
    world.entities.addComponent(id, Position, { roomId: 'forest' });
    world.entities.addComponent(id, Health, { current: w.hp, max: w.hp });
    world.entities.addComponent(id, Wander);
    world.entities.addComponent(id, Loot, {
      drops: [
        { name: '狼皮', aliases: ['皮'], description: '一张带腥味的狼皮，毛色油亮，能卖个好价钱。' },
      ],
    });
  }

  // ---- 洞穴巨蛛（boss）：毒攻击（内容系统）+ 掉传家宝 ----
  const spiderId = world.entities.createWithId('spider');
  world.entities.addComponent(spiderId, Name, {
    text: '洞穴巨蛛',
    aliases: ['巨蛛', '蜘蛛', 'boss'],
  });
  world.entities.addComponent(spiderId, Description, {
    text: '小牛犊子大的蜘蛛，八条腿撑满半个洞穴。腹部斑纹像一张扭曲的人脸。',
  });
  world.entities.addComponent(spiderId, Position, { roomId: 'cave' });
  world.entities.addComponent(spiderId, Health, { current: 40, max: 40 });
  world.entities.addComponent(spiderId, Weapon, { damage: 6 });
  world.entities.addComponent(spiderId, Loot, {
    drops: [
      {
        name: '平安玉佩',
        aliases: ['玉佩', '传家宝'],
        description: '温润的青玉雕成，系着的红绳还很新——村长交出去还没几天。',
      },
    ],
  });

  return { world, playerId };
}
