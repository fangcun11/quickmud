/**
 * 开发者命令（A4，0.3-C 修订；0.12 起事件化——铁律示范位）
 *
 * 供调试与内容搭建使用的内置命令。缺组件时给出明确反馈而不是报错——
 * 开发者命令必须永远不炸游戏。
 *
 * 架构（0.12 起）：命令**只翻译意图**——读状态拼反馈文案 + emit 事件；
 * 写状态的是本模块内置的 DeveloperEffectSystem（消费事件落组件）。
 * 这使得：
 * - 命令产物走标准事件链：可被快照/回滚/录像捕获，行为与其他命令一致；
 * - fail-safe：只注册命令、不注册效果系统时，事件悬空但命令不炸、状态不变
 *   （这正是"改状态的唯一通道是系统"铁律的自然推论）。
 *
 * 组件命名约定（与 trait() 确定性 ID 机制一致，游戏层用 trait('xxx') 定义即可被识别）：
 * - position: { roomId: string }
 * - health:   { current: number; max: number }
 *
 * 0.3-C breaking：`/give` 已移除——它按 inventory.items 约定写字符串，而
 * Inventory 组件随 @mud/prefabs 的实体物品模型（Located 容器）退役。物品版
 * 开发命令归 prefabs（引擎不依赖领域语义）。
 */
import { trait, defineCommand, defineEvent, defineSystem } from '../index';
import type { AnyCommand } from './types';
import type { EntityId } from '../core/types';
import type { World } from '../core/world';

/** 约定组件的数据形状视图（引擎不拥有数据形状，仅约束命令/系统侧的读写类型） */
type DevPosition = { roomId?: string };
type DevHealth = { current?: number; max?: number };

/** 约定组件定义（仅用于按确定性 ID 查找，数据由游戏层提供） */
const PositionRef = trait<DevPosition>('position');
const HealthRef = trait<DevHealth>('health');

/** ---------- 事件：命令翻译出的"意图"，效果系统是唯一消费者 ---------- */

/** 开发者传送。from 为改前房间 id（目标无 position 或未知时缺省） */
export const DevTeleported = defineEvent('dev_teleported')<{
  target: EntityId;
  from?: string;
  to: string;
}>();

/** 开发者治疗（满血）。from 为改前血量 */
export const DevHealed = defineEvent('dev_healed')<{
  target: EntityId;
  from: number;
  to: number;
}>();

/**
 * 开发者效果系统：消费 DevTeleported / DevHealed，唯一写状态的手。
 * 用 createDeveloperCommands 而不注册本系统时，命令照常应答（意图已翻译、
 * 反馈可观测），只是状态不落——事件悬空，不炸、不脏。
 */
export const DeveloperEffectSystem = defineSystem({
  name: 'developer-effect',
  on: [DevTeleported, DevHealed],
  handle(event, ctx) {
    if (event.token === DevTeleported.token) {
      const pos = ctx.getComponent(event.data.target, PositionRef);
      if (pos) pos.roomId = event.data.to;
      return;
    }
    if (event.token === DevHealed.token) {
      const health = ctx.getComponent(event.data.target, HealthRef);
      if (health) health.current = event.data.to;
    }
  },
});

/**
 * 创建开发者命令组（/tp /heal /dev-help）。只翻译意图不写状态——
 * 配套 registerDeveloperKit(world) 一步注册命令 + 效果系统。
 *
 * @example
 * ```ts
 * registerDeveloperKit(world);          // 推荐：命令 + 效果系统一步到位
 * // 或拆开（效果系统缺省时命令仍可用，只是状态不落）：
 * world.registerCommands(...createDeveloperCommands());
 * // 玩家输入：/tp hall   /heal
 * ```
 */
export function createDeveloperCommands(): AnyCommand[] {
  const TpCommand = defineCommand({
    verbs: ['/tp', '/teleport', '//tp'],
    args: { room: { type: 'word' } },
    handle({ args, player, world }) {
      const pos = world.getComponent(player, PositionRef);
      if (!pos) return '[dev] 目标实体没有 position 组件，无法传送。';
      const from = pos.roomId;
      world.emit(DevTeleported, { target: player, from, to: args.room });
      return `[dev] 传送：${from ?? '（未知）'} → ${args.room}`;
    },
  });

  const HealCommand = defineCommand({
    verbs: ['/heal', '//heal'],
    args: { target: { type: 'optional_entity' } },
    handle({ args, player, world }) {
      const targetId = (args.target && world.findEntity(args.target)) || player;
      const health = world.getComponent(targetId, HealthRef);
      if (!health) return '[dev] 目标实体没有 health 组件。';
      const max = health.max ?? 100;
      const before = health.current ?? 0;
      world.emit(DevHealed, { target: targetId, from: before, to: max });
      return `[dev] 治疗 ${args.target ?? '自己'}：${before} → ${max}`;
    },
  });

  const DevHelpCommand = defineCommand({
    verbs: ['/dev-help', '//h'],
    handle() {
      return [
        '开发者命令（组件命名约定：position/health）：',
        '  /tp <roomId>        传送（走 dev_teleported 事件）',
        '  /heal [targetName]  满血治疗（走 dev_healed 事件）',
      ].join('\n');
    },
  });

  return [TpCommand, HealCommand, DevHelpCommand];
}

/**
 * 一步注册开发者套件：命令组 + 内置效果系统（0.12 起推荐入口）。
 * 旧式 `world.registerCommands(...createDeveloperCommands())` 依然合法，
 * 但效果系统不注册时 /tp /heal 不会真正改状态（事件悬空）。
 */
export function registerDeveloperKit(world: World): void {
  world.registerCommands(...createDeveloperCommands());
  world.register(DeveloperEffectSystem);
}
