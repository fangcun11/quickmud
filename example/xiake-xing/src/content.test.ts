/**
 * 侠客行 M0 冒烟测试 —— 走遍三区域
 *
 * M0 的验收不是"测游戏"，是**测骨架**：三区域 12 房连通、地图渲染正常、
 * prefabs 基础件在这个世界里拼得起来。时间无关（M0 没有 every 系统），
 * 无真实定时器、无 sleep。
 */
import { describe, it, expect, beforeAll } from 'vitest';
import type { World } from '@mud/ecs-engine';
import { record, verifyReplay } from '@mud/ecs-engine';
import { Position } from '@mud/prefabs';
import { bootstrap } from './world/bootstrap';

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

function pos(): string {
  return world.getComponent(player, Position)!.roomId;
}

beforeAll(() => {
  const b = bootstrap();
  world = b.world;
  player = b.playerId;
});

describe('侠客行 M0 · 三区域骨架', () => {
  it('出生在悦来客栈，地图抬头是青石镇', async () => {
    expect(pos()).toBe('inn');
    const look = await run('look');
    expect(look).toContain('悦来客栈');
    expect(look).toContain('大堂里飘着酒菜香');
    expect(await run('map')).toContain('【青石镇】');
  });

  it('镇内四通：杂货铺、武馆都在青石街上', async () => {
    await run('east');
    expect(pos()).toBe('street');

    await run('north');
    expect(pos()).toBe('grocery');
    await run('south');
    expect(pos()).toBe('street');

    await run('south');
    expect(pos()).toBe('wuguan');
    await run('north');
    expect(pos()).toBe('street');

    // 方向词别名：n/w 一样能走
    await run('north');
    expect(pos()).toBe('grocery');
    await run('s');
    expect(pos()).toBe('street');
    await run('w');
    expect(pos()).toBe('inn');
  });

  it('出镇进山：镇口南下就是终南山道（跨区域）', async () => {
    await run('east');
    await run('east');
    expect(pos()).toBe('gate');

    await run('south');
    expect(pos()).toBe('path'); // 跨区域：town → road
    expect(await run('map')).toContain('【终南山道】');
  });

  it('山道纵深：松林道、山神庙、林缘', async () => {
    await run('south');
    expect(pos()).toBe('pines');

    await run('east');
    expect(pos()).toBe('shrine');
    await run('west');
    expect(pos()).toBe('pines');

    await run('south');
    expect(pos()).toBe('fringe');
  });

  it('林缘南下进野狼林，一直走到狼穴（跨区域）', async () => {
    await run('south');
    expect(pos()).toBe('woodsgate'); // 跨区域：road → woods
    expect(await run('map')).toContain('【野狼林】');

    await run('south');
    expect(pos()).toBe('thicket');
    await run('south');
    expect(pos()).toBe('den');
  });

  it('狼穴是死路：往南没有出口，位置不动且有提示', async () => {
    const out = await run('south');
    expect(pos()).toBe('den');
    expect(out.length).toBeGreaterThan(0);
  });

  it('世界地图：三个区域纵向一条线，玩家在最深处（区域间有连线）', async () => {
    // 跨区域出口是 south/north ⇒ 区域图按四方向反推拓扑，画得出连线（与跨层 up/down 不同）
    expect(await run('worldmap')).toBe(
      '  青石镇\n     │\n 终南山道\n     │\n野狼林(你)',
    );
  });

  it('原路折返回客栈：跨区域的来路都可逆', async () => {
    for (let i = 0; i < 6; i++) await run('north'); // den → … → gate
    expect(pos()).toBe('gate');
    await run('west');
    await run('west');
    expect(pos()).toBe('inn');
    expect(await run('map')).toContain('【青石镇】');
  });

  it('未探明的区域在世界地图上留白', async () => {
    // 折回后刚进过 road ⇒ 三区全亮；换一个独立世界验证"只有出生区"的初态
    const b = bootstrap();
    b.world.output.clear();
    expect(await b.world.execute('worldmap', b.playerId)).toBe(
      '青石镇(你)\n     │',
    );
  });
});

// ============================================================
// M1 · 内功根基：打坐回气、武侠战斗内核（纯公式三态）、野狼×3
// 每用例独立世界（三态要按场景构造身法，不能共享状态）
// ============================================================
import { Name } from '@mud/ecs-engine';
import { Health, itemsInContainer } from '@mud/prefabs';
import { Energy, Stats, Cultivating, Retaliate, Arsenal, Channeling } from './traits';
import {
  Area, Health, Wander, isNight, shichenOf, weatherLabel, weatherOf,
} from '@mud/prefabs';

