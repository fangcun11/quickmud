# 贡献指南

欢迎 Issue 与 PR。这是一套**确定性优先**的引擎，下面的规矩大多是为了守住确定性——
它们看起来啰嗦，但每一条背后都有一次踩坑。

## 环境

- Node.js ≥ 18，pnpm 8（仓库已锁定 `packageManager` 字段）
- `pnpm install`

## 提交前跑通这四条

```bash
pnpm build                                   # 构建两包
pnpm test                                    # engine / prefabs / mini-rpg 单测
pnpm test:contract                           # ESM + CJS + TS strict 契约
node docs/examples/verify-doc-examples.mjs   # 文档示例：类型检查 + 实际运行
pnpm lint                                    # eslint
```

CI 会在 Node 18/20/22 上跑同样的一组命令。

## 铁律

1. **命令不改状态，系统不解析输入。** 命令只 `emit` 事件，系统是唯一改状态的地方。
2. **引擎内禁用 `Math.random` / `Date.now` / `crypto`。** 需要随机就注入种子，
   需要时间就走 `clock`（ESLint 会拦，但请别想着绕过去）。
3. **给玩家看的文字一律走 `ctx.output`。** 系统里不要 `console.log`——
   否则快照、录像、多端渲染全废。
4. **引擎不内置领域内容。** "房间""背包"属于 `@mud/prefabs`。
   一个 PR 如果往引擎里塞了游戏概念，会被打回。
5. **冲突在定义期 fail-fast。** 宁可启动时崩溃，也不要运行时静默出错。

## 改了什么就补什么

| 改动 | 必须同步 |
| --- | --- |
| 新增/修改公开 API | 契约测试（`scripts/contract-test.mjs`）+ 对应包 README |
| 新增能力 | 文档示例（`docs/examples/NN-*.mts`）+ 单测 |
| 行为变更 | `CHANGELOG.md` 的 Unreleased 段落 |
| 任何文档里的代码块 | 它是被机器验证的，改了代码就得让它继续跑得通 |

## 提交信息

用 Conventional Commits，与现有历史保持一致：

```
feat(prefabs): 新增 xxx        # 新能力
fix(engine): 修复 xxx          # 修 bug
docs: 更新 xxx                 # 文档
chore(release): v0.9.0         # 发版
```

中文正文即可，标题用英文前缀（历史一致，方便 `git log --grep`）。

## 发版

1. 更新各包 `package.json` 的 `version`
2. `CHANGELOG.md` 补条目
3. `pnpm build && pnpm test && pnpm test:contract` 全绿
4. 提交 + 打 tag：`git tag v0.9.0`
5. `git push origin main --tags`

引擎与 prefabs **独立版本号**——引擎不动就不该被带着发版
（v0.7、v0.8 连续两版引擎零改动，这是分层健康的信号，不是偷懒）。

## Issue

报 bug 请带上**最小复现序列**。因为有确定性契约，一串输入命令通常就足够定位——
`record()` 出来的录像是最理想的附件。
