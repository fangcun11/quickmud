/**
 * @mud/prefabs 系统（0.5 toolkit）—— 移动 / 描述 / 物品 / 战斗 / 巡逻
 *
 * 约定：
 * - 移动：`Position.roomId` 指向房间实体 id；房间实体带 `Exits`（方向→房间 id）；
 *   命令 emit `MoveRequested`（意图）→ MovementSystem 校验出口与守卫，
 *   合法才落位、输出房间名与描述，最后 emit `Moved`（结果）
 * - 查看：DescriptionSystem 输出所在房间的 Name/Description，并列出地上可拾取物
 * - 物品：物品实体带 `Located` 关系（→ 所在容器实体，单源位置）。
 *   take/drop 只改关系指向——房间/玩家/箱子都是普通实体，均可作容器
 * - 战斗：攻击者与目标须同房间且目标带 Health；伤害取攻击者 Weapon.damage（缺省 10）；
 *   HP 归零 emit Died（效果系统钩子）后销毁目标实体
 * - 巡逻：实体带 `Wander` 标记 + Position，由 NpcWanderSystem 按 every 时钟、
 *   沿房间 Exits 的方向序列确定性移动（不引入随机）
 */
import { defineSystem, Name, blueprint, Dialogue } from '@mud/ecs-engine';
import type {
  EntityId,
  SystemContext,
  BlueprintComponentInput,
  Segment,
} from '@mud/ecs-engine';
import {
  Moved,
  MoveRequested,
  Look,
  ItemTaken,
  ItemDropped,
  Attack,
  Died,
  LootDropped,
  QuestStarted,
  QuestProgressed,
  QuestCompleted,
  QuestTurnedIn,
  BuffApplied,
  BuffTicked,
  BuffExpired,
  VerboseToggled,
  MiniMapToggled,
  Consumed,
} from './events.js';
import {
  Position,
  Exits,
  Description,
  Short,
  Pose,
  Located,
  Portable,
  Health,
  Weapon,
  Wander,
  Loot,
  Area,
  QuestGiver,
  QuestLog,
  Afflicted,
  Afflicts,
  Duration,
  Visited,
  Verbose,
  MiniMap,
  Backtrack,
  Consumable,
} from './traits.js';
import type { LootEntry, QuestDef, QuestLogData, BuffEffect } from './traits.js';
import {
  itemsInContainer,
  resolveInContainer,
  displayName,
  occupantsIn,
  containerOf,
} from './queries.js';
import { injuryWarning } from './vitals.js';
import { queryRoomGate } from './behavior.js';
import { directionLabel, layoutNeighborMiniMap } from './room.js';
import { weatherOf } from './atmosphere.js';
import { parseInlineMarkup } from '@mud/ecs-engine';

/**
 * 移动系统（v0.9-A 重写）：`MoveRequested` 的**唯一**订阅者
 *
 * 管线（同步、不可中断）：
 * ```
 * 出口存在？否 → "你不能往X走。"
 * canLeave（出发房间）→ 有理由 → 输出理由，不动
 * canEnter（目标房间）→ 有理由 → 输出理由，不动
 * 落位 pos.roomId = 目标
 * 输出房间名 + 描述
 * emit Moved（结果，to = 房间 id）
 * ```
 *
 * 守卫为什么是**同步查询**而不是"高优先级系统否决"：引擎的事件泵没有取消机制
 * （`EventContext` 只暴露 emit），事件一旦入队就必然跑完。所以"拦截"只能发生在
 * 落位之前、由本系统自己问。
 *
 * 也正因为如此，`Moved` 必须是**结果**而不是意图：守卫放行前 emit 的任何
 * "到达"都会让 `Visited` 误记、房间 `enter` 幽灵触发。
 */
/** 出口方向的玩家文案（"北、南、西"）；没有出口返回 undefined */
function exitDirectionList(
  ctx: { getComponent: (id: EntityId, t: typeof Exits) => Record<string, string> | undefined },
  roomId: EntityId,
): string | undefined {
  const exits = ctx.getComponent(roomId, Exits);
  const dirs = exits ? Object.keys(exits) : [];
  return dirs.length > 0 ? dirs.map(directionLabel).join('、') : undefined;
}

/**
 * 出口方向段：每个方向词打 `tag:'direction'`（网页端可点击 = 走过去）。
 * 文本内容与原纯文本版逐字一致——端到端拼接结果不变，只是多了交互语义。
 */
function exitDirectionSegments(dirs: string[]): Segment[] {
  const out: Segment[] = [];
  dirs.forEach((d, i) => {
    if (i > 0) out.push({ text: '、' });
    out.push({ text: directionLabel(d), style: { tag: 'direction' }, entityRef: d });
  });
  return out;
}

/** 出口行**恒显**（xkx 惯例，0.14）：有出口列方向；死路明说，不跳过 */
function emitExitsLine(ctx: SystemContext, roomId: EntityId): void {
  const exits = ctx.getComponent(roomId, Exits);
  const dirs = exits ? Object.keys(exits) : [];
  if (dirs.length === 0) {
    ctx.output.narrative('这里没有任何出口。');
    return;
  }
  ctx.output.narrative([
    { text: '出口：' },
    ...exitDirectionSegments(dirs),
    { text: '。' },
  ]);
}

/**
 * 出口信息（0.14 方案二迭代）：略图开着时方位由小图承担，平面方向文本行
 * **让位**；up/down 不入图，恒以补充行交代（楼梯口不能没人说）。
 * 略图未开（或世界没预挂）→ 原文本行（含死路句式）。
 */
