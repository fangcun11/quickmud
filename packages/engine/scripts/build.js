import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';

// 运行时外部依赖：仅 Node 内置模块。
// 引擎零第三方依赖（确定性约束下 ID/随机/时钟全部自研或显式注入）。
const externals = ['fs/promises', 'fs', 'path', 'url', 'util'];

const shared = {
  bundle: true,
  target: 'es2022',
  sourcemap: true,
  external: externals,
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

  // testing 模块 ESM
  await build({
    ...shared,
    entryPoints: ['src/testing.ts'],
    format: 'esm',
    outfile: 'dist/testing.js',
  });

  // testing 模块 CJS
  await build({
    ...shared,
    entryPoints: ['src/testing.ts'],
    format: 'cjs',
    outfile: 'dist/testing.cjs',
  });

  // 修正 .d.ts 相对导入：补 .js 扩展名
  // tsc 对扩展名导入不重写，产物在 node16/nodenext 解析下会编译失败
  // （外部消费者契约测试发现的真实缺陷，见 scripts/contract-test.mjs）。
  // 0.11：同时处理裸 '..'/'.' 引用——tsc 对推断类型（无显式类型标注、
  // 类型经包入口 re-export）会生成 import("..")，而 ESM 解析不做
  // 目录→index 扩展，必须显式 ../index.js。
  const dtsFiles = (await fs.promises.readdir('dist', { recursive: true }))
    .filter((f) => f.endsWith('.d.ts'))
    .map((f) => path.join('dist', f));
  for (const file of dtsFiles) {
    const code = await fs.promises.readFile(file, 'utf-8');
    const fixed = code.replace(
      /(from\s+|import\s*\(\s*|import\s+)(['"])(\.\.?(?:\/[^'"]*)?)\2/g,
      (_, prefix, quote, spec) => {
        let withExt;
        if (spec === '..' || spec === '.') {
          withExt = `${spec}/index.js`;
        } else {
          withExt = spec.endsWith('.js') || spec.endsWith('.d.ts') ? spec : `${spec}.js`;
        }
        return `${prefix}${quote}${withExt}${quote}`;
      },
    );
    if (fixed !== code) {
      await fs.promises.writeFile(file, fixed, 'utf-8');
    }
  }

  console.log(`Build complete! (${dtsFiles.length} d.ts files patched)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
