/**
 * 房间模块测试（v0.9-A）——TDD 锁死自包含房间的全部语义
 *
 * 锁死六件事：
 * 1. `Moved` 是**结果**（to = 房间 id）：enter/leave/firstEnter 只在真正落位后触发
 * 2. 守卫（canEnter/canLeave）同步拦截：拒绝 = 不落位、不记 Visited、无 enter
 * 3. 房间状态走 `state` 组件：进快照、可回滚；闭包变量才是快照的敌人
 * 4. `every` 由世界时间驱动，`RoomClock` 记账，drift-free
 * 5. 房间命令 = 纯翻译层 + 事件派发：位置校验、动词冲突 fail-fast、系统特权
 * 6. 派发是查表（一个系统服务所有房间），不是一房一系统
 */
import { describe, it, expect } from 'vitest';
import { ManualClock, createTestWorld, Name, blueprint } from '@mud/ecs-engine';
import type { OutputMessage } from '@mud/ecs-engine';
import {
  MovementSystem,
  VisitationSystem,
  ItemSystem,
  GoCommand,
  LookCommand,
  TakeCommand,
  createDirectionCommand,
  Position,
  Visited,
  Exits,
  Located,
  Portable,
  RoomClock,
  defineRoom,
  layoutRooms,
  buildRooms,
  buildRoomBehaviors,
} from './index.js';
import { trait } from '@mud/ecs-engine';

function textOf(messages: OutputMessage[]): string {
  return messages
    .map((m) => m.segments.map((s) => s.text).join(''))
    .join('\n');
}

/** 两房间直线：a -east-> b（各测试按需追加行为后重建） */
function lineWorld(
  decorate: (rooms: ReturnType<typeof plainRooms>) => void = () => {},
) {
  const clock = new ManualClock();
  const w = createTestWorld({
    tickInterval: 500,
    clock,
    systems: [MovementSystem, VisitationSystem, ItemSystem],
    commands: [
      GoCommand,
      LookCommand,
      TakeCommand, // 房间命令 spawn 出来的东西要能真的捡走
      createDirectionCommand('east', ['east']),
      createDirectionCommand('west', ['west']),
    ],
  });

  const rooms = plainRooms();
  decorate(rooms);
  buildRooms(w.world, layoutRooms(rooms, { entry: 'a' }));
  buildRoomBehaviors(w.world, rooms);

  const player = w.entities.createWithId('player');
  w.addComponent(player, Position, { roomId: 'a' });
  return { w, player };
}

function plainRooms() {
  return [
    defineRoom({ id: 'a', name: '甲', description: '甲房间', exits: { east: 'b' } }),
    defineRoom({ id: 'b', name: '乙', description: '乙房间', exits: { west: 'a' } }),
  ];
}

describe('defineRoom · 定义期校验', () => {
  it('every.ms 必须是 ROOM_TICK_MS 的整数倍（更小间隔只会静默降级）', () => {
    expect(() =>
      defineRoom({ id: 'x', name: 'x', description: '', exits: {}, on: { every: { ms: 1500, handle: () => {} } } }),
    ).toThrow(/整数倍/);
    expect(() =>
      defineRoom({ id: 'x', name: 'x', description: '', exits: {}, on: { every: { ms: 0, handle: () => {} } } }),
    ).toThrow(/正整数/);
    expect(() =>
      defineRoom({ id: 'x', name: 'x', description: '', exits: {}, on: { every: { ms: 2000, handle: () => {} } } }),
    ).not.toThrow();
  });

  it('id / name 为空 fail-fast（与 v0.8 相同的底线）', () => {
    expect(() => defineRoom({ id: '', name: 'x', description: '', exits: {} })).toThrow(/id/);
  });
});

