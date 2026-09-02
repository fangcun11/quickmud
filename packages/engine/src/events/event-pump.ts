import type { EventToken } from '../core/types';
import type { EventHandler, EventPayload, EventSubscription } from './types';
import type { SystemErrorPolicy } from '../systems/types';
import type { PendingEvent } from '../persistence/types';

/** 系统错误记录（skip/degrade 策略下累积） */
export interface SystemErrorRecord {
  token: EventToken;
  message: string;
  policy: SystemErrorPolicy;
}

/**
 * 事件队列项
 */
interface QueuedEvent {
  token: EventToken;
  payload: unknown;
  timestamp: number;
}

/**
 * 事件泵配置
 */
export interface EventPumpConfig {
  /** 单条命令最大事件数 */
  maxEventsPerCommand?: number;
  /** 时间源。默认为内部单调计数器（0,1,2…），保证模拟确定性；
   * 禁止默认使用 Date.now() 之类的外部时间。 */
  now?: () => number;
}

/**
 * 事件泵 - 事件驱动架构的核心
 *
 * 职责：
 * 1. 维护事件队列
 * 2. 按优先级分发事件给订阅者
 * 3. 支持 queued (BFS) 和 immediate (DFS) 两种传播模式
 * 4. 管理事件链的事务边界
 */
export class EventPump {
  private subscriptions = new Map<EventToken, EventSubscription[]>();
  private queue: QueuedEvent[] = [];
  private processing = false;
  private eventCount = 0;
  private readonly maxEvents: number;
  private readonly now: () => number;
  private monoCounter = 0;
  private systemErrors: SystemErrorRecord[] = [];
  /** 延时事件队列：triggerAt 升序，同刻按插入序（确定性） */
  private scheduled: Array<PendingEvent & { seq: number }> = [];
  private scheduledSeq = 0;

  constructor(config?: EventPumpConfig) {
    this.maxEvents = config?.maxEventsPerCommand ?? 1000;
    this.now = config?.now ?? (() => ++this.monoCounter);
  }

  /**
   * 订阅事件
   */
  on<T>(
    token: EventToken,
    handler: EventHandler<T>,
    priority = 0,
    onError?: SystemErrorPolicy
  ): () => void {
    const subscription: EventSubscription = {
      token,
      handler: handler as EventHandler<unknown>,
      priority,
      onError,
    };

    const handlers = this.subscriptions.get(token) ?? [];
    handlers.push(subscription);
    // 按优先级排序（升序）
    handlers.sort((a, b) => a.priority - b.priority);
    this.subscriptions.set(token, handlers);

    // 返回取消订阅函数
    return () => {
      const current = this.subscriptions.get(token);
      if (current) {
        const index = current.indexOf(subscription);
        if (index !== -1) {
          current.splice(index, 1);
        }
      }
    };
  }

  /**
   * 发射事件到队列尾部 (BFS)
   */
  emit(token: EventToken, data: unknown, timestamp = this.now()): void {
    if (this.eventCount >= this.maxEvents) {
      throw new Error(
        `Event budget exceeded: ${this.eventCount}/${this.maxEvents} events per command`
      );
    }

    this.eventCount++;

    if (this.processing) {
      // 处理中 → 入队尾部
      this.queue.push({ token, payload: data, timestamp });
    } else {
      // 空闲 → 直接处理
      this.queue.push({ token, payload: data, timestamp });
      this.processQueue();
    }
  }

  /**
   * 立即处理事件 (DFS)
   */
  emitImmediate(token: EventToken, data: unknown, timestamp = this.now()): void {
    if (this.eventCount >= this.maxEvents) {
      throw new Error(
        `Event budget exceeded: ${this.eventCount}/${this.maxEvents} events per command`
      );
    }

    this.eventCount++;

    // 暂存当前队列状态
    const savedQueue = this.queue;
    this.queue = [{ token, payload: data, timestamp }];

    // 递归处理
    while (this.queue.length > 0) {
      const event = this.queue.shift()!;
      this.processEvent(event);
    }

    // 恢复队列
    this.queue = savedQueue;
  }

  /**
   * 显式排水：处理队列内所有事件直至清空
   *
   * emit 在空闲时已自动排水，故通常无需调用；
   * 供测试工具与手工塞入队列的场景显式推进（重入时安全空转返回）。
   */
  drain(): void {
    this.processQueue();
  }

