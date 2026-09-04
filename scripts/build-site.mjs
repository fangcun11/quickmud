#!/usr/bin/env node
/**
 * 组装 GitHub Pages 站点
 *
 * 把各网页版示例的单文件构建（dist/game.html）收进 site/，并生成着陆页。
 * CI（Pages workflow）与本地均可运行：node scripts/build-site.mjs（仓库根目录）。
 * 网页版构建先于本脚本：pnpm --filter demo-adventure build && pnpm --filter xiake-xing build
 */
import { copyFileSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const siteDir = join(rootDir, 'site');

// 与 README 的示例简介保持同一口径；新增网页版示例时在此追加即可
const GAMES = [
  {
    id: 'xiake-xing',
    name: '侠客行',
    tag: '武侠 · 文字 RPG',
    blurb: '青石镇 → 终南山道 → 野狼林。打坐练内力，纯公式三态回合制战斗，倒下的野狼会掉狼皮。',
    hint: '支持口语方向词：往东 / 东边 / 朝东都行；打坐回气，受击打断。',
  },
  {
    id: 'demo-adventure',
    name: '能力演示',
    tag: '对话树 · 物品 · 开发者命令',
    blurb: '引擎能力一览：对话分支与记忆、可拾取物品、/dev 系开发者命令——终端 REPL 的同款体验。',
    hint: '输入 help 看指令；/dev-help 看开发者命令。',
  },
];

for (const game of GAMES) {
  const html = join(rootDir, 'example', game.id, 'dist', 'game.html');
  if (!existsSync(html)) {
    console.error(`✗ 缺少 ${game.id} 的网页版构建：${html}`);
    console.error('  先运行 pnpm --filter ' + game.id + ' build');
    process.exit(1);
  }
  mkdirSync(join(siteDir, game.id), { recursive: true });
  copyFileSync(html, join(siteDir, game.id, 'index.html'));
  console.log(`✓ ${game.id}/index.html`);
}

const card = (g) => `    <a class="card" href="${g.id}/">
      <div class="card-head"><span class="name">${g.name}</span><span class="tag">${g.tag}</span></div>
      <p>${g.blurb}</p>
      <p class="hint">${g.hint}</p>
      <span class="play">进入游戏 →</span>
    </a>`;

const index = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>quickmud · 在线试玩</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    background: #0d1117; color: #c9d1d9;
    font-family: "Segoe UI", "Microsoft YaHei", system-ui, sans-serif;
    line-height: 1.7; min-height: 100vh;
  }
  .wrap { max-width: 680px; margin: 0 auto; padding: 48px 24px 40px; }
  header h1 {
    font-family: Consolas, "Courier New", monospace;
    color: #58a6ff; font-size: 28px; letter-spacing: 1px;
  }
  header .tagline { color: #8b949e; margin-top: 6px; font-size: 14px; }
  main { margin-top: 36px; display: grid; gap: 16px; }
  .card {
    display: block; text-decoration: none; color: inherit;
    background: #161b22; border: 1px solid #30363d; border-radius: 10px;
    padding: 20px 22px; transition: border-color .15s, transform .15s;
  }
  .card:hover { border-color: #58a6ff; transform: translateY(-2px); }
  .card-head { display: flex; align-items: baseline; gap: 10px; margin-bottom: 8px; }
  .card .name { font-size: 18px; font-weight: 600; color: #e6edf3; }
  .card .tag { font-size: 12px; color: #58a6ff; border: 1px solid #30363d; border-radius: 999px; padding: 1px 10px; }
  .card p { font-size: 14px; color: #adbac7; }
  .card .hint { color: #8b949e; font-size: 13px; margin-top: 4px; }
  .card .play { display: inline-block; margin-top: 10px; color: #58a6ff; font-size: 14px; }
  .notes {
    background: #161b22; border: 1px solid #30363d; border-radius: 10px;
    padding: 20px 22px; font-size: 14px;
  }
  .notes h2 { font-size: 14px; color: #e6edf3; margin-bottom: 8px; }
  .notes ul { padding-left: 20px; color: #8b949e; }
  .notes li { margin: 4px 0; }
  .notes code {
    font-family: Consolas, "Courier New", monospace; font-size: 13px;
    background: #0d1117; border: 1px solid #30363d; border-radius: 4px; padding: 1px 5px;
  }
  footer { margin-top: 32px; text-align: center; font-size: 13px; color: #8b949e; }
  footer a { color: #58a6ff; text-decoration: none; }
  footer a:hover { text-decoration: underline; }
</style>
</head>
<body>
  <div class="wrap">
    <header>
      <h1>quickmud</h1>
      <p class="tagline">单机 · 事件驱动 · ECS 架构的 TypeScript 文字 MUD 引擎 —— 确定性可重放，存档、回滚、录像重放都是同一件事的副产品</p>
    </header>
    <main>
${GAMES.map(card).join('\n')}
      <section class="notes">
        <h2>说明</h2>
        <ul>
          <li>游戏完全运行在你的浏览器里，进度自动存入 localStorage——刷新或下次打开可接着玩；「重开」两段确认后清档。</li>
          <li>输入 <code>help</code> 查看命令；输入时输入框上方会弹命令补全，<code>Tab</code> 或点击补进输入框。</li>
          <li>仓库内另有终端示例 mini-rpg、tide-cellar，需本地 pnpm 运行，见仓库 README。</li>
        </ul>
      </section>
    </main>
    <footer>
      <a href="https://github.com/fangcun11/quickmud">GitHub 仓库</a> ·
      <a href="https://github.com/fangcun11/quickmud/tree/main/docs/guide">渐进式指南</a> ·
      MIT License
    </footer>
  </div>
</body>
</html>
`;

writeFileSync(join(siteDir, 'index.html'), index);
console.log(`✓ index.html（着陆页）`);
console.log(`站点组装完成：${siteDir}`);
