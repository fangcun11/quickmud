import type { Entity, EntityId, ComponentId, ComponentDefinition } from './types';

/**
 * 深拷贝（用于快照恢复，切断与快照对象的引用共享）
 * structuredClone 不可用时的 JSON 兜底。
 */
function deepClone<T>(value: T): T {
  if (typeof structuredClone === 'function') {
    return structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value)) as T;
}

/**
 * 实体管理器 - 管理游戏世界中的所有实体
 */
export class EntityManager {
  private entities = new Map<EntityId, Entity>();
  private idCounter = 0;

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
   * @param id - 实体ID
   * @returns 是否删除成功
   */
  delete(id: EntityId): boolean {
    return this.entities.delete(id);
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
    entity.components.set(component.id, componentData);
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

    return entity.components.delete(component.id);
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
    entity.components.set(componentId, deepClone(data));
  }

  /**
   * 查找拥有特定组件的所有实体
   * @param component - 组件定义
   * @returns 实体ID数组
   */
  findByComponent<T>(component: ComponentDefinition<T>): EntityId[] {
    const result: EntityId[] = [];
    for (const [id, entity] of this.entities) {
      if (entity.components.has(component.id)) {
        result.push(id);
      }
    }
    return result;
  }

  /**
   * 查找同时拥有多个组件的所有实体
   * @param components - 组件定义数组
   * @returns 实体ID数组
   */
  findByComponents<T extends ComponentDefinition<unknown>[]>(
    ...components: T
  ): EntityId[] {
    const componentIds = components.map(c => c.id);
    const result: EntityId[] = [];
    
    for (const [id, entity] of this.entities) {
      if (componentIds.every(id => entity.components.has(id))) {
        result.push(id);
      }
    }
    
    return result;
  }

  /**
   * 清空所有实体
   */
  clear(): void {
    this.entities.clear();
  }

  /**
   * 获取实体数量
   * @returns 实体数量
   */
  get size(): number {
    return this.entities.size;
  }
}