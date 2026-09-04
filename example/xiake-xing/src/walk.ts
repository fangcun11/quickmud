/**
 * 通关录像（`pnpm walk`）：M0 版——从客栈一路走到狼穴再折返，看世界与文案
 *
 * 和 `content.test.ts` 是同一条路线，区别在取向：
 * - 测试断言**状态**（位置、地图亮区），坏了就红；
 * - 这个脚本输出**文本**，用来看文案顺不顺、节奏对不对。
 *
 * M0 没有战斗与打坐，这是一趟"走遍三区域"的彩排——M1 的野狼在狼穴等着。
 */
import { Position } from '@mud/prefabs';
import { bootstrap } from './world/bootstrap';

const { world, playerId } = bootstrap();

const drain = () => {
  const t = world.output
    .getAll()
    .map((m) => m.segments.map((s) => s.text).join(''))
    .join('\n');
  world.output.clear();
  return t;
};

const at = () => world.getComponent(playerId, Position)!.roomId;

const act = async (cmd: string) => {
  const r = await world.execute(cmd, playerId);
  const out = [r ?? '', drain()].filter(Boolean).join('\n');
  console.log(`\n> ${cmd}`);
  if (out) console.log(out);
};

const scene = (title: string) => console.log(`\n${'─'.repeat(46)}\n${title}`);

scene('第一幕 · 出生：悦来客栈');
await act('look');
await act('map');

scene('第二幕 · 逛镇：杂货铺、武馆');
await act('east');
await act('north');
await act('south');
await act('south');
await act('north');

scene('第三幕 · 出镇：镇口 → 南山道');
await act('east');
await act('south');
await act('look');

scene('第四幕 · 山道：松林道、山神庙');
await act('south');
await act('east');
await act('look');
await act('west');

scene('第五幕 · 林缘 → 野狼林');
await act('south');
await act('south');
await act('south');
await act('look');
await act('worldmap');

scene('第六幕 · 深入：密林 → 狼穴');
await act('south');
await act('south');
await act('look');
console.log(`[当前位置 ${at()}]`);

scene('第七幕 · 折返回客栈');
await act('north');
await act('north');
await act('north');
await act('north');
await act('north');
await act('north');
await act('west');
await act('west');
console.log(`[回到 ${at()}]`);
await act('map');
