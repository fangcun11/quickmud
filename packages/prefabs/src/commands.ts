/**
 * @mud/prefabs 命令（0.3 toolkit）—— 移动 / 查看 / 物品 / 状态的官方命令
 *
 * 命令只翻译输入并 emit 事件，状态改动由对应系统完成（三条铁律）。
 */
import { defineCommand } from '@mud/ecs-engine';
import type { AnyCommand } from '@mud/ecs-engine';
import { Moved, Look, ItemTaken, ItemDropped, Attack, QuestTurnedIn } from './events.js';
import { Position, Health, QuestGiver, QuestLog } from './traits.js';
import {
  itemsInContainer,
  resolveInContainer,
  resolveOccupantIn,
  displayName,
  containerOf,
} from './queries.js';

/** 移动命令：go/move/walk/走 <方向>，支持 n/s/e/w/北 等归一 */
export const GoCommand = defineCommand({
  verbs: ['go', 'move', 'walk', '走', '移动', '前往'],
  abbrev: ['g'],
  args: {
    direction: { type: 'direction' },
  },
  handle({ args, player, world }) {
    const { direction } = args;
    if (!direction) {
      return '你要去哪里？';
    }

    // 方向归一化（单字母/中文 → 标准方向名）
    const dirMap: Record<string, string> = {
      n: 'north', s: 'south', e: 'east', w: 'west',
      北: 'north', 南: 'south', 东: 'east', 西: 'west',
    };
    const normalizedDir = dirMap[direction.toLowerCase()] ?? direction.toLowerCase();

    const pos = world.getComponent(player, Position);
    if (!pos) return '你不在任何地方。';

    world.emit(Moved, { entity: player, from: pos.roomId, to: normalizedDir });
    return null;
  },
});

/** 方向命令工厂：为每个方向生成专属动词（north/北）的命令，消除重复 */
export function createDirectionCommand(direction: string, verbs: string[]): AnyCommand {
  return defineCommand({
    verbs,
    handle({ player, world }) {
      const pos = world.getComponent(player, Position);
      if (!pos) return '你不在任何地方。';
      world.emit(Moved, { entity: player, from: pos.roomId, to: direction });
      return null;
    },
  });
}

/** 查看命令：look/l/看 <目标?>（无目标时查看所在房间与地上物品） */
export const LookCommand = defineCommand({
  verbs: ['look', 'l', '看', '观察'],
  args: {
    target: { type: 'optional_entity' },
  },
  handle({ args, player, world }) {
    world.emit(Look, { entity: player, target: args.target ?? undefined });
    return null;
  },
});

/** 拾取命令：take/get/拿/拾取 <物品>（从当前房间拿进背包） */
export const TakeCommand = defineCommand({
  verbs: ['take', 'get', '拿', '拾取'],
  args: { item: { type: 'entity' } },
  handle({ args, player, world }) {
    if (!args.item) return '拿什么？';

    const pos = world.getComponent(player, Position);
    if (!pos) return '你不在任何地方。';

    // 作用域解析：只认当前房间地上的物品（全局 findEntity 会因跨容器
    // 同名物品遮蔽而把眼前的东西解析到别的房间）
    const itemId = resolveInContainer(world, pos.roomId, args.item);
    if (!itemId) return `这里没有「${args.item}」。`;

    world.emit(ItemTaken, { player, item: itemId });
    return null;
  },
});

/** 放下命令：drop/put/放下/丢 <物品>（从背包放到当前房间） */
export const DropCommand = defineCommand({
  verbs: ['drop', 'put', '放下', '丢弃'],
  args: { item: { type: 'entity' } },
  handle({ args, player, world }) {
    if (!args.item) return '放下什么？';

    const pos = world.getComponent(player, Position);
    if (!pos) return '你不在任何地方。';

    // 作用域解析：只认自己背包里的物品
    const itemId = resolveInContainer(world, player, args.item);
    if (!itemId) return `你没有「${args.item}」。`;

    world.emit(ItemDropped, { player, item: itemId });
    return null;
  },
});

