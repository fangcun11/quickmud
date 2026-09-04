// 文档「深入篇 · 确定性与录像重放」示例：record / verifyReplay / 版本护栏 / fork 分叉
// 由 verify-doc-examples.mjs 实测（strict tsc 类型检查 + 运行断言）
import assert from 'node:assert';
import {
  World,
  trait,
  defineEvent,
  defineSystem,
  defineCommand,
  record,
  verifyReplay,
} from '@mud/ecs-engine';

const Health = trait('health', () => ({ current: 100, max: 100 }));
const Healed = defineEvent('healed')<{ target: string; amount: number }>();

const HealSystem = defineSystem({
  name: 'heal',
  on: [Healed],
  handle(event, ctx) {
    const hp = ctx.getComponent(event.data.target, Health);
    if (!hp) return;
    hp.current = Math.min(hp.max, hp.current + event.data.amount);
  },
});

const RestCommand = defineCommand({
  verbs: ['rest', '休息'],
  args: { minutes: { type: 'word' } },
  handle({ args, player, world }) {
    world.emit(Healed, { target: player, amount: Math.min(50, Number(args.minutes) || 10) });
    return null;
  },
});

/** 同构世界工厂：verifyReplay 靠它重建与录制时相同初始状态的空白世界 */
const buildWorld = () => {
  const w = new World();
  w.register(HealSystem);
  w.registerCommands(RestCommand);
  const p = w.entities.createWithId('player-1');
  w.entities.addComponent(p, Health, { current: 60, max: 100 });
  return { world: w, player: p };
};

// ---- 1. 录制：只存输入操作序列（可 JSON 序列化、可存盘） ----
const { world, player } = buildWorld();
const rec = record(world);
await rec.execute('rest 30', player);
await rec.execute('rest 50', player);
const recording = rec.stop();

// ---- 2. 重放验证：同一操作序列打在新世界上，最终快照必须分毫不差 ----
const result = await verifyReplay(recording, () => buildWorld().world);
assert.ok(result.ok, '确定性成立：同输入 ⇒ 同状态');
const replayHp = result.replaySnapshot!.entities.find((e) => e.id === 'player-1')!.components[
  Health.id
] as { current: number };
assert.strictEqual(replayHp.current, 100, '60 + 30 + 50 = 140，截断在 max 100');
assert.ok(result.diff === undefined, '无分叉即无 diff');

// ---- 3. 版本护栏（v0.11）：录像来自别的引擎版本 → 拒绝重放 ----
// 跨版本的状态布局可能已变，此时给出的"分叉路径"没有诊断价值
const foreign = { ...recording, engineVersion: '0.0.1' };
const mismatch = await verifyReplay(foreign, () => buildWorld().world);
assert.strictEqual(mismatch.ok, false);
assert.strictEqual(mismatch.versionMismatch, true, 'versionMismatch 标记版本不一致');

// ---- 4. 世界分叉：在沙箱里试跑一串操作，主世界纹丝不动 ----
const main = buildWorld();
await main.world.execute('rest 30', main.player); // 60 → 90
assert.strictEqual(main.world.entities.getComponent(main.player, Health)!.current, 90);

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

console.log('10-determinism ✓ 录像重放 / 版本护栏 / fork 分叉 全通过');
