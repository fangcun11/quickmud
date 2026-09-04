/**
 * 通关录像（`pnpm walk`）：八幕一路打到底，把每一步的输出原样打出来
 *
 * 和 `content.test.ts` 是同一条路线，区别在取向：
 * - 测试断言**状态**（水位、位置、血量），坏了就红；
 * - 这个脚本输出**文本**，用来看文案顺不顺、节奏对不对。
 *
 * 内容包改完先跑它——机制对了但读起来像机器吐的，照样不算做完。
 */
import { Position, areaEntityId } from '@mud/prefabs';
import { bootstrap } from './world/bootstrap';
import { Tide } from './world/tide';

const { world, playerId } = bootstrap();

const drain = () => {
  const t = world.output
    .getAll()
    .map((m) => m.segments.map((s) => s.text).join(''))
    .join('\n');
  world.output.clear();
  return t;
};

const level = () => world.getComponent(areaEntityId('cellar'), Tide)!.level;
const at = () => world.getComponent(playerId, Position)!.roomId;

/** 推进到目标水位（10 秒上限，防死循环） */
const untilTide = (target: number) => {
  for (let i = 0; i < 40 && level() !== target; i++) world.tick();
  drain();
};

const act = async (cmd: string) => {
  const r = await world.execute(cmd, playerId);
  const out = [r ?? '', drain()].filter(Boolean).join('\n');
  console.log(`\n> ${cmd}`);
  if (out) console.log(out);
};

const scene = (title: string) => console.log(`\n${'─'.repeat(46)}\n${title}`);

scene('第一幕 · 地面');
await act('look');
await act('worldmap');

scene('第二幕 · 下到地窖');
await act('east');
await act('down');
await act('map');

scene('第三幕 · 涨潮：蓄水池进不去了（canEnter）');
untilTide(2);
console.log(`[水位 ${level()}]`);
await act('south');
console.log(`[仍在 ${at()}]`);
await act('north'); // 台阶没有北出口 ⇒ 撞墙文案

scene('第四幕 · 涨到顶：退路封死（canLeave）');
untilTide(3);
console.log(`[水位 ${level()}]`);
await act('up');
console.log(`[仍在 ${at()}]`);

scene('第五幕 · 闸门房：房间命令改区域水位上限');
await act('east');
await act('turn');
await act('turn'); // state 记账：只拧得动一次
untilTide(1);

scene('第六幕 · 上钟楼敲钟');
await act('west');
await act('up');
await act('west');
await act('west');
await act('up');
await act('up');
await act('ring');
console.log(`[水位 ${level()}]`);

scene('第七幕 · 祭坛：firstEnter / look / take / leave');
await act('down');
await act('down');
await act('east');
await act('east');
await act('down');
await act('south');
await act('east');
await act('look');
await act('pray');
await act('take 祭器');
await act('inventory');

scene('第八幕 · 回地面，终局');
await act('west');
await act('north');
await act('up');
await act('west');
await act('worldmap');
