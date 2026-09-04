import type { SnapshotData, SaveBackend } from './types';

/**
 * 文件系统存档后端（Node.js）
 *
 * 从主入口拆出到 @mud/ecs-engine/node 子路径（0.12 起，P3-8）：
 * 主入口保持浏览器可安全引用——虽然本类用动态 import('node:fs')，
 * 打包不会静态带上 fs，但"运行时调用才炸"的隐患不如让 Node 专属物
 * 归位专属入口，语义与 bundle 体积双赢。
 *
 * 跨平台说明：目录推导统一使用 node:path（Windows 反斜杠与 POSIX 斜杠均正确）；
 * 无目录部分（纯文件名）时跳过 mkdir；load 仅对"文件不存在"返回 null，
 * 其余错误（权限、损坏 JSON 等）向上抛出，不吞错。
 */
export class FsBackend implements SaveBackend {
  async save(path: string, data: SnapshotData): Promise<void> {
    const [{ dirname }, fs] = await Promise.all([
      import('node:path'),
      import('node:fs/promises'),
    ]);
    const dir = dirname(path);
    if (dir && dir !== path) {
      await fs.mkdir(dir, { recursive: true });
    }
    await fs.writeFile(path, JSON.stringify(data, null, 2), 'utf-8');
  }

  async load(path: string): Promise<SnapshotData | null> {
    const fs = await import('node:fs/promises');
    let content: string;
    try {
      content = await fs.readFile(path, 'utf-8');
    } catch (err) {
      // 仅"文件不存在"视为无存档；权限等其余错误如实上抛
      if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') {
        return null;
      }
      throw err;
    }
    // JSON 损坏必须暴露，不能伪装成"无存档"
    return JSON.parse(content) as SnapshotData;
  }

  async exists(path: string): Promise<boolean> {
    try {
      const fs = await import('node:fs/promises');
      await fs.access(path);
      return true;
    } catch {
      return false;
    }
  }

  async delete(path: string): Promise<void> {
    const fs = await import('node:fs/promises');
    await fs.unlink(path);
  }
}
