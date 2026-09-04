/**
 * 房间模块（v0.9-A）—— 一个房间 = 实体 + 数据 + 行为 + 命令
 *
 * ## 为什么要这一层
 *
 * v0.8 的 `defineRoom` 只定义静态数据（名字/描述/出口），于是房间级的动态
 * 内容只能写成"订阅 Moved 的全局系统 + 在 handle 里 if (roomId === 'swamp')"。
 * 那是 LPMud 的 room proc 烂路：逻辑与房间分离，房间一多，系统里全是分支。
 *
 * 本模块让房间**自包含**：`defineRoom` 一次写完数据、`state`（状态组件）、
 * `on`（生命周期/周期处理器）、`commands`（房间专属动词）。
 *
 * ## 三条边界（防止房间膨胀成"第二个系统层"）
 *
 * 1. **函数可以是代码，状态必须在组件里**——`on.enter` 这类函数不进快照
 *    （它们是代码，加载时重新注册，与快照无关）；真正会毁掉快照的是
 *    **闭包捕获的状态**。所以房间状态走 `state` 组件，不写 `let`。
 * 2. **房间只管房间内的事**——跨房间机制属于 `defineArea` 或全局系统。
 *    房间吸收跨房间逻辑 = 十年后没人敢碰的巨型 room proc。
 * 3. **不是 100 个房间注册 100 个系统**——行为全部收进一张表，由
 *    `RoomEventSystem` / `RoomTickSystem` 两个系统按房间 id 查表派发。
 *
 * ## 派发为什么是两个系统而不是一个
 *
 * `World.tick()` 直接调 `every` 系统的 handle（传 `TICK_TOKEN`），**不走事件泵**；
 * 事件驱动的系统走事件泵。一个 handle 想两者兼得就得在内部按 token 分支——
 * 拆成两个系统更直白，也让周期行为的时钟账本能独立记账。
 */
import { defineSystem, defineCommand } from '@mud/ecs-engine';
import type {
  Entity,
  EntityId,
  World,
  SystemContext,
  ComponentDefinition,
  RelationDefinition,
} from '@mud/ecs-engine';
import { Moved, Look, RoomCommandInvoked } from './events.js';
import { Position, RoomClock, RoomBehaviorRef, Entered } from './traits.js';

/**
 * 房间周期行为的调度粒度（毫秒）
 *
 * 房间 `on.every.ms` 必须是它的**整数倍**（`buildRoomBehaviors` 定义期 fail-fast）。
 * 理由：RoomTickSystem 每 1000ms 醒一次，若房间要 500ms，实际只会 1000ms 触发
 * 一次——"写 500 得到 1000"这种静默降级比报错更坑。
 */
export const ROOM_TICK_MS = 1000;

/** 房间数据的形状（layout/build 消费它，与行为无关） */
export interface RoomDef {
  id: string;
  name: string;
  aliases?: string[];
  description: string;
  /** 方向 → 房间 id（拓扑的唯一真相） */
  exits: Record<string, string>;
  /** 所属区域 id（v0.9-B；区域由 `defineArea` 声明） */
  area?: string;
  /** 可选：显式钉住坐标（非欧空间 escape hatch），必须与推断一致 */
  coords?: { x: number; y: number };
}

/** 只读查询面（系统上下文与命令上下文都满足它） */
export interface RoomQueryScope {
  getEntity: (id: EntityId) => Entity | undefined;
  getComponent: <T>(id: EntityId, c: ComponentDefinition<T>) => T | undefined;
  findByComponent: <T>(c: ComponentDefinition<T>) => EntityId[];
  /** 该实体的全部关系目标（拷贝） */
  getRelations: (id: EntityId, rel: RelationDefinition) => EntityId[];
  /** 是否建立了指向 target 的关系 */
  hasRelation: (id: EntityId, rel: RelationDefinition, target: EntityId) => boolean;
  /** 反查"谁指向 target"（引擎二级索引） */
  findRelated: (rel: RelationDefinition, target: EntityId) => EntityId[];
  findEntity: (name: string) => EntityId | undefined;
}

