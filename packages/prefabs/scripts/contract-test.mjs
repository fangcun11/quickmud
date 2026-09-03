#!/usr/bin/env node
/**
 * @mud/prefabs 外部消费者契约测试
 *
 * 验证 prefabs 以"全新安装"方式被外部项目消费时的契约：
 *   1. ESM：import 具名导出完整、运行时冒烟（移动一个完整小世界）
 *   2. CJS：require 具名导出完整、可实例化
 *   3. 类型：traits/命令/系统类型在 strict tsc 下可用
 *
 * 用法：node scripts/contract-test.mjs
 * 退出码 0 = 契约成立；非 0 = 契约破坏。
 */
import { execSync } from 'node:child_process';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const pkgDir = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const engineDir = resolve(pkgDir, '..', 'engine');
const step = (msg) => console.log(`\n▶ ${msg}`);
const run = (cmd, opts = {}) =>
  execSync(cmd, { stdio: 'inherit', cwd: opts.cwd ?? pkgDir, env: process.env });

let workspace;
try {
  // 1. pack（prefabs 与其依赖 engine 都要打包，consumer 全新安装两者）
  step('pnpm pack 生成安装包');
  workspace = await mkdtemp(join(tmpdir(), 'mud-prefabs-contract-'));
  const packDir = join(workspace, 'pack');
  await mkdir(packDir);
  run(`pnpm pack --pack-destination ${JSON.stringify(packDir)}`, { cwd: pkgDir });
  const tgz = execSync('ls *.tgz', { cwd: packDir }).toString().trim();
  const tgzPath = join(packDir, tgz);
  run(`pnpm pack --pack-destination ${JSON.stringify(packDir)}`, { cwd: engineDir });
  const engineTgz = execSync('ls *.tgz', { cwd: packDir })
    .toString()
    .trim()
    .split('\n')
    .find((f) => f.includes('ecs-engine'));
  const engineTgzPath = join(packDir, engineTgz);
  console.log(`  打包产物: ${tgz} + ${engineTgz}`);

  // 2. 全新安装消费工程
  step('全新消费工程 npm install');
  const consumer = join(workspace, 'consumer');
  await mkdir(consumer);
  await writeFile(
    join(consumer, 'package.json'),
    JSON.stringify({ name: 'prefabs-consumer', private: true, type: 'module' }),
  );
  run(
    `npm install --no-audit --no-fund ${JSON.stringify(tgzPath)} ${JSON.stringify(engineTgzPath)} typescript@5.4`,
    { cwd: consumer },
  );

  // 3. ESM 运行时冒烟：移动一个小世界
  step('ESM 运行时冒烟');
  await writeFile(
    join(consumer, 'smoke.mjs'),
    `
import { World, Name } from '@mud/ecs-engine';
import {
  MovementSystem, DescriptionSystem, ItemSystem, CombatSystem, LootSystem, DeathSystem, QuestSystem,
  BuffSystem, BuffCleanupSystem,
  Health, Position, Exits, Description, Located, Portable, Loot, QuestGiver, QuestLog,
  Afflicted, buffBlueprint, Visited, VisitationSystem, MapCommand, Coordinates,
  defineRoom, layoutRooms, buildRooms, renderAsciiMap, markVisited,
  GoCommand, createDirectionCommand, InventoryCommand, ScoreCommand,
  TakeCommand, DropCommand, LookCommand, AttackCommand, QuestCommand, TurnInCommand,
} from '@mud/prefabs';

const w = new World();
w.register(MovementSystem, DescriptionSystem, ItemSystem, CombatSystem, LootSystem, DeathSystem, QuestSystem, BuffSystem, BuffCleanupSystem, VisitationSystem);
w.registerCommands(
  GoCommand, createDirectionCommand('north', ['north']), createDirectionCommand('south', ['south']),
  InventoryCommand, ScoreCommand, TakeCommand, DropCommand, LookCommand, AttackCommand,
  QuestCommand, TurnInCommand, MapCommand,
);
const p = w.entities.createWithId('player-1');
w.entities.addComponent(p, Health, { current: 100, max: 100 });
w.entities.addComponent(p, Position, { roomId: 'town' });
w.entities.addComponent(p, QuestLog);
const town = w.entities.createWithId('town');
w.entities.addComponent(town, Name, { text: '城镇' });
w.entities.addComponent(town, Description, { text: '小镇广场。' });
w.entities.addComponent(town, Exits, { north: 'tavern' });
const tavern = w.entities.createWithId('tavern');
w.entities.addComponent(tavern, Name, { text: '酒馆' });
w.entities.addComponent(tavern, Exits, { south: 'town' });
// 实体物品：地上有一把剑
const sword = w.entities.createWithId('sword');
w.entities.addComponent(sword, Name, { text: '生锈的剑', aliases: ['剑', 'sword'] });
w.entities.addComponent(sword, Portable);
w.entities.addComponent(sword, Located, { at: 'town' });

await w.execute('north', p);
if (w.entities.getComponent(p, Position)?.roomId !== 'tavern') throw new Error('ESM 移动契约失败');
const lines = w.output.getAll().map(m => m.segments.map(s => s.text).join(''));
if (!lines.some(l => l.includes('酒馆'))) throw new Error('ESM 描述契约失败');
// 0.3-C 物品链路：返回城镇 → take → inventory → drop → look 房间物品可见
await w.execute('south', p);
if (w.entities.getComponent(p, Position)?.roomId !== 'town') throw new Error('ESM 返回失败');
w.output.clear();
await w.execute('take 剑', p);
if (w.entities.getComponent(sword, Located)?.at !== p) throw new Error('ESM take 契约失败');
const inv = await w.execute('inventory', p);
if (!inv.includes('生锈的剑')) throw new Error('ESM inventory 契约失败: ' + inv);
await w.execute('drop 剑', p);
if (w.entities.getComponent(sword, Located)?.at !== 'town') throw new Error('ESM drop 契约失败');
w.output.clear();
await w.execute('look', p);
const lines2 = w.output.getAll().map(m => m.segments.map(s => s.text).join(''));
if (!lines2.some(l => l.includes('生锈的剑'))) throw new Error('ESM look 物品列表契约失败');
// v0.6 战斗 + 掉落 + 任务：酒保悬赏杀狗 → 击杀 → 掉狗肉 → 回酒馆交任务领奖
const barman = w.entities.createWithId('barman');
w.entities.addComponent(barman, Name, { text: '酒保' });
w.entities.addComponent(barman, Located, { at: 'tavern' });
w.entities.addComponent(barman, QuestGiver, {
  quests: [{
    id: 'dog-hunt',
    title: '除掉野狗',
    objective: { type: 'kill', target: '野狗', count: 1 },
    reward: { items: [{ name: '麦酒' }], heal: 10 },
  }],
});
const mob = w.entities.createWithId('mob');
w.entities.addComponent(mob, Name, { text: '野狗', aliases: ['狗'] });
w.entities.addComponent(mob, Position, { roomId: 'town' });
w.entities.addComponent(mob, Health, { current: 20, max: 20 });
w.entities.addComponent(mob, Loot, { drops: [{ name: '狗肉' }] });
await w.execute('attack 野狗', p);
await w.execute('attack 野狗', p);
if (w.entities.has('mob')) throw new Error('ESM attack/死亡契约失败');
// 掉落：狗肉实体落到城镇容器，且能被拾取
const dropped = w.entities.findByComponent(Located).filter(
  (id) => w.entities.getComponent(id, Located)?.at === 'town' && id !== 'sword',
);
if (dropped.length !== 1) throw new Error('ESM 掉落数量契约失败: ' + dropped.length);
const meat = dropped[0];
await w.execute('take 狗肉', p);
if (w.entities.getComponent(meat, Located)?.at !== p) throw new Error('ESM 掉落物拾取契约失败');
// 任务：kill 目标达成（玩家此时在城镇，酒保在酒馆 → 进度仍应记上）
const log = w.entities.getComponent(p, QuestLog);
if (log.active['dog-hunt'] !== 1 || !log.completed.includes('dog-hunt')) {
  throw new Error('ESM 任务进度契约失败: ' + JSON.stringify(log));
}
// 交付：必须回到酒保身边
if (!(await w.execute('turnin', p)).includes('没有可交付')) {
  throw new Error('ESM 跨房间交付不应成功');
}
await w.execute('north', p);
await w.execute('turnin', p);
if (!w.entities.getComponent(p, QuestLog).turnedIn.includes('dog-hunt')) {
  throw new Error('ESM turnin 契约失败');
}
const bag = await w.execute('inventory', p);
if (!bag.includes('麦酒')) throw new Error('ESM 任务奖励契约失败: ' + bag);
// v0.7 buff 链路：毒上低血怪 → 手动 tick 推进世界时间 → 毒杀走完整死亡管线
// （掉落照常、victim 身上的 buff 被清干净、killer 归属 source）
const rat = w.entities.createWithId('rat');
w.entities.addComponent(rat, Name, { text: '毒鼠' });
w.entities.addComponent(rat, Position, { roomId: 'town' });
w.entities.addComponent(rat, Health, { current: 8, max: 8 });
w.entities.addComponent(rat, Loot, { drops: [{ name: '鼠尾草' }] });
w.spawn(buffBlueprint({
  victim: rat,
  effect: { type: 'damage', amount: 3, every: 1000 },
  lasts: 10000,
  source: p,
}));
for (let i = 0; i < 12; i++) w.tick(); // t=6000：激活(1000) + 结算三次(2000/3000/4000 归零)
if (w.entities.has('rat')) throw new Error('ESM 毒杀契约失败');
const herbs = w.entities.findByComponent(Located).filter(
  (id) => w.entities.getComponent(id, Located)?.at === 'town' && id !== 'sword',
);
if (herbs.length !== 1) throw new Error('ESM 毒杀掉落契约失败: ' + herbs.length);
const leftovers = w.entities.findByComponent(Afflicted).filter(
  (id) => w.entities.getComponent(id, Afflicted)?.victim === 'rat',
);
if (leftovers.length !== 0) throw new Error('ESM buff 清理契约失败');
// v0.8 房间定义与地图：defineRoom/layoutRooms/buildRooms 坐标推断 + renderAsciiMap + map 命令
// 拓扑写错（如反向出口不自洽）必须在定义期 fail-fast
let threw = false;
try {
  layoutRooms([
    defineRoom({ id: 'x', name: 'X', description: '', exits: { east: 'y' } }),
    defineRoom({ id: 'y', name: 'Y', description: '', exits: { east: 'x' } }),
  ], { entry: 'x' });
} catch (err) { threw = true; }
if (!threw) throw new Error('ESM 拓扑冲突 fail-fast 契约失败');
const layout = layoutRooms([
  defineRoom({ id: 'plaza', name: '广场', description: '一个广场。', exits: { east: 'shop' } }),
  defineRoom({ id: 'shop', name: '商店', description: '一家小店。', exits: { west: 'plaza' } }),
], { entry: 'plaza' });
buildRooms(w, layout);
if (w.entities.getComponent('plaza', Coordinates)?.x !== 0) throw new Error('ESM buildRooms 坐标契约失败');
// map 命令：无 Visited → 全图；玩家当前不在图内则没有 @
const mapOut = await w.execute('map', p);
if (!mapOut.includes('·—·') || !mapOut.includes('图例')) throw new Error('ESM map 契约失败: ' + mapOut);
// 迷雾：只画去过的房间
const fog = renderAsciiMap(layout.rooms, { visited: ['plaza'] });
if (fog !== '·') throw new Error('ESM renderAsciiMap 迷雾契约失败: ' + fog);
console.log('ESM 契约 ✓');
`,
  );
  run('node smoke.mjs', { cwd: consumer });

  // 4. CJS require 检查
  step('CJS require 检查');
  await writeFile(
    join(consumer, 'smoke.cjs'),
    `
const engine = require('@mud/ecs-engine');
const prefabs = require('@mud/prefabs');
if (!prefabs.Health || !prefabs.MovementSystem || !prefabs.GoCommand) throw new Error('CJS 导出缺失');
if (typeof prefabs.buffBlueprint !== 'function') throw new Error('CJS buffBlueprint 导出缺失');
if (typeof prefabs.layoutRooms !== 'function' || typeof prefabs.renderAsciiMap !== 'function') throw new Error('CJS 房间/地图导出缺失');
if (typeof prefabs.MapCommand !== 'object' || typeof prefabs.VisitationSystem !== 'object') throw new Error('CJS 地图命令/系统导出缺失');
if (typeof prefabs.Health.create !== 'function') throw new Error('CJS 无法构造');
console.log('CJS 契约 ✓');
`,
  );
  run('node smoke.cjs', { cwd: consumer });

  // 5. TS strict 类型契约
  step('TS strict 类型契约');
  await writeFile(
    join(consumer, 'tsconfig.contract.json'),
    JSON.stringify({
      compilerOptions: {
        strict: true,
        module: 'nodenext',
        moduleResolution: 'nodenext',
        target: 'es2022',
        noEmit: true,
        skipLibCheck: true,
      },
      include: ['usage.ts'],
    }),
  );
  await writeFile(
    join(consumer, 'usage.ts'),
    `
import { World, trait } from '@mud/ecs-engine';
import {
  Health, Position, MovementSystem, GoCommand, buffBlueprint,
  defineRoom, layoutRooms, renderAsciiMap,
} from '@mud/prefabs';
// trait 定义类型可用
const hp = Health.create();
const p: number = hp.current;
const pos = Position.create();
void pos;
// 系统可直接注册
const w = new World();
w.register(MovementSystem);
w.registerCommands(GoCommand);
// v0.7 buff 蓝图类型可用
const bp = buffBlueprint({
  victim: 'some-entity',
  effect: { type: 'damage', amount: 1, every: 1000 },
  lasts: 5000,
});
void bp;
// v0.8 房间定义 + 布局 + 渲染类型可用
const layout = layoutRooms(
  [defineRoom({ id: 'r1', name: '一', description: '', exits: { east: 'r2' } })],
  { entry: 'r1' },
);
const mapStr: string = renderAsciiMap(layout.rooms, { visited: ['r1'] });
void mapStr;
// 类型错误必须被捕获（此文件不应出现编译错误）
export const _check: number = p;
`,
  );
  run('node_modules/.bin/tsc -p tsconfig.contract.json', { cwd: consumer });

  step('✅ 外部消费者契约测试全部通过');
  await rm(workspace, { recursive: true, force: true });
} catch (err) {
  if (workspace) {
    console.error(`\n失败现场保留在：${workspace}`);
  }
  process.exit(1);
}
