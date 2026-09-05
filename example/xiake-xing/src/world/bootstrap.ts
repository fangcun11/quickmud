/**
 * 侠客行 · 世界装配（M1 内功根基 v0.2.0）
 *
 * 三区域 12 房：**青石镇**（安全区，出生点）→ **终南山道**（过渡）→
 * **野狼林**（野怪区）。M0 铺世界，M1 上内功与战斗：打坐回气（打坐/
 * 停/状态）、武侠战斗内核（attack/逃，纯公式三态判定）、野狼×3
 * （会还手、掉狼皮）——「练功 → 打怪」循环的第一次落地。
 *
 * 区域排布（区域图从北往南一条线，跨区域出口都是 south/north）：
 *
 *   青石镇 town(0,0)    inn ◄─west─ street ─east─► gate
 *                                │north      │south
 *                          grocery        终南山道 road(0,1)
 *                                │south      path ─south─► pines ─east─► shrine
 *                          wuguan                             │south
 *                       野狼林 woods(0,2)                fringe
 *                                                      woodsgate ─south─► thicket ─south─► den
 */
import {
  World,
  registerDeveloperKit,
  Name,
  type AnyCommand,
} from '@mud/ecs-engine';
import {
  // 系统
  MovementSystem,
  DescriptionSystem,
  VisitationSystem,
  VerboseSystem,
  MiniMapSystem,
  NpcWanderSystem,
  BacktrackSystem,
  ItemSystem,
  LootSystem,
  ConsumableSystem,
  // 命令
  GoCommand,
  ConsumeCommand,
  LookCommand,
  MapCommand,
  WorldMapCommand,
  VerboseCommand,
  MiniMapCommand,
  BackCommand,
  TakeCommand,
  InventoryCommand,
  AttackCommand,
  createDirectionCommand,
  // 组件
  Position,
  Visited,
  Verbose,
  Health,
  Description,
  Portable,
  Located,
  QuestGiver,
  QuestLog,
  Loot,
  Pose,
  MiniMap,
  Backtrack,
  Wander,
  Consumable,
  // 房间与区域
  defineRoom,
  defineArea,
  layoutWorld,
  buildRooms,
  buildAreas,
  buildRoomBehaviors,
  spawnPlayerAt,
} from '@mud/prefabs';
import { HelpCommand, QuitHintCommand } from '../commands/help';
import {
  Energy, Stats, Cultivating, Retaliate, Trail, PlayerTag,
  Arsenal, Channeling, Scripture,
  Purse, Equipment, Bonus, Gear, ForSale,
  Combat, Aggressive, Prayed, WildWolf,
} from '../traits';
import {
  MeditateCommand,
  StopCommand,
  StatusCommand,
  CultivationToggleSystem,
  MeditationSystem,
  InterruptSystem,
  EnergyConsumableSystem,
} from '../cultivation';
import {
  FleeCommand,
  WuxiaCombatSystem,
  NpcRetaliateSystem,
  FleeSystem,
  TrailSystem,
} from '../combat';
import {
  LearnCommand,
  UseCommand,
  ChannelCommand,
  ArtsCommand,
  MartialSystem,
} from '../martial';
import { QuestSystem, QuestCommand, TurnInCommand } from '@mud/prefabs';
import type { QuestDef } from '@mud/prefabs';
import {
  EquipCommand,
  UnequipCommand,
  EquipSystem,
} from '../equipment';
import {
  BuyCommand,
  SellCommand,
  ShopSystem,
} from '../shop';
import { AtmosphereSystem } from '../atmosphere';
import { PresenceSystem, PlayerAwareDeathSystem } from '../life';
import { WolfSpawnSystem } from '../spawn';
import { CombatRoundSystem, DisengageCommand } from '../combat-live';
import { PrayCommand } from '../pray';

export interface BootstrapResult {
  world: World;
  playerId: string;
  /** 注册的全部命令（与 registerCommands 同一份数组——网页版命令建议用它枚举动词，零漂移） */
  commands: AnyCommand[];
  /** 方向词全集（go <方向> 的第二词候选；单字中文在前） */
  directionWords: string[];
}

