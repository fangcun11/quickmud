import type { Entity, EntityId, ComponentId, ComponentDefinition } from './types';
import { deepClone } from '../internal/clone';

/**
 * 实体管理器 - 管理游戏世界中的所有实体
 *
 * 内部机制（0.13 起实体存储职责，组件访问的公开入口在 World 顶层）：
 * - componentIndex：组件反查索引（0.14，flecs query cache 最小版）——
 *   ComponentId -> 拥有该组件的实体 id 集合。挂/摘/删全部增量维护，
 *   findByComponent 从 O(n) 全表扫描降为 O(k log k)（k 为命中数，
 *   log k 来自保序排序）；快照恢复走 createWithId/restoreComponent，
 *   索引随数据自动重建。
 * - creationOrder：实体创建序号。索引候选集是无序 Set，输出按此
 *   排序以保持 findByComponent 的**创建序**契约（Map 迭代序不可查询，
 *   需要独立的序号载体）。恢复路径按快照序重建，相对序与原世界一致。
 */
export class EntityManager {
  private entities = new Map<EntityId, Entity>();
  private idCounter = 0;
  private componentIndex = new Map<ComponentId, Set<EntityId>>();
  private creationOrder = new Map<EntityId, number>();
  private creationSeq = 0;
  /**
   * 实体销毁通知（0.14）：delete() 成功时回调（clear() 静默——回滚/
   * fork/读档的重建路径不走 delete）。World 注入以发射 entity_destroyed。
   */
  onDestroyed?: (id: EntityId) => void;

  /** 维护反查索引：实体获得某组件时挂入候选集 */
  private indexAdd(componentId: ComponentId, entityId: EntityId): void {
    let set = this.componentIndex.get(componentId);
    if (!set) {
      set = new Set();
      this.componentIndex.set(componentId, set);
    }
    set.add(entityId);
  }

  /** 维护反查索引：实体失去某组件时摘出候选集 */
  private indexRemove(componentId: ComponentId, entityId: EntityId): void {
    this.componentIndex.get(componentId)?.delete(entityId);
  }

  /** 索引候选集按创建序输出（保序的核心） */
  private sortByCreation(ids: Iterable<EntityId>): EntityId[] {
    return [...ids].sort(
      (a, b) => this.creationOrder.get(a)! - this.creationOrder.get(b)!
    );
  }

  /**
   * 获取当前 ID 计数器（快照用——"下一个 create() 返回什么"必须可由快照决定，
   * 否则 fork/回滚后的世界与主世界拥有不同的未来）
   */
  getIdCounter(): number {
    return this.idCounter;
  }

  /**
   * 恢复 ID 计数器（快照恢复用）。计数器只进不退；
   * 传入小于当前值的数会被忽略，保证不会复用一个已分配过的 ID。
   */
  setIdCounter(counter: number): void {
    this.idCounter = Math.max(this.idCounter, counter);
  }

  /**
   * 创建实体（确定性 ID：计数器生成，避免 nanoid 等随机源破坏模拟确定性）
   * @returns 新实体的ID
   */
  create(): EntityId {
    let id: EntityId;
    // 碰撞保护：读档恢复的实体可能占用计数器语义上的编号
    do {
      id = `e${(++this.idCounter).toString(36)}` as EntityId;
    } while (this.entities.has(id));
    const entity: Entity = {
      id,
      components: new Map()
    };
    this.entities.set(id, entity);
    this.creationOrder.set(id, ++this.creationSeq);
    return id;
  }

  /**
   * 使用指定ID创建实体（内容加载用）
   * @param id - 指定的实体ID
   * @returns 实体ID
   */
  createWithId(id: string): EntityId {
    const entityId = id as EntityId;
    if (this.entities.has(entityId)) {
      throw new Error(`Entity ${entityId} already exists`);
    }
    const entity: Entity = {
      id: entityId,
      components: new Map()
    };
    this.entities.set(entityId, entity);
    this.creationOrder.set(entityId, ++this.creationSeq);
    return entityId;
  }

  /**
   * 获取实体
   * @param id - 实体ID
   * @returns 实体或undefined
   */
  get(id: EntityId): Entity | undefined {
    return this.entities.get(id);
  }

  /**
   * 检查实体是否存在
   * @param id - 实体ID
   * @returns 是否存在
   */
  has(id: EntityId): boolean {
    return this.entities.has(id);
  }

  /**
   * 删除实体
   *
   * 0.14 起成功删除会触发 onDestroyed 回调（World 借此发射
   * entity_destroyed 事件）。注意 clear() 不触发——回滚/fork/读档
   * 的实体重建走 clear()，绝不能误发销毁事件。
   *
   * @param id - 实体ID
   * @returns 是否删除成功
   */
  delete(id: EntityId): boolean {
    const entity = this.entities.get(id);
    if (!entity) return false;
    // 从该实体拥有的所有组件的反查索引中摘除
    for (const componentId of entity.components.keys()) {
      this.indexRemove(componentId, id);
    }
    this.entities.delete(id);
    this.creationOrder.delete(id);
    this.onDestroyed?.(id);
    return true;
  }

  /**
   * 获取所有实体
   * @returns 实体数组
   */
  getAll(): Entity[] {
    return Array.from(this.entities.values());
  }

