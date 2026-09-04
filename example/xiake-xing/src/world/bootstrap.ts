/**
 * 侠客行 · 世界装配（M0 骨架 v0.1.0）
 *
 * 三区域 12 房：**青石镇**（安全区，出生点）→ **终南山道**（过渡）→
 * **野狼林**（野怪区，M1 的野狼住这儿）。本期只搭骨架：只注册 prefabs
 * 基础系统与移动/查看/地图命令，零新组件、零新系统——先把世界铺出来，
 * 让 M1 的打坐与战斗、M2 的武学秘籍有地方落。
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
} from '@mud/ecs-engine';
import {
  // 系统
  MovementSystem,
  DescriptionSystem,
  VisitationSystem,
  VerboseSystem,
  // 命令
  GoCommand,
  LookCommand,
  MapCommand,
  WorldMapCommand,
  VerboseCommand,
  createDirectionCommand,
  // 组件
  Position,
  Visited,
  Verbose,
  // 房间与区域
  defineRoom,
  defineArea,
  layoutWorld,
  buildRooms,
  buildAreas,
  buildRoomBehaviors,
  markVisited,
} from '@mud/prefabs';
import { HelpCommand, QuitHintCommand } from '../commands/help';

export interface BootstrapResult {
  world: World;
  playerId: string;
}

export function bootstrap(): BootstrapResult {
  const world = new World({
    tickInterval: 1000,
    maxEventsPerCommand: 1000,
  });

  // M0 只注册 prefabs 基础件；M1 起再上修炼/战斗/系统
  world.register(MovementSystem, DescriptionSystem, VisitationSystem, VerboseSystem);
  // RoomEventSystem / RoomTickSystem 由 buildRoomBehaviors 幂等注册

  // 开发者套件一步注册：命令 + 效果系统（/tp /heal 等调试件）
  registerDeveloperKit(world);

  world.registerCommands(
    GoCommand,
    LookCommand,
    MapCommand,
    WorldMapCommand,
    VerboseCommand,
    HelpCommand,
    QuitHintCommand,
    // 口语方向别名：中文玩家不会先想到敲 north——往东/向东/东边都能走
    createDirectionCommand('north', ['north', 'n', '北', '往北', '向北', '朝北', '北边', '往北走']),
    createDirectionCommand('south', ['south', 's', '南', '往南', '向南', '朝南', '南边', '往南走']),
    createDirectionCommand('east', ['east', 'e', '东', '往东', '向东', '朝东', '东边', '往东走']),
    createDirectionCommand('west', ['west', 'w', '西', '往西', '向西', '朝西', '西边', '往西走']),
  );

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
      area: 'town',
      exits: { east: 'street' },
    }),
    defineRoom({
      id: 'street',
      name: '青石街',
      description:
        '镇子正中的青石板路，被独轮车磨得发亮。北边是杂货铺，南边是望岳武馆，往东出镇口，往西回客栈。',
      area: 'town',
      exits: { west: 'inn', north: 'grocery', south: 'wuguan', east: 'gate' },
    }),
    defineRoom({
      id: 'grocery',
      name: '杂货铺',
      description:
        '铺子里堆着干粮、火折子和粗布衣裳，掌柜的噼里啪啦打着算盘。往南回到青石街。',
      area: 'town',
      exits: { south: 'street' },
    }),
    defineRoom({
      id: 'wuguan',
      name: '望岳武馆',
      description:
        '院里立着一排木桩，几个弟子在扎马步，汗把青砖滴湿了一片。墙上挂一块「望岳」的匾。教头说过：想学真功夫，先练好底子。',
      area: 'town',
      exits: { north: 'street' },
    }),
    defineRoom({
      id: 'gate',
      name: '镇口',
      description:
        '青石镇的南门。守门的老卒靠着门框打盹，长枪歪在肩上。出了门就是通往终南山的山道。',
      area: 'town',
      exits: { west: 'street', south: 'path' },
    }),

    // ================= 终南山道（road，过渡）=================
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
  world.addComponent(playerId, Visited);
  world.addComponent(playerId, Verbose, { on: false }); // 预挂详略开关（详细/verbose 命令用）
  markVisited(world, playerId); // seed 出生房间（初始位置没有 Moved 事件可订阅）

  return { world, playerId };
}
