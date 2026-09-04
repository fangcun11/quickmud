#!/usr/bin/env node
/**
 * 文档示例验证脚本
 * 先对 docs/examples/*.mts 做 strict tsc 类型检查，再逐一运行（失败即退出非 0），
 * 保证使用指南不腐烂——"实测"必须同时覆盖类型与运行两个层面。
 * （03-test.test.ts 由引擎 vitest 直接执行，不在本脚本内）
 * 用法：node docs/examples/verify-doc-examples.mjs（仓库根目录）
 */
import { execSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const examplesDir = join(dirname(fileURLToPath(import.meta.url)));
const tsx = resolve(examplesDir, '../../example/demo-adventure/node_modules/tsx/dist/cli.mjs');
const tsc = resolve(examplesDir, '../../packages/engine/node_modules/typescript/bin/tsc');

let failed = 0;
const fail = (msg) => {
  failed++;
  console.error(`✗ ${msg}`);
};

// 0. 类型检查先行（strict 编译不过 = 文档示例失效）
console.log('▶ tsc 类型检查');
try {
  execSync(`node ${JSON.stringify(tsc)} -p tsconfig.json --noEmit`, { stdio: 'inherit', cwd: examplesDir });
  console.log('  tsc ✓');
} catch {
  fail('示例类型检查失败');
}

const files = readdirSync(examplesDir).filter((f) => f.endsWith('.mts'));

for (const file of files) {
  console.log(`\n▶ ${file}`);
  try {
    execSync(`node ${JSON.stringify(tsx)} ${JSON.stringify(join(examplesDir, file))}`, { stdio: 'inherit', cwd: examplesDir });
  } catch {
    fail(`${file} 运行失败`);
  }
}

if (failed) {
  console.error(`\n${failed} 项失败`);
  process.exit(1);
}
console.log('\n✅ 全部文档示例类型与运行双通过');

