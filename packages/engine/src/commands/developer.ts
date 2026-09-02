/**
 * 开发者命令（A4，0.3-C 修订）
 *
 * 供调试与内容搭建使用的内置命令。缺组件时给出明确反馈而不是报错——
 * 开发者命令必须永远不炸游戏。
 *
 * 组件命名约定（与 trait() 确定性 ID 机制一致，游戏层用 trait('xxx') 定义即可被识别）：
 * - position: { roomId: string }
 * - health:   { current: number; max: number }
 *
 * 0.3-C breaking：`/give` 已移除——它按 inventory.items 约定写字符串，而
 * Inventory 组件随 @mud/prefabs 的实体物品模型（Located 容器）退役。物品版
 * 开发命令归 prefabs（引擎不依赖领域语义）。
 */
import { trait, defineCommand } from '../index';
import type { AnyCommand } from './types';
import type { EntityId } from '../core/types';

/** 约定组件定义（仅用于按确定性 ID 查找，数据由游戏层提供） */
const PositionRef = trait('position');
const HealthRef = trait('health');

/**
 * 创建开发者命令组（/tp /heal /dev-help）
 *
 * @example
 * ```ts
 * world.registerCommands(...createDeveloperCommands());
 * // 玩家输入：/tp hall   /heal
 * ```
 */
export function createDeveloperCommands(): AnyCommand[] {
  const readPosition = (world: { getComponent: <T>(id: EntityId, c: { id: string } & never) => T | undefined }, id: EntityId) =>
    world.getComponent(id, PositionRef as never) as { roomId?: string } | undefined;

  const TpCommand = defineCommand({
    verbs: ['/tp', '/teleport', '//tp'],
    args: { room: { type: 'word' } },
    handle({ args, player, world }) {
      const pos = readPosition(world as never, player);
      if (!pos) return '[dev] 目标实体没有 position 组件，无法传送。';
      const from = pos.roomId;
      pos.roomId = args.room;
      return `[dev] 传送：${from ?? '（未知）'} → ${args.room}`;
    },
  });

  const HealCommand = defineCommand({
    verbs: ['/heal', '//heal'],
    args: { target: { type: 'optional_entity' } },
    handle({ args, player, world }) {
      const targetId =
        args.target && world.findEntity(args.target) ? world.findEntity(args.target)! : player;
      const health = world.getComponent(targetId, HealthRef as never) as
        | { current?: number; max?: number }
        | undefined;
      if (!health) return '[dev] 目标实体没有 health 组件。';
      const max = health.max ?? 100;
      const before = health.current ?? 0;
      health.current = max;
      return `[dev] 治疗 ${args.target ?? '自己'}：${before} → ${max}`;
    },
  });

  const DevHelpCommand = defineCommand({
    verbs: ['/dev-help', '//h'],
    handle() {
      return [
        '开发者命令（组件命名约定：position/health）：',
        '  /tp <roomId>        传送（写 position.roomId）',
        '  /heal [targetName]  满血治疗（写 health.current）',
      ].join('\n');
    },
  });

  return [TpCommand, HealCommand, DevHelpCommand];
}
