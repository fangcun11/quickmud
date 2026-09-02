#!/usr/bin/env node
/**
 * 外部消费者契约测试
 *
 * 验证 @mud/ecs-engine 以"全新安装"方式被外部项目消费时的契约：
 *   1. ESM：import 具名导出完整、运行时冒烟（World + defineCommand + SavePort round-trip）
 *   2. CJS：require 具名导出完整、可实例化
 *   3. 类型：defineCommand args 泛型推导、ParsedArgs、defineEvent 载荷类型在 strict tsc 下可用
 *
 * 用法：node scripts/contract-test.mjs  （在 packages/engine 目录下或仓库任意位置）
 * 退出码 0 = 契约成立；非 0 = 契约破坏。
 */
import { execSync } from 'node:child_process';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const engineDir = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const step = (msg) => console.log(`\n▶ ${msg}`);
const run = (cmd, opts = {}) =>
  execSync(cmd, { stdio: 'inherit', cwd: opts.cwd ?? engineDir, env: process.env });

let workspace;
try {
  // 1. pack
  step('pnpm pack 生成安装包');
  workspace = await mkdtemp(join(tmpdir(), 'mud-contract-'));
  const packDir = join(workspace, 'pack');
  await mkdir(packDir);
  run(`pnpm pack --pack-destination ${JSON.stringify(packDir)}`, { cwd: engineDir });
  const tgz = execSync('ls *.tgz', { cwd: packDir }).toString().trim();
  const tgzPath = join(packDir, tgz);
  console.log(`  打包产物: ${tgz}`);

  // 2. 全新安装消费工程
  step('全新消费工程 npm install');
  const consumer = join(workspace, 'consumer');
  await mkdir(consumer);
  await writeFile(
    join(consumer, 'package.json'),
    JSON.stringify({ name: 'contract-consumer', type: 'module', private: true }, null, 2),
  );
  run(`npm install --no-audit --no-fund ${JSON.stringify(tgzPath)} typescript@5.4`, {
    cwd: consumer,
  });

  // 3. ESM 运行时冒烟
  step('ESM 运行时冒烟');
  await writeFile(
    join(consumer, 'smoke-esm.mjs'),
    `import { World, Name, trait, defineEvent, defineSystem, defineCommand, SavePort, FsBackend } from '@mud/ecs-engine';
import assert from 'node:assert';
import { join } from 'node:path';

const Health = trait('health', () => ({ current: 100, max: 100 }));
const Heal = defineEvent('heal')();

const HealSystem = defineSystem({
  name: 'heal',
  on: [Heal.token],
  priority: 10,
  handle(event, ctx) {
    const h = ctx.getComponent(event.data.target, Health);
    if (h) h.current = Math.min(h.max, h.current + event.data.amount);
  },
});

// args 泛型推导：此处 minutes 应为 string，无断言
const Rest = defineCommand({
  verbs: ['rest'],
  args: { minutes: { type: 'word' } },
  handle({ args, player, world }) {
    const amount = Number(args.minutes) || 10;
    world.emit(Heal, { target: player, amount });
    return null;
  },
});

const world = new World();
world.register(HealSystem);
world.registerCommands(Rest);
const player = world.entities.createWithId('hero-001');
world.entities.addComponent(player, Health, { current: 50, max: 100 });
world.entities.addComponent(player, Name, { text: '勇者', aliases: [] });

const before = world.entities.getComponent(player, Health).current;
const out = await world.execute('rest 30', player);
assert.strictEqual(out, null, '命令返回 null，输出走事件链');
const after = world.entities.getComponent(player, Health).current;
assert.ok(after > before, \`治疗生效 \${before} -> \${after}\`);

// 存档 round-trip
const saveFile = join(process.cwd(), 'save-contract.json');
const port = new SavePort(new FsBackend(), '0.0.0-test');
await port.save(saveFile, world.createSnapshot());
const loaded = await port.load(saveFile);
assert.strictEqual(loaded.engineVersion, '0.0.0-test');
console.log('ESM 契约 ✓');
`,
  );
  run('node smoke-esm.mjs', { cwd: consumer });

  // 4. CJS require 检查
  step('CJS require 检查');
  await writeFile(
    join(consumer, 'smoke-cjs.cjs'),
    `const engine = require('@mud/ecs-engine');
const assert = require('node:assert');
for (const name of ['World', 'trait', 'defineEvent', 'defineSystem', 'defineCommand', 'SavePort', 'FsBackend']) {
  assert.strictEqual(typeof engine[name], 'function', \`missing export: \${name}\`);
}
const world = new engine.World({ seed: 1 });
assert.ok(world, 'CJS 可实例化');
console.log('CJS 契约 ✓');
`,
  );
  run('node smoke-cjs.cjs', { cwd: consumer });

  // 5. 类型契约（strict tsc）
  step('TS strict 类型契约');
  await writeFile(
    join(consumer, 'contract.ts'),
    `import { defineCommand, defineEvent, trait, type ParsedArgs } from '@mud/ecs-engine';

const Health = trait('health', () => ({ current: 100, max: 100 }));
const Look = defineEvent('look')<{ entity: string; target?: string }>();

// 字面量不拓宽：args 推导出精确类型
const LookCommand = defineCommand({
  verbs: ['look'],
  args: { target: { type: 'optional_entity' }, dir: { type: 'direction' } },
  handle({ args, world, player }) {
    // args.target: string | null；args.dir: string —— 无需断言
    const t: string | null = args.target;
    const d: string = args.dir;
    world.emit(Look, { entity: player, target: t ?? undefined });
  },
});

// ParsedArgs 类型可独立使用
type LookArgs = ParsedArgs<{ target: { type: 'optional_entity' } }>;
const probe: LookArgs = { target: null };
void probe;
void LookCommand;
void Health;
`,
  );
  await writeFile(
    join(consumer, 'tsconfig.contract.json'),
    JSON.stringify(
      {
        compilerOptions: {
          strict: true,
          noEmit: true,
          module: 'Node16',
          moduleResolution: 'Node16',
          target: 'ES2022',
          skipLibCheck: false,
        },
        include: ['contract.ts'],
      },
      null,
      2,
    ),
  );
  run('node_modules/.bin/tsc -p tsconfig.contract.json', { cwd: consumer });

  console.log('\n✅ 外部消费者契约测试全部通过');
} finally {
  if (workspace) await rm(workspace, { recursive: true, force: true });
}
