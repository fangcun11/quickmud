/**
 * mini-rpg 共享引导逻辑（v0.9-B）
 *
 * 「纯内容」包：通用件全部来自预制件包，本文件只剩世界观内容——
 * 3 个区域、4 个房间、2 个 NPC、2 只狼、1 只 boss、2 条任务、4 个内容系统。
 *
 * 世界流程（纵向切片，v0.9 起按区域划分）：
 *   村庄(村长·任务/药婆·回春) -east-> 野地{ 森林小径(野狼×2·掉狼皮) ↓ 沼泽(毒雾) }
 *   -east-> 蛛巢(巨蛛 boss·毒攻·掉传家宝) -回村交任务-> 终局
 *
 * v0.9 的三处新活：
 * - 区域：`defineArea` + `layoutWorld`，区域拓扑由跨区域房间出口**反推**
 * - 房间行为：毒雾从全局系统搬进沼泽的 `on.enter`；蛛巢的 `firstEnter`
 *   与 `search` 命令用 `state` 组件记账（状态进快照，不是闭包变量）
 * - 房间命令：`search` 只在蛛巢里能敲，换个房间就是"我不明白你的意思"
 */
import {
  World,
  Name,
  trait,
  blueprint,
  registerDeveloperKit,
  createDialogueCommands,
  DialogueSystem,
  Dialogue,
} from '@mud/ecs-engine';
import type { EntityId } from '@mud/ecs-engine';
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
  VisitationSystem,
  Health,
  Position,
  Description,
  Portable,
  Weapon,
  Located,
  Wander,
  Loot,
  QuestGiver,
  QuestLog,
  Visited,
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
  MapCommand,
  WorldMapCommand,
  defineRoom,
  defineArea,
  layoutWorld,
  buildRooms,
  buildAreas,
  buildRoomBehaviors,
  markVisited,
  buffBlueprint,
} from '@mud/prefabs';
import {
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

/** 蛛巢的房间状态：碎骨堆搜没搜过（组件记账，进快照——不是 `let` 变量） */
const CaveState = trait('cave_state', () => ({ searched: false }));

export function bootstrap(): BootstrapResult {
  const world = new World({
    tickInterval: 500,
    maxEventsPerCommand: 1000,
  });

  // 注册系统：prefabs 全家桶（移动/描述/物品/战斗/掉落/清场/巡逻/任务/buff）
  // + 引擎对话 + mini-rpg 内容系统
  // （房间行为的派发系统由 buildRoomBehaviors 自动注册，见下方"房间模块"）
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
    VisitationSystem,
    DialogueSystem,
    SpiderRevengeSystem,
    SpiderVenomSystem,
    HerbalistEffectsSystem,
    EndingSystem,
  );

  // 开发者套件一步注册：命令 + 效果系统（0.12 起写状态走事件链）
  registerDeveloperKit(world);

  // 注册命令：对话 + prefabs 通用 + 四方向 + help
  world.registerCommands(
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
    MapCommand,
    WorldMapCommand,
    HelpCommand,
    createDirectionCommand('north', ['north', 'n', '北']),
    createDirectionCommand('south', ['south', 's', '南']),
    createDirectionCommand('east', ['east', 'e', '东']),
    createDirectionCommand('west', ['west', 'w', '西']),
  );

  // ---- 区域（v0.9：村庄 / 野地 / 蛛巢，三张独立平面）----
  // 区域只声明"我是谁"；出口拓扑由跨区域的房间出口**反推**（单一真相）：
  //   village -east-> wilds（village.east=forest）
  //   wilds  -east-> cave （swamp.east=cave）
  const areas = [
    defineArea({ id: 'village', name: '村庄', description: '破败但还亮着灯的地方。' }),
    defineArea({ id: 'wilds', name: '野地', description: '村子外面，树影和雾气统治的地方。' }),
    defineArea({ id: 'lair', name: '蛛巢', description: '兽骨与蛛网堆成的黑暗。' }),
  ];

  // ---- 房间模块（v0.9：defineRoom = 数据 + 行为 + 命令）----
  // 拓扑是唯一真相：只写出口，二维坐标由 layoutWorld 分区域 BFS 推出
  // （拓扑写错在启动时 fail-fast，不会等玩家走进第三个房间才发现地图像鬼画符）
  const rooms = [
    defineRoom({
      id: 'village',
      area: 'village',
      name: '村庄',
      aliases: ['村子'],
      description:
        '晨光里的村庄安静而破败。村口的老槐树下站着村长，东侧屋檐下是药婆的药摊。一条小路向东伸进森林。',
      exits: { east: 'forest' },
    }),
    defineRoom({
      id: 'forest',
      area: 'wilds',
      name: '森林小径',
      aliases: ['森林'],
      description:
        '浓密的树冠遮住了半边天。灌木丛里传来窸窸窣窣的动静——绿油油的眼睛正盯着你。西面回村庄，南边的空气越来越潮。',
      exits: { west: 'village', south: 'swamp' },
    }),
    defineRoom({
      id: 'swamp',
      area: 'wilds',
      name: '沼泽',
      aliases: ['湿地'],
      description:
        '腐臭的泥浆没过脚踝，灰绿色的雾气贴着水面翻涌。北面是森林，东边的岩壁下裂开一道洞口，深不见底。',
      exits: { north: 'forest', east: 'cave' },
      // 毒雾（原 SwampMiasmaSystem）：进沼泽的活物都会缠上——不分玩家与 NPC，
      // 狼游进来照样中毒。每次进入都触发（沼毒是一次性的，不叠加在旧账上）
      on: {
        enter(ctx) {
          if (!ctx.getComponent(ctx.entity, Health)) return;
          ctx.spawn(
            buffBlueprint({
              victim: ctx.entity,
              effect: { type: 'damage', amount: 3, every: 2000 },
              lasts: 8000,
            }),
          );
          ctx.output.narrative('沼泽的毒雾无声无息地缠了上来……（每隔一会儿 -3 生命，持续一阵子）');
        },
      },
    }),
    defineRoom({
      id: 'cave',
      area: 'lair',
      name: '蛛巢洞穴',
      aliases: ['洞穴'],
      description:
        '洞壁上挂满厚重的蛛网，地面散落着白森森的兽骨。洞穴深处，八只眼睛在黑暗里反着光。西面是唯一的退路。',
      exits: { west: 'swamp' },
      state: CaveState,
      on: {
        firstEnter(ctx) {
          ctx.output.narrative('你第一次踏进这里。头顶的蛛网随气流轻轻颤动——它们还新鲜。');
        },
      },
      commands: [
        {
          verbs: ['search', '搜索'],
          handle(ctx) {
            if (ctx.state.searched) return '碎骨堆已经被你翻了个底朝天，再没有别的了。';
            ctx.state.searched = true;
            ctx.spawn(
              blueprint({
                components: [
                  [Name, { text: '旧铜币', aliases: ['铜币', 'coin'] }],
                   [Description, { text: '一枚磨得发亮的旧铜币，边缘还有牙印。' }],
                  [Located, { at: ctx.roomId }],
                  [Portable],
                ],
              }),
            );
            return '你在碎骨堆里翻出一枚旧铜币。';
          },
        },
      ],
    }),
  ];

  const layout = layoutWorld(rooms, { entry: 'village', areas, entryArea: 'village' });
  buildRooms(world, layout);
  buildAreas(world, layout);
  // 房间行为装进世界：挂 state/时钟/首入账本组件 + 注册房间命令 +
  // 幂等注册 RoomEventSystem / RoomTickSystem（v0.9 房间动态性的开关）
  buildRoomBehaviors(world, rooms);

  // ---- 玩家（QuestLog 是参与任务的前提；Visited 决定地图迷雾）----
  const playerId = world.entities.create();
  world.addComponent(playerId, Health, { current: 100, max: 100 });
  // 出生点直接用 layout.entry：房间拓扑与玩家初始位置不可能写歪
  world.addComponent(playerId, Position, { roomId: layout.entry });
  world.addComponent(playerId, Name, { text: '冒险者' });
  world.addComponent(playerId, QuestLog);
  world.addComponent(playerId, Visited);
  markVisited(world, playerId); // seed 入口（初始位置没有 Moved 事件可订阅）

  // ---- 村长：挂两条任务（主线 kill 巨蛛 / 支线 collect 狼皮）----
  const elderId = world.entities.createWithId('elder');
  world.addComponent(elderId, Name, { text: '村长', aliases: ['长老', 'elder'] });
  world.addComponent(elderId, Description, {
    text: '佝偻着背的老人，手里攥着一根磨得发亮的拐杖，眼神里全是心事。',
  });
  world.addComponent(elderId, Located, { at: 'village' });
  world.addComponent(elderId, QuestGiver, {
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
  world.addComponent(elderId, Dialogue, ElderDialogue);

  // ---- 药婆：讨茶回春（HerbalistEffectsSystem）----
  const herbalistId = world.entities.createWithId('herbalist');
  world.addComponent(herbalistId, Name, { text: '药婆', aliases: ['药师', 'herbalist'] });
  world.addComponent(herbalistId, Description, {
    text: '干瘦的老妇人，面前的粗布上摊着成捆的草药，空气里都是苦味。',
  });
  world.addComponent(herbalistId, Located, { at: 'village' });
  world.addComponent(herbalistId, Dialogue, HerbalistDialogue);

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
    world.addComponent(id, Name, w.name);
    world.addComponent(id, Description, w.desc);
    world.addComponent(id, Position, { roomId: 'forest' });
    world.addComponent(id, Health, { current: w.hp, max: w.hp });
    world.addComponent(id, Wander);
    world.addComponent(id, Loot, {
      drops: [
        { name: '狼皮', aliases: ['皮'], description: '一张带腥味的狼皮，毛色油亮，能卖个好价钱。' },
      ],
    });
  }

  // ---- 洞穴巨蛛（boss）：毒攻击（内容系统）+ 掉传家宝 ----
  const spiderId = world.entities.createWithId('spider');
  world.addComponent(spiderId, Name, {
    text: '洞穴巨蛛',
    aliases: ['巨蛛', '蜘蛛', 'boss'],
  });
  world.addComponent(spiderId, Description, {
    text: '小牛犊子大的蜘蛛，八条腿撑满半个洞穴。腹部斑纹像一张扭曲的人脸。',
  });
  world.addComponent(spiderId, Position, { roomId: 'cave' });
  world.addComponent(spiderId, Health, { current: 40, max: 40 });
  world.addComponent(spiderId, Weapon, { damage: 6 });
  world.addComponent(spiderId, Loot, {
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