function emitExitsBlock(ctx: SystemContext, viewer: EntityId, roomId: EntityId): void {
  const exits = ctx.getComponent(roomId, Exits);
  const vertical = exits ? Object.keys(exits).filter((d) => d === 'up' || d === 'down') : [];
  if (ctx.getComponent(viewer, MiniMap)?.on === true) {
    emitMiniMapIfOn(ctx, viewer, roomId);
    if (vertical.length > 0) {
      ctx.output.narrative([
        { text: '另有出口：' },
        ...exitDirectionSegments(vertical),
        { text: '。' },
      ]);
    }
    return;
  }
  emitExitsLine(ctx, roomId);
}

/**
 * 实体列示段（xkx「店小二2」词汇教学）：同名聚组，主名可点（tag:entity），
 * 别名并集与重名计数跟在名字后——`野狼(狼、wolf)×2`。
 * `groupSuffix` 可给整组追加标注（如地上物的「（拿不动）」）。
 */
function entityListSegments(
  ctx: SystemContext,
  ids: EntityId[],
  groupSuffix?: (groupIds: EntityId[], name: string) => string,
): Segment[] {
  const groups = new Map<string, { ids: EntityId[]; aliases: string[] }>();
  for (const id of ids) {
    const nc = ctx.getComponent(id, Name);
    const name = nc?.text && nc.text !== '' ? nc.text : id;
    const group = groups.get(name) ?? { ids: [], aliases: [] };
    if (group.ids.length === 0) {
      for (const alias of nc?.aliases ?? []) {
        if (alias !== name && !group.aliases.includes(alias)) group.aliases.push(alias);
      }
    }
    group.ids.push(id);
    groups.set(name, group);
  }
  const out: Segment[] = [];
  let index = 0;
  for (const [name, group] of groups) {
    out.push({ text: name, style: { tag: 'entity' }, entityRef: group.ids[0] });
    const alias = group.aliases.length > 0 ? `(${group.aliases.join('、')})` : '';
    const count = group.ids.length > 1 ? `×${group.ids.length}` : '';
    const suffix = groupSuffix ? groupSuffix(group.ids, name) : '';
    const separator = index < groups.size - 1 ? '、' : '';
    out.push({ text: `${alias}${count}${suffix}${separator}` });
    index += 1;
  }
  return out;
}

/**
 * 活体逐行（xkx 式身份感，0.14）：每个同名片一行——
 * `「野狼」(狼、wolf)×2压低前身，喉咙里滚出低低的呜声。`
 * 姿态短语取组内首个成员的 `Pose`（内容层声明，Phrase 不带句尾标点）。
 */
function emitOccupantLines(ctx: SystemContext, ids: EntityId[]): void {
  const groups = new Map<string, { ids: EntityId[]; aliases: string[]; pose: string }>();
  for (const id of ids) {
    const nc = ctx.getComponent(id, Name);
    const name = nc?.text && nc.text !== '' ? nc.text : id;
    const group = groups.get(name) ?? { ids: [], aliases: [], pose: '' };
    if (group.ids.length === 0) {
      for (const alias of nc?.aliases ?? []) {
        if (alias !== name && !group.aliases.includes(alias)) group.aliases.push(alias);
      }
      group.pose = ctx.getComponent(id, Pose)?.text ?? '';
    }
    group.ids.push(id);
    groups.set(name, group);
  }
  for (const [name, group] of groups) {
    const alias = group.aliases.length > 0 ? `(${group.aliases.join('、')})` : '';
    const count = group.ids.length > 1 ? `×${group.ids.length}` : '';
    ctx.output.narrative([
      { text: '「' },
      { text: name, style: { tag: 'entity' }, entityRef: group.ids[0] },
      { text: `」${alias}${count}${group.pose}。` },
    ]);
  }
}

/** 描述缩进（xkx 惯例：全角两格） */
const INDENT = '　　';

/**
 * 房间块（xkx 式）：【名】 → 描述 → 环境行(预留位) → 出口 → 地上物 → 活体。
 *
 * 进房（首次/详细）与 look 共用同一份输出——进房即全知，look 是重看；
 * 实体名都带 tag:entity（网页端可点击 = look）。标题走 title 通道。
 * 地上物**全列**（含拿不动的场景物，标注「（拿不动）」——能 look 到的东西
 * 不该在列示里隐身）。
 */
