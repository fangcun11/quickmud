import { EntityManager } from './entity';
import { spawnBlueprint } from './blueprint';
import type { EntityBlueprint, SpawnOptions } from './blueprint';
import { Name } from './name';
import { deepClone } from '../internal/clone';
import { TICK_TOKEN } from '../events/tick';
import { EventPump } from '../events/event-pump';
import { EntityDestroyed } from '../events/entity-destroyed';
import { OutputCollector } from '../output/output-collector';
import { ENGINE_VERSION } from '../version';
import type { EntityId, ComponentDefinition, ComponentDataTuple, EventToken } from './types';
import type { RelationDefinition } from './trait';
import type { SystemDefinition, SystemContext } from '../systems/types';
import type { SystemErrorRecord } from '../events/event-pump';

/** every 系统收到的合成 tick 事件 token（实现在 events/tick.ts，此处 re-export 保持 API 稳定） */
export { TICK_TOKEN };
import type { AnyCommand, CommandContext, CommandMeta, ArgumentDefinition } from '../commands/types';

/** 带截断的编辑距离（F2 兜底近似匹配用；超过 max 提前返回 max+1） */
function editDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const prev = new Array<number>(b.length + 1);
  const curr = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    let rowMin = curr[0]!;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j]! + 1, curr[j - 1]! + 1, prev[j - 1]! + cost);
      rowMin = Math.min(rowMin, curr[j]!);
    }
    if (rowMin > max) return max + 1; // 整行都超界，提前剪枝
    for (let j = 0; j <= b.length; j++) prev[j] = curr[j]!;
  }
  return prev[b.length]!;
}
import type { EventDefinition, EventPayload, TypedEmit } from '../events/types';
import type { SnapshotData } from '../persistence/types';
import type { Segment, OutputMessage } from '../output/types';

/** 任意泛型参数的系统定义（register 运行时入口用；唯一豁免点） */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySystemDefinition = SystemDefinition<unknown> | SystemDefinition<any>;

/** 默认 tick 间隔（毫秒）——测试工具与 World 构造共用同一来源 */
export const DEFAULT_TICK_INTERVAL = 500;

/**
 * 世界配置
 */
export interface WorldConfig {
  /** tick 间隔（毫秒） */
  tickInterval?: number;
  /** 单条命令最大事件数 */
  maxEventsPerCommand?: number;
}

/**
 * 游戏世界 - 引擎的核心入口
 *
 * 职责：
 * 1. 管理实体和组件
 * 2. 协调事件泵、系统、命令
 * 3. 提供状态快照和回滚
 * 4. 驱动游戏循环
 */
export class World {
  readonly entities: EntityManager;
  readonly eventPump: EventPump;
  readonly output: OutputCollector;
  private systems: SystemDefinition[] = [];
  private commands: Map<string, AnyCommand> = new Map();
  private verbMap: Map<string, string> = new Map();
  private tickCount = 0;
  /** 世界时间（毫秒），仅由 tick() 推进 —— 确定性时钟 */
  private timeMs = 0;
  private tickInterval: number;
  /** every 系统的 skip/degrade 错误写入泵日志（复用同一份记录） */
  private systemErrorSink: SystemErrorRecord[] = [];
  private tickTimer?: ReturnType<typeof setInterval>;

  constructor(config?: WorldConfig) {
    this.entities = new EntityManager();
    // entity_destroyed 合成事件（0.14）：删除成功时由 EntityManager 通知，
    // World 统一发射。clear() 静默——回滚/fork/读档的重建不误发。
    this.entities.onDestroyed = (id) => {
      this.eventPump.emit(EntityDestroyed.token, { id });
    };
    this.eventPump = new EventPump({
      maxEventsPerCommand: config?.maxEventsPerCommand,
      // 事件 timestamp 统一为入队时的世界时间（0.12 起）；
      // beforeSave/restore 时 timeMs 随快照回放，timestamp 天然随之走
      now: () => this.timeMs,
    });
    this.output = new OutputCollector();
    this.tickInterval = config?.tickInterval ?? DEFAULT_TICK_INTERVAL;
  }

