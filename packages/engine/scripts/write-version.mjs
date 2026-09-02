#!/usr/bin/env node
/**
 * 从 package.json 读取 version 并生成 src/version.generated.ts。
 *
 * 保证版本号单一事实源：改 package.json 的 version，重建即全量生效
 * （快照 engineVersion / 渲染器欢迎语 / REPL 横幅）。
 *
 * 幂等：内容无变化时不重写文件（避免 watch 模式下的循环触发）。
 */
import { readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkgPath = resolve(__dirname, '../package.json');
const outPath = resolve(__dirname, '../src/version.generated.ts');

const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
const version = String(pkg.version ?? '0.0.0-dev');

const banner = `/**
 * 引擎版本 - 单一事实源
 *
 * 来源：packages/engine/package.json 的 version 字段。
 * 由 scripts/write-version.mjs 在构建/开发前生成，请勿手工编辑。
 */
`;

const next = `${banner}export const ENGINE_VERSION = '${version}';\n`;

let current = null;
try {
  current = readFileSync(outPath, 'utf-8');
} catch {
  // 首次生成
}

if (current !== next) {
  writeFileSync(outPath, next, 'utf-8');
  console.log(`version.generated.ts -> ${version}`);
}