function emitRoomBlock(ctx: SystemContext, roomId: EntityId, viewer: EntityId, timestamp = 0): void {
  const name = ctx.getComponent(roomId, Name);
  const desc = ctx.getComponent(roomId, Description);

  if (name) {
    ctx.output.title(`【${name.text}】`);
  }
  // 环境行预留位（时辰/天气落地后插在此处，见 prefabs README）
  // 描述支持内联标记（{{语义|文本}}）——emit 时解析为段，三个渲染器白得高亮
  ctx.output.narrative(
    desc && desc.text !== ''
      ? [{ text: INDENT }, ...parseInlineMarkup(desc.text)]
      : '这里没有任何描述。',
  );

  emitExitsBlock(ctx, viewer, roomId);

  // 房间绑定实体二分（xkx：人和物分开列）：有对话/任务/生命的视为活体
  // （钉在房间里的 NPC——酒保、村长——用 Located 关系），其余是物品
  const bound = itemsInContainer(ctx, roomId);
  const isPerson = (id: EntityId): boolean =>
    ctx.getComponent(id, Dialogue) !== undefined ||
    ctx.getComponent(id, QuestGiver) !== undefined ||
    ctx.getComponent(id, Health) !== undefined;
  const stationaryPersons = bound.filter(isPerson);
  const objects = bound.filter((id) => !isPerson(id));

  if (objects.length > 0) {
    ctx.output.narrative([
      { text: '你可以看到：' },
      ...entityListSegments(ctx, objects, (groupIds) => {
        const portable = groupIds.every((id) => ctx.getComponent(id, Portable) !== undefined);
        return portable ? '' : '（拿不动）';
      }),
      { text: '。' },
    ]);
  }

  // 同房活物（会动的 + 钉在房间的 NPC；不含查看者自己）——逐行，带姿态；
  // 暴雪（0.14 玩法钩子）：雪盲——视线被雪遮住，只给氛围不给名单
  const others = occupantsIn(ctx, roomId).filter((id) => id !== viewer);
  const occupants = [...others, ...stationaryPersons];
  if (occupants.length > 0) {
    if (weatherOf(areaIdOf(ctx, roomId), timestamp) === 'snow') {
      ctx.output.system('大雪纷飞，你几乎看不清周围的动静。');
    } else {
      emitOccupantLines(ctx, occupants);
    }
  }
}

/** 房间所属区域实体 id（无区域 → 房间自身 id，作天气种子） */
function areaIdOf(ctx: SystemContext, roomId: EntityId): EntityId {
  return ctx.getRelations(roomId, Area)[0] ?? roomId;
}

/**
 * 短描述档（xkx 长短双描述，0.14）：重复进房（自动简略）时——
 * 【名】+ 一行短氛围 + 出口。房间没写 `short` 时由 MovementSystem 回退旧行为。
 */
function emitRoomBrief(ctx: SystemContext, roomId: EntityId, viewer: EntityId): void {
  const name = ctx.getComponent(roomId, Name);
  if (name) {
    ctx.output.title(`【${name.text}】`);
  }
  const short = ctx.getComponent(roomId, Short);
  if (short?.text) {
    ctx.output.narrative(INDENT + short.text);
  }
  emitExitsBlock(ctx, viewer, roomId);
}

/**
 * 进房邻接小图（0.14 方案二）：玩家开了 `MiniMap` 才画；出口行之下、
 * 实体列示之上。当前房名独立**红色段**；邻房迷雾——已探明显示地名，
 * 未探明显示 `?`（暗示有路，不剧通向哪）。up/down 不入图（全图同规）。
 */
function emitMiniMapIfOn(ctx: SystemContext, viewer: EntityId, roomId: EntityId): void {
  if (ctx.getComponent(viewer, MiniMap)?.on !== true) return;
  const current = ctx.getComponent(roomId, Name)?.text ?? String(roomId);
  const exits = ctx.getComponent(roomId, Exits);
  const visited = ctx.getComponent(viewer, Visited)?.rooms ?? [];
  const neighbor = (dir: string): string | undefined => {
    const target = exits?.[dir];
    if (!target) return undefined;
    return visited.includes(target) ? ctx.getComponent(target, Name)?.text ?? '?' : '?';
  };
  const layout = layoutNeighborMiniMap(current, {
    north: neighbor('north'),
    east: neighbor('east'),
    south: neighbor('south'),
    west: neighbor('west'),
  });
  // 交互标注（0.18）：通路的邻格名是**可点段**（tag:direction + entityRef=方向 id）——
  // 略图开着时方位文本行让位，图上的格子就是玩家点来走路的地方。拼接文本不变。
  const walkable = (dir: string, name: string | undefined): Segment[] => {
    if (name === undefined) return [];
    return [{ text: name, style: { tag: 'direction' }, entityRef: dir }];
  };
  const segments: Segment[] = [];
  if (layout.northName !== undefined) {
    segments.push(
      { text: ' '.repeat(layout.northPad) },
      ...walkable('north', layout.northName),
      { text: '\n' },
    );
  }
  if (layout.vTop) segments.push({ text: layout.vTop + '\n' });
  if (layout.westName !== undefined) {
    segments.push(...walkable('west', layout.westName), { text: '──' });
  }
  segments.push({ text: current, style: { color: 'red' } });
  if (layout.eastName !== undefined) {
    segments.push({ text: '──' }, ...walkable('east', layout.eastName));
  }
  if (layout.vBottom) segments.push({ text: '\n' + layout.vBottom });
  if (layout.southName !== undefined) {
    segments.push(
      { text: '\n' + ' '.repeat(layout.southPad) },
      ...walkable('south', layout.southName),
    );
  }
  ctx.output.narrative(segments);
}

