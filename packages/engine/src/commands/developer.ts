/**
 * 开发者命令（A4）
 *
 * 供调试与内容搭建使用的内置命令。走与玩家命令完全相同的
 * 命令→事件→系统流水线（不搞特殊通道），因此天然受快照/回滚/录像保护。
 *
 * 组件命名约定（与 trait() 确定性 ID 机制一致，游戏层用 trait('xxx') 定义即可被识别）：
 * - position: { roomId: string }
 * - inventory: { items: string[] }
 * - health:   { current: number; max: number }
 *
 * 缺组件时给出明确反馈而不是报错——开发者命令必须永远不炸游戏。
 */
import { trait, defineCommand } from '../index';
import type { AnyCommand } from './types';
import type { EntityId } from '../core/types';

/** 约定组件定义（仅用于按确定性 ID 查找，数据由游戏层提供） */
const PositionRef = trait('position');
const InventoryRef = trait('inventory');
const HealthRef = trait('health');

/**
 * 创建开发者命令组
 *
 * @example
 * ```ts
 * world.registerCommands(...createDeveloperCommands());
 * // 玩家输入：/tp hall   /give sword 2   /heal
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

  const GiveCommand = defineCommand({
    verbs: ['/give', '//give'],
    args: {
      item: { type: 'word' },
      count: { type: 'word' },
    },
    handle({ args, player, world }) {
      const inv = world.getComponent(player, InventoryRef as never) as
        | { items?: string[] }
        | undefined;
      if (!inv) return '[dev] 目标实体没有 inventory 组件。';
      if (!inv.items) inv.items = [];
      const count = Math.max(1, Math.min(99, Number(args.count) || 1));
      for (let i = 0; i < count; i++) inv.items.push(args.item);
      return `[dev] 给予 ${args.item} ×${count}（现有 ${inv.items.length} 件）`;
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
        '开发者命令（组件命名约定：position/inventory/health）：',
        '  /tp <roomId>        传送（写 position.roomId）',
        '  /give <item> [n]    给予物品（写 inventory.items）',
        '  /heal [targetName]  满血治疗（写 health.current）',
      ].join('\n');
    },
  });

  return [TpCommand, GiveCommand, HealCommand, DevHelpCommand];
}
