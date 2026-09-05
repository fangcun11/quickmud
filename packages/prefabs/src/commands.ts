/**
 * @mud/prefabs 命令（0.3 toolkit）—— 移动 / 查看 / 物品 / 状态的官方命令
 *
 * 命令只翻译输入并 emit 事件，状态改动由对应系统完成（三条铁律）。
 */
import { defineCommand, Name } from '@mud/ecs-engine';
import type { AnyCommand } from '@mud/ecs-engine';
import {
  MoveRequested,
  Look,
  ItemTaken,
  ItemDropped,
  Attack,
  QuestTurnedIn,
  VerboseToggled,
  MiniMapToggled,
} from './events.js';
import {
  Position,
  Health,
  QuestGiver,
  QuestLog,
  Coordinates,
  Visited,
  Verbose,
  MiniMap,
  Exits,
  Area,
} from './traits.js';
import { renderAsciiMap } from './room.js';
import { renderAsciiWorldMap, roomsOfArea } from './area.js';
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
  handle({ args, output, player, world }) {
    const { direction } = args;
    if (!direction) {
      // 意图不成立（缺参）→ error 通道（F3 定约），不再走返回值
      output.error('你要去哪里？');
      return null;
    }

    // 方向归一化（单字母/中文 → 标准方向名）
    const dirMap: Record<string, string> = {
      n: 'north', s: 'south', e: 'east', w: 'west',
      北: 'north', 南: 'south', 东: 'east', 西: 'west',
    };
    const normalizedDir = dirMap[direction.toLowerCase()] ?? direction.toLowerCase();

    const pos = world.getComponent(player, Position);
    if (!pos) {
      output.error('你不在任何地方。');
      return null;
    }

    // 只 emit 意图：出不去、被拦下，都由 MovementSystem 判断
    world.emit(MoveRequested, { entity: player, to: normalizedDir });
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
      world.emit(MoveRequested, { entity: player, to: direction });
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

/**
 * 详细模式命令：verbose/详细（切换移动时的描述详略）
 *
 * 默认"自动简略"：首次进房全量描述，重复进房只报地名。命令只 emit
 * 切换意图（铁律：命令不改状态），`VerboseSystem` 翻转 `Verbose.on`——
 * emit 同步派发，所以回显读两次状态就能说准切到了哪档。
 * 玩家没预挂 `Verbose` 的世界没有这个开关。
 */
export const VerboseCommand = defineCommand({
  verbs: ['verbose', '详细'],
  handle({ player, world }) {
    // 开关是否存在只看组件本身：before/after 对比会把「系统没注册、事件
    // 无人消费」误报成「没有详略开关」，两种失败不该共用一句文案
    const verbose = world.getComponent(player, Verbose);
    if (!verbose) return '这个世界的玩家没有详略开关。';
    world.emit(VerboseToggled, { entity: player });
    // emit 同步派发，verbose.on 此刻已是翻转后的值
    return verbose.on
      ? '已切换为详细模式：每次进入房间都显示完整描述。'
      : '已切回自动简略：重复经过的房间只报地名，想重看细节用 look。';
  },
});

/**
 * 进房略图开关：minimap/略图/小图（0.14 方案二）
 *
 * 开启后每次进房（与 look）在出口行下渲染 3×3 邻接小图（当前位置红字）。
 * 命令只 emit 切换意图，`MiniMapSystem` 翻转 `MiniMap.on`；玩家没预挂
 * `MiniMap` 的世界没有这个开关（与 VerboseCommand 同款判定）。
 */
export const MiniMapCommand = defineCommand({
  verbs: ['minimap', '略图', '小图'],
  handle({ player, world }) {
    const mini = world.getComponent(player, MiniMap);
    if (!mini) return '这个世界的玩家没有进房略图开关。';
    world.emit(MiniMapToggled, { entity: player });
    // emit 同步派发，mini.on 此刻已是翻转后的值
    return mini.on
      ? '已开启进房略图：每次进房显示邻接小图（当前位置红字）。'
      : '已关闭进房略图：想看全景用 map。';
  },
});

/** 拾取命令：take/get/拿/拾取 <物品>（从当前房间拿进背包） */
export const TakeCommand = defineCommand({
  verbs: ['take', 'get', '拿', '拾取'],
  args: { item: { type: 'entity' } },
  handle({ args, output, player, world }) {
    if (!args.item) {
      output.error('拿什么？');
      return null;
    }

    const pos = world.getComponent(player, Position);
    if (!pos) {
      output.error('你不在任何地方。');
      return null;
    }

    // 作用域解析：只认当前房间地上的物品（全局 findEntity 会因跨容器
    // 同名物品遮蔽而把眼前的东西解析到别的房间）
    const itemId = resolveInContainer(world, pos.roomId, args.item);
    if (!itemId) {
      output.error(`这里没有「${args.item}」。`);
      return null;
    }

    world.emit(ItemTaken, { player, item: itemId });
    return null;
  },
});

/** 放下命令：drop/put/放下/丢 <物品>（从背包放到当前房间） */
export const DropCommand = defineCommand({
  verbs: ['drop', 'put', '放下', '丢弃'],
  args: { item: { type: 'entity' } },
  handle({ args, output, player, world }) {
    if (!args.item) {
      output.error('放下什么？');
      return null;
    }

    const pos = world.getComponent(player, Position);
    if (!pos) {
      output.error('你不在任何地方。');
      return null;
    }

    // 作用域解析：只认自己背包里的物品
    const itemId = resolveInContainer(world, player, args.item);
    if (!itemId) {
      output.error(`你没有「${args.item}」。`);
      return null;
    }

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
  handle({ output, player, world }) {
    const pos = world.getComponent(player, Position);
    if (!pos) {
      output.error('你不在任何地方。');
      return null;
    }

    const log = world.getComponent(player, QuestLog);
    if (!log) {
      output.error('你还没有任何任务。');
      return null;
    }

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

    output.error('这里没有可交付的任务。');
    return null;
  },
});

/** 攻击命令：attack/kill/攻击/打 <目标>（目标须与自己同房间） */
export const AttackCommand = defineCommand({
  verbs: ['attack', 'kill', '攻击', '打'],
  args: { target: { type: 'entity' } },
  handle({ args, output, player, world }) {
    if (!args.target) {
      output.error('攻击谁？');
      return null;
    }

    const pos = world.getComponent(player, Position);
    if (!pos) {
      output.error('你不在任何地方。');
      return null;
    }

    // 房间作用域解析（与 take/drop 同理由：全局 findEntity 会跨房间错选）
    const target = resolveOccupantIn(world, pos.roomId, args.target);
    if (!target) {
      output.error(`这里没有「${args.target}」。`);
      return null;
    }

    world.emit(Attack, { attacker: player, target });
    return null;
  },
});

/**
 * 区域地图命令：map/地图 <绘制**当前区域**的 ASCII 地图>
 *
 * 只读查询（与 inventory/quests 同款）。是否迷雾由玩家挂不挂 `Visited` 决定：
 * 挂了 → 只画已探明区域；没挂 → 内容没声明探索，渲染全图。
 *
 * 为什么要按区域过滤（v0.9-B）：每个区域有**自己的坐标系**，把两个区域
 * 的房间画到同一张平面上是坐标撞车的鬼画符。没挂 `Area` 的房间按 v0.8
 * 行为全画（无区域世界 = 一张平面）。
 */
export const MapCommand = defineCommand({
  verbs: ['map', '地图'],
  handle({ player, world }) {
    const pos = world.getComponent(player, Position);
    const areaId = pos ? world.getRelations(pos.roomId, Area)[0] : undefined;

    const rooms = world
      .findByComponent(Coordinates)
      .filter((id) => world.getComponent(id, Exits))
      .filter((id) => areaId === undefined || world.getRelations(id, Area)[0] === areaId)
      .map((id) => ({
        id,
        name: world.getComponent(id, Name)?.text,
        coords: world.getComponent(id, Coordinates)!,
        exits: world.getComponent(id, Exits)!,
      }));

    if (rooms.length === 0) return '这里没有可绘制的地图。';

    const visited = world.getComponent(player, Visited);
    const map = renderAsciiMap(rooms, {
      current: pos?.roomId,
      visited: visited?.rooms,
    });

    const title = areaId ? world.getComponent(areaId, Name)?.text : undefined;
    // 地名直书（v0.12）：名字与 (你) 标注就在图上，不再需要图例和地名清单
    return title ? `【${title}】\n\n${map}` : map;
  },
});

/**
 * 世界地图命令：worldmap/世界地图 <绘制区域之间的连接图>
 *
 * 区域图与房间图同构，所以渲染复用 `renderAsciiMap`。
 * 迷雾口径：一个区域里**去过任意一间房**就算探明（配合房间地图的迷雾，
 * 玩家看到的是"我知道有这么个地方"，细节靠走进去填）。
 */
export const WorldMapCommand = defineCommand({
  verbs: ['worldmap', 'wmap', '世界地图', '区域地图'],
  handle({ player, world }) {
    const areas = world
      .findByComponent(Coordinates)
      .filter((id) => world.getComponent(id, Exits))
      // 区域实体与房间实体都带 Coordinates/Exits；用"有没有房间用 Area 指着他"区分
      .filter((id) => roomsOfArea(world, id).length > 0)
      .map((id) => ({
        id,
        name: world.getComponent(id, Name)?.text,
        coords: world.getComponent(id, Coordinates)!,
        exits: world.getComponent(id, Exits)!,
      }));

    if (areas.length === 0) return '这个世界还没有划分区域。';

    const pos = world.getComponent(player, Position);
    const currentArea = pos ? world.getRelations(pos.roomId, Area)[0] : undefined;
    const visited = world.getComponent(player, Visited)?.rooms;

    const explored = visited
      ? areas
          .filter((a) => roomsOfArea(world, a.id).some((room) => visited.includes(room)))
          .map((a) => a.id)
      : undefined;
    if (explored && currentArea && !explored.includes(currentArea)) {
      explored.push(currentArea);
    }

    // 地名直书（v0.12）：区域名与 (你) 标注就在图上，不再需要图例和区域清单
    return renderAsciiWorldMap(areas, { current: currentArea, visited: explored });
  },
});
