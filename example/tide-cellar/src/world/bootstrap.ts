/**
 * 潮汐地窖 · 世界装配（v0.10）
 *
 * 这是一个**内容验证包**：v0.9 的房间行为 API 里有一半只有单测、没有真实消费者
 * （守卫 canEnter/canLeave、on.leave、on.look、on.every、跨层区域、区域实体状态）。
 * 本包用一个三层三区域的小世界把它们全部用上——不是为炫技，是为了让这些 API
 * 有真实内容背书，并顺带逼出缺口清单里真正该做的那一项。
 *
 * 结构（三张独立平面，用 up/down 跨层）：
 *
 *   钟楼 belfry(0,-1)      stair ─up─► bellroom
 *                            ↑ up
 *   地面 ruins(0,0)   nave ◄─west─ courtyard ─east─► well
 *                                                     │ down
 *   地窖 cellar(0,1)  steps ─south─► cistern ─east─► altar
 *                      └─east─► valve
 *
 * 时间：tickInterval 1000ms；潮汐每 4000ms 一格，闸门房蒸汽每 3000ms 一次。
 */
import {
  World,
  registerDeveloperKit,
  blueprint,
  trait,
  Name,
} from '@mud/ecs-engine';
import {
  // 系统
  MovementSystem,
  DescriptionSystem,
  ItemSystem,
  VisitationSystem,
  // 命令
  GoCommand,
  LookCommand,
  InventoryCommand,
  ScoreCommand,
  TakeCommand,
  DropCommand,
  MapCommand,
  WorldMapCommand,
  createDirectionCommand,
  // 组件
  Health,
  Position,
  Visited,
  Located,
  Portable,
  Description,
  // 房间与区域
  defineRoom,
  defineArea,
  layoutWorld,
  buildRooms,
  buildAreas,
  buildRoomBehaviors,
  markVisited,
  areaEntityId,
} from '@mud/prefabs';
import { Tide, TideSystem, EndingSystem } from './tide';
import { HelpCommand } from '../commands/help';

/** 闸门房的房间状态：铁轮拧没拧过（组件记账，进快照——不是 `let` 变量） */
const ValveState = trait('valve_state', () => ({ shut: false }));
/** 祭坛：祈祷过没有（祭器只能拿一次） */
const AltarState = trait('altar_state', () => ({ prayed: false }));
/** 钟室：钟敲过没有（只影响文案，钟可以反复敲） */
const BellState = trait('bell_state', () => ({ rung: false }));

export interface BootstrapResult {
  world: World;
  playerId: string;
}

