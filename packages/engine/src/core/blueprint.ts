/**
 * 蓝图预制件（0.3 B0）——可复用实体的声明化创建
 *
 * 蓝图是纯数据，spawn 是确定性的 addComponent 序列：
 * 同蓝图 + 同 id ⇒ 完全相同的实体。快照/回滚/录像/fork 天然兼容。
 *
 * 设计边界（刻意不做）：继承树、序列化格式、延迟解析——
 * 内容直接内联在代码中（与 0.1 砍掉 YAML 数据层的决策一脉相承）。
 *
 * @example
 * ```ts
 * const Goblin = blueprint({
 *   name: '哥布林',
 *   components: [
 *     [Health, { current: 30, max: 30 }],
 *     [Position, { roomId: 'cave' }],
 *   ],
 * });
 *
 * const goblin = world.spawn(Goblin);
 * const boss = world.spawn(Goblin, {
 *   id: 'goblin-king',
 *   patch: { health: { current: 200, max: 200 } }, // 按 trait 名覆盖
 * });
 * ```
 */
import type { ComponentDefinition, EntityId } from './types';
import { trait } from './trait';
import { Name } from './name';
import { deepClone } from '../internal/clone';

/** 蓝图组件项：trait 定义 + 实例数据（data 缺省用 trait 工厂默认值） */
export interface BlueprintComponent<T = unknown> {
  trait: ComponentDefinition<T>;
  data?: T;
}

/** 组件项的书写形式：对象或 [trait, data?] 元组 */
export type BlueprintComponentInput<T = unknown> =
  | BlueprintComponent<T>
  | [ComponentDefinition<T>, T?];

/** 蓝图：纯数据，可放进任何常量/配置文件 */
export interface EntityBlueprint {
  /** 实体名（自动挂 Name trait，findEntity 可查） */
  name?: string;
  /** 组件列表 */
  components: BlueprintComponent[];
  /** 自由标签（供游戏层做内容分组，引擎不消费） */
  tags?: string[];
}

/** patch：按 trait 名（或组件 id）覆盖组件数据（浅合并） */
export type BlueprintPatch = Record<string, Record<string, unknown>>;

/**
 * 声明蓝图。归一化元组/对象两种书写形式；蓝图即纯数据，可直接 JSON 化。
 */
export function blueprint(def: {
  name?: string;
  tags?: string[];
  components: BlueprintComponentInput[];
}): EntityBlueprint {
  const components = def.components.map((entry) => {
    const e = Array.isArray(entry)
      ? { trait: entry[0], data: entry[1] }
      : entry;
    if (!e.trait || typeof e.trait.id !== 'string') {
      throw new Error('Blueprint component entry must be [trait, data?] or { trait, data }');
    }
    return e as BlueprintComponent;
  });

  if (components.length === 0) {
    throw new Error('Blueprint must have at least one component');
  }

  return { name: def.name, tags: def.tags, components };
}

/** Name 约定组件的查找引用（与 trait('name') 确定性 ID 一致） */
const NameRef = trait('name');

/** World.spawn 的实现细节放在 world.ts（需要访问 entities）；此处仅类型 */
export interface SpawnOptions {
  /** 确定性实体 ID（省略时由计数器生成，依然确定性） */
  id?: string;
  /** 按 trait 名覆盖组件数据（浅合并到蓝图数据上） */
  patch?: BlueprintPatch;
}

/**
 * 将蓝图落到指定世界（由 World.spawn 调用；独立导出便于测试与高级用法）
 * @returns 新实体 ID
 */
export function spawnBlueprint(
  world: {
    entities: {
      createWithId(id: string): EntityId;
      create(): EntityId;
      addComponent<T>(id: EntityId, c: ComponentDefinition<T>, data?: T): void;
      getComponent<T>(id: EntityId, c: ComponentDefinition<T>): T | undefined;
    };
  },
  bp: EntityBlueprint,
  opts?: SpawnOptions,
): EntityId {
  // patch 键必须能匹配到蓝图里的组件，否则拼错 trait 名会静默失效
  if (opts?.patch) {
    const known = new Set<string>();
    for (const entry of bp.components) {
      if (entry.trait && typeof entry.trait.id === 'string') {
        known.add(entry.trait.name);
        known.add(entry.trait.id);
      }
    }
    const unknown = Object.keys(opts.patch).filter((key) => !known.has(key));
    if (unknown.length > 0) {
      const names = [...new Set(bp.components.map((e) => e.trait?.name).filter(Boolean))];
      throw new Error(
        `Blueprint patch 引用了蓝图中不存在的组件：${unknown.join(', ')}。` +
          `可用组件：${names.join(', ')}`,
      );
    }
  }

  const entityId = opts?.id ? world.entities.createWithId(opts.id) : world.entities.create();

  for (const entry of bp.components) {
    if (!entry.trait || typeof entry.trait.id !== 'string') {
      throw new Error('Blueprint component entry must be [trait, data?] with a valid trait');
    }
    // 覆盖合并：patch 按 trait 名或组件 id 匹配；浅合并到蓝图数据的浅拷贝上，
    // 保证蓝图本身不可被 spawn 过程污染
    const p = opts?.patch;
    const patchEntry = p ? (p[entry.trait.name] ?? p[entry.trait.id]) : undefined;
    const base = entry.data ?? entry.trait.create();
    const patchData =
      patchEntry && typeof base === 'object' && base !== null
        ? { ...(base as Record<string, unknown>), ...patchEntry }
        : patchEntry ?? base;
    // 深拷贝后再挂载：同蓝图多次 spawn 的实体互不共享引用
    world.entities.addComponent(entityId, entry.trait, deepClone(patchData) as never);
  }

  if (bp.name) {
    const existing = world.entities.getComponent(
      entityId,
      NameRef as ComponentDefinition<{ text: string; aliases: string[] }>,
    );
    if (existing) {
      existing.text = bp.name;
    } else {
      world.entities.addComponent(entityId, Name, deepClone({ text: bp.name, aliases: [] }));
    }
  }

  return entityId;
}
