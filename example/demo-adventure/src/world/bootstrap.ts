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
  registerDeveloperKit,
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
  DeathSystem,
  LootSystem,
  NpcWanderSystem,
  QuestSystem,
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
  defineRoom,
  layoutRooms,
  buildRooms,
  markVisited,
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

  // 注册系统（prefabs 移动/描述/物品/战斗·死亡·掉落/巡逻/任务 + 引擎对话 + demo 效果）
  world.register(
    MovementSystem,
    DescriptionSystem,
    ItemSystem,
    CombatSystem,
    LootSystem,
    DeathSystem,
    NpcWanderSystem,
    QuestSystem,
    VisitationSystem,
    DialogueSystem,
    BarkeepEffectsSystem,
  );

  // 开发者套件一步注册：命令 + 效果系统（0.12 起写状态走事件链）
  registerDeveloperKit(world);

  // 注册命令：对话 + prefabs 通用命令 + 四方向 + demo help
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
    HelpCommand,
    createDirectionCommand('north', ['north', 'n', '北']),
    createDirectionCommand('south', ['south', 's', '南']),
    createDirectionCommand('east', ['east', 'e', '东']),
    createDirectionCommand('west', ['west', 'w', '西']),
  );

  // 创建房间（v0.8：defineRoom + 入口锚定 + 坐标自动推断）
  const layout = layoutRooms(
    [
      defineRoom({
        id: 'town_square',
        name: '城镇广场',
        aliases: ['广场'],
        description: '你站在城镇广场上。北面是酒馆，东面是铁匠铺。广场中央有一口古井。',
        exits: { north: 'tavern', east: 'smithy' },
      }),
      defineRoom({
        id: 'tavern',
        name: '酒馆',
        aliases: ['酒吧'],
        description: '你走进了热闹的酒馆。空气中弥漫着麦酒的香气。吧台后面站着一位酒保。',
        exits: { south: 'town_square' },
      }),
      defineRoom({
        id: 'smithy',
        name: '铁匠铺',
        aliases: ['锻造坊'],
        description: '你走进了铁匠铺。炉火熊熊燃烧，铁锤敲击铁砧的声音不绝于耳。铁匠正在工作。',
        exits: { west: 'town_square' },
      }),
    ],
    { entry: 'town_square' },
  );
  buildRooms(world, layout);

  // 创建玩家（QuestLog 是参与任务的前提：系统不能替玩家补组件；
  // Visited 挂上 = 地图带迷雾）
  const playerId = world.entities.create();
  world.addComponent(playerId, Health, { current: 100, max: 100 });
  world.addComponent(playerId, Position, { roomId: layout.entry });
  world.addComponent(playerId, Name, { text: '冒险者' });
  world.addComponent(playerId, QuestLog);
  world.addComponent(playerId, Visited);
  markVisited(world, playerId); // seed 入口（初始位置没有 Moved 事件可订阅）

  // 创建物品实体（0.3-C 容器模型：Located 单源位置，物品真实存在于世界）
  const sword = world.entities.createWithId('sword');
  world.addComponent(sword, Name, {
    text: '生锈的剑',
    aliases: ['剑', 'sword'],
  });
  world.addComponent(sword, Description, {
    text: '一把生锈的旧剑，但仍然锋利。',
  });
  world.addComponent(sword, Portable);
  world.addComponent(sword, Weapon, { damage: 6 });
  world.addComponent(sword, Located, { at: 'town_square' });

  const gold = world.entities.createWithId('gold');
  world.addComponent(gold, Name, { text: '金币', aliases: ['coin'] });
  world.addComponent(gold, Description, { text: '一枚闪闪发光的金币。' });
  world.addComponent(gold, Portable);
  world.addComponent(gold, Located, { at: 'town_square' });

  // 广场游荡的野狗：带 Wander + Position + Health，由 NpcWanderSystem 驱动巡逻，
  // 玩家可以攻击它（CombatSystem）。demo REPL 每 500ms tick → 每 3 秒跳一次房。
  // 带 Loot：死后掉落狗肉（v0.6 —— Died 钩子终于有消费者了）
  const dog = world.entities.createWithId('dog');
  world.addComponent(dog, Name, { text: '野狗', aliases: ['狗', 'dog'] });
  world.addComponent(dog, Description, { text: '一条瘦骨嶙峋的野狗，正警惕地盯着你。' });
  world.addComponent(dog, Position, { roomId: 'town_square' });
  world.addComponent(dog, Health, { current: 20, max: 20 });
  world.addComponent(dog, Wander);
  world.addComponent(dog, Loot, {
    drops: [
      { name: '狗肉', aliases: ['肉'], description: '一块血淋淋的肉，野狗身上割下来的。' },
      { name: '脏兮兮的项圈', aliases: ['项圈'], description: '磨得发亮的旧项圈，看不出主人的名字。' },
    ],
  });

  // 创建 NPC（0.3-B 对话）：酒馆的酒保
  // v0.6：常驻 NPC 用 Located 锚定房间（会动的才用 Position），这样 QuestGiver
  // 的"同房间才算数"规则才能落到酒保身上；顺带挂上悬赏任务。
  const barmanId = world.entities.createWithId('barman');
  world.addComponent(barmanId, Name, {
    text: '酒保',
    aliases: ['bartender', '老王'],
  });
  world.addComponent(barmanId, Description, {
    text: '一个系着围裙的中年男人，正用抹布擦着杯子。',
  });
  world.addComponent(barmanId, Located, { at: 'tavern' });
  world.addComponent(barmanId, QuestGiver, {
    quests: [
      {
        id: 'dog-hunt',
        title: '除掉广场的野狗',
        objective: { type: 'kill', target: '野狗', count: 1 },
        reward: {
          items: [{ name: '陈酿麦酒', description: '老王私藏的好酒，市面上喝不到。' }],
          heal: 20,
        },
      },
      {
        id: 'dog-meat',
        title: '给厨房找块狗肉',
        objective: { type: 'collect', target: '狗肉', count: 1 },
        reward: { items: [{ name: '金币', description: '一枚闪闪发光的金币。' }] },
      },
    ],
  });
  world.addComponent(barmanId, Dialogue, BarkeepDialogue);
  world.addComponent(barmanId, Memory, { flags: [] });

  return { world, playerId };
}
