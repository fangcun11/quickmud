/**
 * @mud/prefabs 系统（0.5 toolkit）—— 移动 / 描述 / 物品 / 战斗 / 巡逻
 *
 * 约定：
 * - 移动：`Position.roomId` 指向房间实体 id；房间实体带 `Exits`（方向→房间 id）；
 *   MovementSystem 校验出口，合法才落位并输出目标房间名与描述
 * - 查看：DescriptionSystem 输出所在房间的 Name/Description，并列出地上可拾取物
 * - 物品：物品实体带 `Located { at }`（单源位置）。take/drop 只改 at——
 *   房间/玩家/箱子都是普通实体，均可作容器
 * - 战斗：攻击者与目标须同房间且目标带 Health；伤害取攻击者 Weapon.damage（缺省 10）；
 *   HP 归零 emit Died（效果系统钩子）后销毁目标实体
 * - 巡逻：实体带 `Wander` 标记 + Position，由 NpcWanderSystem 按 every 时钟、
 *   沿房间 Exits 的方向序列确定性移动（不引入随机）
 */
import { defineSystem, Name, blueprint } from '@mud/ecs-engine';
import type {
  EntityId,
  SystemContext,
  BlueprintComponentInput,
} from '@mud/ecs-engine';
import {
  Moved,
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
} from './events.js';
import {
  Position,
  Exits,
  Description,
  Located,
  Portable,
  Health,
  Weapon,
  Wander,
  Loot,
  QuestGiver,
  QuestLog,
} from './traits.js';
import type { LootEntry, QuestDef, QuestLogData } from './traits.js';
import {
  itemsInContainer,
  resolveInContainer,
  displayName,
  occupantsIn,
  containerOf,
} from './queries.js';

/** 处理实体移动（出口校验 + 落位 + 描述） */
export const MovementSystem = defineSystem<{
  entity: EntityId;
  from: string;
  to: string;
}>({
  name: 'prefab.movement',
  on: [Moved],
  priority: 0,
  handle(event, ctx) {
    const { entity, to } = event.data;

    const pos = ctx.getComponent(entity, Position);
    if (!pos) return;

    // 从当前所在房间的出口中查找目标房间
    const exits = ctx.getComponent(pos.roomId, Exits);
    const targetRoomId = exits?.[to];
    if (!exits || !targetRoomId) {
      ctx.output.narrative(`你不能往${to}走。`);
      return;
    }

    // 更新位置（唯一改状态处）
    pos.roomId = targetRoomId;

    // 输出目标房间的标题与描述
    const roomName = ctx.getComponent(targetRoomId, Name);
    const desc = ctx.getComponent(targetRoomId, Description);
    ctx.output.narrative([
      { text: `你来到了${roomName?.text ?? targetRoomId}。`, style: { bold: true } },
    ]);
    if (desc) {
      ctx.output.narrative(desc.text);
    }
  },
});

/** 处理查看（输出所在房间的描述与地上可拾取物；look <目标> 查看容器内物品详情） */
export const DescriptionSystem = defineSystem<{
  entity: EntityId;
  target?: string;
}>({
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
          ? targetDesc.text
          : `「${targetName}」看起来没什么特别的。`,
      );
      return;
    }

    const name = ctx.getComponent(pos.roomId, Name);
    const desc = ctx.getComponent(pos.roomId, Description);

    if (name) {
      ctx.output.narrative([{ text: `【${name.text}】`, style: { bold: true } }]);
    }
    if (desc) {
      ctx.output.narrative(desc.text);
    } else {
      ctx.output.narrative('这里没有任何描述。');
    }

    // 列地上可拾取物（Located.at == 房间 && Portable）
    const groundItems = itemsInContainer(ctx, pos.roomId).filter(
      (id) => ctx.getComponent(id, Portable) !== undefined,
    );
    if (groundItems.length > 0) {
      ctx.output.narrative(
        `你可以看到：${groundItems.map((id) => displayName(ctx, id)).join('、')}。`,
      );
    }

    // 列同房活物（有身体的实体；不含查看者自己）
    const others = occupantsIn(ctx, pos.roomId).filter((id) => id !== entity);
    if (others.length > 0) {
      ctx.output.narrative(`这里还有：${others.map((id) => displayName(ctx, id)).join('、')}。`);
    }
  },
});

/**
 * 物品系统：唯一负责物品转移的手
 *
 * - take（ItemTaken）：物品须在当前房间且可携带（Portable）→ at 改玩家
 * - drop（ItemDropped）：物品须在背包（at == 玩家）→ at 改当前房间
 * 校验失败输出 error，不炸链路。
 */