export const MovementSystem = defineSystem({
  name: 'prefab.movement',
  on: [MoveRequested],
  priority: 0,
  handle(event, ctx) {
    const { entity, to } = event.data;

    const pos = ctx.getComponent(entity, Position);
    if (!pos) return;

    const from = pos.roomId;

    // 0. 来路（0.14，F4）：to === 'back' → 不查出口表，由来路栈定目标——
    //    退的是"你来时那间"（栈顶≠当前房），守卫照走（有拦的房间后退照被拦）。
    //    没有来路 → 明说。
    let direction = to;
    let targetRoomId: string | undefined;
    if (to === 'back') {
      // 原路折返（弹栈消费）：把栈顶的当前房记录弹掉，再退到它前面那间——
      // A→B→C 连退两下回到 A（真正"原路返回"，而不是在最后两间打转）
      const trail = ctx.getComponent(entity, Backtrack);
      let target: string | undefined;
      if (trail) {
        while (trail.rooms.length > 0 && trail.rooms[trail.rooms.length - 1] === from) {
          trail.rooms.pop();
        }
        target = trail.rooms.pop();
      }
      if (!target) {
        ctx.output.error('没有来路可退。');
        return;
      }
      targetRoomId = target;
      direction = 'back';
    } else {
      // 1. 出口存在性（拓扑真相来自 Exits）；撞墙时顺手告诉玩家还能往哪走
      const exits = ctx.getComponent(from, Exits);
      targetRoomId = exits?.[to];
      if (!targetRoomId) {
        // 方向 id 是机器真相，文案要说人话
        const here = exitDirectionList(ctx, from);
        ctx.output.narrative(
          here
            ? `你不能往${directionLabel(to)}走。这里的出口：${here}。`
            : `你不能往${directionLabel(to)}走。`,
        );
        return;
      }
    }

    // 2. 出发房间的离开守卫
    const leave = queryRoomGate(ctx, from, 'canLeave', entity, direction);
    if (leave !== undefined) {
      ctx.output.narrative(leave);
      return;
    }

    // 3. 目标房间的进入守卫（守卫跑在落位之前，所以拒绝时不留任何副作用）
    const enter = queryRoomGate(ctx, targetRoomId, 'canEnter', entity, direction);
    if (enter !== undefined) {
      ctx.output.narrative(enter);
      return;
    }

    // 4. 落位（唯一改状态处）
    pos.roomId = targetRoomId;

    // 5. 输出目标房间（xkx 长短双描述，0.14 三档）：
    //    - 首次进入（或详细模式）→ 完整房间块（【名】+描述+出口+实体）
    //    - 重复进入：写了 `short` 的房间 → 短描述档（【名】+一行氛围+出口）；
    //      没写的 → 回退旧行为（报名一行 + 出口行）
    //    出口行**恒显**（含死路句式）——"回城往哪走"不该靠 look。
    //    来没来过查 `Visited`（VisitationSystem 在 Moved 之后记账，本系统
    //    emit Moved 前查到的"没有"就是真的第一次）。细节随时用 look 重看。
    const desc = ctx.getComponent(targetRoomId, Description);
    const seenBefore = ctx.getComponent(entity, Visited)?.rooms.includes(targetRoomId) ?? false;
    const fullDesc = !!desc && desc.text !== '' && (!seenBefore || ctx.getComponent(entity, Verbose)?.on === true);
    if (fullDesc) {
      emitRoomBlock(ctx, targetRoomId, entity, event.timestamp);
    } else if (ctx.getComponent(targetRoomId, Short)?.text) {
      emitRoomBrief(ctx, targetRoomId, entity);
    } else {
      const roomName = ctx.getComponent(targetRoomId, Name);
      ctx.output.narrative([
        { text: `你来到了${roomName?.text ?? targetRoomId}。`, style: { bold: true } },
      ]);
      emitExitsBlock(ctx, entity, targetRoomId);
    }

    // 6. 广播"人真的到了"——探索记账、房间 enter/leave/firstEnter 都挂在这上面
    ctx.emit(Moved, { entity, from, to: targetRoomId, direction });
  },
});

/**
 * 探索记录系统（v0.8-B）：把去过的房间写进 `Visited`
 *
 * v0.9 起 `Moved.to` 就是房间 id，v0.8 那段"从出发房间 Exits 反查目标"的
 * 绕路（以及随之而来的注册顺序依赖）彻底消失。
 *
 * 没挂 `Visited` 的实体不参与记账（系统不能替内容补组件）。
 */
export const VisitationSystem = defineSystem({
  name: 'prefab.visitation',
  on: [Moved],
  priority: 0,
  handle(event, ctx) {
    const { entity, to } = event.data;
    const visited = ctx.getComponent(entity, Visited);
    if (!visited) return;

    if (!visited.rooms.includes(to)) visited.rooms.push(to);
  },
});

/**
 * 来路栈（0.14，F4）：`Moved` 的记账员——把离开的房间压进 `Backtrack`。
 *
 * 与 `Visited`（集合语义）互补：栈记**顺序**，回退命令按弹栈消费原路折返
 * （退掉当前房记录，回到上一间——连按可逐站走回出生点）。
 * 栈上限 32，超出丢最旧。没预挂 `Backtrack` 的实体不记账。
 */
export const BacktrackSystem = defineSystem({
  name: 'prefab.backtrack',
  on: [Moved],
  priority: 0,
  handle(event, ctx) {
    // 回退移动（direction='back'）不压栈——回退是**消费**历史，不是新来路；
    // 否则刚弹掉的又被记回，back 会永远在最后两间之间打转
    if (event.data.direction === 'back') return;
    const trail = ctx.getComponent(event.data.entity, Backtrack);
    if (!trail) return;
    trail.rooms.push(event.data.from);
    if (trail.rooms.length > 32) trail.rooms.shift();
  },
});

/**
 * 详略模式系统（v0.11）：`VerboseToggled` 的唯一订阅者
 *
 * 翻转玩家 `Verbose.on` 字段（可变读特权，与房间 state 同款）。
 * 玩家没预挂 `Verbose` 的世界没有这个开关（静默忽略）——组件的挂载
 * 由内容层声明（与 `Visited` 同款），系统不替内容补组件。
 * 回显文案由命令给出（emit 同步派发，命令读得到翻转结果）。
 */
