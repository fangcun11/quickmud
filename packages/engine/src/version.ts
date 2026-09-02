/**
 * 引擎版本号 - 唯一事实源
 *
 * 构建时由 scripts/write-version.ts 从 package.json 读取并生成为
 * src/version.generated.ts（本文件的同目录兄弟文件）。
 * 源码中一律 import { ENGINE_VERSION } from '../version'。
 *
 * 注意：src/version.generated.ts 不入库（见 .gitignore），
 * 构建脚本（tsc）前会自动生成，缺失时 fallback 到 '0.0.0-dev'。
 */
export { ENGINE_VERSION } from './version.generated';