function fresh(): void {
  const b = bootstrap();
  world = b.world;
  player = b.playerId;
  world.output.clear();
}

/** 从客栈一路走到野狼林（thicket）：e e s s s s s */
async function gotoWolves(): Promise<void> {
  for (const dir of ['e', 'e', 's', 's', 's', 's', 's']) await run(dir);
  expect(pos()).toBe('thicket');
}

function energy(): { current: number; max: number } {
  return world.getComponent(player, Energy)!;
}

function hp(): number {
  return world.getComponent(player, Health)!.current;
}

describe('侠客行 M1 · 内功根基', () => {
  it('打坐回气：每息 +20，4 息回满（5 tick 内达标），封顶不溢出', async () => {
    fresh();
    expect(energy().current).toBe(20);

    expect(await run('打坐')).toContain('盘膝坐下');
    expect(world.getComponent(player, Cultivating)!.on).toBe(true);

    for (let i = 0; i < 4; i++) world.tick();
    drain();
    expect(energy().current).toBe(100); // 20 → 40 → 60 → 80 → 100

    world.tick();
    drain();
    expect(energy().current).toBe(100); // 满了不再涨
  });

  it('移动自动收功：打坐中挪窝，内力停止回复', async () => {
    fresh();
    await run('打坐');
    world.tick();
    drain();
    expect(energy().current).toBe(40);

    expect(await run('e')).toContain('收功起身'); // 挪出客栈
    expect(world.getComponent(player, Cultivating)!.on).toBe(false);

    world.tick();
    drain();
    expect(energy().current).toBe(40); // 已收功，不再回气
  });

  it('收功命令：主动停，内力保留', async () => {
    fresh();
    await run('打坐');
    world.tick();
    drain();
    expect(await run('停')).toContain('缓缓收功');
    expect(world.getComponent(player, Cultivating)!.on).toBe(false);
    expect(energy().current).toBe(40);
  });

  it('状态命令：生命/内力/三围/位置一览（替换 ScoreCommand）', async () => {
    fresh();
    const out = await run('状态');
    expect(out).toContain('生命：100/100');
    expect(out).toContain('内力：20/100');
    expect(out).toContain('攻击 5 · 防御 2 · 身法 2');
    expect(out).toContain('位置：悦来客栈');
  });

  it('战斗三态（纯公式）：身法差决定 命中/格挡/闪避', async () => {
    // 差 +2 → 命中全额 4 伤（atk5 − def1）
    fresh();
    await gotoWolves();
    world.getComponent(player, Stats)!.dodge = 4;
    const hit = await run('attack 野狼');
    expect(hit).toContain('命中「野狼」'); // 招式名随回合报出（M2：自动选招直拳）
    expect(hit).toContain('一记「直拳」');
    expect(hit).toContain('造成 4 点伤害');

    // 差 0 → 格挡：round(4 × 0.7) = 3 伤；狼还手同样被格挡（3 伤，被动视角）
    fresh();
    await gotoWolves();
    const blocked = await run('attack 野狼');
    expect(blocked).toContain('格挡');
    expect(blocked).toContain('只造成 3 点伤害');
    // P4 句式定约：句首永远是攻击者——狼还手的句子以「野狼」开头
    expect(blocked).toContain('「野狼」全力出手，被你格挡');
    expect(hp()).toBe(97); // 100 − 3

    // 差 −2 → 被闪避：零伤；但狼察觉攻击仍会反咬（差 +2 → 咬实 4 伤）
    fresh();
    await gotoWolves();
    world.getComponent(player, Stats)!.dodge = 0;
    const dodged = await run('attack 野狼');
    expect(dodged).toContain('闪过');
    expect(hp()).toBe(96);
  });

  it('NPC 还手：打狼一拳，狼自动咬回来（走同一结算内核）', async () => {
    fresh();
    await gotoWolves();
    world.getComponent(player, Stats)!.dodge = 4; // 狼差 2−4=−2 → 还手被闪掉
    await run('attack 野狼');
    expect(hp()).toBe(100);

    fresh();
    await gotoWolves();
    world.getComponent(player, Stats)!.dodge = 3; // 狼差 2−3=−1 → 还手被格挡，3 伤
    await run('attack 野狼');
    expect(hp()).toBe(97);
  });

  it('击杀与掉落：狼倒下掉狼皮，捡进背包，尸体清场', async () => {
    fresh();
    await gotoWolves();
    const stats = world.getComponent(player, Stats)!;
    stats.atk = 25; // 一击 24 伤（25−1），两击倒
    stats.dodge = 4; // 狼的还手全被闪掉

    const hit1 = await run('attack 野狼');
    const hit2 = await run('attack 野狼');
    const out = hit1 + hit2;
    expect(out).toContain('惨嚎一声');
    expect(out).toContain('掉了狼皮');

    // 尸体清场：thicket 的狼被 DeathSystem 销毁
    const wolvesLeft = world.findByComponent(Retaliate).filter((id) => {
      const p = world.getComponent(id, Position);
      return p?.roomId === 'thicket';
    });
    expect(wolvesLeft).toHaveLength(0);

    // 拾取：掉落物是真实体，look 看得见、take 拿得走
    expect(await run('take 狼皮')).toContain('狼皮');
    const inv = itemsInContainer(world, player);
    expect(inv).toHaveLength(1);
    expect(world.getComponent(inv[0]!, Name)!.text).toBe('狼皮');
  });

  it('逃跑：身法够高退回来路（thicket 的来路是林口），不够原地挨一击', async () => {
    fresh();
    await gotoWolves();
    world.getComponent(player, Stats)!.dodge = 4; // 差 +2 → 逃掉
    expect(await run('逃')).toContain('一口气退回');
    expect(pos()).toBe('woodsgate'); // Trail 记录的来路

    fresh();
    await gotoWolves();
    world.getComponent(player, Stats)!.dodge = 0; // 差 −2 → 逃不掉，挨一击（4 伤）
    expect(await run('逃')).toContain('没能脱身');
    expect(pos()).toBe('thicket');
    expect(hp()).toBe(96);
  });

  it('受击打断：打坐中被咬，收功护体', async () => {
    fresh();
    await gotoWolves();
    await run('打坐');
    expect(world.getComponent(player, Cultivating)!.on).toBe(true);

    const out = await run('attack 野狼'); // 狼还手 → Attacked(target=玩家) → 打断
    expect(world.getComponent(player, Cultivating)!.on).toBe(false);
    expect(out).toContain('收功护体');
  });

  it('help 覆盖：注册表里每个命令都能在 help 里找到自己（防漂移，P8）', async () => {
    fresh();
    const text = await run('help');
    for (const cmd of bootstrap().commands) {
      const hit =
        cmd.verbs.some((v) => text.includes(v)) ||
        (cmd.abbrev ?? []).some((a) => text.includes(a));
      expect(hit, `help 缺少命令：${cmd.verbs.join('/')}`).toBe(true);
    }
  });
});