/**
 * 守卫上下文（canEnter / canLeave）：**只读**
 *
 * 不给 `output`——守卫只回答"能不能过、为什么"，拒绝文案由 MovementSystem
 * 统一输出（否则同一个拒绝理由会在守卫里写一次、在移动系统里再写一次）。
 * 不给 `emit`/`spawn`/`destroy`——守卫跑在"决定是否移动"的半路上，
 * 这里造物会让"被拒绝的移动"留下副作用。
 */
export interface RoomGateContext<S> {
  /** 想移动的实体 */
  readonly entity: EntityId;
  /** 本守卫所在的房间（canLeave = 出发房间；canEnter = 目标房间） */
  readonly roomId: EntityId;
  /** 房间状态（未声明 `state` 的房间访问它会抛错） */
  readonly state: S;
  /** 本次移动的方向 */
  readonly direction: string;
  getEntity: RoomQueryScope['getEntity'];
  getComponent: RoomQueryScope['getComponent'];
  findByComponent: RoomQueryScope['findByComponent'];
  getRelations: RoomQueryScope['getRelations'];
  hasRelation: RoomQueryScope['hasRelation'];
  findRelated: RoomQueryScope['findRelated'];
}

/** 守卫返回值：返回非空字符串 = 拒绝，字符串即理由；返回 void/undefined/空串 = 放行 */
export type RoomGateResult = string | undefined | void;

/** 守卫：同步查询，不允许有副作用 */
export type RoomGate<S> = (ctx: RoomGateContext<S>) => RoomGateResult;

/**
 * 房间行为上下文：与系统同权（emit / spawn / destroy / output）
 *
 * `entity` 在 `every` 里等于房间自己（周期性行为没有别的主体）。
 * `from` / `direction` 只在 enter/leave 时有值（look / every 为 undefined）。
 */
export interface RoomEventContext<S> {
  readonly entity: EntityId;
  readonly roomId: EntityId;
  readonly state: S;
  /** enter：来处房间；leave：去处房间；look / every：undefined */
  readonly from?: EntityId;
  /** enter / leave：走的方向；look / every：undefined */
  readonly direction?: string;
  emit: SystemContext['emit'];
  getComponent: SystemContext['getComponent'];
  findByComponent: SystemContext['findByComponent'];
  getRelations: SystemContext['getRelations'];
  hasRelation: SystemContext['hasRelation'];
  findRelated: SystemContext['findRelated'];
  spawn: SystemContext['spawn'];
  destroy: SystemContext['destroy'];
  output: SystemContext['output'];
}

/** 房间行为处理器 */
export type RoomHandler<S> = (ctx: RoomEventContext<S>) => void;

/**
 * 房间生命周期钩子
 *
 * | 钩子 | 触发时机 | 典型用途 |
 * | --- | --- | --- |
 * | `canLeave` | 移动意图已定，尚未离开 | 门从里面锁死了 |
 * | `canEnter` | 出口存在、即将落位 | 需要钥匙 / 前方太黑 |
 * | `leave` | 已经落位，回望出发房间 | 身后的吊桥轰然断裂 |
 * | `enter` | 每次进入 | 沼泽毒雾、埋伏 |
 * | `firstEnter` | 该实体**首次**进入 | 一眼万年的场景描写 |
 * | `look` | `look`（无目标）时 | 房间描述的动态追加段 |
 * | `every` | 每 `ms` 毫秒（世界时间） | 火把燃尽、潮水涨落 |
 */
export interface RoomHandlers<S> {
  canEnter?: RoomGate<S>;
  canLeave?: RoomGate<S>;
  enter?: RoomHandler<S>;
  leave?: RoomHandler<S>;
  firstEnter?: RoomHandler<S>;
  look?: RoomHandler<S>;
  every?: {
    /** 间隔（毫秒），必须是 `ROOM_TICK_MS` 的整数倍 */
    ms: number;
    handle: RoomHandler<S>;
  };
}

/**
 * 房间命令上下文：与房间事件处理器**同级**的特权（emit / spawn / destroy / output）
 *
 * 为什么房间命令能 spawn，而引擎的全局命令（GoCommand 等）只能 emit：
 * 三条铁律里的"命令不改状态"约束的是**通用命令**——它们不知道游戏规则，
 * 改状态会抢走"唯一改状态的手"（系统）的职责。房间命令不是通用命令，
 * 它是房间行为的第四种触发器（与 enter / look / every 并列），跑在房间
 * 模块的派发路径上，是房间对自己领地内事务的处置权。
 */
