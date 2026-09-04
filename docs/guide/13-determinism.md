# 13 · 确定性与录像重放

> **本章你会学到**：确定性契约、录像重放（record / verifyReplay）、版本护栏、
> 世界分叉（fork）。这是 quickmud 与"普通 ECS 库"拉开差距的地方。
> 本章代码对应验证示例 [10-determinism.mts](../examples/10-determinism.mts)。

---

## 确定性契约

引擎内部**禁用** `Math.random` / `Date.now` / `crypto`（ESLint 强制）。
同一输入序列 ⇒ 同一最终状态——这是录像重放（`record/replay`）与世界分叉
（`fork`）的根基。需要随机就自己注入种子（组件里存 seed），需要时间就走
世界时钟。

## 录像重放：确定性回归的调试利器

原理：录像只存**输入操作序列**（execute/tick），重放即复现；最终状态与录制时
不一致 ⇒ 有代码破坏了确定性。

```ts
/** 同构世界工厂：verifyReplay 靠它重建与录制时相同初始状态的空白世界 */
const buildWorld = () => {
  const w = new World();
  w.register(HealSystem);
  w.registerCommands(RestCommand);
  const p = w.entities.createWithId('player-1');
  w.entities.addComponent(p, Health, { current: 60, max: 100 });
  return { world: w, player: p };
};

// ---- 录制：只存输入操作序列（可 JSON 序列化、可存盘） ----
const { world, player } = buildWorld();
const rec = record(world);
await rec.execute('rest 30', player);
await rec.execute('rest 50', player);
const recording = rec.stop();

// ---- 重放验证：同一操作序列打在新世界上，最终快照必须分毫不差 ----
const result = await verifyReplay(recording, () => buildWorld().world);
assert.ok(result.ok, '确定性成立：同输入 ⇒ 同状态');
const replayHp = result.replaySnapshot!.entities.find((e) => e.id === 'player-1')!.components[
  Health.id
] as { current: number };
assert.strictEqual(replayHp.current, 100, '60 + 30 + 50 = 140，截断在 max 100');
assert.ok(result.diff === undefined, '无分叉即无 diff');
```

- `recording` 是纯 JSON（含录制结束时的最终快照），可以存盘当"关卡录像"，
  也可以进 git 当回归 fixture；
- `result.ok === false` 时 `result.diff` 给出**首个分叉路径**（如
  `entities.0.components.c1a2b3.value`）——bug 复现从"说不清"变成"指哪打哪"。

## 版本护栏（v0.11）

录像的 `engineVersion` 与当前 `ENGINE_VERSION` 不一致时**拒绝重放**，返回
`versionMismatch: true`——跨版本的状态布局可能已变，此时给出的"分叉路径"
没有诊断价值：

```ts
const foreign = { ...recording, engineVersion: '0.0.1' };
const mismatch = await verifyReplay(foreign, () => buildWorld().world);
assert.strictEqual(mismatch.ok, false);
assert.strictEqual(mismatch.versionMismatch, true, 'versionMismatch 标记版本不一致');
```

## 世界分叉：试跑而不落地

NPC AI 决策试跑、技能预演、"如果我现在喝药会怎样"——在沙箱里试跑一串操作，
主世界纹丝不动：

```ts
const main = buildWorld();
await main.world.execute('rest 30', main.player); // 60 → 90

const sandbox = main.world.fork(); // 实体 id 与主世界一致，状态是当前快照的深拷贝
await sandbox.execute('rest 99', main.player);

assert.strictEqual(
  main.world.entities.getComponent(main.player, Health)!.current,
  90,
  '主世界没被沙箱里的操作影响',
);
assert.strictEqual(
  sandbox.entities.getComponent(main.player, Health)!.current,
  100,
  '分叉世界走自己的时间线（90 + 50 = 140 → 截断 100）',
);
```

## 相关能力一览

| 能力 | API | 用途 |
| --- | --- | --- |
| 录制 | `record(world)` → `rec.execute/tick` → `rec.stop()` | 存输入序列 |
| 重放验证 | `verifyReplay(recording, build)` | 确定性回归、bug 复现 |
| 重放（拿世界） | `replay(recording, build)` | 从录像重建现场 |
| 分叉 | `world.fork()` | AI 试跑、技能预演 |
| 首个分叉 | `firstDiff(a, b)` | 两个快照的差异化诊断 |

---

[← 上一篇：12 存档与回滚](./12-save-rollback.md) | [下一篇：14 测试 →](./14-testing.md) | [目录](./index.md)