export const VerboseSystem = defineSystem({
  name: 'prefab.verbose',
  on: [VerboseToggled],
  priority: 0,
  handle(event, ctx) {
    const { entity } = event.data;
    const verbose = ctx.getComponent(entity, Verbose);
    if (verbose) verbose.on = !verbose.on;
  },
});

/**
 * 进房略图开关（0.14 方案二）：`MiniMapToggled` 的唯一订阅者——
 * 翻转 `MiniMap.on`（预挂组件，VerboseSystem 同款）。玩家没预挂
 * `MiniMap` 的世界没有这个开关（静默忽略）。
 */
export const MiniMapSystem = defineSystem({
  name: 'prefab.minimap',
  on: [MiniMapToggled],
  priority: 0,
  handle(event, ctx) {
    const { entity } = event.data;
    const mini = ctx.getComponent(entity, MiniMap);
    if (mini) mini.on = !mini.on;
  },
});

/** 处理查看（输出所在房间的描述与地上可拾取物；look <目标> 查看容器内物品详情） */
export const DescriptionSystem = defineSystem({
  name: 'prefab.description',
  on: [Look],
  priority: 0,
  handle(event, ctx) {
    const { entity, target } = event.data;

    const pos = ctx.getComponent(entity, Position);
    if (!pos) return;

    // look <目标>：在当前房间容器内解析并输出详情
    if (target !== undefined) {
      const targetId = resolveInContainer(ctx, pos.roomId, target);
      if (!targetId) {
        ctx.output.error(`这里没有「${target}」。`);
        return;
      }
      const targetName = displayName(ctx, targetId);
      const targetDesc = ctx.getComponent(targetId, Description);
      ctx.output.narrative(
        targetDesc && targetDesc.text !== ''
          ? parseInlineMarkup(targetDesc.text)
          : `「${targetName}」看起来没什么特别的。`,
      );
      return;
    }

    // look = 重看一遍进房时的房间块（同一份输出，格式永不漂移）
    emitRoomBlock(ctx, pos.roomId, entity, event.timestamp);
  },
});

/**
 * 物品系统：唯一负责物品转移的手
 *
 * - take（ItemTaken）：物品的 Located 须指向当前房间且可携带（Portable）→ 改指玩家
 * - drop（ItemDropped）：Located 须指向玩家 → 改指当前房间
 * 校验失败输出 error，不炸链路。
 */
export const ItemSystem = defineSystem({
  name: 'prefab.items',
  on: [ItemTaken, ItemDropped],
  handle(event, ctx) {
    if (event.token === ItemTaken.token) {
      handleTake(ctx, event.data);
    } else {
      handleDrop(ctx, event.data);
    }
  },
});

type TakeDrop = { player: EntityId; item: EntityId };

function handleTake(ctx: SystemContext, { player, item }: TakeDrop): void {
  const pos = ctx.getComponent(player, Position);
  if (!pos) {
    ctx.output.error('你不在任何地方。');
    return;
  }

  const at = ctx.getRelations(item, Located);
  if (at.length === 0) {
    ctx.output.error('那东西不在这里。');
    return;
  }
  if (!at.includes(pos.roomId)) {
    ctx.output.error(`这里没有「${displayName(ctx, item)}」。`);
    return;
  }
  if (ctx.getComponent(item, Portable) === undefined) {
    ctx.output.error(`你拿不动「${displayName(ctx, item)}」。`);
    return;
  }

  ctx.removeRelation(item, Located, pos.roomId);
  ctx.addRelation(item, Located, player);
  ctx.output.narrative(`你拿起了「${displayName(ctx, item)}」。`);
}

function handleDrop(ctx: SystemContext, { player, item }: TakeDrop): void {
  const pos = ctx.getComponent(player, Position);
  if (!pos) {
    ctx.output.error('你不在任何地方。');
    return;
  }

  if (!ctx.hasRelation(item, Located, player)) {
    ctx.output.error(`你没有「${displayName(ctx, item)}」。`);
    return;
  }

  ctx.removeRelation(item, Located, player);
  ctx.addRelation(item, Located, pos.roomId);
  ctx.output.narrative(`你放下了「${displayName(ctx, item)}」。`);
}

/**
 * 战斗系统：结算攻击伤害，死亡时 emit `Died`（v0.5，v0.6 起不再自己清场）
 *
 * - 攻击：目标须与攻击者同房间、带 Health；伤害 = 攻击者 Weapon.damage（>0）否则 10
 * - 死亡：HP 归零 → 输出 → emit `Died`（掉落/任务等效果系统的钩子）
 *
 * **不在这里销毁实体**：事件在处理中 emit 只入队、不立即处理，等 `Died` 排到时
 * 本函数早已同步返回并 destroy 了目标，订阅者将读不到死者的任何组件（v0.6 开发
 * 掉落时踩到：Loot 读不到 → 静默不掉东西）。销毁改由 `DeathSystem` 在管线末端执行。
 */
