#!/usr/bin/env node
/**
 * 文档示例验证脚本
 * 逐一运行 docs/examples/*.mts，失败即退出非 0，保证使用指南不腐烂。
 * （03-test.test.ts 由引擎 vitest 直接执行，不在本脚本内）
 * 用法：node docs/examples/verify-doc-examples.mjs（仓库根目录）
 */
import { execSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const examplesDir = join(dirname(fileURLToPath(import.meta.url)));
const tsx = resolve(examplesDir, '../../example/demo-adventure/node_modules/.bin/tsx');
const files = readdirSync(examplesDir).filter((f) => f.endsWith('.mts'));

let failed = 0;
for (const file of files) {
  console.log(`\n▶ ${file}`);
  try {
    execSync(`${tsx} ${join(examplesDir, file)}`, { stdio: 'inherit', cwd: examplesDir });
  } catch {
    failed++;
    console.error(`✗ ${file} 失败`);
  }
}

if (failed) {
  console.error(`\n${failed} 个示例失败`);
  process.exit(1);
}
console.log('\n✅ 全部文档示例实测通过');