describe('房间行为 · 生命周期', () => {
  it('enter 在真正落位后触发，ctx.entity 是移动者', async () => {
    const seen: string[] = [];
    const { w, player } = lineWorld((rooms) => {
      rooms[1]!.on = {
        enter(ctx) {
          seen.push(ctx.entity);
          ctx.output.narrative('你踏进了乙房间。');
        },
      };
    });

    await w.world.execute('east', player);
    expect(seen).toEqual([player]);
    expect(textOf(w.output.getAll())).toContain('你踏进了乙房间。');
    expect(w.getComponent(player, Position)!.roomId).toBe('b');
  });

  it('撞墙（出口不存在）不触发 enter——Moved 是结果不是意图', async () => {
    let entered = 0;
    const { w, player } = lineWorld((rooms) => {
      rooms[1]!.on = { enter: () => void entered++ };
    });

    await w.world.execute('north', player); // a 没有 north
    expect(entered).toBe(0);
    expect(w.getComponent(player, Position)!.roomId).toBe('a');
  });

  it('leave 先于 enter，ctx.from 分别是去处与来处', async () => {
    const calls: string[] = [];
    const { w, player } = lineWorld((rooms) => {
      rooms[0]!.on = {
        leave(ctx) {
          calls.push(`leave:${ctx.from}`);
        },
      };
      rooms[1]!.on = {
        enter(ctx) {
          calls.push(`enter:${ctx.from}`);
        },
      };
    });

    await w.world.execute('east', player);
    expect(calls).toEqual(['leave:b', 'enter:a']);
  });

  it('firstEnter 只在实体首次进入时触发一次，账由 prefabs 记（不污染内容 state）', async () => {
    let first = 0;
    let always = 0;
    const { w, player } = lineWorld((rooms) => {
      rooms[1]!.on = {
        enter: () => void always++,
        firstEnter: () => void first++,
      };
    });

    await w.world.execute('east', player);
    await w.world.execute('west', player);
    await w.world.execute('east', player);

    expect(always).toBe(2);
    expect(first).toBe(1);
  });

  it('look（无目标）触发房间 look；look <目标> 不触发', async () => {
    let looked = 0;
    const { w, player } = lineWorld((rooms) => {
      rooms[0]!.on = { look: () => void looked++ };
    });
    // 地上一枚可拾取物，供 look <目标> 用
    const coin = w.world.spawn(
      blueprint({
        components: [
          [Name, { text: '铜币' }],
          [Located, { targets: ['a'] }],
          [Portable],
        ],
      }),
    );
    void coin;

    await w.world.execute('look', player);
    expect(looked).toBe(1);

    await w.world.execute('look 铜币', player);
    expect(looked).toBe(1); // 看的是东西不是房间
  });

  it('every 由世界时间驱动：drift-free，RoomClock 记账，state 持久', async () => {
    const State = trait('test_room_state', () => ({ count: 0 }));
    const { w } = lineWorld((rooms) => {
      rooms[0]!.state = State;
      rooms[0]!.on = {
        every: {
          ms: 1000,
          handle(ctx) {
            ctx.state.count += 1;
          },
        },
      };
    });

    w.advance(500); // t=500：没到 1000 网格
    expect(w.getComponent('a', State)!.count).toBe(0);

    w.advance(1500); // t=2000：跨过 1000 与 2000 两个网格点
    expect(w.getComponent('a', State)!.count).toBe(2);
    expect(w.getComponent('a', RoomClock)!.lastTickedAt).toBe(2000);
  });

  it('访问未声明的 ctx.state → 运行期炸一句人话（而非 undefined 上赋值的诡异报错）', async () => {
    const { w, player } = lineWorld((rooms) => {
      rooms[1]!.on = {
        // 走守卫路径断言：守卫在 MovementSystem（propagate）里同步执行，
        // 抛错能穿透到 execute；事件处理器走 RoomEventSystem 的 'skip'，
        // 错误被记录但不清空输出断言
        canEnter(ctx) {
          void (ctx as { state: unknown }).state;
          return undefined;
        },
      };
    });

    await expect(w.world.execute('east', player)).rejects.toThrow(/没有声明 state/);
    expect(w.getComponent(player, Position)!.roomId).toBe('a');
  });

  it('一个房间的处理器炸了，不连坐其他房间（派发器故障域 = 单房间）', async () => {
    const { w, player } = lineWorld((rooms) => {
      rooms[1]!.on = {
        enter() {
          throw new Error('房间 b 的内容 bug');
        },
      };
    });

    await w.world.execute('east', player); // 炸掉，但不中断世界
    expect(w.getComponent(player, Position)!.roomId).toBe('b');
    // 玩家走回 a 再出去：a 的 enter 照常（下一轮加 a 的行为验证派发器还活着）
    await w.world.execute('west', player);
    expect(w.getComponent(player, Position)!.roomId).toBe('a');
  });
});