  /**
   * 获取系统错误日志（skip/degrade 策略下累积）
   */
  getSystemErrors(): SystemErrorRecord[] {
    return [...this.eventPump.getSystemErrors(), ...this.systemErrorSink];
  }

  /**
   * 清空系统错误日志
   */
  clearSystemErrors(): void {
    this.eventPump.clearSystemErrors();
    this.systemErrorSink = [];
  }

  /** 构建系统上下文（事件系统与 every 定时系统共用）。
   * context 是无状态视图（闭包只引用 World 自身），缓存单实例复用，
   * 热路径不再每事件每系统重建一次全量对象。 */
  private systemContext?: SystemContext;

  /** 输出视图（SystemContext 与 CommandContext 共用同一形态） */
  private makeOutputView() {
    const wrap = (kind: 'narrative' | 'system' | 'dialogue') =>
      (textOrSegments: string | Segment[]) => {
        if (typeof textOrSegments === 'string') {
          this.output[kind]([{ text: textOrSegments }]);
        } else {
          this.output[kind](textOrSegments);
        }
      };
    return {
      narrative: wrap('narrative'),
      title: (text: string) => this.output.title(text),
      system: wrap('system'),
      dialogue: wrap('dialogue'),
      error: (text: string) => this.output.error(text),
      status: (data: unknown) => this.output.status(data),
    };
  }

  private makeSystemContext(): SystemContext {
    if (this.systemContext) return this.systemContext;
    this.systemContext = {
      emit: this.makeEmit(),
      getEntity: (id: EntityId) => this.entities.get(id),
      getComponent: <T>(id: EntityId, component: ComponentDefinition<T>) =>
        this.entities.getComponent(id, component),
      findByComponent: <T>(component: ComponentDefinition<T>) =>
        this.entities.findByComponent(component),
        each: (components, callback) => this.each(components, callback),
        addRelation: (id, rel, target) => this.entities.addRelation(id, rel, target),
        removeRelation: (id, rel, target) => this.entities.removeRelation(id, rel, target),
        getRelations: (id, rel) => this.entities.getRelations(id, rel),
        hasRelation: (id, rel, target) => this.entities.hasRelation(id, rel, target),
        findRelated: (rel, target) => this.entities.findRelated(rel, target),
        spawn: (bp, opts) => this.spawn(bp, opts),
      destroy: (id) => this.entities.delete(id),
      output: this.makeOutputView(),
      after: (delayMs, definitionOrToken, data) => {
        const token = typeof definitionOrToken === 'string' ? definitionOrToken : definitionOrToken.token;
        return this.eventPump.schedule(token, data, delayMs, this.timeMs);
      },
      cancel: (handle) => this.eventPump.cancel(handle),
    };
    return this.systemContext;
  }

  /** 类型化事件发射器（EventDefinition 或 token 皆可） */
  private makeEmit(): TypedEmit {
    const emit = (definitionOrToken: EventDefinition<unknown> | EventToken, data: unknown): void => {
      const token = typeof definitionOrToken === 'string' ? definitionOrToken : definitionOrToken.token;
      this.eventPump.emit(token, data);
    };
    return emit as TypedEmit;
  }

