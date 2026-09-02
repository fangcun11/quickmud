import { World, DEFAULT_TICK_INTERVAL } from '../core/world';
import { EntityManager } from '../core/entity';
import { OutputCollector } from '../output/output-collector';
import type { SystemDefinition } from '../systems/types';
import type { AnyCommand } from '../commands/types';
import type { EventToken } from '../core/types';

/**
 * 手动时钟 - 用于测试的时间控制
 *
 * 两种用法：
 * 1. **独立计数器**（默认）：`advance(ms)` 只推进自身读数
 * 2. **绑定世界**（由 TestWorld 自动装载）：`advance(ms)` 额外驱动世界 tick，
 *    世界时间真正前进——`every` 周期系统、`ctx.after` 延时事件随之触发
 *
 * 装不装槽位的差别就是 P1-4 那张空头支票：此前 advance 与世界毫无连接。
 */
export class ManualClock {
  private time = 0;
  private sink?: (ms: number) => void;

  now(): number {
    return this.time;
  }

  advance(ms: number): void {
    this.time += ms;
    this.sink?.(ms);
  }

  reset(): void {
    this.time = 0;
  }

  /**
   * 装载推进槽位（由 TestWorld 构造时调用）
   *
   * advance 之后回调，参数是被推进的毫秒数；世界侧据此 tick 到目标时间。
   */
  attachSink(sink: (ms: number) => void): void {
    this.sink = sink;
  }

  /** 卸载槽位（回到纯计数器语义） */
  detachSink(): void {
    this.sink = undefined;
  }

  /**
   * 把读数对齐到给定时间（由 TestWorld 在推进后调用）
   *
   * tickInterval 不整除时世界时间会略超前于请求量，以**世界时间为准**，
   * 避免 clock 与世界说两套时间。
   */
  sync(ms: number): void {
    this.time = ms;
  }
}

/**
 * 测试世界配置
 *
 * 构造器与 createTestWorld 工厂共用此类型——
 * 两处各写一份签名曾导致 commands 在工厂侧丢失（类型未兑现运行时能力）。
 */
export interface TestWorldConfig {
  // 与 World.register 同款收敛点：系统是"任一具体载荷"的定义，而非仅 unknown
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  systems?: Array<SystemDefinition<unknown> | SystemDefinition<any>>;
  commands?: AnyCommand[];
  entities?: Array<{ id?: string; components?: Record<string, unknown> }>;
  clock?: ManualClock;
  /** tick 间隔（毫秒）；省略则用引擎默认（500） */
  tickInterval?: number;
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
  readonly tickInterval: number;
  private _eventLog: EventToken[] = [];
  private chainRunning = false;

  get eventLog(): EventToken[] {
    return this._eventLog;
  }

  /** 当前世界时间（毫秒）——与 clock 同步，是唯一的时间真相 */
  get currentTime(): number {
    return this.world.currentTime;
  }

  constructor(config: TestWorldConfig) {
    this.clock = config.clock ?? new ManualClock();
    this.tickInterval = config.tickInterval ?? DEFAULT_TICK_INTERVAL;
    this.world = new World({ tickInterval: this.tickInterval });
    // 兑现"手动时钟"承诺：clock 推进即驱动世界（every 系统 / 延时事件随之触发）
    this.clock.attachSink((ms) => this.advance(ms));

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
   * 推进世界时间（毫秒）
   *
   * 按 tickInterval 循环 tick，直到世界时间 >= 当前 + ms（不整除时取上整）。
   * 推进结束后把 clock 对齐到世界时间——世界时间才是真相。
   *
   * `clock.advance(ms)` 走的也是这里（构造时装了槽位）。
   */
  advance(ms: number): void {
    if (ms <= 0) return;
    if (this.tickInterval <= 0) {
      throw new Error(
        `TestWorld: tickInterval must be > 0 to advance time (got ${this.tickInterval})`,
      );
    }

    const target = this.world.currentTime + ms;
    // 护栏：tick 次数有理论上限，超出说明 interval/时间计算异常，
    // 宁可显式报错也不要让测试进程空转卡死
    const maxTicks = Math.ceil(ms / this.tickInterval) + 1;
    let ticks = 0;

    while (this.world.currentTime < target) {
      this.world.tick();
      if (++ticks > maxTicks) {
        throw new Error(`TestWorld: advance(${ms}) exceeded tick budget (${maxTicks})`);
      }
    }

    this.clock.sync(this.world.currentTime);
  }

  /** 推进 n 个 tick（默认 1），并同步 clock */
  tick(n = 1): void {
    for (let i = 0; i < n; i++) {
      this.world.tick();
    }
    this.clock.sync(this.world.currentTime);
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