/**
 * 侠客行 M0 冒烟测试 —— 走遍三区域
 *
 * M0 的验收不是"测游戏"，是**测骨架**：三区域 12 房连通、地图渲染正常、
 * prefabs 基础件在这个世界里拼得起来。时间无关（M0 没有 every 系统），
 * 无真实定时器、无 sleep。
 */
import { describe, it, expect, beforeAll } from 'vitest';
import type { World } from '@mud/ecs-engine';
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
      ' 青石镇\n    │\n终南山道\n    │\n 野狼林(你)',
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
      '青石镇(你)\n   │',
    );
  });
});
