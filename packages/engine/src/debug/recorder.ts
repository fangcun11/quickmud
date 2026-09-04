/**
 * 录像重放（D1）——确定性模拟的调试利器
 *
 * 原理：引擎满足确定性契约（无 Math.random/Date.now/crypto，金测试+ESLint 双重
 * 防护），因此"同一输入序列 ⇒ 同一最终状态"。录像只存输入操作序列，
 * 重放即复现；最终状态与录制时不一致 ⇒ 有代码破坏了确定性。
 *
 * 用法：
 * ```ts
 * const rec = record(world);
 * await rec.execute('go north', player);
 * rec.tick();
 * const recording = rec.stop();          // 可 JSON 序列化存盘
 *
 * const result = await verifyReplay(recording, () => buildWorld()); // buildWorld 由应用提供
 * result.ok;   // true = 确定性成立
 * result.diff; // 首个分叉路径（如 "entities.0.components.c1a2b3.value"）
 * ```
 */
import type { World } from '../core/world';
import type { EntityId } from '../core/types';
import type { SnapshotData } from '../persistence/types';
import { ENGINE_VERSION } from '../version';

/** 录制的操作：命令执行或 tick */
export type RecordedOp =
  | { op: 'execute'; input: string; playerId: EntityId }
  | { op: 'tick' };

/** 录像：可 JSON 序列化（含录制结束时的最终快照，用于重放比对） */
export interface Recording {
  engineVersion: string;
  recordedAt: string;
  ops: RecordedOp[];
  finalSnapshot: SnapshotData;
}

/** 录制器：代理 execute/tick 并记录操作序列 */
export class WorldRecorder {
  private ops: RecordedOp[] = [];

  constructor(private readonly world: World) {}

  /** 执行命令并记录 */
  async execute(input: string, playerId: EntityId): Promise<string | null> {
    this.ops.push({ op: 'execute', input, playerId });
    return this.world.execute(input, playerId);
  }

  /** 执行 tick 并记录（可批量） */
  tick(count = 1): void {
    for (let i = 0; i < count; i++) {
      this.ops.push({ op: 'tick' });
      this.world.tick();
    }
  }

  /** 结束录制：冻结操作序列与最终快照 */
  stop(): Recording {
    return {
      // 版本号单一事实源 = package.json（构建时生成 ENGINE_VERSION）；
      // 跨引擎版本的录像据此判断兼容性
      engineVersion: ENGINE_VERSION,
      recordedAt: 'deterministic', // 刻意不放墙钟时间：录像内容本身必须可复现
      ops: [...this.ops],
      finalSnapshot: this.world.createSnapshot(),
    };
  }
}

/** 开始录制 */
export function record(world: World): WorldRecorder {
  return new WorldRecorder(world);
}

/**
 * 重放：在 build() 产出的全新世界上依序应用操作，返回重放后的世界。
 * build() 必须返回与录制时同构的世界（同样的系统/命令/初始实体）。
 */
export async function replay(recording: Recording, build: () => World): Promise<World> {
  const world = build();
  for (const op of recording.ops) {
    if (op.op === 'execute') {
      await world.execute(op.input, op.playerId);
    } else {
      world.tick();
    }
  }
  return world;
}

/**
 * 深比较两个 JSON 值，返回首个分叉路径（无分叉返回 undefined）
 */
export function firstDiff(a: unknown, b: unknown, path = ''): string | undefined {
  if (a === b) return undefined;
  if (typeof a !== typeof b || a === null || b === null) return path || '<root>';
  if (Array.isArray(a) && Array.isArray(b)) {
    const len = Math.max(a.length, b.length);
    for (let i = 0; i < len; i++) {
      const d = firstDiff(a[i], b[i], `${path}[${i}]`);
      if (d) return d;
    }
    return undefined;
  }
  if (typeof a === 'object' && typeof b === 'object') {
    const keys = new Set([...Object.keys(a as object), ...Object.keys(b as object)]);
    for (const k of keys) {
      const d = firstDiff(
        (a as Record<string, unknown>)[k],
        (b as Record<string, unknown>)[k],
        path ? `${path}.${k}` : k,
      );
      if (d) return d;
    }
    return undefined;
  }
  return path || '<root>';
}

/** 重放校验结果 */
export interface ReplayResult {
  /** true = 重放状态与录制时完全一致 */
  ok: boolean;
  /** 重放后世界（ok 时即"复现成功"的世界，可继续用它调试；
   * 版本不匹配时为未应用任何操作的初始世界） */
  world: World;
  /** 首个分叉路径（仅 ok=true 的内容分叉时存在；版本不匹配时为 undefined） */
  diff?: string;
  /** true = 录像与当前引擎版本不一致，重放被拒绝（分叉比对无意义） */
  versionMismatch?: boolean;
  /** 重放侧最终快照（版本不匹配时为未重放的初始状态） */
  replaySnapshot: SnapshotData;
  /** 录制侧最终快照 */
  recordedSnapshot: SnapshotData;
}

/**
 * 重放并校验：重放后的全量快照与录制时的最终快照逐字段比对。
 * ok=false 时用 result.diff 定位首个分叉点。
 *
 * 版本护栏：录像的 engineVersion 与当前 ENGINE_VERSION 不一致时直接拒绝
 * （versionMismatch: true、不执行重放）——跨版本的状态布局可能已变，
 * 此时得出的"分叉"没有诊断价值，只会误导排查方向。
 */
export async function verifyReplay(
  recording: Recording,
  build: () => World,
): Promise<ReplayResult> {
  // 版本护栏：不一致时拒绝重放（分叉比对无意义），只构建世界供返回
  if (recording.engineVersion !== ENGINE_VERSION) {
    const untouched = build();
    return {
      ok: false,
      versionMismatch: true,
      world: untouched,
      replaySnapshot: untouched.createSnapshot(),
      recordedSnapshot: recording.finalSnapshot,
    };
  }

  const world = await replay(recording, build);
  const replaySnapshot = world.createSnapshot();
  const diff = firstDiff(recording.finalSnapshot, replaySnapshot);
  return { ok: diff === undefined, world, diff, replaySnapshot, recordedSnapshot: recording.finalSnapshot };
}