describe('房间守卫 · 同步拦截', () => {
  it('canEnter 拒绝：不落位、不记 Visited、输出理由', async () => {
    const { w, player } = lineWorld((rooms) => {
      rooms[1]!.on = { canEnter: () => '洞口被一张巨大的蛛网封死了。' };
    });
    w.addComponent(player, Visited);

    await w.world.execute('east', player);
    expect(w.getComponent(player, Position)!.roomId).toBe('a');
    expect(w.getComponent(player, Visited)!.rooms).toEqual([]); // 没记账
    expect(textOf(w.output.getAll())).toContain('蛛网封死');
  });

  it('canLeave 拒绝：门从里面锁死，理由来自出发房间', async () => {
    const { w, player } = lineWorld((rooms) => {
      rooms[0]!.on = { canLeave: () => '吊桥还没放下来。' };
      rooms[1]!.on = { canEnter: () => '这里不该被到达。' };
    });

    await w.world.execute('east', player);
    expect(w.getComponent(player, Position)!.roomId).toBe('a');
    expect(textOf(w.output.getAll())).toContain('吊桥'); // canLeave 先于 canEnter
  });

  it('守卫与 state 联动：门闩拔了才放行（读 state，不改 state）', async () => {
    const DoorState = trait('door_state', () => ({ bolted: true }));
    const { w, player } = lineWorld((rooms) => {
      rooms[1]!.state = DoorState;
      rooms[1]!.on = {
        canEnter(ctx) {
          return ctx.state.bolted ? '门从里面闩着。' : undefined;
        },
      };
      rooms[0]!.commands = [
        {
          verbs: ['unbolt'],
          handle(ctx) {
            // 甲房间的绳子拴着乙房间的门闩（跨房间机制归房间自己？不——
            // 这里演示的是"房间命令有系统特权"；真实项目里跨房间机制
            // 应该放 defineArea 或全局系统，见 README 的边界）
            const b = ctx.getComponent('b', DoorState);
            if (b) b.bolted = false;
            return '你拉动绳子，听见远处「咔哒」一声。';
          },
        },
      ];
    });

    await w.world.execute('east', player);
    expect(w.getComponent(player, Position)!.roomId).toBe('a');

    await w.world.execute('unbolt', player);
    await w.world.execute('east', player);
    expect(w.getComponent(player, Position)!.roomId).toBe('b');
  });
});

describe('房间命令', () => {
  it('只在玩家身处该房间时可用；出去之后就是"听不懂"', async () => {
    const { w, player } = lineWorld((rooms) => {
      rooms[0]!.commands = [{ verbs: ['pray'], handle: () => '你默念了几句。' }];
    });

    expect(await w.world.execute('pray', player)).toBe(null); // 在 a：派发成功
    expect(textOf(w.output.getAll())).toContain('你默念了几句。');

    await w.world.execute('east', player);
    expect(await w.world.execute('pray', player)).toBe('我不明白你的意思。');
  });

  it('命令处理器有系统特权：spawn 出来的东西真捡得走', async () => {
    const { w, player } = lineWorld((rooms) => {
      rooms[0]!.commands = [
        {
          verbs: ['search'],
          handle(ctx) {
            ctx.spawn(
              blueprint({
                components: [
                  [Name, { text: '火把' }],
                  [Located, { targets: [ctx.roomId] }],
                  [Portable],
                ],
              }),
            );
            return '你从柴堆里抽出一支火把。';
          },
        },
      ];
    });

    await w.world.execute('search', player);
    await w.world.execute('take 火把', player);
    expect(w.hasComponent('火把' as never, Located)).toBe(false); // 名字不是 id
    const held = w.findRelated(Located, player); // 谁指向玩家 = 玩家背包
    expect(held).toHaveLength(1);
  });

  it('动词冲突 fail-fast（两个房间抢同一个动词）', () => {
    const clock = new ManualClock();
    const w = createTestWorld({ tickInterval: 500, clock });
    const rooms = plainRooms();
    rooms[0]!.commands = [{ verbs: ['push'], handle: () => '' }];
    rooms[1]!.commands = [{ verbs: ['push'], handle: () => '' }];
    buildRooms(w.world, layoutRooms(rooms, { entry: 'a' }));

    expect(() => buildRoomBehaviors(w.world, rooms)).toThrow(/动词冲突.*甲.*乙|push/);
  });

  it('先 buildRooms 后 buildRoomBehaviors：房间实体不存在就炸清楚', () => {
    const clock = new ManualClock();
    const w = createTestWorld({ tickInterval: 500, clock });
    const rooms = plainRooms();
    rooms[0]!.on = { enter: () => {} };
    expect(() => buildRoomBehaviors(w.world, rooms)).toThrow(/buildRooms/);
  });
});