export function bootstrap(): BootstrapResult {
  const world = new World({
    tickInterval: 1000,
    maxEventsPerCommand: 1000,
  });

  world.register(
    MovementSystem,
    DescriptionSystem,
    ItemSystem,
    VisitationSystem,
    TideSystem, // 跨房间机制：涨落（区域级，不属于任何房间）
    EndingSystem,
    // RoomEventSystem / RoomTickSystem 由 buildRoomBehaviors 幂等注册
  );

  // 开发者套件一步注册：命令 + 效果系统（0.12 起写状态走事件链）
  registerDeveloperKit(world);

  world.registerCommands(
    GoCommand,
    LookCommand,
    InventoryCommand,
    ScoreCommand,
    TakeCommand,
    DropCommand,
    MapCommand,
    WorldMapCommand,
    HelpCommand,
    createDirectionCommand('north', ['north', 'n', '北']),
    createDirectionCommand('south', ['south', 's', '南']),
    createDirectionCommand('east', ['east', 'e', '东']),
    createDirectionCommand('west', ['west', 'w', '西']),
    createDirectionCommand('up', ['up', 'u', '上']),
    createDirectionCommand('down', ['down', 'd', '下']),
  );

  // ---- 区域（v0.9）：三张独立平面，纵向叠成一座废墟的三层 ----
  // 跨层连接是 up/down —— 它们**不是平面邻接**（v0.8 就定下的语义），
  // 所以区域图不会画出连线；三层的位置靠显式 coords 钉住，摆成一张剖面图。
  const areas = [
    defineArea({
      id: 'ruins',
      name: '废墟',
      description: '塌了半边的礼拜堂和它脚下的院子，风从每一条缝里穿过去。',
      coords: { x: 0, y: 0 },
    }),
    defineArea({
      id: 'cellar',
      name: '地窖',
      description: '礼拜堂底下的蓄水层，每过一会儿就被灌满一次。',
      coords: { x: 0, y: 1 },
    }),
    defineArea({
      id: 'belfry',
      name: '钟楼',
      description: '塔顶的钟还挂着，绳也还在。',
      coords: { x: 0, y: -1 },
    }),
  ];

  const rooms = [
    // ================= 地面（ruins）=================
    defineRoom({
      id: 'courtyard',
      name: '庭院',
      description:
        '塌下来的屋顶底下长满荒草，正中一方石板，缝里嵌着旧日的灰。东边是井，西边是礼拜堂。',
      area: 'ruins',
      exits: { east: 'well', west: 'nave' },
    }),
    defineRoom({
      id: 'well',
      name: '井口',
      description: '井沿的石头被绳子磨出一道道深槽。往下看只有黑，和一股潮湿的凉气。',
      area: 'ruins',
      exits: { west: 'courtyard', down: 'steps' }, // 跨层：地面 → 地窖
    }),
    defineRoom({
      id: 'nave',
      name: '礼拜堂',
      description: '半边屋顶塌了，阳光斜着落进来。墙角一道旋梯通向上面的钟楼。',
      area: 'ruins',
      exits: { east: 'courtyard', up: 'stair' }, // 跨层：地面 → 钟楼
    }),

    // ================= 地窖（cellar）=================
    defineRoom({
      id: 'steps',
      name: '台阶',
      description:
        '十二级石阶。往下是地窖的黑暗，往上能看见井口割出来的一小块天。东边是闸门房，南边是蓄水池。',
      area: 'cellar',
      exits: { up: 'well', south: 'cistern', east: 'valve' },
      on: {
        // 守卫（canLeave）：水位到顶，回地面的那条路封死——但地窖内部照走
        // （守卫拿得到 direction，这是它必须"同步查询"而不是"事件后回滚"的理由）
        canLeave(ctx) {
          const tide = ctx.getComponent(areaEntityId('cellar'), Tide);
          if (ctx.direction === 'up' && tide && tide.level >= 3) {
            return '退路被水封死了——台阶下面翻涌着黑水，你上不去。';
          }
          return undefined;
        },
      },
    }),
    defineRoom({
      id: 'cistern',
      name: '蓄水池',
      description: '半池黑水贴着拱顶，水面上漂着一层灰。东边有道矮门，进去是祭坛。',
      area: 'cellar',
      exits: { north: 'steps', east: 'altar' },
      on: {
        // 守卫（canEnter）：水没退干就进不去。门槛卡在 1 —— 关闸后水位锁在 1，
        // 所以「关闸」解决不了这里，必须另想办法（敲钟）
        canEnter(ctx) {
          const tide = ctx.getComponent(areaEntityId('cellar'), Tide);
          if (tide && tide.level >= 1) {
            return '水还漫着门槛，下去就是齐腰深——等退干净了再说。';
          }
          return undefined;
        },
      },
    }),
    defineRoom({
      id: 'valve',
      name: '闸门房',
      description: '墙上一只锈死的铁轮，连着地下的水闸。铁轮旁边的管口嘶嘶地漏着气。',
      area: 'cellar',
      exits: { west: 'steps' },
      state: ValveState,
      on: {
        // 房间心跳（every）：纯房间局部的周期效果，与潮汐的 4000ms 各走各的
        every: {
          ms: 3000,
          handle(ctx) {
            // 关了闸，管口就不喷了——周期行为读**房间 state**，不是读全局变量
            if (ctx.state.shut) return;
            const here = ctx
              .findByComponent(Position)
              .filter((id) => ctx.getComponent(id, Position)?.roomId === ctx.roomId);
            for (const id of here) {
              const hp = ctx.getComponent(id, Health);
              if (!hp) continue;
              // 蒸汽只烫不杀（本包不接死亡管线，免得机制演示变复杂）
              hp.current = Math.max(1, hp.current - 5);
              ctx.output.narrative('管口猛地喷出一股滚烫的蒸汽，烫得你往后一缩。（-5 生命）');
            }
          },
        },
      },
      commands: [
        {
          verbs: ['turn', '转动', '关闸'],
          handle(ctx) {
            if (ctx.state.shut) return '铁轮已经拧到底了，再拧就断了。';
            ctx.state.shut = true;
            // 房间命令有系统特权：可以写**区域实体**上的组件
            const tide = ctx.getComponent(areaEntityId('cellar'), Tide);
            if (tide) tide.valveShut = true;
            return (
              '你咬牙拧动铁轮，地下的水闸「哐」地落下一半——潮水再也漫不上来了，' +
              '可它也退不干净：水位卡在门槛上，进蓄水池还是过不去。管口的汽也停了。'
            );
          },
        },
      ],
    }),
    defineRoom({
      id: 'altar',
      name: '祭坛',
      description:
        '一尊断手的石像立在拱顶底下，石台上一圈凝固的烛油。墙上一排横刻的线，是水位。',
      area: 'cellar',
      exits: { west: 'cistern' },
      state: AltarState,
      on: {
        firstEnter(ctx) {
          ctx.output.narrative('石像断掉的那只手朝着水面，像是在拦什么东西。');
        },
        // look：刻痕跟着**区域上的水位**变（房间读区域状态，不是自己记账）
        look(ctx) {
          const level = ctx.getComponent(areaEntityId('cellar'), Tide)?.level ?? 0;
          const marks = [
            '最低那道还是干的',
            '第二道——水线刚舔到这儿',
            '第三道——水已经淹上石台',
            '最高那道——这间屋子整个在水底下',
          ];
          ctx.output.narrative(`墙上的水位刻痕：${marks[level] ?? marks[0]}。`);
        },
        // leave：带着祭器走的时候才响
        leave(ctx) {
          const carrying = ctx
            .findByComponent(Located)
            .some(
              (id) =>
                ctx.getComponent(id, Located)?.at === ctx.entity &&
                ctx.getComponent(id, Name)?.text === '青铜祭器',
            );
          if (carrying) {
            ctx.output.narrative('你转身时，石台上最后一簇烛火「噗」地灭了。');
          }
        },
      },
      commands: [
        {
          verbs: ['pray', '祈祷'],
          handle(ctx) {
            if (ctx.state.prayed) return '石台上只剩一圈冷掉的烛油。';
            ctx.state.prayed = true;
            ctx.spawn(
              blueprint({
                components: [
                  [Name, { text: '青铜祭器', aliases: ['祭器', 'relic'] }],
                  [
                    Description,
                    {
                      text: '一只巴掌大的青铜器，绿锈下面还看得出刻着的水纹。分量比看上去重。',
                    },
                  ],
                  [Located, { at: ctx.roomId }],
                  [Portable],
                ],
              }),
            );
            return '你对着断手的石像低下头。再抬起头时，石台上多了一只青铜祭器。';
          },
        },
      ],
    }),

    // ================= 钟楼（belfry）=================
    defineRoom({
      id: 'stair',
      name: '旋梯',
      description: '贴着塔壁盘上去的石梯，窄得只能侧身。',
      area: 'belfry',
      exits: { down: 'nave', up: 'bellroom' },
    }),
    defineRoom({
      id: 'bellroom',
      name: '钟室',
      description:
        '一口青铜钟悬在梁下，钟口积着鸽粪。从这儿能看见整片废墟，还有远处水面上泛的白。',
      area: 'belfry',
      exits: { down: 'stair' },
      // 区域内的跨层边（stair -up-> 这里）不进平面 ⇒ 不显式钉坐标就上不了地图
      coords: { x: 0, y: -1 },
      state: BellState,
      commands: [
        {
          verbs: ['ring', '敲钟'],
          handle(ctx) {
            const tide = ctx.getComponent(areaEntityId('cellar'), Tide);
            if (tide) {
              tide.level = Math.max(0, tide.level - 1);
              tide.rising = false; // 敲完这一下，潮水改为退
            }
            const first = !ctx.state.rung;
            ctx.state.rung = true;
            return first
              ? '你拉响铜钟。钟声在废墟上荡开，远处的地下水像是听话地退了一格。'
              : '铜钟又响了一声，水声退了些。';
          },
        },
      ],
    }),
  ];

  const layout = layoutWorld(rooms, { entry: 'courtyard', entryArea: 'ruins', areas });
  buildRooms(world, layout);
  buildAreas(world, layout);
  buildRoomBehaviors(world, rooms);

  // 潮汐挂在**区域实体**上：它影响地窖四个房间，跨房间机制不归单个房间
  world.addComponent(areaEntityId('cellar'), Tide, {
    level: 0,
    rising: true,
    valveShut: false,
  });

  // ---- 玩家 ----
  const playerId = world.entities.create();
  world.addComponent(playerId, Health, { current: 100, max: 100 });
  world.addComponent(playerId, Position, { roomId: layout.entry });
  world.addComponent(playerId, Name, { text: '探访者' });
  world.addComponent(playerId, Visited);
  markVisited(world, playerId); // seed 出生房间（初始位置没有 Moved 事件可订阅）

  return { world, playerId };
}
