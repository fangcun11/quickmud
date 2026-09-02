/**
 * @mud/prefabs 组件族（0.3 toolkit）—— MUD 文字游戏开箱即用的领域 trait
 *
 * 与引擎的关系：本包是**领域预制件**，引擎保持零内容预设。
 * 组件名（确定性 id）即约定，`@mud/ecs-engine` 的开发者命令
 * （/tp /heal 按 position/health 命名约定）依赖此处的定义。
 *
 * Name 组件属引擎契约（findEntityByName 的查找载体），不在此重复导出——
 * 需要时请直接从 `@mud/ecs-engine` 导入。
 */
import { trait } from '@mud/ecs-engine';
import type { EntityId } from '@mud/ecs-engine';

/** 文本描述组件（房间/物品/NPC 的展示文本） */
export const Description = trait('description', () => ({
  text: '',
}));

/** 生命值组件（/heal 的约定目标） */
export const Health = trait('health', () => ({
  current: 100,
  max: 100,
}));

/** 位置组件（/tp 的约定目标；roomId 引用房间实体 id） */
export const Position = trait('position', () => ({
  roomId: 'town_square',
}));

/**
 * 物品位置组件（0.3-C）：物品实体的**单源位置**
 *
 * `at` = 所在容器实体 id。房间/玩家/箱子都只是普通实体，均可作容器：
 * - 物品在地上：`at` = 房间实体 id
 * - 物品在背包：`at` = 玩家实体 id
 *
 * "某容器里有什么" = 查询所有带 Located 且 at==容器的实体（配合
 * SystemContext / CommandContext 的 findByComponent）。
 *
 * 注意：0.1 时代曾用 `Inventory { items: string[] }` 表示背包（物品只是名字
 * 字符串）；本组件取代了它——物品是真实实体，位置是单源真相。
 */
export const Located = trait('located', () => ({
  at: null,
}) as LocatedData);

/** Located 组件数据类型 */
export type LocatedData = {
  at: EntityId | null;
};

/** 房间出口组件（房间专用）：{ [方向]: 目标房间 id } */
export const Exits = trait('exits', () => ({} as Record<string, string>));

/** 便携性标记组件（物品可被拾取/持有） */
export const Portable = trait('portable', () => ({}));

/** 武器组件：额外伤害 */
export const Weapon = trait('weapon', () => ({
  damage: 0,
}));

/** 巡逻标记组件：带它 + Position 的实体由 NpcWanderSystem 驱动漫游 */
export const Wander = trait('wander', () => ({}));

/**
 * 掉落条目（v0.6-A1）：**纯数据**描述一个掉落物
 *
 * 刻意用数据而非蓝图引用：组件数据必须可 JSON（引擎铁律，快照走 structuredClone），
 * 而蓝图持有 ComponentDefinition（内含函数）。掉落时由 LootSystem 用 blueprint()
 * 运行时构造蓝图——blueprint() 是纯函数，运行时调用没有任何问题。
 */
export type LootEntry = {
  /** 掉落物名字（同时作为 Name.text） */
  name: string;
  /** 别名（供 take/look 的名称解析） */
  aliases?: string[];
  /** 掉落物描述 */
  description?: string;
  /** 可拾取性（默认 true——掉落物本来就是要被捡起的） */
  portable?: boolean;
  /** > 0 时挂 Weapon（掉落武器） */
  damage?: number;
};

/** 掉落表组件：带它的实体死亡时（Died）由 LootSystem 结算掉落 */
export const Loot = trait('loot', () => ({ drops: [] as LootEntry[] }));

/** Loot 组件数据类型 */
export type LootData = { drops: LootEntry[] };

/**
 * 任务目标（v0.6-A2）
 *
 * `target` 是**名字**而不是实体 id：掉落物是运行时 spawn 的新实体，id 由计数器
 * 生成、不可预知；名字才是内容作者能写进任务定义的稳定锚点（与 look/take 的
 * 名称解析同路线）。匹配为包含匹配（`'脏兮兮的项圈'.includes('项圈')` 成立）。
 */
export type QuestObjective =
  | { type: 'collect'; target: string; count: number }
  | { type: 'kill'; target: string; count: number };

/** 奖励：掉落物条目 + 回血（纯数据，进快照） */
export type QuestReward = {
  items?: LootEntry[];
  heal?: number;
};

/** 任务定义（挂在 QuestGiver 上） */
export type QuestDef = {
  /** 全局唯一的任务 id（内容作者保证） */
  id: string;
  /** 展示名 */
  title: string;
  objective: QuestObjective;
  reward?: QuestReward;
};

/** 发任务者组件（挂 NPC）：ta 能提供哪些任务 */
export const QuestGiver = trait('quest_giver', () => ({ quests: [] as QuestDef[] }));

/** QuestGiver 组件数据类型 */
export type QuestGiverData = { quests: QuestDef[] };

/**
 * 玩家任务账本（v0.6-A2）
 *
 * 纯数据，随快照走。**必须挂在玩家实体上**——系统不能给实体补组件
 * （SystemContext 无 addComponent），没挂的玩家静默不参与任务。
 */
export const QuestLog = trait('quest_log', () => ({
  /** 任务 id → 已达成数量 */
  active: {} as Record<string, number>,
  /** 已达标的任务 id */
  completed: [] as string[],
  /** 已交付的任务 id（领过奖，不可重复） */
  turnedIn: [] as string[],
}));

/** QuestLog 组件数据类型 */
export type QuestLogData = {
  active: Record<string, number>;
  completed: string[];
  turnedIn: string[];
};
