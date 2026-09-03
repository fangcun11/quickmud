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

/**
 * Buff 效果（v0.7-A，最小定时效果层）
 *
 * `every` 是该效果的结算间隔（毫秒）——实际粒度受 BuffSystem 的 every（1000）
 * 限制，传小于 1000 的值不会更频繁。
 */
export type BuffEffect =
  | { type: 'damage'; amount: number; every: number }
  | { type: 'heal'; amount: number; every: number };

/**
 * Buff 本体（挂在 **buff 实体**上，指向受害者）
 *
 * Buff 是实体而非列表组件：与 Located 同哲学——一切皆实体、单源真相。
 * "谁身上有什么 buff" = findByComponent(Afflicted) 一次查询；
 * 快照/录像天然一致；未来的叠加/互斥（v0.8）不用改数据结构。
 *
 * `startedAt <= 0` 表示**待激活**：由 BuffSystem 在首个结算网格点写入世界时间，
 * 内容层全程不需要感知时间（spawn 即忘）。`lastTickedAt` 是上次结算时间
 * （自上次结算起计 effect.every，而非固定网格——避免 effect.every 与结算
 * 粒度不对齐时重复结算）；两者都是组件数据，随快照回滚，确定性无损。
 */
export const Afflicted = trait('afflicted', () => ({
  victim: null as EntityId | null,
  effect: { type: 'damage', amount: 0, every: 1000 } as BuffEffect,
  startedAt: 0,
  lastTickedAt: 0,
  /** 施加者（毒杀时 Died.killer 指向它） */
  source: undefined as EntityId | undefined,
}));

/** Afflicted 组件数据类型 */
export type AfflictedData = {
  victim: EntityId | null;
  effect: BuffEffect;
  startedAt: number;
  lastTickedAt: number;
  source?: EntityId;
};

/** 持续时间组件：buff 实体不带它 = 永久（直到被显式移除/受害者死亡） */
export const Duration = trait('duration', () => ({ lasts: 5000 }));

/** Duration 组件数据类型 */
export type DurationData = { lasts: number };

/**
 * 房间坐标（v0.8-A）：二维平面位置，由 `Exits` 拓扑**派生**
 *
 * 单一真相是 `Exits`——坐标在定义期（`layoutRooms`）一次性算好写入，
 * 运行时不推断。跨层/非欧连接（up/down 等）可达的房间没有坐标
 * （二维平面装不下它），地图渲染跳过。
 */
export const Coordinates = trait('coordinates', () => ({ x: 0, y: 0 }));

/**
 * 探索记录（v0.8-B）：挂玩家（或有探索概念的实体），记录去过的房间
 *
 * 纯数据数组（可 JSON、进快照）。挂了它 = 内容声明"这个世界的地图要迷雾"；
 * 没挂 → 地图命令渲染全图。
 */
export const Visited = trait('visited', () => ({ rooms: [] as string[] }));