export interface RoomCommandContext<S> {
  readonly entity: EntityId;
  readonly roomId: EntityId;
  readonly state: S;
  emit: SystemContext['emit'];
  spawn: SystemContext['spawn'];
  destroy: SystemContext['destroy'];
  output: SystemContext['output'];
  getEntity: RoomQueryScope['getEntity'];
  getComponent: RoomQueryScope['getComponent'];
  findByComponent: RoomQueryScope['findByComponent'];
  getRelations: RoomQueryScope['getRelations'];
  hasRelation: RoomQueryScope['hasRelation'];
  findRelated: RoomQueryScope['findRelated'];
  findEntity: RoomQueryScope['findEntity'];
}

/** 房间专属命令：动词只在**玩家身处该房间**时可用 */
export interface RoomCommandDef<S> {
  verbs: string[];
  /** 返回字符串 = 直接输出；返回 null/void = 输出由事件链产出 */
  handle: (ctx: RoomCommandContext<S>) => string | null | void;
}

/**
 * 房间模块定义：`RoomDef` + 可选的状态/行为/命令
 *
 * `S` 由 `state` 组件的形状决定，`on` 与 `commands` 里的 `ctx.state` 即 `S`。
 */
export interface RoomModuleDef<S extends Record<string, unknown> = Record<string, never>>
  extends RoomDef {
  /** 房间状态组件（进快照；`ctx.state` 的载体） */
  state?: ComponentDefinition<S>;
  /** 生命周期 / 周期行为 */
  on?: RoomHandlers<S>;
  /** 房间专属命令（自动带"必须在本房间"的位置校验） */
  commands?: RoomCommandDef<S>[];
}

/**
 * 定义层擦除泛型后的形态（只用于 `buildRoomBehaviors` 的入参与注册表）
 *
 * 为什么是 `any`：`state?: ComponentDefinition<S>` 是协变位（要 `S` 的超集），
 * `on` / `commands` 的处理器参数是逆变位（要 `S` 的子集）——`never` 与
 * `unknown` 各只能满足一头，`any` 双向通吃。这与引擎 `AnyCommand` 的收敛
 * 是同一个问题、同一种解法：仅注册表存储这一个点用 any，用户侧 defineRoom
 * 仍保持精确类型。
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyRoomModuleDef = RoomModuleDef<any>;

/**
 * 定义房间模块：校验 + 返回纯数据（函数原样保留——它们是代码，不进快照）
 */
export function defineRoom<S extends Record<string, unknown> = Record<string, never>>(
  def: RoomModuleDef<S>,
): RoomModuleDef<S> {
  if (!def.id) throw new Error('defineRoom: 房间 id 不能为空');
  if (!def.name) throw new Error('defineRoom: 房间 name 不能为空');
  if (def.on?.every !== undefined) {
    const ms = def.on.every.ms;
    if (!Number.isInteger(ms) || ms <= 0) {
      throw new Error(`defineRoom: 房间 ${def.id} 的 every.ms 必须是正整数，收到 ${ms}`);
    }
    if (ms % ROOM_TICK_MS !== 0) {
      throw new Error(
        `defineRoom: 房间 ${def.id} 的 every.ms=${ms} 不是 ROOM_TICK_MS(${ROOM_TICK_MS}) 的整数倍` +
          `（更小的间隔不会真的更快，只会静默降级——故定义期 fail-fast）`,
      );
    }
  }
  return {
    ...def,
    aliases: def.aliases,
    exits: { ...def.exits },
    coords: def.coords ? { ...def.coords } : undefined,
  };
}

// ---------------------------------------------------------------------------
// 行为注册表
// ---------------------------------------------------------------------------

/**
 * 房间行为表（模块级、只增不改）
 *
 * 房间实体上的 `RoomBehaviorRef.index` 指向这里。为什么绕一层下标：
 * 行为里全是函数，函数不能进组件（快照 structuredClone 遇函数直接抛
 * DataCloneError）；每个世界的房间各自持有一个整数下标，既能被快照，
 * 又不会让 A 世界的行为串到 B 世界。
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Erased = any;

interface RoomBehavior {
  roomId: string;
  state?: ComponentDefinition<Erased>;
  on: RoomHandlers<Erased>;
  commands: RoomCommandDef<Erased>[];
}

const BEHAVIORS: RoomBehavior[] = [];

/** 已经自动注册过房间系统的世界（幂等，避免重复注册同名系统） */
const BOOTSTRAPPED = new WeakSet<World>();