export const CombatSystem = defineSystem({
  name: 'prefab.combat',
  on: [Attack],
  priority: 0,
  handle(event, ctx) {
    const { attacker, target } = event.data;

    const hp = ctx.getComponent(target, Health);
    if (!hp) {
      ctx.output.error('ta 身上没有可伤害的生命。');
      return;
    }
    const atkPos = ctx.getComponent(attacker, Position);
    const tgtPos = ctx.getComponent(target, Position);
    if (!atkPos || !tgtPos || tgtPos.roomId !== atkPos.roomId) {
      ctx.output.error(`「${displayName(ctx, target)}」不在你身边。`);
      return;
    }

    const weapon = ctx.getComponent(attacker, Weapon);
    const damage = weapon && weapon.damage > 0 ? weapon.damage : 10;
    const before = hp.current;
    hp.current = Math.max(0, hp.current - damage);
    const targetName = displayName(ctx, target);
    ctx.output.narrative(`你攻击了「${targetName}」，造成 ${damage} 点伤害。`);
    // 伤势警示（P2）：只在掉档那一刻出现，黄=轻伤、红=危急
    const warn = injuryWarning(before, hp.current, hp.max, {
      isPlayerTarget: false,
      name: targetName,
    });
    if (warn) ctx.output.narrative([{ text: warn.text, style: { color: warn.color } }]);

    if (before > 0 && hp.current <= 0) {
      // 死亡是视觉事件（xkx 惯例）：独立强调，不与普通过招同权重
      ctx.output.narrative([
        { text: `「${targetName}」倒下了。`, style: { color: 'red', bold: true } },
      ]);
      ctx.emit(Died, { entity: target, killer: attacker, roomId: tgtPos.roomId });
    }
  },
});

/**
 * 死亡清场系统（v0.6）：销毁 `Died` 的实体，是死亡管线的**最后一环**
 *
 * priority 最高（100）→ 无论注册顺序如何都排在其他 `Died` 订阅者之后，
 * 保证掉落、任务计数等效果系统在实体消失**之前**读到它。
 */
export const DeathSystem = defineSystem({
  name: 'prefab.death',
  on: [Died],
  priority: 100,
  handle(event, ctx) {
    const { entity } = event.data;
    ctx.destroy(entity);
  },
});

/**
 * 掉落系统（v0.6-A1）：接上 `Died` 这个悬空了一版的钩子
 *
 * - 死者带 `Loot` → 按掉落表用 `ctx.spawn` **现造实体**落入死亡房间容器
 * - 掉落物是真实体：look 看得见、take 拿得走（不是字符串装饰）
 * - emit `LootDropped`（任务 kill 型目标、统计、播报的钩子）
 *
 * 顺序契约：CombatSystem 是「先 emit Died，再 destroy」——本系统跑在 destroy
 * 之前，此时死者组件仍可读（`displayName` 才拿得到名字）。这个顺序由
 * prefabs.test.ts 的战斗用例与 loot.test.ts 共同锁死。
 */
export const LootSystem = defineSystem({
  name: 'prefab.loot',
  on: [Died],
  priority: 0,
  handle(event, ctx) {
    const { entity, roomId } = event.data;

    // 无房间（不是死在某个容器里）→ 无处可掉
    if (!roomId) return;

    const loot = ctx.getComponent(entity, Loot);
    if (!loot || loot.drops.length === 0) return;

    const items: EntityId[] = [];
    for (const entry of loot.drops) {
      items.push(ctx.spawn(lootBlueprint(entry, roomId)));
    }

    const names = items.map((id) => displayName(ctx, id)).join('、');
    // 得宝是视觉事件（xkx 惯例）：黄色醒目，但不算错误
    ctx.output.narrative([
      { text: `「${displayName(ctx, entity)}」倒下，掉了${names}。`, style: { color: 'yellow' } },
    ]);
    ctx.emit(LootDropped, { entity, roomId, items });
  },
});

/** 掉落条目 → 蓝图（运行时构造：blueprint() 是纯函数，随时可调） */
function lootBlueprint(entry: LootEntry, roomId: EntityId) {
  const components: BlueprintComponentInput[] = [
    [Name, { text: entry.name, aliases: entry.aliases ?? [] }],
    [Description, { text: entry.description ?? '' }],
    // 关系组件直写 targets（引擎 0.12 起蓝图通道自动维护关系索引）
    [Located, { targets: [roomId] }],
  ];
  // 掉落物默认可拾取（要的就是玩家捡走）；显式 portable:false 可做成场景装饰
  if (entry.portable !== false) components.push([Portable]);
  if (entry.damage !== undefined && entry.damage > 0) {
    components.push([Weapon, { damage: entry.damage }]);
  }
  return blueprint({ components });
}

/**
 * 任务系统（v0.6-A2）：进度推进 + 交付发奖
 *
 * - `collect` 目标：订阅 `ItemTaken` —— **在 ItemSystem 转移之后**才记账
 *   （priority 10 > ItemSystem 的 0），只有真正到手的物品才计数，
 *   拿不动/不在这里的东西不会白送进度
 * - `kill` 目标：订阅 `Died`（priority 10 < DeathSystem 的 100）→ 实体还在，读得到名字
 * - 交付：订阅 `QuestTurnedIn`（由 turnin 命令 emit），校验后发奖
 *
 * 推进规则：**进度全局追踪**，不看玩家在哪（否则在酒馆接任务、去广场杀怪
 * 永远记不上功）；但**交付必须回到发任务者身边**（`turnin` 与系统双重校验）。
 * 玩家没有 `QuestLog` 组件 → 静默跳过（系统不能补组件，也不该替玩家决定）。
 */
export const QuestSystem = defineSystem({
  name: 'prefab.quest',
  on: [ItemTaken, Died, QuestTurnedIn],
  priority: 10,
  handle(event, ctx) {
    if (event.token === ItemTaken.token) {
      const { player, item } = event.data;
      const itemName = displayName(ctx, item);
      // 转移已由 ItemSystem 完成（priority 更低）；没到手就不记账
      if (!ctx.hasRelation(item, Located, player)) return;
      forEachMatchingQuest(ctx, player, 'collect', itemName, (def, giver, log) =>
        advance(ctx, player, giver, def, log),
      );
      return;
    }

    if (event.token === Died.token) {
      const { entity, killer } = event.data;
      if (!killer) return;
      const deadName = displayName(ctx, entity);
      forEachMatchingQuest(ctx, killer, 'kill', deadName, (def, giver, log) =>
        advance(ctx, killer, giver, def, log),
      );
      return;
    }

    const { player, giver, questId } = event.data;
    handleTurnIn(ctx, player, giver, questId);
  },
});