  /**
   * 注册系统
   *
   * 参数可为单个系统、多个系统或系统的数组（自动展开）：
   * world.register(sysA, [sysB, sysC]);
   */
  register(...inputs: Array<AnySystemDefinition | AnySystemDefinition[]>): void {
    const systems = inputs.flat();
    for (const system of systems) {
      this.systems.push(system);

      // 订阅事件（on 元素可能为 EventDefinition 或 token，运行时统一归一化）
      if (system.on) {
        for (const entry of system.on) {
          const token = typeof entry === 'string' ? entry : entry.token;
          this.eventPump.on(token, (payload: EventPayload<unknown>) => {
            // 唯一的类型收敛点：泛型 T 在注册循环中已擦除，
            // 类型安全由 defineSystem<T> 在定义侧保证
            (system.handle as (p: EventPayload<unknown>, c: SystemContext) => void | Promise<void>)(
              payload,
              this.makeSystemContext()
            );
          }, system.priority ?? 0, system.onError);
        }
      }
    }

    // 批量排序（稳定排序：优先级相同则保持注册顺序）
    this.systems.sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0));
  }

  /**
   * 注册命令
   *
   * 动词/缩写冲突会显式抛错（否则后注册者静默覆盖前者，
   * 内容包与插件组合场景极易踩中）。
   * 重复注册同一命令（同 primaryVerb）幂等，不报错。
   * 参数可为单个命令、多个命令或命令数组（自动展开）：
   * world.registerCommands(cmdA, [cmdB, cmdC]);
   */
  registerCommands(...inputs: Array<AnyCommand | AnyCommand[]>): void {
    const commands = inputs.flat();
    for (const command of commands) {
      const primaryVerb = command.verbs[0]!.toLowerCase();

      // 冲突检测：主动词槽位
      const existing = this.commands.get(primaryVerb);
      if (existing && existing !== command) {
        throw new Error(
          `命令动词冲突："${primaryVerb}" 已被注册。冲突方：${existing.verbs.join('/')} 与 ${command.verbs.join('/')}`
        );
      }
      this.commands.set(primaryVerb, command);

      // 冲突检测：动词映射（verbs + abbrevs 全覆盖）
      const verbsAndAbbrevs = [...command.verbs, ...(command.abbrev ?? [])];
      for (const verb of verbsAndAbbrevs) {
        const v = verb.toLowerCase();
        const owner = this.verbMap.get(v);
        if (owner !== undefined && owner !== primaryVerb) {
          throw new Error(
            `命令动词冲突："${v}" 已被注册给 "${owner}"。冲突方：${command.verbs.join('/')}`
          );
        }
        this.verbMap.set(v, primaryVerb);
      }
    }
  }

  /**
   * 分叉出一个沙盒世界（D2）
   *
   * 状态：基于当前快照深拷贝（含延时事件、世界时间），与主世界零共享。
   * 行为：复用主世界已注册的系统/命令定义（定义为无 World 闭包的纯声明，
   * 注册只是向新世界的泵接线，安全且确定性等价）。
   * every 系统的时相由 worldTime 派生（见 tick 注释），随快照一并继承，
   * 因此分叉世界与主世界的后续 tick 行为逐帧等价。
   *
   * 典型用途：NPC AI 决策试跑、技能预演、UI 预览"如果走这条路会怎样"。
   *
   * 已知限制：不做写时复制（COW），fork 是 O(状态规模) 的快照拷贝；
   * 大世界高频 fork 场景留待后续版本引入 COW。
   */
  fork(): World {
    const forked = new World({
      tickInterval: this.tickInterval,
      maxEventsPerCommand: this.eventPump.getMaxEventsPerCommand(),
    });
    if (this.systems.length > 0) {
      forked.register(...this.systems);
    }
    if (this.commands.size > 0) {
      forked.registerCommands(...new Set(this.commands.values()));
    }
    // degrade 隔离态随 fork 继承：已降级系统不在分叉世界复活
    forked.eventPump.restoreDisabled(this.eventPump.getDisabled());
    forked.rollbackWorld(this.createSnapshot());
    return forked;
  }

  /**
   * 执行玩家输入
   *
   * 返回 Promise：命令的 handle 允许为异步函数，
   * 其返回的反馈文本必须等待后才能交付调用方。
   */
  async execute(input: string, playerId: EntityId): Promise<string | null> {
    // 重置事件计数
    // 0.12 起不再自动清空输出——多次 execute 的输出累积（批量处理/
    // 回合结算依赖它）；消费者用 drainOutput() 显式取走
    this.eventPump.resetEventCount();

    // 解析输入
    const trimmed = input.trim();
    if (!trimmed) return null;


    // 解析动词
    const parts = trimmed.split(/\s+/);
    const verb = (parts[0] ?? '').toLowerCase();
    const normalizedVerb = this.verbMap.get(verb);

    if (!normalizedVerb) {
      // 兜底近似匹配（F2）：有相近动词就递一句「你是想…？」，没有保持原文案
      const hint = this.suggestVerb(verb);
      return hint ? `我不明白你的意思。你是想「${hint}」吗？` : '我不明白你的意思。';
    }

    const command = this.commands.get(normalizedVerb);
    if (!command) {
      return '命令未找到。';
    }

    // 简单参数解析
    // parseArgs 是动态键控实现，无法在编译期逐键推导；
    // 类型正确性由 ParsedArgValue 与 parseArgs 行为的契约注释保证（见 commands/types.ts），
    // 此处是引擎内部唯一的收敛点。
    const args = this.parseArgs(command, parts.slice(1)) as CommandContext['args'];

    // 执行命令
    const context: CommandContext = {
      raw: trimmed,
      args,
      player: playerId,
      // 0.11：命令侧输出通道。铁律"命令不改状态"对输出放宽——
      // 语义化输出（多段/对话/状态）不必再"为一个事件写一个系统"
      output: this.makeOutputView(),
      world: {
        emit: this.makeEmit(),
        getEntity: (id: EntityId) => this.entities.get(id),
        getComponent: <T>(id: EntityId, component: ComponentDefinition<T>) =>
          this.entities.getComponent(id, component),
        findByComponent: <T>(component: ComponentDefinition<T>) =>
          this.entities.findByComponent(component),
        each: (components, callback) => this.each(components, callback),
        getRelations: (id, rel) => this.entities.getRelations(id, rel),
        hasRelation: (id, rel, target) => this.entities.hasRelation(id, rel, target),
        findRelated: (rel, target) => this.entities.findRelated(rel, target),
        findEntity: (name: string) => this.findEntityByName(name),
      },
    };

    const result = await command.handle(context);

    // 如果命令返回字符串，直接输出
    if (typeof result === 'string') {
      return result;
    }

    // 返回 null，输出由事件链产出
    return null;
  }

  /**
   * 取走并清空累计输出（0.12 起）
   *
   * execute 不再每次自动清空（输出跨命令累积），宿主在渲染时机
   * 显式 drain——一次拿走全部消息并复位缓冲。
   * 只读检查可用 output.getAll()/ofKind()/last()（不清空）。
   */
  drainOutput(): OutputMessage[] {
    return this.output.drain();
  }

  /**
   * 解析命令参数
   */
  private parseArgs(command: AnyCommand, parts: string[]): Record<string, unknown> {
    const args: Record<string, unknown> = {};

    if (!command.args) return args;

    const argKeys = Object.keys(command.args);
    let partIndex = 0;

    for (const key of argKeys) {
      const def = command.args[key];
      if (!def) continue;

      switch (def.type) {
        case 'rest':
          args[key] = parts.slice(partIndex).join(' ');
          partIndex = parts.length;
          break;
        case 'word':
          args[key] = parts[partIndex] ?? '';
          partIndex++;
          break;
        case 'direction':
          args[key] = parts[partIndex] ?? '';
          partIndex++;
          break;
        case 'entity':
        case 'optional_entity':
          args[key] = parts[partIndex] ?? null;
          partIndex++;
          break;
      }
    }

    return args;
  }

  /**
   * 按名称查找实体
   *
   * 契约：实体名称存储于引擎内置的 Name 组件（{ text, aliases }）。
   * 按**优先级分级**匹配，同级内按实体创建顺序取首个命中：
   *
   * 1. 主名精确相等        —— `剑` 命中 `{ text: '剑' }`
   * 2. 别名精确相等        —— `小二` 命中 `{ aliases: ['小二'] }`
   * 3. 主名子串包含        —— `生锈` 命中 `{ text: '生锈的剑' }`
   * 4. 别名子串包含        —— `sword` 命中 `{ aliases: ['rusty-sword'] }`
   * 5. 输入反包含别名      —— `生锈的剑` 命中 `{ aliases: ['剑'] }`（最宽松，兜底）
   *
   * 分级的意义：单遍扫描时，先注册的长名会用子串抢走后注册的精确同名实体
   * （`剑` 命中 `生锈的剑`），玩家输入的精确名字反而找不到东西。
   */
  private findEntityByName(name: string): EntityId | undefined {
    // 0.14 起走组件反查索引：只扫挂了 Name 的实体（创建序），不再遍历全表——
    // 世界里大量无名字的内部实体（计数器、buff、区域数据…）从此零开销。
    // 候选仍是创建序，五级分级"首个命中"的语义与全表扫描逐点一致。
    const entities = this.entities.findByComponent(Name);
    // 索引 = 优先级层级，值 = 该层首个命中
    const hits: (EntityId | undefined)[] = [undefined, undefined, undefined, undefined, undefined];

    const take = (level: number, id: EntityId): void => {
      if (hits[level] === undefined) hits[level] = id;
    };

    for (const id of entities) {
      const nameComp = this.entities.getComponent(id, Name)!; // 索引保证存在
      const text = nameComp.text;
      const aliases = nameComp.aliases ?? [];

      if (text === name) {
        // 最高优先级，可以立即返回
        return id;
      }
      if (aliases.includes(name)) {
        take(1, id);
        continue;
      }
      if (text && text.includes(name)) {
        take(2, id);
        continue;
      }
      if (aliases.some((a) => a.includes(name))) {
        take(3, id);
        continue;
      }
      if (aliases.some((a) => name.includes(a))) {
        take(4, id);
      }
    }

    return hits.find((id) => id !== undefined);
  }


  /**
   * 生成世界快照
   */
  createSnapshot(): SnapshotData {
    // 深拷贝：快照必须是时间点的冻结视图，
    // 否则后续组件突变（如数组 push）会反向污染"过去"的快照
    const entities = this.entities.getAll().map(entity => ({
      id: entity.id,
      components: structuredClone(Object.fromEntries(entity.components)),
    }));

    return {
      engineVersion: ENGINE_VERSION,
      tickCount: this.tickCount,
      entities,
      worldTime: this.timeMs,
      idCounter: this.entities.getIdCounter(),
      scheduler: {
        // data 同样深拷贝：延时事件载荷若与活世界共享引用，
        // fork 世界触发修改会隔空污染主世界尚未触发的载荷
        pendingEvents: this.eventPump.getScheduled().map((e) => ({
          ...e,
          data: deepClone(e.data),
        })),
      },
    };
  }

  /**
   * 回滚到快照
   *
   * 恢复内容：实体（含原始ID）与组件数据、tick 计数；
   * 同时清空事件队列（队列是命令内的瞬态状态，快照不含它）。
   * 注意：系统/命令注册表不受回滚影响。
   */
  rollbackWorld(snapshot: SnapshotData): void {
    // 清空当前状态
    this.entities.clear();
    this.eventPump.clearQueue();

    // 恢复实体：按快照重建原始 ID，并逐个恢复组件数据
    for (const entityData of snapshot.entities) {
      this.entities.createWithId(entityData.id);
      for (const componentId of Object.keys(entityData.components)) {
        this.entities.restoreComponent(entityData.id, componentId, entityData.components[componentId]);
      }
    }

    this.tickCount = snapshot.tickCount;
    this.timeMs = snapshot.worldTime ?? 0;
    this.entities.setIdCounter(snapshot.idCounter ?? 0);
    this.entities.rebuildRelationIndex(); // 关系索引恢复路径不增量维护，全量重建
    this.eventPump.restoreScheduled(snapshot.scheduler?.pendingEvents ?? []);
  }

  /**
   * 启动游戏循环
   */
  start(): void {
    this.tickTimer = setInterval(() => {
      this.tick();
    }, this.tickInterval);
  }

  /**
   * 停止游戏循环
   */
  stop(): void {
    if (this.tickTimer) {
      clearInterval(this.tickTimer);
      this.tickTimer = undefined;
    }
  }

  /**
   * 按名称查找实体（Name 主名精确/子串匹配，别名精确匹配）
   */
  findEntity(name: string): EntityId | undefined {
    return this.findEntityByName(name);
  }

  /**
   * 注册命令的只读元数据（0.14，F6）：动词/缩写/参数类型形状。
   *
   * 宿主（命令建议器、help 生成、兜底近似匹配）由此拿全集，不再依赖
   * 内容层把命令常量二次收编。同一名册去重；顺序 = 注册序（确定性）。
   */
  listCommands(): CommandMeta[] {
    const seen = new Set<AnyCommand>();
    const out: CommandMeta[] = [];
    for (const cmd of this.commands.values()) {
      if (seen.has(cmd)) continue;
      seen.add(cmd);
      const args: Record<string, { type: CommandMeta['args'][string]['type'] }> = {};
      for (const [key, def] of Object.entries(cmd.args ?? {})) {
        args[key] = { type: (def as ArgumentDefinition).type };
      }
      out.push({ verbs: [...cmd.verbs], abbrev: [...(cmd.abbrev ?? [])], args });
    }
    return out;
  }

  /**
   * 兜底近似匹配（0.14，F2）：未识别动词 → 从注册表找最接近的动词。
   * 前缀命中（双向）优先，否则编辑距离 ≤2 取最小者；无命中返回 undefined。
   */
  private suggestVerb(token: string): string | undefined {
    const t = token.toLowerCase();
    if (!t) return undefined;
    let best: string | undefined;
    let bestDist = Number.POSITIVE_INFINITY;
    for (const verb of new Set(this.commands.keys())) {
      const v = verb.toLowerCase();
      if (v.startsWith(t) || t.startsWith(v)) return verb;
      const d = editDistance(t, v, 2);
      if (d <= 2 && d < bestDist) {
        best = verb;
        bestDist = d;
      }
    }
    return best;
  }

  /**
   * 从蓝图生成实体（0.3 B0）：确定性的 addComponent 序列
   */
  spawn(bp: EntityBlueprint, opts?: SpawnOptions): EntityId {
    return spawnBlueprint(this, bp, opts);
  }

  // ---------- 组件访问（0.13 起顶层统一入口） ----------
  //
  // 组件读写全部提升到 World 顶层，与 SystemContext（ctx.getComponent /
  // ctx.findByComponent）和 CommandContext.world.getComponent 同名同签名——
  // 同一个操作在三个层面只有一种写法。`world.entities` 降为实体存储与
  // 内部机制（create/createWithId/has/get/delete/快照恢复），不再承载
  // 组件访问；组件数据结构的物理存取仍是 EntityManager 的实现细节。

  /** 读取组件（返回活引用——改字段即改世界状态；系统侧请走 ctx，命令侧禁止改） */
  getComponent<T>(id: EntityId, component: ComponentDefinition<T>): T | undefined {
    return this.entities.getComponent(id, component);
  }

  /** 组件存在性（不看数据，只看是否挂了） */
  hasComponent<T>(id: EntityId, component: ComponentDefinition<T>): boolean {
    return this.entities.hasComponent(id, component);
  }

  /** 挂组件（data 省略用组件默认值；测试/初始化/世界搭建用，游戏内改状态走系统） */
  addComponent<T>(id: EntityId, component: ComponentDefinition<T>, data?: T): void {
    this.entities.addComponent(id, component, data);
  }

  /** 摘组件（是否确实摘掉了） */
  removeComponent<T>(id: EntityId, component: ComponentDefinition<T>): boolean {
    return this.entities.removeComponent(id, component);
  }

  /** 函数式原位更新组件（组件不存在则抛错） */
  updateComponent<T>(
    id: EntityId,
    component: ComponentDefinition<T>,
    updater: (current: T) => T
  ): void {
    this.entities.updateComponent(id, component, updater);
  }

  /** 按组件查询实体（创建序；容器查询等场景） */
  findByComponent<T>(component: ComponentDefinition<T>): EntityId[] {
    return this.entities.findByComponent(component);
  }

  // ---------- 关系（0.15） ----------
  //
  // 关系 = 多目标组件（数据 `{ targets: EntityId[] }`）+ 二级反查索引。
  // 与组件访问同构：写走系统特权，读三层同名。

  /**
   * 建立一条关系（幂等：已存在同目标 no-op）。
   * 目标必须是活实体，否则抛错（fail-fast）。
   */
  addRelation(id: EntityId, rel: RelationDefinition, target: EntityId): void {
    this.entities.addRelation(id, rel, target);
  }

  /** 移除一条关系（最后一条时关系组件自动摘除） */
  removeRelation(id: EntityId, rel: RelationDefinition, target: EntityId): boolean {
    return this.entities.removeRelation(id, rel, target);
  }

  /** 该实体的全部关系目标（拷贝——写走 add/removeRelation） */
  getRelations(id: EntityId, rel: RelationDefinition): EntityId[] {
    return this.entities.getRelations(id, rel);
  }

  /** 是否建立了指向 target 的关系 */
  hasRelation(id: EntityId, rel: RelationDefinition, target: EntityId): boolean {
    return this.entities.hasRelation(id, rel, target);
  }

  /** 反查"谁指向 target"（索引，创建序）。目标被删后条目悬挂保留（删除不级联） */
  findRelated(rel: RelationDefinition, target: EntityId): EntityId[] {
    return this.entities.findRelated(rel, target);
  }

  /**
   * 多组件联合迭代（0.14，flecs each 思想）
   *
   * 内连接语义：只迭代**同时拥有**全部列出的组件的实体，缺任一即跳过。
   * 回调按传入顺序收到各组件数据（活引用，可原地改——系统侧特权），
   * 迭代顺序为实体创建序（与 findByComponent 一致）。
   *
   * 类型上组件元组自动映射为数据元组：
   * ```ts
   * world.each([Position, Health], (id, pos, hp) => { ... });
   * // pos: PositionData, hp: HealthData —— 无需断言
   * ```
   *
   * 底层走反查索引（以候选集最小的组件为主扫描），规模大时显著快于
   * findByComponent 手写双重循环。
   */
  each<T extends readonly ComponentDefinition<unknown>[]>(
    components: T,
    callback: (id: EntityId, ...data: ComponentDataTuple<T>) => void
  ): void {
    for (const id of this.entities.findByComponents(...components)) {
      const datas = components.map((c) => this.entities.getComponent(id, c));
      // 内连接保证全存在；类型收敛点：ComponentDataTuple 已在签名侧保证
      (callback as (id: EntityId, ...data: unknown[]) => void)(id, ...datas);
    }
  }

  /**
   * 执行一个 tick：
   * 1. 推进世界时间
   * 2. 触发所有到期延时事件（ctx.after 调度的）
   * 3. 触发所有跨过 every 网格点的周期系统
   *
   * every 的时相**完全由世界时间派生**（固定网格 `k * every`，
   * 由跨过该点的第一个 tick 承接），不保存"上次触发时间"这类
   * 游离状态。这样快照 / 回滚 / fork / 录像重放天然一致——
   * timeMs 已在快照里，时相就在快照里。
   *
   * 副作用：触发间隔是 drift-free 的（长期平均严格等于 every），
   * 而非"自上次触发起至少 every"（后者会随 tickInterval 累积漂移）。
   */
  tick(): void {
    this.tickCount++;
    // 事件预算按 tick 重置：预算约束的是"一个 tick 内的事件风暴"，
    // 而非跨 tick 无限累计（纯 tick 长跑的世界不应因累计超限崩溃）
    this.eventPump.resetEventCount();
    const prevTime = this.timeMs;
    this.timeMs += this.tickInterval;
    this.eventPump.fireDue(this.timeMs);

    for (const system of this.systems) {
      if (!system.every || system.every <= 0) continue;
      // 本 tick 是否跨过了一个 every 网格点
      if (Math.floor(this.timeMs / system.every) <= Math.floor(prevTime / system.every)) {
        continue;
      }
      try {
        (system.handle as (p: EventPayload<unknown>, c: SystemContext) => void)(
          { token: TICK_TOKEN, data: { time: this.timeMs }, timestamp: this.timeMs },
          this.makeSystemContext(),
        );
      } catch (error) {
        this.handleSystemError(system, error);
      }
    }
  }

  /** every 系统错误处理（走与事件系统一致的 onError 策略） */
  private handleSystemError(system: AnySystemDefinition, error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    if ((system.onError ?? 'propagate') === 'propagate') {
      // { cause } 保留原始 error（与事件泵的错误包装一致）
      throw new Error(`Event handler error: ${message}`, { cause: error });
    }
    this.systemErrorSink.push({ token: TICK_TOKEN, message, policy: system.onError!, cause: error });
    // degrade 对 every 系统同样生效：从后续 tick 中摘除
    if (system.onError === 'degrade') {
      this.systems = this.systems.filter((s) => s !== system);
    }
  }

  /** 当前世界时间（毫秒） */
  get currentTime(): number {
    return this.timeMs;
  }

  /**
   * 获取当前 tick 数
   */
  getTickCount(): number {
    return this.tickCount;
  }
}