/** 取房间行为（查不到 = 静态房间） */
export function lookupRoomBehavior(
  scope: Pick<SystemContext, 'getComponent'>,
  roomId: EntityId,
): RoomBehavior | undefined {
  const ref = scope.getComponent(roomId, RoomBehaviorRef);
  if (!ref || ref.index < 0) return undefined;
  return BEHAVIORS[ref.index];
}

/** 读房间状态；未声明 `state` 的房间返回 undefined */
function readState(
  behavior: RoomBehavior,
  scope: Pick<SystemContext, 'getComponent'>,
  roomId: EntityId,
): Erased | undefined {
  return behavior.state ? scope.getComponent(roomId, behavior.state) : undefined;
}

/**
 * 给上下文装上 `state` 访问器
 *
 * 没声明 `state` 的房间访问 `ctx.state` 是内容 bug——定义期抓不到（类型上
 * `S` 默认是个空对象），所以运行期炸一句人话，而不是让人对着 `undefined`
 * 的属性赋值调试半小时。
 */
function withState<T extends object>(
  roomId: EntityId,
  state: Erased | undefined,
  base: T,
): T & { readonly state: Erased } {
  return Object.defineProperty({ ...base }, 'state', {
    enumerable: true,
    get(): Erased {
      if (state === undefined) {
        throw new Error(
          `房间 ${roomId} 的处理器访问了 ctx.state，但该房间没有声明 state 组件。` +
            `要持久状态请在 defineRoom 里加 state: SomeTrait（闭包变量不进快照，别用 let）`,
        );
      }
      return state;
    },
  }) as T & { readonly state: Erased };
}

/** 系统侧查询面（守卫与处理器都从这里读世界） */
type SystemScope = Pick<
  SystemContext,
  'getComponent' | 'getEntity' | 'findByComponent' | 'getRelations' | 'hasRelation' | 'findRelated'
>;

/**
 * 查询守卫：`canLeave` / `canEnter`
 *
 * MovementSystem **同步**调用它——引擎的事件泵没有取消机制（`EventContext`
 * 只暴露 emit），所以"高优先级系统否决"这条路根本不存在，守卫只能是同步查询。
 *
 * @returns 拒绝理由（非空字符串）或 undefined（放行）
 */
export function queryRoomGate(
  scope: SystemScope,
  roomId: EntityId,
  kind: 'canEnter' | 'canLeave',
  entity: EntityId,
  direction: string,
): string | undefined {
  const behavior = lookupRoomBehavior(scope, roomId);
  const gate = behavior?.on[kind];
  if (!behavior || !gate) return undefined;

  const reason = gate(
    withState(roomId, readState(behavior, scope, roomId), {
      entity,
      roomId,
      direction,
      getEntity: scope.getEntity,
      getComponent: scope.getComponent,
      findByComponent: scope.findByComponent,
      getRelations: scope.getRelations,
      hasRelation: scope.hasRelation,
      findRelated: scope.findRelated,
    }),
  );
  return typeof reason === 'string' && reason !== '' ? reason : undefined;
}

/** 构造事件型上下文并调用处理器 */
function invokeHandler(
  behavior: RoomBehavior,
  ctx: SystemContext,
  opts: {
    entity: EntityId;
    roomId: EntityId;
    handler: RoomHandler<Erased>;
    from?: EntityId;
    direction?: string;
  },
): void {
  const base = {
    entity: opts.entity,
    roomId: opts.roomId,
    from: opts.from,
    direction: opts.direction,
    emit: ctx.emit,
    getComponent: ctx.getComponent,
    findByComponent: ctx.findByComponent,
    getRelations: ctx.getRelations,
    hasRelation: ctx.hasRelation,
    findRelated: ctx.findRelated,
    spawn: ctx.spawn,
    destroy: ctx.destroy,
    output: ctx.output,
  };
  opts.handler(withState(opts.roomId, readState(behavior, ctx, opts.roomId), base));
}

