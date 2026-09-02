import type { SnapshotData, SnapshotMigration, SaveBackend } from './types';

/**
 * 比较两个语义版本号
 * @returns 负数(a < b)，0(a === b)，正数(a > b)
 */
function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const na = pa[i] ?? 0;
    const nb = pb[i] ?? 0;
    if (na !== nb) return na - nb;
  }
  return 0;
}

/**
 * 存档端口 - 管理快照的保存、加载和迁移
 */
export class SavePort {
  private backend: SaveBackend;
  private migrations: SnapshotMigration[] = [];
  private currentVersion: string;

  constructor(backend: SaveBackend, engineVersion: string) {
    this.backend = backend;
    this.currentVersion = engineVersion;
  }

  /**
   * 注册迁移函数
   */
  registerMigrations(...migrations: SnapshotMigration[]): void {
    this.migrations.push(...migrations);
    // 按 from 版本排序
    this.migrations.sort((a, b) => compareVersions(a.from, b.from));
  }

  /**
   * 保存快照
   */
  async save(path: string, snapshot: SnapshotData): Promise<void> {
    // 保存前确保版本号正确
    const data: SnapshotData = {
      ...snapshot,
      engineVersion: this.currentVersion,
    };
    await this.backend.save(path, data);
  }

  /**
   * 加载快照（带迁移）
   */
  async load(path: string): Promise<SnapshotData> {
    const data = await this.backend.load(path);
    if (!data) {
      throw new Error(`Save file not found: ${path}`);
    }

    // 版本校验
    if (compareVersions(data.engineVersion, this.currentVersion) > 0) {
      throw new Error(
        `Save file is from a newer version: ${data.engineVersion} > ${this.currentVersion}`
      );
    }

    // 执行迁移
    return this.migrate(data);
  }

  /**
   * 执行迁移链
   */
  private migrate(snapshot: SnapshotData): SnapshotData {
    let current = snapshot;

    while (compareVersions(current.engineVersion, this.currentVersion) < 0) {
      const migration = this.migrations.find(
        m => m.from === current.engineVersion
      );

      if (!migration) {
        throw new Error(
          `No migration found for version ${current.engineVersion} → ${this.currentVersion}`
        );
      }

      if (compareVersions(migration.to, current.engineVersion) <= 0) {
        throw new Error(
          `Invalid migration: to-version ${migration.to} must be greater than from-version ${current.engineVersion}`
        );
      }

      current = { ...migration.migrate(current), engineVersion: migration.to };
    }

    return current;
  }

  /**
   * 检查存档是否存在
   */
  async exists(path: string): Promise<boolean> {
    return this.backend.exists(path);
  }

  /**
   * 删除存档
   */
  async delete(path: string): Promise<void> {
    return this.backend.delete(path);
  }
}

/**
 * 文件系统存档后端（Node.js）
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

/**
 * localStorage 存档后端（浏览器）
 */
export class LocalStorageBackend implements SaveBackend {
  private getStorage(): { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void } | null {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const g = globalThis as any;
    if (typeof g !== 'undefined' && g.localStorage) {
      return g.localStorage;
    }
    return null;
  }

  async save(path: string, data: SnapshotData): Promise<void> {
    const storage = this.getStorage();
    if (storage) {
      storage.setItem(path, JSON.stringify(data));
    }
  }

  async load(path: string): Promise<SnapshotData | null> {
    const storage = this.getStorage();
    if (storage) {
      const raw = storage.getItem(path);
      if (!raw) return null;
      return JSON.parse(raw) as SnapshotData;
    }
    return null;
  }

  async exists(path: string): Promise<boolean> {
    const storage = this.getStorage();
    if (storage) {
      return storage.getItem(path) !== null;
    }
    return false;
  }

  async delete(path: string): Promise<void> {
    const storage = this.getStorage();
    if (storage) {
      storage.removeItem(path);
    }
  }
}