type QuestMatch = (def: QuestDef, giver: EntityId, log: QuestLogData) => void;

/**
 * 遍历所有发任务者里目标匹配的任务
 *
 * 刻意**不比较房间**：进度是全局账本。房间只在交付时才有意义
 * （见 handleTurnIn）——跑腿任务的常识是"去别处办事，回来交差"。
 */
function forEachMatchingQuest(
  ctx: SystemContext,
  player: EntityId,
  type: 'collect' | 'kill',
  name: string,
  onMatch: QuestMatch,
): void {
  const log = ctx.getComponent(player, QuestLog);
  if (!log) return; // 玩家不参与任务

  for (const giver of ctx.findByComponent(QuestGiver)) {
    const data = ctx.getComponent(giver, QuestGiver);
    if (!data) continue;
    for (const def of data.quests) {
      if (def.objective.type !== type) continue;
      if (!name.includes(def.objective.target)) continue;
      if (log.turnedIn.includes(def.id) || log.completed.includes(def.id)) continue;
      onMatch(def, giver, log);
    }
  }
}

/** 进度 +1，达标则标记完成并 emit */
function advance(
  ctx: SystemContext,
  player: EntityId,
  giver: EntityId,
  def: QuestDef,
  log: QuestLogData,
): void {
  const before = log.active[def.id] ?? 0;
  const progress = before + 1;

  if (before === 0) {
    ctx.emit(QuestStarted, { player, giver, questId: def.id });
  }
  log.active[def.id] = progress;
  ctx.emit(QuestProgressed, {
    player,
    giver,
    questId: def.id,
    progress,
    count: def.objective.count,
  });

  if (progress >= def.objective.count) {
    log.completed.push(def.id);
    // 里程碑是视觉事件（xkx 惯例）：黄色加粗，与普通过程区分
    ctx.output.narrative([
      { text: `任务「${def.title}」完成。`, style: { color: 'yellow', bold: true } },
    ]);
    ctx.emit(QuestCompleted, { player, giver, questId: def.id });
  }
}

/** 交付：校验 → 发奖 → 记账（只此一次） */
function handleTurnIn(
  ctx: SystemContext,
  player: EntityId,
  giver: EntityId,
  questId: string,
): void {
  const log = ctx.getComponent(player, QuestLog);
  const giverData = ctx.getComponent(giver, QuestGiver);
  const def = giverData?.quests.find((q) => q.id === questId);
  if (!log || !def) return;

  // 同房间 + 已完成 + 未交付
  const room = containerOf(ctx, player);
  if (!room || containerOf(ctx, giver) !== room) return;
  if (!log.completed.includes(questId) || log.turnedIn.includes(questId)) return;

  log.turnedIn.push(questId);
  ctx.output.narrative(`你把「${def.title}」交给了「${displayName(ctx, giver)}」。`);

  for (const entry of def.reward?.items ?? []) {
    ctx.spawn(lootBlueprint(entry, player));
    ctx.output.narrative(`你获得了「${entry.name}」。`);
  }
  if (def.reward?.heal) {
    const hp = ctx.getComponent(player, Health);
    if (hp) {
      const healed = Math.min(hp.max, hp.current + def.reward.heal);
      const gained = healed - hp.current;
      hp.current = healed;
      if (gained > 0) ctx.output.narrative(`你恢复了 ${gained} 点生命。`);
    }
  }
}

/**
 * Buff 系统（v0.7-A）：定时效果结算 + 到期移除
 *
 * 与 NpcWanderSystem 同款 every 网格模式：由世界时间派生时相，快照/回滚/录像
 * 天然一致。Buff 实体的 `startedAt <= 0` 表示待激活——首个结算网格写入世界时间，
 * **内容层全程不需要感知时间**（spawn 即忘）。
 *
 * 毒杀走完整死亡管线：HP 归零 emit `Died`（killer = 施加者）→
 * 掉落 / 任务计数 / BuffCleanup / DeathSystem 全部照常生效。
 */
