/**
 * @mud/prefabs 构建：tsc（前置，产出 js+d.ts）→ esbuild 双格式 bundle → d.ts 扩展名后处理
 *
 * 与 packages/engine/scripts/build.js 同源（d.ts patch 正则保持一致）。
 * 区别：额外 external @mud/ecs-engine（保持运行时外部依赖）。
 */
import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';

const external = ['@mud/ecs-engine'];

const shared = {
  bundle: true,
  target: 'es2022',
  sourcemap: true,
  external,
  platform: 'node',
};

async function main() {
  // 主入口 ESM
  await build({
    ...shared,
    entryPoints: ['src/index.ts'],
    format: 'esm',
    outfile: 'dist/index.js',
  });

  // 主入口 CJS
  await build({
    ...shared,
    entryPoints: ['src/index.ts'],
    format: 'cjs',
    outfile: 'dist/index.cjs',
  });

  // 修正 .d.ts 相对导入：补 .js 扩展名（node16/nodenext 解析要求，
  // 由外部消费者契约测试保证，与 engine 的 build 脚本同一策略）。
  const dtsFiles = (await fs.promises.readdir('dist', { recursive: true }))
    .filter((f) => f.endsWith('.d.ts'))
    .map((f) => path.join('dist', f));
  for (const file of dtsFiles) {
    const code = await fs.promises.readFile(file, 'utf-8');
    const fixed = code.replace(
      /(from\s+|import\s*\(\s*|import\s+)(['"])(\.\.?\/[^'"]+)\2/g,
      (_, prefix, quote, spec) => {
        const withExt = spec.endsWith('.js') || spec.endsWith('.d.ts') ? spec : `${spec}.js`;
        return `${prefix}${quote}${withExt}${quote}`;
      },
    );
    if (fixed !== code) {
      await fs.promises.writeFile(file, fixed, 'utf-8');
    }
  }

  console.log(`prefabs build complete! (${dtsFiles.length} d.ts files patched)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