  /**
   * 为实体添加组件
   * @param entityId - 实体ID
   * @param component - 组件定义
   * @param data - 组件数据
   */
  addComponent<T>(
    entityId: EntityId,
    component: ComponentDefinition<T>,
    data?: T
  ): void {
    const entity = this.entities.get(entityId);
    if (!entity) {
      throw new Error(`Entity ${entityId} not found`);
    }

    const componentData = data ?? component.create();
    const had = entity.components.has(component.id);
    entity.components.set(component.id, componentData);
    if (!had) this.indexAdd(component.id, entityId);
  }

  /**
   * 获取实体的组件数据
   * @param entityId - 实体ID
   * @param component - 组件定义
   * @returns 组件数据或undefined
   */
  getComponent<T>(
    entityId: EntityId,
    component: ComponentDefinition<T>
  ): T | undefined {
    const entity = this.entities.get(entityId);
    if (!entity) {
      return undefined;
    }

    return entity.components.get(component.id) as T | undefined;
  }

  /**
   * 检查实体是否有某个组件
   * @param entityId - 实体ID
   * @param component - 组件定义
   * @returns 是否有该组件
   */
  hasComponent<T>(
    entityId: EntityId,
    component: ComponentDefinition<T>
  ): boolean {
    const entity = this.entities.get(entityId);
    if (!entity) {
      return false;
    }

    return entity.components.has(component.id);
  }

  /**
   * 更新实体的组件数据
   * @param entityId - 实体ID
   * @param component - 组件定义
   * @param updater - 更新函数
   */
  updateComponent<T>(
    entityId: EntityId,
    component: ComponentDefinition<T>,
    updater: (current: T) => T
  ): void {
    const entity = this.entities.get(entityId);
    if (!entity) {
      throw new Error(`Entity ${entityId} not found`);
    }

    const current = entity.components.get(component.id) as T | undefined;
    if (current === undefined) {
      throw new Error(`Component ${component.name} not found on entity ${entityId}`);
    }

    const updated = updater(current);
    entity.components.set(component.id, updated);
  }

  /**
   * 移除实体的组件
   * @param entityId - 实体ID
   * @param component - 组件定义
   * @returns 是否删除成功
   */
  removeComponent<T>(
    entityId: EntityId,
    component: ComponentDefinition<T>
  ): boolean {
    const entity = this.entities.get(entityId);
    if (!entity) {
      return false;
    }

    const removed = entity.components.delete(component.id);
    if (removed) this.indexRemove(component.id, entityId);
    return removed;
  }

  /**
   * 按组件ID直接恢复组件数据（快照恢复用）
   *
   * 与 addComponent 的区别：调用方持有的是序列化后的组件ID与数据，
   * 而非 ComponentDefinition；数据会被深拷贝，避免与快照对象共享引用。
   *
   * @param entityId - 实体ID
   * @param componentId - 组件ID
   * @param data - 序列化的组件数据
   */
  restoreComponent(entityId: EntityId, componentId: ComponentId, data: unknown): void {
    const entity = this.entities.get(entityId);
    if (!entity) {
      throw new Error(`Entity ${entityId} not found`);
    }
    const had = entity.components.has(componentId);
    entity.components.set(componentId, deepClone(data));
    if (!had) this.indexAdd(componentId, entityId);
  }

  /**
   * 查找拥有特定组件的所有实体
   *
   * 0.14 起走反查索引：O(k) 候选 + O(k log k) 保序排序
   * （k 为命中数，此前是 O(n) 全表扫描）。输出仍为**创建序**，
   * 与 0.13 及之前的语义一致。
   *
   * @param component - 组件定义
   * @returns 实体ID数组（创建序）
   */
  findByComponent<T>(component: ComponentDefinition<T>): EntityId[] {
    const candidates = this.componentIndex.get(component.id);
    if (!candidates || candidates.size === 0) return [];
    return this.sortByCreation(candidates);
  }

  /**
   * 查找同时拥有多个组件的所有实体
   *
   * 0.14 起走反查索引：以候选集最小的组件为主扫描集，
   * 其余组件做存在性验证。输出为**创建序**。
   * 空参数保持既有语义：返回所有实体。
   *
   * @param components - 组件定义数组
   * @returns 实体ID数组（创建序）
   */
  findByComponents<T extends ComponentDefinition<unknown>[]>(
    ...components: T
  ): EntityId[] {
    if (components.length === 0) {
      return this.getAll().map((entity) => entity.id);
    }

    // 取候选集最小的组件做主扫描（内连接的最优扫描顺序）
    let smallest: Set<EntityId> | undefined;
    let smallestId: ComponentId | undefined;
    for (const component of components) {
      const set = this.componentIndex.get(component.id);
      if (!set || set.size === 0) return [];
      if (!smallest || set.size < smallest.size) {
        smallest = set;
        smallestId = component.id;
      }
    }

    const otherIds = components
      .map((c) => c.id)
      .filter((id) => id !== smallestId);
    const result: EntityId[] = [];
    for (const id of smallest!) {
      const entity = this.entities.get(id);
      if (!entity) continue; // 索引脏数据防御（正常路径不会发生）
      if (otherIds.every((cid) => entity.components.has(cid))) {
        result.push(id);
      }
    }

    return this.sortByCreation(result);
  }

  /**
   * 清空所有实体（静默：不触发 onDestroyed——回滚/fork/读档的重建路径）
   */
  clear(): void {
    this.entities.clear();
    this.componentIndex.clear();
    this.creationOrder.clear();
    // creationSeq 不重置：实体 id 可能被读档复用（碰撞保护会跳号），
    // 但 creationOrder 是新起的一轮，序号只要单调即可，无需与历史对齐
  }

  /**
   * 获取实体数量
   * @returns 实体数量
   */
  get size(): number {
    return this.entities.size;
  }
}