import { World } from '../core/world';
import { EntityManager } from '../core/entity';
import { OutputCollector } from '../output/output-collector';
import type { SystemDefinition } from '../systems/types';
import type { AnyCommand } from '../commands/types';
import type { EventToken } from '../core/types';

/**
 * 手动时钟 - 用于测试的时间控制
 */
export class ManualClock {
  private time = 0;

  now(): number {
    return this.time;
  }

  advance(ms: number): void {
    this.time += ms;
  }

  reset(): void {
    this.time = 0;
  }
}

/**
 * 测试世界配置
 *
 * 构造器与 createTestWorld 工厂共用此类型——
 * 两处各写一份签名曾导致 commands 在工厂侧丢失（类型未兑现运行时能力）。
 */
export interface TestWorldConfig {
  systems?: SystemDefinition[];
  commands?: AnyCommand[];
  entities?: Array<{ id?: string; components?: Record<string, unknown> }>;
  clock?: ManualClock;
}

/**
 * 测试世界 - 用于单元测试的简化世界
 *
 * @example
 * ```typescript
 * const w = createTestWorld({
 *   systems: [CombatSystem],
 *   entities: [goblinFixture],
 *   clock: manualClock,
 * })
 *
 * w.emit(AttackCommand, { attacker: player, target: goblin })
 * w.runChain()
 *
 * expect(w.eventLog).toEqual([AttackCommand, Damage])
 * expect(goblin.get(Health)!.current).toBe(0)
 * ```
 */
export class TestWorld {
  readonly world: World;
  readonly clock: ManualClock;
  private _eventLog: EventToken[] = [];
  private chainRunning = false;

  get eventLog(): EventToken[] {
    return this._eventLog;
  }

  constructor(config: TestWorldConfig) {
    this.world = new World();
    this.clock = config.clock ?? new ManualClock();

    // 注册系统
    if (config.systems) {
      this.world.register(...config.systems);
    }

    // 注册命令
    if (config.commands) {
      this.world.registerCommands(...config.commands);
    }

    // 创建测试实体
    if (config.entities) {
      for (const entityDef of config.entities) {
        // 固定 id 应被尊重（此前被静默丢弃、一律 create() 计数 id）
        const id = entityDef.id
          ? this.world.entities.createWithId(entityDef.id)
          : this.world.entities.create();
        if (entityDef.components) {
          for (const [componentId, data] of Object.entries(entityDef.components)) {
            // 暂时直接存储组件数据
            const entity = this.world.entities.get(id);
            if (entity) {
              entity.components.set(componentId, data);
            }
          }
        }
      }
    }

    // 拦截事件泵以记录事件日志
    const originalEmit = this.world.eventPump.emit.bind(this.world.eventPump);
    this.world.eventPump.emit = <T>(token: EventToken, data: T, timestamp?: number) => {
      this._eventLog.push(token);
      originalEmit(token, data, timestamp);
    };
  }

  /**
   * 发射事件
   *
   * 构造器已包装 eventPump.emit 统一记录日志，这里直接转发即可——
   * 不要再次 push，否则与命令路径（只记一次）语义不一致。
   */
  emit<T>(token: EventToken, data: T): void {
    this.world.eventPump.emit(token, data);
  }

  /**
   * 手动驱动事件链至清空
   *
   * 事件泵在空闲时 emit 会同步排水，所以多数情况下调用时队列已空；
   * 此处显式 drain 以覆盖队列仍有残留的情形（幂等、可重复调用）。
   * 注意：不要退化成 `while (queueLength > 0) {}` 空转——那不会推进
   * 任何工作，队列真非空时会直接卡死进程。
   */
  runChain(): void {
    if (this.chainRunning) return;
    this.chainRunning = true;
    try {
      this.world.eventPump.drain();
    } finally {
      this.chainRunning = false;
    }
  }

  /**
   * 获取输出收集器
   */
  get output(): OutputCollector {
    return this.world.output;
  }

  /**
   * 获取实体管理器
   */
  get entities(): EntityManager {
    return this.world.entities;
  }

  /**
   * 获取事件日志
   */
  getLog(): EventToken[] {
    return [...this.eventLog];
  }

  /**
   * 清空事件日志
   */
  clearLog(): void {
    this._eventLog = [];
  }
}

/**
 * 创建测试世界
 */
export function createTestWorld(config?: TestWorldConfig): TestWorld {
  return new TestWorld(config ?? {});
}