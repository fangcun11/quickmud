/**
 * @mud/ecs-engine/node —— Node.js 专属入口（0.12 起）
 *
 * 主入口 `@mud/ecs-engine` 保持零 Node 依赖、浏览器可安全引用；
 * 依赖 node:fs 的存档后端归位此子路径：
 *
 * ```ts
 * import { SavePort } from '@mud/ecs-engine';
 * import { FsBackend } from '@mud/ecs-engine/node';
 * const save = new SavePort(new FsBackend(), '1.0.0');
 * ```
 */
export { FsBackend } from './persistence/fs-backend';