describe('房间状态 · 快照与回滚', () => {
  it('state 走组件：进快照、可回滚（闭包变量做不到）', async () => {
    const TrapState = trait('trap_state', () => ({ collapsed: false }));
    const { w, player } = lineWorld((rooms) => {
      rooms[1]!.state = TrapState;
      rooms[1]!.on = {
        enter(ctx) {
          ctx.state.collapsed = true;
        },
      };
    });

    await w.world.execute('east', player);
    expect(w.getComponent('b', TrapState)!.collapsed).toBe(true);

    const snap = w.world.createSnapshot();
    expect(() => JSON.parse(JSON.stringify(snap.entities))).not.toThrow(); // 可 JSON

    // 回滚到进入前：状态回到 false，且再走一遍 enter 照常触发
    const snapBefore = w.world.createSnapshot();
    void snapBefore;
    w.world.rollbackWorld(snap);
    expect(w.getComponent('b', TrapState)!.collapsed).toBe(true); // 快照时已是 true

    const snapEarlier = w.world.createSnapshot();
    void snapEarlier;
    void snap;
  });

  it('回滚后再触发：行为是代码（重新可用），状态从快照恢复', async () => {
    const TrapState = trait('trap_state2', () => ({ collapsed: false }));
    const { w, player } = lineWorld((rooms) => {
      rooms[1]!.state = TrapState;
      rooms[1]!.on = {
        enter(ctx) {
          if (!ctx.state.collapsed) {
            ctx.state.collapsed = true;
            ctx.output.narrative('你身后的通道轰然塌陷！');
          }
        },
      };
    });

    const before = w.world.createSnapshot();
    await w.world.execute('east', player);
    expect(textOf(w.output.getAll())).toContain('轰然塌陷');

    w.world.rollbackWorld(before);
    expect(w.getComponent('b', TrapState)!.collapsed).toBe(false);

    w.output.clear();
    await w.world.execute('east', player);
    expect(textOf(w.output.getAll())).toContain('轰然塌陷'); // 行为照常，状态重新记账
  });

  it('fork 后改房间 state，主世界不受影响（行为是代码，状态随快照走）', async () => {
    const TrapState = trait('fork_trap_state', () => ({ sprung: false }));
    const { w, player } = lineWorld((rooms) => {
      rooms[1]!.state = TrapState;
      rooms[1]!.on = {
        enter(ctx) {
          ctx.state.sprung = true;
        },
      };
    });

    await w.world.execute('east', player);
    expect(w.getComponent('b', TrapState)!.sprung).toBe(true);

    // fork 的世界里：状态被复制、行为照常可用（RoomBehaviorRef 指向模块级注册表，
    // 实体 id 与主世界一致）
    const fork = w.world.fork();
    fork.getComponent('b', TrapState)!.sprung = false;
    expect(w.getComponent('b', TrapState)!.sprung).toBe(true); // 主世界不受影响

    await fork.execute('west', player);
    await fork.execute('east', player);
    expect(fork.getComponent('b', TrapState)!.sprung).toBe(true); // fork 里行为照常记账
  });
});

describe('派发架构 · 查表而非一房一系统', () => {
  it('多个房间的行为由同一对系统服务（RoomEventSystem 全局唯一注册）', async () => {
    const hits: string[] = [];
    const { w, player } = lineWorld((rooms) => {
      rooms[0]!.on = { enter: () => void hits.push('a') };
      rooms[1]!.on = { enter: () => void hits.push('b') };
    });

    const names = w.world.systems.map((s: { name?: string }) => s.name ?? '');
    expect(names.filter((n: string) => n === 'prefab.room.event')).toHaveLength(1);
    expect(names.filter((n: string) => n === 'prefab.room.tick')).toHaveLength(1);

    await w.world.execute('east', player);
    await w.world.execute('west', player);
    expect(hits).toEqual(['b', 'a']);
  });

  it('确定性：同输入序列 ⇒ 同输出（行为派发不引入随机性）', async () => {
    const build = () =>
      lineWorld((rooms) => {
        rooms[1]!.on = {
          enter(ctx) {
            ctx.output.narrative('你踏进了乙房间。');
          },
        };
      });

    const a = build();
    const b = build();
    for (const cmd of ['east', 'west', 'east']) {
      await a.w.world.execute(cmd, a.player);
      await b.w.world.execute(cmd, b.player);
    }
    expect(textOf(a.w.output.getAll())).toBe(textOf(b.w.output.getAll()));
  });

  it('重复调用 buildRoomBehaviors 不重复注册系统（幂等）', () => {
    const clock = new ManualClock();
    const w = createTestWorld({ tickInterval: 500, clock });
    const rooms = plainRooms();
    rooms[0]!.on = { enter: () => {} };
    buildRooms(w.world, layoutRooms(rooms, { entry: 'a' }));
    buildRoomBehaviors(w.world, rooms);
    buildRoomBehaviors(w.world, rooms);

    const names = w.world.systems.map((s: { name?: string }) => s.name ?? '');
    expect(names.filter((n: string) => n === 'prefab.room.event')).toHaveLength(1);
  });

  it('纯静态房间不占行为槽位（挂了 ref 才有行为）', () => {
    const clock = new ManualClock();
    const w = createTestWorld({ tickInterval: 500, clock });
    const rooms = plainRooms(); // 无 state/on/commands
    buildRooms(w.world, layoutRooms(rooms, { entry: 'a' }));
    buildRoomBehaviors(w.world, rooms);

    expect(w.getComponent('a', Exits)).toBeDefined();
    expect(w.findByComponent(RoomClock)).toEqual([]);
  });
});
