/**
 * 潮汐地窖自动通关测试（v0.10）—— 测试即通关录像
 *
 * 目的不是"测游戏"，是给 v0.9 那批**只有单测、没有真实消费者**的 API 找活干：
 * 守卫（canEnter/canLeave）、on.leave、on.look、on.every（房间心跳）、
 * 跨层区域（up/down 分区域）、区域实体状态（潮汐挂在区域上）。
 *
 * 时间全部由手动 `world.tick()` 驱动（tickInterval 1000ms/tick），
 * 无真实定时器、无 sleep——内容回归不靠手玩，这是内容包的 CI。
 */
import { describe, it, expect, beforeAll } from 'vitest';
import type { World } from '@mud/ecs-engine';
import { Health, Position, areaEntityId } from '@mud/prefabs';
import { bootstrap } from './world/bootstrap';
import { Ending, Tide } from './world/tide';

let world: World;
let player: string;

/** 收集当前缓冲的全部输出文本并清空 */
function drain(): string {
  const text = world.output
    .getAll()
    .map((m) => m.segments.map((s) => s.text).join(''))
    .join('\n');
  world.output.clear();
  return text;
}

/** 执行一条命令，返回「命令回显 + 事件链输出」 */
async function run(cmd: string): Promise<string> {
  const result = await world.execute(cmd, player);
  return [result ?? '', drain()].filter(Boolean).join('\n');
}

/** 手动推进 n 个 tick，返回期间系统的全部输出 */
function runTicks(n: number): string {
  for (let i = 0; i < n; i++) world.tick();
  return drain();
}

/** 推进到目标水位（潮汐每 4 tick 一格，最多等 40 tick） */
function untilTide(target: number): void {
  for (let i = 0; i < 40 && tide().level !== target; i++) world.tick();
  drain();
}

function pos(): string {
  return world.getComponent(player, Position)!.roomId;
}

function hp(): number {
  return world.getComponent(player, Health)!.current;
}

/** 读**区域实体**上的水位（跨房间机制的状态载体，不是某个房间的私有变量） */
function tide(): { level: number; rising: boolean; valveShut: boolean } {
  return world.getComponent(areaEntityId('cellar'), Tide)!;
}

beforeAll(() => {
  const b = bootstrap();
  world = b.world;
  player = b.playerId;
});