/**
 * 房间事件派发系统（v0.9-A）：把 `Moved` / `Look` 翻译成房间行为
 *
 * - `Moved` → 出发房间 `leave` → 目标房间 `enter` →（首次）`firstEnter`
 * - `Look`（无目标）→ 所在房间 `look`
 *
 * priority 5：稳稳排在基础系统（`prefab.visitation` 等 priority 0）之后，
 * 于是输出顺序恒为「房间标题 → 描述 → 房间追加内容」。
 *
 * `onError: 'skip'` 而不是 'degrade'：本系统是**所有房间共享的派发器**，
 * 一个房间的处理器炸了若把派发器整个隔离，等于全世界的房间行为一起哑火
 * ——故障域太大。'skip' 让出错的那次调用被记录、其他房间照常运转。
 */
export const RoomEventSystem = defineSystem({
  name: 'prefab.room.event',
  on: [Moved, Look, RoomCommandInvoked],
  priority: 5,
  onError: 'skip',
  handle(event, ctx) {
    if (event.token === Moved.token) {
      const { entity, from, to, direction } = event.data;

      const leaving = lookupRoomBehavior(ctx, from);
      if (leaving?.on.leave) {
        invokeHandler(leaving, ctx, {
          entity,
          roomId: from,
          handler: leaving.on.leave,
          from: to,
          direction,
        });
      }

      const entering = lookupRoomBehavior(ctx, to);
      if (entering?.on.enter) {
        invokeHandler(entering, ctx, {
          entity,
          roomId: to,
          handler: entering.on.enter,
          from,
          direction,
        });
      }

      // firstEnter：账由 prefabs 自己记（Entered 关系），不污染内容层的 state
      if (entering?.on.firstEnter && !ctx.hasRelation(entity, Entered, to)) {
        invokeHandler(entering, ctx, {
          entity,
          roomId: to,
          handler: entering.on.firstEnter,
          from,
          direction,
        });
        ctx.addRelation(entity, Entered, to);
      }
      return;
    }

    if (event.token === RoomCommandInvoked.token) {
      const { player, roomId, verb } = event.data;
      const behavior = lookupRoomBehavior(ctx, roomId);
      if (!behavior) return;
      const key = verb.toLowerCase();
      const cmd = behavior.commands.find((c) => c.verbs.some((v) => v.toLowerCase() === key));
      if (!cmd) return; // 位置校验已由翻译层做过，这里只会是内部错配

      const result = cmd.handle(
        withState(roomId, readState(behavior, ctx, roomId), {
          entity: player,
          roomId,
          emit: ctx.emit,
          spawn: ctx.spawn,
          destroy: ctx.destroy,
          output: ctx.output,
          getEntity: ctx.getEntity,
          getComponent: ctx.getComponent,
          findByComponent: ctx.findByComponent,
          getRelations: ctx.getRelations,
          hasRelation: ctx.hasRelation,
          findRelated: ctx.findRelated,
        }) as RoomCommandContext<Erased>,
      );
      // 返回字符串 = 直接反馈（与事件链输出同管；不返回则由 handler 自己 output）
      if (typeof result === 'string' && result !== '') ctx.output.narrative(result);
      return;
    }

    const { entity, target } = event.data;
    if (target !== undefined) return; // look <目标>：看的是东西不是房间
    const pos = ctx.getComponent(entity, Position);
    if (!pos) return;
    const here = lookupRoomBehavior(ctx, pos.roomId);
    if (here?.on.look) {
      invokeHandler(here, ctx, { entity, roomId: pos.roomId, handler: here.on.look });
    }
  },
});

/**
 * 房间周期派发系统（v0.9-A）：驱动各房间的 `on.every`
 *
 * 无漂移网格（与 BuffSystem 同款）：`floor(time/ms) <= floor(last/ms)` 就跳过。
 * 时间账本 `RoomClock.lastTickedAt` 是**组件**，所以快照/回滚/fork 全部一致
 * ——这也是为什么"房间里的 `let lastTick = 0`"是错的写法。
 *
 * `onError: 'skip'`：理由同 RoomEventSystem——派发器是共享的，故障域必须
 * 收敛到出错的那个房间。
 */
