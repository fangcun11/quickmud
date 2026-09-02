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
  MovementSystem, DescriptionSystem, Health, Position, Exits, Description,
  GoCommand, createDirectionCommand, InventoryCommand, ScoreCommand,
} from '@mud/prefabs';

const w = new World();
w.register(MovementSystem, DescriptionSystem);
w.registerCommands(GoCommand, createDirectionCommand('north', ['north']), InventoryCommand, ScoreCommand);
const p = w.entities.createWithId('player-1');
w.entities.addComponent(p, Health, { current: 100, max: 100 });
w.entities.addComponent(p, Position, { roomId: 'town' });
const town = w.entities.createWithId('town');
w.entities.addComponent(town, Name, { text: '城镇' });
w.entities.addComponent(town, Description, { text: '小镇广场。' });
w.entities.addComponent(town, Exits, { north: 'tavern' });
const tavern = w.entities.createWithId('tavern');
w.entities.addComponent(tavern, Name, { text: '酒馆' });
w.entities.addComponent(tavern, Exits, {});
await w.execute('north', p);
if (w.entities.getComponent(p, Position)?.roomId !== 'tavern') throw new Error('ESM 移动契约失败');
const lines = w.output.getAll().map(m => m.segments.map(s => s.text).join(''));
if (!lines.some(l => l.includes('酒馆'))) throw new Error('ESM 描述契约失败');
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
