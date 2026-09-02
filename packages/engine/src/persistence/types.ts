import type { EntityId, ComponentId } from '../core/types';

/**
 * 快照数据 - 游戏世界的序列化状态
 */
export interface SnapshotData {
  /** 引擎版本 */
  engineVersion: string;
  /** 游戏 tick 计数 */
  tickCount: number;
  /** 世界时间（毫秒）。0.1 存档无此字段，恢复时按 0 处理 */
  worldTime?: number;
  /** 组件注册表 */
  registry: Record<ComponentId, string>;
  /** 所有实体 */
  entities: SnapshotEntity[];
  /** 调度器状态 */
  scheduler: SchedulerSnapshot;
  /** 任务进度 */
  quests?: Record<string, QuestSnapshot>;
}

/**
 * 快照中的实体
 */
export interface SnapshotEntity {
  id: EntityId;
  components: Record<ComponentId, unknown>;
}

/**
 * 调度器快照
 */
export interface SchedulerSnapshot {
  pendingEvents: PendingEvent[];
}

/**
 * 待触发事件
 */
export interface PendingEvent {
  token: string;
  data: unknown;
  triggerAt: number;
}

/**
 * 任务快照
 */
export interface QuestSnapshot {
  id: string;
  stage: number;
  completedConditions: string[];
}

/**
 * 快照迁移函数
 */
export interface SnapshotMigration {
  from: string;
  to: string;
  migrate: (snapshot: SnapshotData) => SnapshotData;
}

/**
 * 存档后端接口
 */
export interface SaveBackend {
  /** 保存快照 */
  save(path: string, data: SnapshotData): Promise<void>;
  /** 加载快照 */
  load(path: string): Promise<SnapshotData | null>;
  /** 检查存档是否存在 */
  exists(path: string): Promise<boolean>;
  /** 删除存档 */
  delete(path: string): Promise<void>;
}