// ============================================================
// M2 · 武学与秘籍：学/招/运转/熟练度升级 + 原路折返
// 每用例独立世界（fresh），录像重放走一遍验收通关序列
// ============================================================

/** 客栈 → 武馆（东、南） */
async function gotoWuguan(): Promise<void> {
  await run('东');
  await run('南');
  expect(pos()).toBe('wuguan');
}

describe('侠客行 M2 · 武学与秘籍', () => {
  it('学秘籍：武馆地上有剑谱/心法，拿进背包学成，秘籍即焚', async () => {
    fresh();
    await gotoWuguan();
    expect(await run('look')).toContain('基础剑法');
    expect(await run('take 剑谱')).toContain('拿起了');
    expect(await run('learn 剑谱')).toContain('学会了');
    const arsenal = world.getComponent(player, Arsenal)!.arts;
    expect(arsenal.basic_sword).toEqual({ level: 1, exp: 0 });
    // 秘籍即焚：背包空了，再学一次会明说
    expect(itemsInContainer(world, player)).toHaveLength(0);
    expect(await run('learn 剑谱')).toContain('背包里没有');
  });

  it('武学一览与运转心法（打坐内力翻倍 + 心法熟练度每息增长）', async () => {
    fresh();
    expect(await run('武学')).toContain('开山拳');
    await gotoWuguan();
    await run('take 吐纳');
    await run('学 吐纳');
    expect(await run('运转 吐纳术')).toContain('运转');
    expect(world.getComponent(player, Channeling)!.artId).toBe('tuna');

    await run('回'); // 回客栈打坐
    await run('打坐');
    world.tick();
    drain();
    world.tick();
    drain();
    // 20 + 40×2 = 100（吐纳术 meditateBonus 2）
    expect(energy().current).toBe(100);
    // 心法熟练度每息 +1
    expect(world.getComponent(player, Arsenal)!.arts.tuna.exp).toBe(2);
  });

  it('战斗熟练度：自动选招直拳、升层解锁崩拳、use 崩拳耗内力提伤害', async () => {
    fresh();
    await gotoWolves();
    // level 1 时崩拳（tier 2）未解锁 → 明说
    expect(await run('使 崩拳 野狼')).toContain('没练成');
    // 直拳（自动选招）：身法差 0 → 全被格挡，每击 3 伤；命中 +1/击
    const outs: string[] = [];
    for (let i = 0; i < 8; i++) outs.push(await run('attack 野狼')); // 8 击 24 伤，+8 熟练 → 第 8 击后升 2 层
    outs.push(await run('attack 野狼')); // 第 9 击（此时自动选招已是崩拳）：狼倒地；击杀 +3
    const all = outs.join('\n');
    expect(all).toContain('悟出了新招式「崩拳」'); // 第 8 击后升 2 层解锁
    expect(all).toContain('轰然倒地');
    expect(all).toContain('一记「崩拳」'); // 击杀那击自动用了崩拳（内力够、系数最高）
    expect(world.getComponent(player, Arsenal)!.arts.kaishan_fist.level).toBe(2);
  });

  it('use 崩拳：耗内力、按系数结算伤害', async () => {
    fresh();
    await gotoWolves();
    await run('南'); // 密林→狼穴：两只狼，够打
    // 直接置 2 层（升层路径由上一用例覆盖），验证招式数值
    world.getComponent(player, Arsenal)!.arts.kaishan_fist.level = 2;
    const before = energy().current; // 20
    const hit = await run('使 崩拳 野狼');
    expect(hit).toContain('一记「崩拳」');
    // 身法差 0 → 被格挡：round(round(5×1.7−1)×0.7) = 6
    expect(hit).toContain('只造成 6 点伤害');
    expect(energy().current).toBe(before - 8);
  });

  it('验收通关序列全程录像重放一致（M2 验收）', async () => {
    fresh();
    const rec = record(world);
    const inputs = [
      '东', '南', 'take 剑谱', 'learn 剑谱',
      '南', '南', '南', '南', '南',
      'attack 野狼', 'attack 野狼', 'attack 野狼',
      'attack 野狼', 'attack 野狼', 'attack 野狼', 'attack 野狼',
      '使 崩拳 野狼', '回', '武学',
    ];
    for (const cmd of inputs) await rec.execute(cmd, player);

    const result = await verifyReplay(rec.stop(), () => bootstrap().world);
    expect(result.ok).toBe(true);
    expect(result.diff).toBeUndefined();
  });

  it('氛围：进房/look 后有时辰与天气行（派生只读，确定性）', async () => {
    fresh();
    const out = await run('look');
    const areaId = world.getRelations('inn', Area)[0] ?? 'inn';
    const expected = `时值${shichenOf(0, { dayLengthMs: 240_000 })}，${weatherLabel(weatherOf(areaId, 0, { segmentMs: 60_000 }))}。`;
    expect(out).toContain(expected); // time=0 → 子时；天气按区域+时段哈希
  });

  it('场景门控：attack/use 不许指自己；战斗中无法学武', async () => {
    fresh();
    await gotoWolves();
    expect(await run('attack 少年侠客')).toContain('你不能攻击自己');
    expect(await run('使 直拳 少年侠客')).toContain('你不能攻击自己');
    const learn = await run('learn 剑谱'); // 狼在身边 → 战斗中无法读书
    expect(learn).toContain('战斗中无法静心读书');
    // 脱战后（原路折回到武馆方向）即可读书（没秘籍会另说——门控先行）
  });
});

