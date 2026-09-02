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
  MovementSystem, DescriptionSystem, ItemSystem, Health, Position, Exits, Description,
  Located, Portable, GoCommand, createDirectionCommand, InventoryCommand, ScoreCommand,
  TakeCommand, DropCommand, LookCommand,
} from '@mud/prefabs';

const w = new World();
w.register(MovementSystem, DescriptionSystem, ItemSystem);
w.registerCommands(
  GoCommand, createDirectionCommand('north', ['north']), createDirectionCommand('south', ['south']),
  InventoryCommand, ScoreCommand, TakeCommand, DropCommand, LookCommand,
);
const p = w.entities.createWithId('player-1');
w.entities.addComponent(p, Health, { current: 100, max: 100 });
w.entities.addComponent(p, Position, { roomId: 'town' });
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
import { Health, Position, MovementSystem, GoCommand } from '@mud/prefabs';
// trait 定义类型可用
const hp = Health.create();
const p: number = hp.current;
const pos = Position.create();
void pos;
// 系统可直接注册
const w = new World();
w.register(MovementSystem);
w.registerCommands(GoCommand);
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