  /**
   * 处理事件队列 (BFS)
   */
  private processQueue(): void {
    if (this.processing) return;
    this.processing = true;

    try {
      while (this.queue.length > 0) {
        const event = this.queue.shift()!;
        this.processEvent(event);
      }
    } finally {
      this.processing = false;
    }
  }

  /**
   * 处理单个事件
   */
  private processEvent(event: QueuedEvent): void {
    const handlers = this.subscriptions.get(event.token);
    if (!handlers) return;

    for (const subscription of handlers) {
      if (subscription.disabled) continue;
      try {
        const payload: EventPayload = {
          token: event.token,
          data: event.payload,
          timestamp: event.timestamp,
        };

        // 事件泵本身不持有实体表，故 context 只提供 emit——
        // 系统经 World.register 订阅时收到的是 World 注入的完整
        // SystemContext（getComponent/output/after 等），与此无关。
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (subscription.handler as any)(payload, {
          emit: (token: EventToken, data: unknown) => {
            this.emit(token, data);
          },
        });
      } catch (error) {
        this.handleError(subscription, error);
      }
    }
  }

  /**
   * 按订阅声明的策略处理系统错误：
   * - propagate：包装后向上抛出，中止整条事件链（默认，fail-fast）
   * - skip：记录错误，链路继续
   * - degrade：记录错误，链路继续，且该系统被隔离禁用
   * 错误日志见 getSystemErrors()（确定性：仅追加，不隐式清空）。
   */
  private handleError(subscription: EventSubscription, error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    const policy = subscription.onError ?? 'propagate';

    if (policy === 'propagate') {
      throw new Error(`Event handler error: ${message}`);
    }

    this.systemErrors.push({
      token: subscription.token,
      message,
      policy,
    });

    if (policy === 'degrade') {
      subscription.disabled = true;
    }
  }

  /**
   * 调度延时事件：currentMs + delayMs 后触发（触发时走 emit，受预算与策略约束）
   */
  schedule(token: EventToken, data: unknown, delayMs: number, currentMs: number): void {
    this.scheduled.push({
      token,
      data,
      triggerAt: currentMs + delayMs,
      seq: ++this.scheduledSeq,
    });
    this.scheduled.sort((a, b) => a.triggerAt - b.triggerAt || a.seq - b.seq);
  }

  /**
   * 触发所有到期的延时事件（World.tick 驱动；同刻按调度顺序）
   */
  fireDue(currentMs: number): void {
    while (this.scheduled.length > 0 && this.scheduled[0]!.triggerAt <= currentMs) {
      const due = this.scheduled.shift()!;
      this.emit(due.token, due.data, due.triggerAt);
    }
  }

  /** 当前未触发的延时事件（快照用，seq 剥离） */
  getScheduled(): PendingEvent[] {
    return this.scheduled.map(({ token, data, triggerAt }) => ({ token, data, triggerAt }));
  }

  /** 从快照恢复延时队列（seq 重排以保持 triggerAt+原顺序的确定性） */
  restoreScheduled(events: PendingEvent[]): void {
    this.scheduled = events
      .map((e, i) => ({ ...e, seq: i }))
      .sort((a, b) => a.triggerAt - b.triggerAt || a.seq - b.seq);
  }

  /**
   * 获取系统错误日志（skip/degrade 模式下累积；propagate 不经过此日志）
   */
  getSystemErrors(): SystemErrorRecord[] {
    return [...this.systemErrors];
  }

  /**
   * 清空系统错误日志（测试/新命令周期使用）
   */
  clearSystemErrors(): void {
    this.systemErrors = [];
  }

  /** 事件预算上限（fork 配置透传用） */
  getMaxEventsPerCommand(): number {
    return this.maxEvents;
  }

  /**
   * 重置事件计数器（新命令开始时调用）
   */
  resetEventCount(): void {
    this.eventCount = 0;
  }

  /**
   * 清空队列
   */
  clearQueue(): void {
    this.queue = [];
    this.eventCount = 0;
  }

  /**
   * 获取当前队列长度
   */
  get queueLength(): number {
    return this.queue.length;
  }

  /**
   * 获取当前事件计数
   */
  get currentEventCount(): number {
    return this.eventCount;
  }
}