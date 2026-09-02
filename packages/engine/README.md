# @mud/ecs-engine

MUD 文字游戏引擎核心 —— 事件驱动、ECS 架构、确定性模拟的单机文字游戏引擎库。

零依赖（运行时与编译期均无第三方包），同时提供 ESM 与 CJS 产物，可直接被任何 Node.js ≥ 18 项目引用。

> 确定性契约：引擎内部禁用 `Math.random` / `Date.now` / `crypto`（ESLint 强制）。
> 同一输入序列 ⇒ 同一最终状态——这是录像重放（`record/replay`）与世界分叉（`fork`）的根基。
> 版本号单一事实源是 `package.json` 的 `version` 字段（构建时由 scripts/write-version.mjs 生成 `ENGINE_VERSION` 导出）。

## 安装

```bash
npm install @mud/ecs-engine
# 或从源码打包安装
cd packages/engine && pnpm pack
npm install ./mud-ecs-engine-0.2.0.tgz
```

## 快速上手（ESM）

```ts
import { World, trait, Name } from '@mud/ecs-engine';

// 定义组件（ECS 的 C）
const Health = trait('health', { current: 100, max: 100 });

// 创建世界与实体
const world = new World({ tickInterval: 500 });
const player = world.entities.create();
world.entities.addComponent(player, Health, { current: 80, max: 100 });
// Name 是引擎内置组件（单语言，findEntityByName 的查找契约）：
// 形状为 { text: string; aliases?: string[] }
world.entities.addComponent(player, Name, { text: '韩立' });

// 注册命令与系统，处理玩家输入
world.register(...systems);
world.registerCommands(...commands);
const feedback = await world.execute('look', playerId); // async：支持异步命令
```

> 注意：`world.execute()` 返回 `Promise<string | null>`——命令的 handle 允许为异步函数。
>
> i18n 暂不支持；数据驱动内容（YAML 等）为设计意图、当前未实现——内容直接内联在代码中。

## 测试支持

```ts
import { createTestWorld } from '@mud/ecs-engine/testing';

const t = createTestWorld();
t.clock.advance(1000); // 手动时钟，确定性测试
```

## 0.2 新特性速览

```ts
// 定时系统：every 周期 + ctx.after 延时（World.tick 驱动，纳入快照/回滚）
defineSystem({ name: 'poison', every: 2000, handle: (p, ctx) => { /* ... */ } });
ctx.after(3000, Explosion, { room: 'hall' });

// 系统错误策略：不炸主链路的容错
defineSystem({ name: 'render', on: [Moved.token], onError: 'degrade', handle /* ... */ });

// 开发者命令：/tp /give /heal /dev-help（按 position/inventory/health 约定）
world.registerCommands(...createDeveloperCommands());

// 录像重放：确定性回归的调试利器
const rec = record(world);
await rec.execute('go north', player);
const result = await verifyReplay(rec.stop(), () => buildWorld());
result.ok;   // false 时 result.diff 给出首个分叉路径

// 世界分叉：NPC AI 决策试跑、技能预演
const sandbox = world.fork();
await sandbox.execute('attack boss', player); // 主世界纹丝不动
```

输出渲染：`renderAnsi` / `renderSemanticHtml` / `renderPlainText`（纯函数，语义化消息 → 终端/Web/日志）。
完整新手指南见仓库根 `docs/guide.md`；变更明细见 `CHANGELOG.md`。

## 双模块格式

| 入口 | import (ESM) | require (CJS) |
| --- | --- | --- |
| `@mud/ecs-engine` | dist/index.js | dist/index.cjs |
| `@mud/ecs-engine/testing` | dist/testing.js | dist/testing.cjs |

## 开发

```bash
pnpm install          # 仓库根目录
pnpm build            # tsc + esbuild 双格式构建
pnpm test             # vitest 单测
pnpm --filter demo-adventure dev   # 运行终端 REPL 示例
```