/** 背包命令：inventory/i/物品 <列出 Located.at == 玩家的物品> */
export const InventoryCommand = defineCommand({
  verbs: ['inventory', 'i', '物品', '背包'],
  handle({ player, world }) {
    const names = itemsInContainer(world, player).map((id) => displayName(world, id));
    if (names.length === 0) {
      return '你的背包是空的。';
    }
    return `你的背包里有：${names.join('、')}`;
  },
});

/** 状态命令：score/状态 <生命与位置一览> */
export const ScoreCommand = defineCommand({
  verbs: ['score', '状态', '属性'],
  handle({ player, world }) {
    const health = world.getComponent(player, Health);
    const pos = world.getComponent(player, Position);

    const lines: string[] = [];
    if (health) {
      lines.push(`生命值：${health.current}/${health.max}`);
    }
    if (pos) {
      lines.push(`位置：${pos.roomId}`);
    }
    return lines.join('\n') || '没有状态信息。';
  },
});

/**
 * 任务列表命令：quests/任务 <列出当前房间 NPC 提供的任务与自己的进度>
 *
 * 只读查询（与 inventory 同款）：任务归属按房间，换个地方问就是另一批任务。
 */
export const QuestCommand = defineCommand({
  verbs: ['quests', 'quest', '任务'],
  handle({ player, world }) {
    const pos = world.getComponent(player, Position);
    if (!pos) return '你不在任何地方。';

    const log = world.getComponent(player, QuestLog);
    const lines: string[] = [];
    for (const giver of world.findByComponent(QuestGiver)) {
      if (containerOf(world, giver) !== pos.roomId) continue;
      const data = world.getComponent(giver, QuestGiver);
      for (const q of data?.quests ?? []) {
        if (log?.turnedIn.includes(q.id)) {
          lines.push(`- ${q.title}（已交付）`);
        } else if (log?.completed.includes(q.id)) {
          lines.push(`- ${q.title}（已完成，可交付）`);
        } else {
          const progress = log?.active[q.id] ?? 0;
          lines.push(`- ${q.title}（${progress}/${q.objective.count}）`);
        }
      }
    }

    if (lines.length === 0) return '这里没有人需要帮忙。';
    return `任务：\n${lines.join('\n')}`;
  },
});

/** 交任务命令：turnin/交任务 <向同房间的发任务者交付已完成的任务，领奖> */
export const TurnInCommand = defineCommand({
  verbs: ['turnin', '交任务', '交付'],
  handle({ player, world }) {
    const pos = world.getComponent(player, Position);
    if (!pos) return '你不在任何地方。';

    const log = world.getComponent(player, QuestLog);
    if (!log) return '你还没有任何任务。';

    for (const giver of world.findByComponent(QuestGiver)) {
      if (containerOf(world, giver) !== pos.roomId) continue;
      const data = world.getComponent(giver, QuestGiver);
      for (const q of data?.quests ?? []) {
        if (!log.completed.includes(q.id) || log.turnedIn.includes(q.id)) continue;
        // 只 emit：发奖由 QuestSystem 完成（命令不改状态）
        world.emit(QuestTurnedIn, { player, giver, questId: q.id });
        return null;
      }
    }

    return '这里没有可交付的任务。';
  },
});

/** 攻击命令：attack/kill/攻击/打 <目标>（目标须与自己同房间） */
export const AttackCommand = defineCommand({
  verbs: ['attack', 'kill', '攻击', '打'],
  args: { target: { type: 'entity' } },
  handle({ args, player, world }) {
    if (!args.target) return '攻击谁？';

    const pos = world.getComponent(player, Position);
    if (!pos) return '你不在任何地方。';

    // 房间作用域解析（与 take/drop 同理由：全局 findEntity 会跨房间错选）
    const target = resolveOccupantIn(world, pos.roomId, args.target);
    if (!target) return `这里没有「${args.target}」。`;

    world.emit(Attack, { attacker: player, target });
    return null;
  },
});
