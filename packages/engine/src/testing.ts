/**
 * @mud/ecs-engine/testing —— 测试工具官方入口
 *
 * 测试全家桶（createTestWorld / 录像重放）统一从此子路径导入：
 *   import { createTestWorld, record, verifyReplay } from '@mud/ecs-engine/testing';
 *
 * 主入口（@mud/ecs-engine）为兼容仍导出同套符号，但新代码请走本子路径。
 */
export { createTestWorld, TestWorld, ManualClock } from './testing/test-world';
export type { TestWorldConfig } from './testing/test-world';
export { record, replay, verifyReplay, WorldRecorder, firstDiff } from './debug/recorder';
export type { Recording, RecordedOp, ReplayResult } from './debug/recorder';