// ============================================================
// 沉浸支线（0.14）：狼巡逻/进退场播报/夜狼/雨滑/雪盲/夜嚎/死亡重生
// ============================================================

function drainText(): string {
  return drain();
}

describe('侠客行沉浸支线 · 世界活着', () => {
  it('狼巡逻：沿狼林三房轮换，不出界；进出玩家房间有播报', async () => {
    fresh();
    await gotoWolves(); // 玩家在 thicket，狼-1 也在 thicket
    expect(world.getComponent('wolf-1', Position)!.roomId).toBe('thicket');
    drain();
    // wander every:3000 → 网格首触在第 3 个 tick（round1,dir=south）：狼 thicket→den（玩家房离开）
    world.tick();
    world.tick();
    world.tick();
    expect(drainText()).toContain('往南离开了');
    expect(world.getComponent('wolf-1', Position)!.roomId).toBe('den');
    for (let i = 0; i < 6; i++) world.tick();
    drain();
    // bounded：狼不出狼林三房
    expect(['woodsgate', 'thicket', 'den']).toContain(world.getComponent('wolf-1', Position)!.roomId);
  });

  it('狼回到玩家房间 → 「从北面走了进来」', async () => {
    fresh();
    await gotoWolves();
    drain();
    world.tick(); // 狼去 woodsgate（r0 north）
    drain();
    world.tick(); // r0 仍 north?——exits 顺序轮换按 round;woodsgate round0 north→fringe 越界原地
    world.tick();
    drain();
    world.tick();
    drain();
    // 轮换推进后狼总会折返 thicket;找到回场播报
    let seen = drainText();
    for (let i = 0; i < 8 && !seen.includes('走了进来'); i++) {
      world.tick();
      seen = drainText();
    }
    expect(seen).toContain('走了进来');
  });

  it('夜间狼更凶：伤害 3 → 4', async () => {
    fresh();
    // 造一只伴身狼（无 Wander,不乱跑;时间推到夜:raw 7 = 140s,戌时）
    const wolf = world.entities.createWithId('test-wolf');
    world.addComponent(wolf, Name, { text: '灰狼', aliases: [] });
    world.addComponent(wolf, Retaliate);
    world.addComponent(wolf, Stats, { atk: 6, def: 2, dodge: 2 });
    world.addComponent(wolf, Health, { current: 50, max: 50 });
    world.addComponent(wolf, Position, { roomId: 'inn' });
    for (let i = 0; i < 140; i++) world.tick(); // t=140s → 戌时(夜)
    const hit = await run('attack 灰狼');
    // 玩家直拳:(5−2)×0.7 → 2;狼的**还手**带夜加成:(6+1−2)×0.7 → 4
    expect(hit).toContain('「灰狼」全力出手，被你格挡，只造成 4 点伤害');
  });

  it('雨天打滑：命中降档（hit → blocked）', async () => {
    fresh();
    // 找 woods 区域最近的 rain 时段,tick 到位
    const areaId = world.getRelations('inn', Area)[0] ?? 'inn';
    let rainTime = 0;
    for (let slot = 0; slot < 64; slot++) {
      if (weatherOf(areaId, slot * 60_000) === 'rain') { rainTime = slot * 60_000; break; }
    }
    const wolf = world.entities.createWithId('test-wolf');
    world.addComponent(wolf, Name, { text: '灰狼', aliases: [] });
    world.addComponent(wolf, Retaliate);
    world.addComponent(wolf, Stats, { atk: 6, def: 2, dodge: 2 });
    world.addComponent(wolf, Health, { current: 200, max: 200 });
    world.addComponent(wolf, Position, { roomId: 'inn' });
    world.getComponent(player, Stats)!.dodge = 4; // 白天 diff+2 → 命中
    drain();
    const hit = await run('attack 灰狼');
    expect(hit).toContain('命中');
    for (let i = 0; i < rainTime / 1000; i++) world.tick();
    drain();
    const wet = await run('attack 灰狼');
    expect(wet).toContain('格挡'); // 攻方身法-1 → diff 降档
  });

  it('雪盲：大雪时活体名单隐去', async () => {
    fresh();
    // 造一只伴身狼（雪盲只对“有活物的房间”有意义）
    const wolf = world.entities.createWithId('test-wolf');
    world.addComponent(wolf, Name, { text: '灰狼', aliases: [] });
    world.addComponent(wolf, Health, { current: 50, max: 50 });
    world.addComponent(wolf, Position, { roomId: 'inn' });
    const areaId = world.getRelations('inn', Area)[0] ?? 'inn';
    let snowTime = 0;
    for (let slot = 0; slot < 64; slot++) {
      if (weatherOf(areaId, slot * 60_000) === 'snow') { snowTime = slot * 60_000; break; }
    }
    for (let i = 0; i < snowTime / 1000; i++) world.tick();
    const out = await run('look');
    expect(out).toContain('大雪纷飞');
    expect(out).not.toContain('灰狼'); // 名单被雪遮住
  });

  it('夜嚎：狼林夜间追加远处狼嚎', async () => {
    fresh();
    await gotoWolves();
    for (let i = 0; i < 150; i++) world.tick(); // 推进到 150s → 戌时(夜,raw 7)
    drain();
    const out = await run('look');
    expect(out).toContain('远处传来狼嚎');
  });

  it('死亡重生：黑屏文案 → 客栈醒来，生命回满内力清零，来路清空', async () => {
    fresh();
    await gotoWolves();
    world.getComponent(player, Health)!.current = 6; // 三口就倒
    world.getComponent(player, Energy)!.current = 50;
    drain();
    // 玩家攻击(狼还手)互相磨:玩家 6 血,狼咬 blocked 3/次 → 两次还手后倒
    await run('attack 野狼');
    const out = await run('attack 野狼');
    expect(out + drainText()).toContain('眼前一黑');
    expect(pos()).toBe('inn');
    expect(hp()).toBe(100);
    expect(energy().current).toBe(0);
    expect(await run('回')).toContain('没有来路'); // 来路已断
  });
});