describe('潮汐地窖自动通关（v0.9 API 真实消费者）', () => {
  it('第一幕：出生在地面，地图只画当前区域，世界地图只有一层亮着', async () => {
    expect(pos()).toBe('courtyard');
    // MapCommand 按当前区域过滤，抬头带【区域名】
    // 庭院西通中殿、东通井，两侧都未探明 ⇒ 两侧断线（nave 占列位，庭院不在首列）
    expect(await run('map')).toBe(
      '【废墟】\n\n──庭院(你)──',
    );
    // 只探明过地面 ⇒ 另外两层留白（地图首尾的纯空行被裁掉，不带字形的位置不渲染）
    expect(await run('worldmap')).toBe(
      '废墟(你)',
    );
  });

  it('第二幕：跨层往返（down/up 走的是区域，不是平面方向）', async () => {
    await run('east'); // courtyard → well
    expect(pos()).toBe('well');

    await run('down'); // 跨层：地面 → 地窖
    expect(pos()).toBe('steps');
    // 地窖是另一张平面：map 抬头换成【地窖】
    expect(await run('map')).toContain('【地窖】');

    // 世界地图点亮第二层。跨层边（up/down）不是平面邻接 ⇒ 只给位置、不画连线；
    // 中间的空行是没点亮的地面层——它夹在两层之间，裁不得
    expect(await run('worldmap')).toBe(
      '废墟\n\n地窖(你)',
    );
  });

  it('第三幕：守卫 canEnter —— 水没退干，蓄水池进不去（不落位）', async () => {
    untilTide(2); // 涨两格
    const out = await run('south');
    expect(pos()).toBe('steps'); // 守卫拒绝 ⇒ 不落位
    expect(out).toContain('水还漫着门槛');
  });

  it('第四幕：守卫 canLeave —— 涨到顶，回地面的那条路封死', async () => {
    untilTide(3);
    const out = await run('up');
    expect(pos()).toBe('steps'); // canLeave 拒绝
    expect(out).toContain('退路被水封死');

    // 但地窖内部照走：守卫拿得到 direction，只封 up 这一条
    await run('east');
    expect(pos()).toBe('valve');
  });

  it('第五幕：房间心跳 every + 房间命令 —— 关闸门只拧一次，蒸汽跟着停', async () => {
    // 3000ms 是 ROOM_TICK_MS(1000) 的整数倍 ⇒ 任意连续 3 tick 恰好跨过 1 个网格。
    // 分两段各断言"正好一次"，比"跑 6 tick 掉 10 点"更能锁住无漂移。
    const start = hp();
    expect(runTicks(3)).toContain('滚烫的蒸汽');
    expect(hp()).toBe(start - 5);

    const out = await run('turn');
    expect(out).toContain('水闸');
    expect(tide().valveShut).toBe(true);

    // 周期行为读的是**房间 state 组件**：关了闸，蒸汽就停了
    const after = runTicks(3);
    expect(after).not.toContain('滚烫的蒸汽');
    expect(hp()).toBe(start - 5);

    // state 组件记账：第二次拧是"已经拧到底了"
    expect(await run('turn')).toContain('拧到底');
  });

  it('第六幕：闸门压住了水位，但蓄水池还是进不去 —— 得去敲钟', async () => {
    // 闸门把区间换成「锁死在 1」：涨不上去了，可也退不干净
    untilTide(1);
    expect(tide().level).toBe(1);

    await run('west'); // valve → steps
    await run('up'); // 水位 1 < 3 ⇒ canLeave 放行
    expect(pos()).toBe('well');
    await run('west');
    await run('west'); // → nave
    await run('up'); // 跨层：地面 → 钟楼
    await run('up'); // stair → bellroom（区域内跨层边，靠显式 coords 上地图）
    expect(pos()).toBe('bellroom');

    // 敲钟：房间命令跨实体写**区域**上的水位
    expect(await run('ring')).toContain('退了一格');
    expect(tide().level).toBe(0);
    expect(tide().rising).toBe(false);

    // 窗口是有时限的：等 8 秒，水又回到 1，门重新关上
    runTicks(8);
    expect(tide().level).toBe(1);

    await run('down');
    await run('down');
    await run('east');
    await run('east');
    await run('down');
    expect(pos()).toBe('steps');

    expect(await run('south')).toContain('水还漫着门槛'); // 又被拦了
    expect(pos()).toBe('steps');

    // 再敲一次，趁窗口开着下去（钟可以反复敲，只有文案分头尾）
    await run('up');
    await run('west');
    await run('west');
    await run('up');
    await run('up');
    await run('ring');
    expect(tide().level).toBe(0);
    await run('down');
    await run('down');
    await run('east');
    await run('east');
    await run('down');
    await run('south');
    expect(pos()).toBe('cistern');
  });

  it('第七幕：取祭器 —— firstEnter / look 随水位 / leave 触发，房间命令 spawn 真拿得走', async () => {
    const entering = await run('east'); // → altar
    expect(pos()).toBe('altar');
    expect(entering).toContain('断掉的那只手'); // firstEnter

    const praying = await run('pray');
    expect(praying).toContain('青铜祭器');

    await run('take 祭器'); // 房间命令 spawn 出来的东西真捡得走
    expect(await run('inventory')).toContain('青铜祭器');

    // on.look：刻痕跟着**区域上的水位**变（房间读区域状态，不是自己记账）
    expect(await run('look')).toContain('刻痕');

    // on.leave：带着祭器离开才响
    const leaving = await run('west');
    expect(leaving).toContain('烛火');
    expect(pos()).toBe('cistern');

    // 出了祭坛，房间命令就"听不懂"了
    expect(await run('pray')).toContain('我不明白你的意思。');
  });

  it('第八幕：回地面 —— 带着祭器走出井口，终局', async () => {
    await run('north'); // cistern → steps
    await run('up'); // steps → well（闸门关着，水位封顶 1，退路不会再封）
    expect(pos()).toBe('well');
    await run('west'); // → courtyard

    expect(await run('score')).toContain('生命值');
    expect(pos()).toBe('courtyard');
    expect(world.findByComponent(Ending)).toHaveLength(1); // 终局只结算一次

    // 三层都点亮了
    expect(await run('worldmap')).toBe(
      '钟楼\n\n废墟(你)\n\n地窖',
    );
  });
});

describe('潮汐节奏（独立世界，避免污染主线 tick 计数）', () => {
  it('每 4 tick 一格，涨到顶后转退', () => {
    const b = bootstrap();
    const t = () => b.world.getComponent(areaEntityId('cellar'), Tide)!;
    b.world.output.clear();

    for (let i = 0; i < 4; i++) b.world.tick();
    expect(t().level).toBe(1);
    for (let i = 0; i < 4; i++) b.world.tick();
    expect(t().level).toBe(2);
    for (let i = 0; i < 4; i++) b.world.tick();
    expect(t().level).toBe(3);
    expect(t().rising).toBe(true);

    for (let i = 0; i < 4; i++) b.world.tick(); // 到顶 ⇒ 转退
    expect(t().rising).toBe(false);
    for (let i = 0; i < 4; i++) b.world.tick();
    expect(t().level).toBe(2);
  });

  it('关闸后水位锁死在 1：涨不上去，也退不干净', () => {
    const b = bootstrap();
    const t = () => b.world.getComponent(areaEntityId('cellar'), Tide)!;
    b.world.output.clear();

    t().valveShut = true;
    for (let i = 0; i < 40; i++) {
      b.world.tick();
      expect(t().level).toBeLessThanOrEqual(1);
    }
    expect(t().level).toBe(1);
  });
});