export const ItemSystem = defineSystem({
  name: 'prefab.items',
  on: [ItemTaken.token, ItemDropped.token],
  handle(event, ctx) {
    if (event.token === ItemTaken.token) {
      handleTake(ctx, event.data as { player: EntityId; item: EntityId });
    } else {
      handleDrop(ctx, event.data as { player: EntityId; item: EntityId });
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

  const loc = ctx.getComponent(item, Located);
  if (!loc || loc.at === null) {
    ctx.output.error('那东西不在这里。');
    return;
  }
  if (loc.at !== pos.roomId) {
    ctx.output.error(`这里没有「${displayName(ctx, item)}」。`);
    return;
  }
  if (ctx.getComponent(item, Portable) === undefined) {
    ctx.output.error(`你拿不动「${displayName(ctx, item)}」。`);
    return;
  }

  loc.at = player;
  ctx.output.narrative(`你拿起了「${displayName(ctx, item)}」。`);
}

function handleDrop(ctx: SystemContext, { player, item }: TakeDrop): void {
  const pos = ctx.getComponent(player, Position);
  if (!pos) {
    ctx.output.error('你不在任何地方。');
    return;
  }

  const loc = ctx.getComponent(item, Located);
  if (!loc || loc.at !== player) {
    ctx.output.error(`你没有「${displayName(ctx, item)}」。`);
    return;
  }

  loc.at = pos.roomId;
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
  on: [Attack.token],
  priority: 0,
  handle(event, ctx) {
    const { attacker, target } = event.data as { attacker: EntityId; target: EntityId };

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
    ctx.output.narrative(`你攻击了「${displayName(ctx, target)}」，造成 ${damage} 点伤害。`);

    if (before > 0 && hp.current <= 0) {
      ctx.output.narrative(`「${displayName(ctx, target)}」倒下了。`);
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
  on: [Died.token],
  priority: 100,
  handle(event, ctx) {
    const { entity } = event.data as { entity: EntityId };
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
  on: [Died.token],
  priority: 0,
  handle(event, ctx) {
    const { entity, roomId } = event.data as {
      entity: EntityId;
      killer?: EntityId;
      roomId?: string;
    };

    // 无房间（不是死在某个容器里）→ 无处可掉
    if (!roomId) return;

    const loot = ctx.getComponent(entity, Loot);
    if (!loot || loot.drops.length === 0) return;

    const items: EntityId[] = [];
    for (const entry of loot.drops) {
      items.push(ctx.spawn(lootBlueprint(entry, roomId)));
    }

    const names = items.map((id) => displayName(ctx, id)).join('、');
    ctx.output.narrative(`「${displayName(ctx, entity)}」倒下，掉了${names}。`);
    ctx.emit(LootDropped, { entity, roomId, items });
  },
});

/** 掉落条目 → 蓝图（运行时构造：blueprint() 是纯函数，随时可调） */
function lootBlueprint(entry: LootEntry, roomId: EntityId) {
  const components: BlueprintComponentInput[] = [
    [Name, { text: entry.name, aliases: entry.aliases ?? [] }],
    [Description, { text: entry.description ?? '' }],
    [Located, { at: roomId }],
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
  on: [ItemTaken.token, Died.token, QuestTurnedIn.token],
  priority: 10,
  handle(event, ctx) {
    if (event.token === ItemTaken.token) {
      const { player, item } = event.data as { player: EntityId; item: EntityId };
      const itemName = displayName(ctx, item);
      // 转移已由 ItemSystem 完成（priority 更低）；没到手就不记账
      if (ctx.getComponent(item, Located)?.at !== player) return;
      forEachMatchingQuest(ctx, player, 'collect', itemName, (def, giver, log) =>
        advance(ctx, player, giver, def, log),
      );
      return;
    }

    if (event.token === Died.token) {
      const { entity, killer } = event.data as {
        entity: EntityId;
        killer?: EntityId;
        roomId?: string;
      };
      if (!killer) return;
      const deadName = displayName(ctx, entity);
      forEachMatchingQuest(ctx, killer, 'kill', deadName, (def, giver, log) =>
        advance(ctx, killer, giver, def, log),
      );
      return;
    }

    const { player, giver, questId } = event.data as {
      player: EntityId;
      giver: EntityId;
      questId: string;
    };
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
    ctx.output.narrative(`任务「${def.title}」完成。`);
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
    const time = (payload.data as { time: number }).time;
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
      pos.roomId = to;
    }
  },
});