export const RoomTickSystem = defineSystem({
  name: 'prefab.room.tick',
  every: ROOM_TICK_MS,
  onError: 'skip',
  handle(payload, ctx) {
    const time = payload.data.time;

    for (const roomId of ctx.findByComponent(RoomBehaviorRef)) {
      const behavior = lookupRoomBehavior(ctx, roomId);
      const every = behavior?.on.every;
      if (!behavior || !every) continue;

      const clock = ctx.getComponent(roomId, RoomClock);
      if (!clock) continue; // 没挂时钟 = 这个房间没有周期行为（防御：组件没加上）

      if (Math.floor(time / every.ms) <= Math.floor(clock.lastTickedAt / every.ms)) continue;
      clock.lastTickedAt = time;

      invokeHandler(behavior, ctx, { entity: roomId, roomId, handler: every.handle });
    }
  },
});

/**
 * 把房间模块的行为装进世界
 *
 * 做四件事（顺序有讲究）：
 * 1. 命令动词冲突检查（房间内 + 房间间），带房间 id 报错
 * 2. 为房间实体挂 `RoomBehaviorRef` / `state` / `RoomClock`
 * 3. 注册房间命令（自动带"必须在本房间"校验）
 * 4. 幂等注册 `RoomEventSystem` + `RoomTickSystem`
 *
 * **必须先 `buildRooms`**（房间实体得先存在）。
 */
export function buildRoomBehaviors(world: World, defs: AnyRoomModuleDef[]): void {
  // 1. 命令动词冲突：引擎的 registerCommands 也会查，但它的报错里没有房间 id
  const verbOwner = new Map<string, string>();
  for (const def of defs) {
    for (const cmd of def.commands ?? []) {
      for (const verb of cmd.verbs) {
        const key = verb.toLowerCase();
        const owner = verbOwner.get(key);
        if (owner !== undefined) {
          throw new Error(
            `buildRoomBehaviors: 房间命令动词冲突："${verb}" 同时属于房间 ${owner} 与 ${def.id}`,
          );
        }
        verbOwner.set(key, def.id);
      }
    }
  }

  // 2. 挂组件
  for (const def of defs) {
    const hasBehavior =
      def.state !== undefined ||
      def.on !== undefined ||
      (def.commands !== undefined && def.commands.length > 0);
    if (!hasBehavior) continue; // 纯静态房间不占槽位

    const roomId = def.id as EntityId;
    if (!world.entities.get(roomId)) {
      throw new Error(
        `buildRoomBehaviors: 房间实体不存在：${def.id}（请先调用 buildRooms 注入房间）`,
      );
    }

    const existing = world.getComponent(roomId, RoomBehaviorRef);
    // 同一个世界重复构建时复用槽位，避免 BEHAVIORS 无限增长
    const index = existing && existing.index >= 0 ? existing.index : BEHAVIORS.length;
    BEHAVIORS[index] = {
      roomId: def.id,
      state: def.state,
      on: (def.on ?? {}) as RoomHandlers<Record<string, unknown>>,
      commands: (def.commands ?? []) as RoomCommandDef<Record<string, unknown>>[],
    };
    if (existing) {
      existing.index = index;
    } else {
      world.addComponent(roomId, RoomBehaviorRef, { index });
    }

    if (def.state) world.addComponent(roomId, def.state);
    if (def.on?.every) world.addComponent(roomId, RoomClock);
    // firstEnter 的账本是 Entered 关系（v0.10），按需记录，无需预挂
  }

  // 3. 房间命令：全局注册的**纯翻译层**——只做位置校验并 emit 派发事件，
  //    真正的命令逻辑由 RoomEventSystem 在事件泵内执行（那样才有系统特权，
  //    "命令不改状态"的铁律对翻译层依然成立）
  for (const def of defs) {
    for (const cmd of def.commands ?? []) {
      const roomId = def.id as EntityId;
      const canonical = cmd.verbs[0] ?? '';
      world.registerCommands(
        defineCommand({
          verbs: cmd.verbs,
          handle({ player, world: w }) {
            const pos = w.getComponent(player, Position);
            if (!pos || pos.roomId !== roomId) return '我不明白你的意思。';
            w.emit(RoomCommandInvoked, { player, roomId, verb: canonical });
            return null;
          },
        }),
      );
    }
  }

  // 4. 派发系统：幂等（重复构建同一个世界不重复注册）
  if (!BOOTSTRAPPED.has(world)) {
    world.register(RoomEventSystem, RoomTickSystem);
    BOOTSTRAPPED.add(world);
  }
}
