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
npm install ./mud-ecs-engine-0.4.0.tgz   # 版本号随 package.json
```

## 快速上手（ESM）

```ts
import { World, trait, Name } from '@mud/ecs-engine';

// 定义组件（ECS 的 C）
// trait 第二参可传默认数据对象（模板）或工厂，二者等价——
// 每次 create() 都返回独立深拷贝，互不共享。
const Health = trait('health', { current: 100, max: 100 });

// 创建世界与实体
const world = new World({ tickInterval: 500 });
const player = world.entities.create();
world.addComponent(player, Health, { current: 80, max: 100 });
// Name 是引擎内置组件（单语言，findEntityByName 的查找契约）：
// 形状为 { text: string; aliases?: string[] }
world.addComponent(player, Name, { text: '韩立' });

// 注册命令与系统，处理玩家输入
world.register(...systems);
world.registerCommands(...commands);
const feedback = await world.execute('look', player); // async：支持异步命令
```

> 注意：`world.execute()` 返回 `Promise<string | null>`——命令的 handle 允许为异步函数。
>
> i18n 暂不支持；数据驱动内容（YAML 等）为设计意图、当前未实现——内容直接内联在代码中。

## 测试支持

```ts
import { createTestWorld } from '@mud/ecs-engine/testing';

const t = createTestWorld({ tickInterval: 100 });
t.clock.advance(1000); // 手动时钟，确定性测试——真的驱动世界时间
                       // （推进 10 个 tick，every 周期/延时事件随之触发）
t.currentTime;         // 1000，世界时间与 clock 保持同步
```

> 0.5 及更早版本 `clock.advance` 只改自己的计数器、不驱动世界（文档空头承诺，
> API 评审 P1-4）；0.6 起兑现：`advance(ms)` 按 `tickInterval` 循环 tick，
> 世界时间真正前进。另有 `t.tick(n)` / `t.advance(ms)` 两个直接驱动的便捷 API。

## 0.2 新特性速览

```ts
// 定时系统：every 周期 + ctx.after 延时（World.tick 驱动，纳入快照/回滚）
defineSystem({ name: 'poison', every: 2000, handle: (p, ctx) => { /* ... */ } });
const fuse = ctx.after(3000, Explosion, { room: 'hall' }); // 0.12 起返回句柄
ctx.cancel(fuse);                                          // 随时可取消（幂等）

// 系统错误策略：不炸主链路的容错
defineSystem({ name: 'render', on: [Moved.token], onError: 'degrade', handle /* ... */ });

// 开发者命令：/tp /heal /dev-help（按 position/health 约定；/give 自 0.3-C 起
// 随 Inventory 退役而迁出，物品版开发命令归 @mud/prefabs）
// 0.12 起命令走事件链：registerDeveloperKit 一步注册命令 + 内置效果系统
registerDeveloperKit(world);

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
完整新手指南见 `docs/guide/`（渐进式四篇 16 章，示例全部机器验证）；变更明细见 `CHANGELOG.md`。

## 0.3-B 对话与 NPC

分支对话开箱即用：内容内联代码（纯数据），条件与记忆用 flags，组件可快照/回滚/存档。

```ts
import {
  Dialogue, Memory, defineDialogue, DialogueSystem, createDialogueCommands,
} from '@mud/ecs-engine';

// 1. 定义对话树（to 跳转 / requires 门控 / remember 记忆 / reply 收尾）
const tree = defineDialogue('start', [
  { id: 'start', text: '欢迎光临酒馆。', options: [
    { text: '打听传闻', to: 'rumor', requires: ['patron'] }, // 买酒后解锁
    { text: '你是谁？', to: 'who', remember: ['asked_name'] },
    { text: '再见。', reply: '慢走。' },
  ]},
  { id: 'who', text: '我叫老王。', options: [{ text: '来杯麦酒。', remember: ['patron'] }] },
  { id: 'rumor', text: '北边矿洞有宝藏。' },
]);

// 2. 挂到 NPC + 注册系统/命令
world.register(DialogueSystem);
world.registerCommands(...createDialogueCommands());
world.addComponent(npcId, Dialogue, tree);
world.addComponent(npcId, Memory, { flags: [] });

// 3. 玩家输入：talk 酒保 → 1 → 2（选项序号）
const feedback = await world.execute('talk 酒保', playerId);
```

要点：

- **分支**：`requires` 不满足的选项直接不可见；`remember` 在选中时写入 `Memory.flags`
- **副作用**：选项生效会 emit `DialogueChoiceMade`，给物品/发任务等效果由游戏层
  系统订阅该事件实现——对话模块只管说，不改世界
- **确定性**：对话状态全部在组件上，快照/回滚/fork/录像重放天然一致（demo 完整对话
  流程已进录像重放测试）
- 无 `options`（或全部被门控）的节点说完自动结束；NPC 需挂 `Memory` 才支持记忆

## 0.3-C 容器查询原语

`SystemContext` 与 `CommandContext.world` 均注入 **`findByComponent(component)`**
（按组件查实体）。@mud/prefabs 的实体物品模型（Located 容器/背包）正构建在此之上：

```ts
// 查"玩家背包里有什么" = 拥有 Located 且 at == 玩家 的实体
const items = ctx.findByComponent(Located)
  .filter((id) => ctx.getComponent(id, Located)?.at === playerId);
```

## 0.5 系统内造物与销毁

`SystemContext` 另注入 **`spawn(bp, opts)`** 与 **`destroy(entityId)`**（系统是唯一
改状态的手，命令仍只 emit）：

```ts
// 掉落/产出/刷怪：从蓝图现造一个实体（确定性：同蓝图 ⇒ 同组件）
const drop = ctx.spawn(CoinBp, { patch: { located: { at: roomId } } });

// 死亡清场等
ctx.destroy(target);
```

> 注：destroy 不级联清理其他实体的引用（如 Located 指向被删容器会悬挂）。

## 0.11 事件类型贯通与命令输出通道

```ts
// 事件定义：第一层把名字推断为字面量，token 携带字面量类型
const Killed = defineEvent('killed')<{ victim: string }>();

// 多事件系统：on 传定义数组，handle 收 discriminated union
const HuntSystem = defineSystem({
  on: [Killed, Looted],
  handle(event, ctx) {
    if (event.token === Killed.token) {
      event.data.victim; // string——收窄自动完成，无需 as
    }
  },
});

// 命令侧输出通道（0.11 新增）：语义化输出不必再"为一个事件写一个系统"
defineCommand({
  verbs: ['score'],
  handle({ output, player }) {
    output.narrative([{ text: '【状态】', style: { bold: true } }]);
    output.error('没有存档。');
    return null;
  },
});
```

正确性加固：错误包装带 `{ cause }`（根因堆栈可查）；`trait()` 同 id 不同名
（djb2 碰撞）fail-fast；`verifyReplay` 拒绝跨版本录像（`versionMismatch`）。

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