export function bootstrap(): BootstrapResult {
  const world = new World({
    tickInterval: 1000,
    maxEventsPerCommand: 1000,
  });

  // 基础件 + 死亡管线（掉落/清场），战斗内核换成武侠版（不用 prefabs CombatSystem）
  world.register(
    MovementSystem,
    DescriptionSystem,
    VisitationSystem,
    VerboseSystem,
    ItemSystem,
    LootSystem,
    MiniMapSystem,
    NpcWanderSystem,
    CombatRoundSystem,
    WolfSpawnSystem,
    BacktrackSystem,
    PresenceSystem,
    PlayerAwareDeathSystem,
    EquipSystem,
    ShopSystem,
    ConsumableSystem,
    QuestSystem,
    MartialSystem,
    MeditationSystem,
    EnergyConsumableSystem,
    AtmosphereSystem,
    CultivationToggleSystem,
    InterruptSystem,
    WuxiaCombatSystem,
    NpcRetaliateSystem,
    FleeSystem,
    TrailSystem,
  );
  // RoomEventSystem / RoomTickSystem 由 buildRoomBehaviors 幂等注册

  // 开发者套件一步注册：命令 + 效果系统（/tp /heal 等调试件）
  registerDeveloperKit(world);

  // 口语方向别名：中文玩家不会先想到敲 north——往东/向东/东边都能走。
  // 别名表是单一数据源：方向命令与网页版的建议词都从这里来
  const DIRECTION_ALIASES: Record<string, string[]> = {
    north: ['north', 'n', '北', '往北', '向北', '朝北', '北边', '往北走'],
    south: ['south', 's', '南', '往南', '向南', '朝南', '南边', '往南走'],
    east: ['east', 'e', '东', '往东', '向东', '朝东', '东边', '往东走'],
    west: ['west', 'w', '西', '往西', '向西', '朝西', '西边', '往西走'],
  };
  const directionCommands = Object.entries(DIRECTION_ALIASES).map(([dir, aliases]) =>
    createDirectionCommand(dir, aliases),
  );
  const directionWords = Array.from(
    new Set(['北', '南', '东', '西', 'north', 'south', 'east', 'west', ...Object.values(DIRECTION_ALIASES).flat()]),
  );

  const commands: AnyCommand[] = [
    GoCommand,
    LookCommand,
    MapCommand,
    WorldMapCommand,
    VerboseCommand,
    MiniMapCommand,
    BackCommand,
    ConsumeCommand,
    EquipCommand,
    UnequipCommand,
    BuyCommand,
    SellCommand,
    DisengageCommand,
    PrayCommand,
    LearnCommand,
    UseCommand,
    ChannelCommand,
    ArtsCommand,
    QuestCommand,
    TurnInCommand,
    TakeCommand,
    InventoryCommand,
    AttackCommand,
    MeditateCommand,
    StopCommand,
    StatusCommand, // 替换 prefabs ScoreCommand（demo 件只报生命和房间 id）
    FleeCommand,
    HelpCommand,
    QuitHintCommand,
    ...directionCommands,
  ];
  world.registerCommands(...commands);

  // ---- 区域：三张平面，从北往南一条线 ----
  const areas = [
    defineArea({
      id: 'town',
      name: '青石镇',
      description: '终南山脚的小镇，南来北往的行商都在这儿落脚。',
    }),
    defineArea({
      id: 'road',
      name: '终南山道',
      description: '上山的小路，走的人不多——狼嚎就是从山那边传来的。',
    }),
    defineArea({
      id: 'woods',
      name: '野狼林',
      description: '青石镇人宁绕十里也不肯进的黑林子。',
    }),
  ];

  const rooms = [
    // ================= 青石镇（town，安全区）=================
    defineRoom({
      id: 'inn',
      name: '悦来客栈',
      description:
        '大堂里飘着酒菜香，跑堂的正挨着桌子擦。柜台后挂一面小旗，写着「悦来」二字。江湖消息跟着行商的驮队一起到，这里最灵。',
      short: '酒菜香混着人声，跑堂的正挨着桌子擦。',
      area: 'town',
      exits: { east: 'street' },
    }),
    defineRoom({
      id: 'street',
      name: '青石街',
      description:
        '镇子正中的青石板路，被独轮车磨得发亮。北边是杂货铺，南边是望岳武馆，往东出镇口，往西回客栈。',
      short: '青石板被独轮车磨得发亮，吆喝声此起彼伏。',
      area: 'town',
      exits: { west: 'inn', north: 'grocery', south: 'wuguan', east: 'gate' },
    }),
    defineRoom({
      id: 'grocery',
      name: '杂货铺',
      description:
        '铺子里堆着干粮、火折子和粗布衣裳，掌柜的噼里啪啦打着算盘。往南回到青石街。',
      area: 'town',
      exits: { south: 'street', north: 'smithy' },
    }),
    defineRoom({
      id: 'smithy',
      name: '铁匠铺',
      description:
        '炉火映着半墙，铁砧上的叮当声不紧不慢。墙上挂着几件成色不错的家伙，价目牌钉在柱子上——铁剑十五、皮甲十二、护身符十。掌柜的铁塔似的站在炉边。',
      short: '炉火通红，叮当声不紧不慢。价目牌：铁剑十五、皮甲十二、护身符十。',
      area: 'town',
      exits: { south: 'grocery' },
    }),
    defineRoom({
      id: 'wuguan',
      name: '望岳武馆',
      description:
        '院里立着一排木桩，几个弟子在扎马步，汗把青砖滴湿了一片。墙上挂一块「望岳」的匾。教头说过：想学真功夫，先练好底子。',
      short: '木桩林立，弟子们扎马步的呼吸声整整齐齐。',
      area: 'town',
      exits: { north: 'street' },
    }),
    defineRoom({
      id: 'gate',
      name: '镇口',
      description:
        '青石镇的南门。守门的老卒靠着门框打盹，长枪歪在肩上。出了门就是通往终南山的山道。',
      short: '守门的老卒靠着门框打盹，长枪歪在肩上。',
      area: 'town',
      exits: { west: 'street', south: 'path' },
    }),

    defineRoom({
      id: 'path',
      name: '南山道',
      description:
        '碎石铺就的山道，两侧茅草齐腰。北边下去就是青石镇，往南渐渐入山，路上偶有车辙，看样子有些日子没人走了。',
      area: 'road',
      exits: { north: 'gate', south: 'pines' },
    }),
    defineRoom({
      id: 'pines',
      name: '松林道',
      description:
        '松涛阵阵，山风从林间穿过去，带着松脂的气味。东边有座山神庙，往南林子越来越密。',
      area: 'road',
      exits: { north: 'path', east: 'shrine', south: 'fringe' },
    }),
    defineRoom({
      id: 'shrine',
      name: '山神庙',
      description:
        '一间小小的山神庙，香案上的香炉积着厚厚的香灰。塑像落满了尘，脚下倒是扫得干净——像是常年有人来。',
      short: '香炉积灰，塑像蒙尘。',
      area: 'road',
      exits: { west: 'pines' },
    }),
    defineRoom({
      id: 'fringe',
      name: '林缘',
      description:
        '山道到了尽头。北边是松林道，南边的林子黑压压一片，风里隐隐夹着狼嚎——再往前，就不是人走的路了。',
      area: 'road',
      exits: { north: 'pines', south: 'woodsgate' },
    }),

    // ================= 野狼林（woods，野怪区）=================
    defineRoom({
      id: 'woodsgate',
      name: '林口',
      description:
        '两块歪斜的界石之间就是林口。树上钉着一块褪色的木牌：「野狼林，行人绕行」。落款的字被雨水泡烂了。',
      area: 'woods',
      exits: { north: 'fringe', south: 'thicket' },
    }),
    defineRoom({
      id: 'thicket',
      name: '密林',
      description:
        '树冠遮天蔽日，脚下的落叶厚得没过鞋面。草根间露出几截白骨，看不清是兽是畜——再往南，腥臊味越来越重。',
      short: '树冠遮天蔽日，脚下的落叶厚得没过鞋面。',
      area: 'woods',
      exits: { north: 'woodsgate', south: 'den' },
    }),
    defineRoom({
      id: 'den',
      name: '狼穴',
      description:
        '林子深处的一处洼地，土腥味混着兽骚味扑面而来。地上的爪印又深又密，压倒的荒草铺成一个窝，草茎还是新的——狼群常回来。',
      area: 'woods',
      exits: { north: 'thicket' },
    }),
  ];

  const layout = layoutWorld(rooms, { entry: 'inn', entryArea: 'town', areas });
  buildRooms(world, layout);
  buildAreas(world, layout);
  buildRoomBehaviors(world, rooms);

  // ---- 玩家 ----
  const playerId = world.entities.create();
  world.addComponent(playerId, Position, { roomId: layout.entry });
  world.addComponent(playerId, Name, { text: '少年侠客' });
  world.addComponent(playerId, PlayerTag); // 战斗文案的视角标记
  world.addComponent(playerId, Visited);
  world.addComponent(playerId, Verbose, { on: false }); // 预挂详略开关（详细/verbose 命令用）
  world.addComponent(playerId, Health, { current: 100, max: 100 });
  world.addComponent(playerId, Energy, { current: 20, max: 100 }); // 打坐 4 tick 回满
  world.addComponent(playerId, Stats, { atk: 5, def: 2, dodge: 2 });
  world.addComponent(playerId, Cultivating, { on: false, lastTickedAt: 0 }); // 打坐开关（预挂，Verbose 同款）
  world.addComponent(playerId, Trail, { roomId: layout.entry }); // 逃跑的"来路"
  world.addComponent(playerId, MiniMap, { on: true }); // 进房略图默认开（略图 命令可关）
  world.addComponent(playerId, Backtrack, { rooms: [] }); // 来路栈（回 命令用）
  // M2：出生自带开山拳 1 级；运转心法初始为空（运转 吐纳术 启用）
  world.addComponent(playerId, Arsenal, {
    arts: { kaishan_fist: { level: 1, exp: 0 } },
  });
  world.addComponent(playerId, Purse, { silver: 10 }); // 兜里几枚碎银
  world.addComponent(playerId, Equipment, { weapon: '', armor: '', trinket: '' });
  world.addComponent(playerId, Combat, { foe: '', lastRoundAt: 0 });
  world.addComponent(playerId, QuestLog, { active: {}, completed: [], turnedIn: [] });
  world.addComponent(playerId, Channeling, { artId: '', lastTickedAt: 0 });
  world.addComponent(playerId, Prayed, { done: false });

  // ---- 野狼×3（野怪区，M1 的沙包）----
  // 数值 { hp 25, atk 6, def 1, dodge 2 }：玩家 atk5 打它 4 伤 7 击倒，
  // 它反咬 4 伤——7 击挨 24 点，100 血的新手死不了，但知道疼。
  const wolves = [
    { id: 'wolf-1', roomId: 'thicket' },
    { id: 'wolf-2', roomId: 'den' },
    { id: 'wolf-3', roomId: 'den' },
  ];
  for (const w of wolves) {
    const id = world.entities.createWithId(w.id);
    world.addComponent(id, Name, { text: '野狼', aliases: ['狼', 'wolf'] });
    world.addComponent(id, Description, {
      text: '一头精瘦的灰狼，绿油油的眼睛盯着你，喉咙里滚出低低的呜声。',
    });
    // 姿态短语（xkx 身份感）：房间块的活体行会拼在名字后
    world.addComponent(id, Pose, { text: '压低前身，喉咙里滚出低低的呜声' });
    world.addComponent(id, Wander); // 巡逻（每 3 息沿狼林出口游荡）
    world.addComponent(id, Aggressive); // 主动接敌（玩家进狼林即被攻击）
    world.addComponent(id, Position, { roomId: w.roomId });
    world.addComponent(id, Health, { current: 25, max: 25 });
    world.addComponent(id, Stats, { atk: 6, def: 1, dodge: 2 });
    world.addComponent(id, Retaliate); // 被打自动还手一击
    world.addComponent(id, WildWolf); // 狼群标记（刷怪狼口统计口径）
    world.addComponent(id, Loot, {
      drops: [
        {
          name: '狼皮',
          aliases: ['皮', 'wolf skin'],
          description: '一张带腥味的狼皮，毛色油亮。杂货铺掌柜说过这玩意能换碎银。',
        },
      ],
    });
  }

  // ---- 铁匠铺（M3）：铁匠 + 在售商品 ----
  const smith = world.entities.createWithId('blacksmith');
  world.addComponent(smith, Name, { text: '铁匠', aliases: ['掌柜', '铁匠铺掌柜'] });
  world.addComponent(smith, Description, {
    text: '铁塔似的汉子，胳膊上的肌肉比砧子还硬。手里的锤子起起落落，火星四溅。',
  });
  world.addComponent(smith, Pose, { text: '手里的锤子起起落落，火星四溅' });
  world.addComponent(smith, QuestGiver, {
    quests: [{
      id: 'wolf-pelts',
      title: '收集狼皮',
      objective: { type: 'collect', target: '狼皮', count: 3 },
      reward: { items: [{ name: '金创药', description: '小瓷瓶装的药粉。' }], heal: 20 },
    } as QuestDef],
  });
  world.addComponent(smith, Position, { roomId: 'smithy' });

  const shopItems = [
    {
      id: 'iron_sword',
      name: '铁剑',
      aliases: ['剑'],
      slot: 'weapon' as const,
      bonus: { atk: 3, def: 0, dodge: 0 },
      price: 15,
      desc: '一把分量十足的铁剑，剑刃在炉火下泛着青光。',
    },
    {
      id: 'leather_armor',
      name: '皮甲',
      aliases: ['甲'],
      slot: 'armor' as const,
      bonus: { atk: 0, def: 2, dodge: 0 },
      price: 12,
      desc: '硝好的牛皮缝成的软甲，穿着利索，挡得住爪牙。',
    },
    {
      id: 'amulet',
      name: '护身符',
      aliases: ['符'],
      slot: 'trinket' as const,
      bonus: { atk: 0, def: 0, dodge: 2 },
      price: 10,
      desc: '一枚铜符，刻着模糊的云纹。老人们说挂身上能躲灾。',
    },
  ];
  for (const it of shopItems) {
    const id = world.entities.createWithId(it.id);
    world.addComponent(id, Name, { text: it.name, aliases: it.aliases });
    world.addComponent(id, Description, { text: it.desc });
    world.addComponent(id, Gear, { slot: it.slot });
    world.addComponent(id, Bonus, { ...it.bonus });
    world.addComponent(id, ForSale, { price: it.price });
    world.addComponent(id, Portable);
    world.addComponent(id, Located, { targets: ['smithy'] });
  }

  // ---- 杂货铺消耗品（M4）：馒头/金创药 ----
  const consumables = [
    { id: 'baozi', name: '馒头', aliases: ['包子'], hp: 30, energy: 0, price: 2, desc: '热腾腾的白面馒头，咬一口满嘴麦香。' },
    { id: 'jinchuang', name: '金创药', aliases: ['药', '金创'], hp: 0, energy: 50, price: 5, desc: '小瓷瓶装的药粉，洒在伤口上刀枪痕都能收。' },
  ];
  for (const c of consumables) {
    const id = world.entities.createWithId(c.id);
    world.addComponent(id, Name, { text: c.name, aliases: c.aliases });
    world.addComponent(id, Description, { text: c.desc });
    world.addComponent(id, Consumable, { hp: c.hp, energy: c.energy });
    world.addComponent(id, Portable);
    world.addComponent(id, ForSale, { price: c.price });
    world.addComponent(id, Located, { targets: ['grocery'] });
  }

  // ---- 武馆秘籍（M2）：学 剑谱 / 学 心法——学完即焚 ----
  const scriptures = [
    { id: 'scripture_sword', name: '基础剑法', aliases: ['剑谱', '剑法', '秘籍'], artId: 'basic_sword' },
    { id: 'scripture_tuna', name: '吐纳术', aliases: ['心法', '吐纳', '秘籍'], artId: 'tuna' },
  ];
  for (const sc of scriptures) {
    const id = world.entities.createWithId(sc.id);
    world.addComponent(id, Name, { text: sc.name, aliases: sc.aliases });
    world.addComponent(id, Description, {
      text: '一本泛黄的册子，封皮上的字迹已经斑驳，翻开来是一招一式的图谱与口诀。',
    });
    world.addComponent(id, Scripture, { artId: sc.artId });
    world.addComponent(id, Portable);
    world.addComponent(id, Located, { targets: ['wuguan'] });
  }

  return { world, playerId, commands, directionWords };
}
