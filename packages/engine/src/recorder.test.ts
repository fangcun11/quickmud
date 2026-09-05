/**
 * D1 录像重放测试
 */
import { describe, it, expect } from 'vitest';
import { World, trait, defineEvent, defineSystem, defineCommand, record, verifyReplay, replay, ENGINE_VERSION } from './index';
import type { SnapshotData } from './persistence/types';

const Health = trait('health', () => ({ current: 100, max: 100 }));
const Healed = defineEvent('healed')<{ target: string; amount: number }>();

const HealSystem = defineSystem({
  name: 'heal',
  on: [Healed.token],
  priority: 10,
  handle(event, ctx) {
    const hp = ctx.getComponent(event.data.target, Health);
    if (hp) hp.current = Math.min(hp.max, hp.current + event.data.amount);
  },
});

const Rest = defineCommand({
    describe: '测试用命令',
  verbs: ['rest'],
  args: { minutes: { type: 'word' } },
  handle({ args, player, world }) {
    world.emit(Healed, { target: player, amount: Number(args.minutes) || 10 });
    return null;
  },
});

/** 应用提供的 buildWorld：同构世界工厂（确定性） */
function buildWorld(): World {
  const w = new World();
  w.register(HealSystem);
  w.registerCommands(Rest);
  const p = w.entities.createWithId('player-1');
  w.addComponent(p, Health, { current: 50, max: 100 });
  return w;
}

function makeRecordingJson(rec: ReturnType<ReturnType<typeof record>['stop']>): string {
  return JSON.stringify(rec);
}

describe('D1 录像重放', () => {
  it('重放与录制最终状态深度一致', async () => {
    const w = buildWorld();
    const rec = record(w);
    await rec.execute('rest 30', 'player-1');
    await rec.execute('rest 10', 'player-1');
    rec.tick(3);
    const recording = rec.stop();

    const result = await verifyReplay(recording, buildWorld);
    expect(result.ok).toBe(true);
    expect(result.diff).toBeUndefined();
    expect(result.world.getComponent('player-1', Health)!.current)
      .toBe(w.getComponent('player-1', Health)!.current);
  });

  it('录像 JSON 序列化后重放仍一致（存档/传输场景）', async () => {
    const w = buildWorld();
    const rec = record(w);
    await rec.execute('rest 25', 'player-1');
    rec.tick(2);

    const restored = JSON.parse(makeRecordingJson(rec.stop())) as Parameters<typeof verifyReplay>[0];
    const result = await verifyReplay(restored, buildWorld);
    expect(result.ok).toBe(true);
  });

  it('篡改录像 → 检出分叉并定位首个分叉路径', async () => {
    const w = buildWorld();
    const rec = record(w);
    await rec.execute('rest 30', 'player-1');
    const recording = rec.stop();

    // 篡改：30 分钟改成 300 分钟（超过 max 被 clamp 前后不同？50+300→100 vs 50+30→80）
    const tampered: typeof recording = {
      ...recording,
      ops: [{ op: 'execute', input: 'rest 300', playerId: 'player-1' }],
    };
    const result = await verifyReplay(tampered, buildWorld);
    expect(result.ok).toBe(false);
    expect(result.diff).toBeDefined();
  });

  it('跨版本录像拒绝重放（versionMismatch），不做无意义的分叉比对', async () => {
    const w = buildWorld();
    const rec = record(w);
    await rec.execute('rest 30', 'player-1');
    const recording = rec.stop();

    const forged: typeof recording = { ...recording, engineVersion: '0.0.1' };
    const result = await verifyReplay(forged, buildWorld);
    expect(result.ok).toBe(false);
    expect(result.versionMismatch).toBe(true);
    expect(result.diff).toBeUndefined(); // 不是内容分叉，是版本不兼容
  });

  it('replay 返回的世界可继续操作（调试起点）', async () => {
    const rec = record(buildWorld());
    await rec.execute('rest 10', 'player-1');
    const recording = rec.stop();

    const w2 = await replay(recording, buildWorld);
    const before = w2.getComponent('player-1', Health)!.current;
    await w2.execute('rest 10', 'player-1');
    expect(w2.getComponent('player-1', Health)!.current).toBe(before + 10);
  });

  it('tick 操作也被录制（every 系统的确定性可回放）', async () => {
    const fired: number[] = [];
    const w = buildWorld();
    w.register({
      name: 'pulse',
      every: 100,
      handle: (() => fired.push(1)) as never,
    } as never);
    const rec = record(w);
    rec.tick(4);
    const recording = rec.stop();

    // 回滚到录制前状态并重放，every 触发次数一致
    const result = await verifyReplay(recording, () => {
      const w2 = buildWorld();
      w2.register({ name: 'pulse', every: 100, handle: (() => fired.push(1)) as never } as never);
      return w2;
    });
    expect(result.ok).toBe(true);
    const snap = result.replaySnapshot as SnapshotData;
    expect(snap.tickCount).toBe(4);
  });

  it('录像携带真实引擎版本（跨版本兼容性校验的依据）', () => {
    const rec = record(buildWorld());
    const recording = rec.stop();
    // 版本号单一事实源 = package.json → ENGINE_VERSION，不是占位字符串
    expect(recording.engineVersion).toBe(ENGINE_VERSION);
    expect(recording.engineVersion).toMatch(/^\d+\.\d+\.\d+/);
  });
});
