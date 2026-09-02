import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, '../../..');

/**
 * 单 HTML 构建脚本
 *
 * 将引擎 + 内容 + 渲染器打包为一个自包含的 HTML 文件。
 *
 * 用法：
 *   node scripts/build-html.js <入口文件> <输出文件>
 *
 * 示例：
 *   node scripts/build-html.js ../../example/demo-adventure/src/main-web.ts dist/game.html
 */
async function main() {
  const args = process.argv.slice(2);
  const entryFile = resolve(args[0] ?? '../../example/demo-adventure/src/main-web.ts');
  const outputFile = resolve(args[1] ?? '../../example/demo-adventure/dist/game.html');
  const templateFile = resolve(__dirname, '../../web-client/src/template.html');

  console.log(`Building single HTML...`);
  console.log(`  Entry:  ${entryFile}`);
  console.log(`  Output: ${outputFile}`);

  // 1. 用 esbuild 打包为 IIFE
  const result = await build({
    entryPoints: [entryFile],
    bundle: true,
    format: 'iife',
    target: 'es2022',
    platform: 'browser',
    write: false,
    minify: false,
    sourcemap: false,
    // node: 前缀与无前缀都要 external（FsBackend 用 import('node:path') 形式；
    // 浏览器端只走 LocalStorageBackend，FsBackend 分支运行时永不触发）
    external: ['fs/promises', 'fs', 'path', 'node:path', 'node:fs/promises'],
    alias: {
      '@mud/ecs-engine': resolve(rootDir, 'packages/engine/src/index.ts'),
      '@mud/prefabs': resolve(rootDir, 'packages/prefabs/src/index.ts'),
      '@mud/web-client': resolve(rootDir, 'packages/web-client/src/index.ts'),
    },
    define: {
      'process.env.NODE_ENV': '"production"',
    },
  });

  const bundleCode = result.outputFiles[0].text;

  // 2. 读取 HTML 模板
  let html;
  try {
    html = readFileSync(templateFile, 'utf-8');
  } catch {
    // 如果模板不存在，使用内联模板
    html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>MUD 文字游戏</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body { height: 100%; overflow: hidden; }
  </style>
</head>
<body>
  <div id="app"></div>
  <script>
    // __MUD_BUNDLE__
  </script>
</body>
</html>`;
  }

  // 3. 注入 bundle
  html = html.replace('// __MUD_BUNDLE__', bundleCode);

  // 4. 写入输出文件
  const outDir = dirname(outputFile);
  mkdirSync(outDir, { recursive: true });
  writeFileSync(outputFile, html, 'utf-8');

  const sizeKB = (Buffer.byteLength(html) / 1024).toFixed(1);
  console.log(`Done! Output: ${outputFile} (${sizeKB} KB)`);
}

main().catch((err) => {
  console.error('Build failed:', err);
  process.exit(1);
});