export const BuffSystem = defineSystem({
  name: 'prefab.buff',
  every: 1000,
  handle(payload, ctx) {
    const time = payload.data.time;

    for (const buffId of ctx.findByComponent(Afflicted)) {
      const buff = ctx.getComponent(buffId, Afflicted);
      if (!buff) continue; // 毒杀时 Died 会在本循环中途同步排水清掉后续 buff——防御已删实体
      const victim = ctx.getRelations(buffId, Afflicts)[0] ?? null;
      if (!victim) continue;

      // 待激活：写入世界时间作为计时起点，本网格不结算
      if (buff.startedAt <= 0) {
        buff.startedAt = time;
        buff.lastTickedAt = time;
        ctx.emit(BuffApplied, { buff: buffId, victim });
        continue;
      }

      // 到期判定优先于结算（到期那格不再造成伤害/回复）
      const dur = ctx.getComponent(buffId, Duration);
      if (dur && time - buff.startedAt >= dur.lasts) {
        ctx.emit(BuffExpired, { buff: buffId, victim });
        ctx.destroy(buffId);
        continue;
      }

      const effect = buff.effect;
      // 自上次结算起计 effect.every（不用固定网格：effect.every 与结算粒度
      // 不对齐时，固定网格会让同一段窗口被结算两次）
      if (time - buff.lastTickedAt < effect.every) continue;

      const hp = ctx.getComponent(victim, Health);
      if (!hp) continue; // 受害者没有生命 → 无从结算（留待清理）

      if (effect.type === 'damage') {
        const before = hp.current;
        hp.current = Math.max(0, before - effect.amount);
        const applied = before - hp.current;
        if (applied > 0) {
          ctx.output.narrative(`「${displayName(ctx, victim)}」受到持续伤害（-${applied} 生命）。`);
        }
        buff.lastTickedAt = time;
        ctx.emit(BuffTicked, { buff: buffId, victim, effect, applied });
        if (before > 0 && hp.current <= 0) {
          const pos = ctx.getComponent(victim, Position);
          ctx.emit(Died, { entity: victim, killer: buff.source, roomId: pos?.roomId });
        }
      } else {
        const before = hp.current;
        hp.current = Math.min(hp.max, before + effect.amount);
        const applied = hp.current - before;
        if (applied > 0) {
          ctx.output.narrative(`「${displayName(ctx, victim)}」感到伤势在缓缓恢复（+${applied} 生命）。`);
        }
        buff.lastTickedAt = time;
        ctx.emit(BuffTicked, { buff: buffId, victim, effect, applied });
      }
    }
  },
});

/**
 * Buff 清场（v0.7-A）：受害者死亡时销毁 ta 身上的所有 buff
 *
 * priority 50 = 死亡管线中段（掉落/任务之后、DeathSystem 清场之前）——
 * 避免留下指向死者的孤儿 buff（与 Located 悬挂引用同款预防）。
 * v0.10 起走 Afflicts 反查索引：O(k) 命中，不再扫全部 buff 比对字段。
 */
export const BuffCleanupSystem = defineSystem({
  name: 'prefab.buff-cleanup',
  on: [Died],
  priority: 50,
  handle(event, ctx) {
    const { entity } = event.data;
    for (const buffId of ctx.findRelated(Afflicts, entity)) {
      ctx.destroy(buffId);
    }
  },
});

/**
 * 构造一个 buff 实体蓝图（每次调用新建；供 ctx.spawn / world.spawn 使用）
 *
 * `lasts` <= 0 表示永久（不挂 Duration）。startedAt 留 0：由 BuffSystem 激活，
 * 内容层不需要知道当前世界时间。受害者走 Afflicts 关系直写 targets。
 */
export function buffBlueprint(opts: {
  victim: EntityId;
  effect: BuffEffect;
  lasts: number;
  source?: EntityId;
}) {
  const components: BlueprintComponentInput[] = [
    [Afflicted, { effect: opts.effect, startedAt: 0, source: opts.source }],
    [Afflicts, { targets: [opts.victim] }],
  ];
  if (opts.lasts > 0) components.push([Duration, { lasts: opts.lasts }]);
  return blueprint({ components });
}

/**
 * NPC 巡逻系统（v0.5）：让带 `Wander` + `Position` 的实体沿房间出口漫游
 *
 * 确定性：不引入随机——下一跳由世界时间决定：
 * `idx = floor(worldTime / interval) % 出口数`，沿 Exits 的键序轮换。
 * 每跳间隔 = every（毫秒）。同世界同时间 ⇒ 同位置，快照/录像/分叉天然一致。
 */
export const NpcWanderSystem = defineSystem({
  name: 'prefab.wander',
  every: 3000,
  priority: 0,
  handle(payload, ctx) {
    const time = payload.data.time;
    const interval = 3000;
    const round = Math.floor(time / interval);

    for (const npc of ctx.findByComponent(Wander)) {
      const pos = ctx.getComponent(npc, Position);
      if (!pos) continue; // 无位置 → 不动
      const exits = ctx.getComponent(pos.roomId as EntityId, Exits);
      const directions = exits ? Object.keys(exits) : [];
      if (directions.length === 0) continue; // 无出口 → 原地停留

      const dir = directions[round % directions.length]!;
      const to = exits![dir];
      if (!to || to === pos.roomId) continue;
      const from = pos.roomId;
      pos.roomId = to;
      // 移动事实广播 Moved（0.14）：进退场播报、场景系统从同一事件流感知世界
      ctx.emit(Moved, { entity: npc, from, to, direction: dir });
    }
  },
});

/**
 * 消耗品系统（0.17，M4 通用件）：`Consumed` 的落地者
 *
 * 读 `Consumable` 组件的 hp 字段回复 Health（通用资源），然后 destroy 物品。
 * energy 字段为游戏层资源——由游戏层额外注册的监听系统处理
 * （此处只管 prefabs 层的 Health 通用回复）。
 */
export const ConsumableSystem = defineSystem({
  name: 'prefab.consume',
  on: [Consumed],
  handle(event, ctx) {
    const { entity, item } = event.data;
    const consumable = ctx.getComponent(item, Consumable);
    if (!consumable) return;
    if (consumable.hp > 0) {
      const hp = ctx.getComponent(entity, Health);
      if (hp) {
        const before = hp.current;
        hp.current = Math.min(hp.max, hp.current + consumable.hp);
        const gained = hp.current - before;
        if (gained > 0) ctx.output.narrative(`你使用了${displayName(ctx, item)}，恢复了 ${gained} 点气血。`);
      }
    }
    ctx.destroy(item);
  },
});
