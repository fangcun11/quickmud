/**
 * 侠客行 · 武学与秘籍（M2）
 *
 * - `Arsenal`（已习武学进度）/ `Channeling`（运转心法）/ 秘籍物品 `Scripture`
 * - 命令：学（learn）、使（use <招式>）、运转（practice <心法>）、武学（arts）
 * - 熟练度规则（grantArtExp）：战斗命中 +1（击杀 +3）、打坐运转每息 +1；
 *   exp ≥ art.expPerLevel → 升一层（可解锁新招式），输出走黄色里程碑。
 * - 场景门控（0.14 决策）：战斗中无法学武；attack/use 不许以自己为目标。
 *
 * 铁律照旧：命令只翻译意图（ArtLearned/Strike/ChannelRequested），
 * 写状态的是系统（可变读特权与 hp 同款）；输出走 output 通道。
 */
import { defineCommand, defineSystem, rich, yellow } from '@mud/ecs-engine';
import type { ComponentDefinition, EntityId, SystemContext } from '@mud/ecs-engine';
import { Health, Position } from '@mud/prefabs';
import { resolveInContainer, resolveOccupantIn, occupantsIn } from '@mud/prefabs';
import { Arsenal, Channeling, Scripture, Retaliate } from './traits';
import { ARTS } from './arts';
import { ArtLearned, Strike, ChannelRequested } from './events';

// ------------------------------------------------------------ 判据 --

/**
 * 同房的敌对活物（挂 `Retaliate` 且活着，不含自己）——
 * 逃跑结算与场景门控（学武等）共用的"是否处于战斗中"判据。
 */
export function foesInRoom(
  ctx: {
    getComponent: <T>(id: EntityId, c: ComponentDefinition<T>) => T | undefined;
    findByComponent: <T>(c: ComponentDefinition<T>) => EntityId[];
  },
  entity: EntityId,
  roomId: EntityId,
): EntityId[] {
  return ctx.findByComponent(Retaliate).filter((f) => {
    if (f === entity) return false;
    const fp = ctx.getComponent(f, Position);
    const fh = ctx.getComponent(f, Health);
    return fp?.roomId === roomId && !!fh && fh.current > 0;
  });
}

// ------------------------------------------------------------ 熟练度 --

/**
 * 武学熟练度结算：加经验、按 art.expPerLevel 升层、解锁提示。
 *
 * 没有 Arsenal（野怪等）或没学该武学 → 不修炼（静默）。
 * 升层输出是里程碑（黄+粗）；解锁招式逐句跟报。
 */
export function grantArtExp(
  ctx: Pick<SystemContext, 'getComponent' | 'output'>,
  entity: EntityId,
  artId: string,
  amount: number,
): void {
  const arsenal = ctx.getComponent(entity, Arsenal);
  const art = ARTS[artId];
  const progress = arsenal?.arts[artId];
  if (!arsenal || !art || !progress) return;

  progress.exp += amount;
  while (progress.level < art.maxLevel && progress.exp >= art.expPerLevel) {
    progress.exp -= art.expPerLevel;
    progress.level += 1;
    ctx.output.narrative([
      {
        text: `你使出越发放肆的力道——「${art.name}」提升到第 ${progress.level} 层！`,
        style: { color: 'yellow', bold: true },
      },
    ]);
    for (const move of art.moves.filter((m) => m.tier === progress.level)) {
      ctx.output.narrative(rich`你悟出了新招式「${yellow(move.name)}」！`);
    }
  }
}

// ------------------------------------------------------------ 命令 --

/** 学武命令：learn/学 <秘籍>（秘籍在背包里；学了写入 Arsenal、消耗秘籍） */
export const LearnCommand = defineCommand({
  verbs: ['learn', '学'],
  describe: '学会背包里的秘籍（武馆地上有剑谱与心法，学完即焚）',
  args: { item: { type: 'entity' } },
  handle({ args, output, player, world }) {
    // 场景门控：同房有敌对活物 → 无法静心读书（语境回应而非命令锁定）
    const posNow = world.getComponent(player, Position);
    if (posNow && foesInRoom(world, player, posNow.roomId).length > 0) {
      output.error('战斗中无法静心读书。');
      return null;
    }
    if (!args.item) {
      output.error('学什么？（把秘籍拿进背包：学 剑谱）');
      return null;
    }
    // 作用域解析：只认背包里的（与 drop 同理由）
    const itemId = resolveInContainer(world, player, args.item);
    if (!itemId) {
      output.error(`你背包里没有「${args.item}」。`);
      return null;
    }
    const scripture = world.getComponent(itemId, Scripture);
    if (!scripture) {
      output.error(`「${args.item}」不是秘籍，学不了。`);
      return null;
    }
    const art = ARTS[scripture.artId];
    if (!art) {
      output.error('这本秘籍残缺不全，学不了。');
      return null;
    }
    if (world.getComponent(player, Arsenal)?.arts[scripture.artId]) {
      output.error(`「${art.name}」你早已学会，温故即可，不必再读。`);
      return null;
    }
    world.emit(ArtLearned, { entity: player, item: itemId, artId: scripture.artId });
    return null;
  },
});

/**
 * 出招命令：use/使 <招式> [目标]（M2）
 *
 * 招式必须在已习武学中且已解锁（level ≥ tier）；目标缺省自动选同房
 * 带生命的活物（不含自己）；内力校验与消耗在 WuxiaCombatSystem（结算处）。
 */
export const UseCommand = defineCommand({
  verbs: ['use', '使'],
  describe: '用已解锁招式攻击（use 崩拳 野狼；耗内力、伤害按系数）',
  args: { move: { type: 'word' }, target: { type: 'optional_entity' } },
  handle({ args, output, player, world }) {
    if (!args.move) {
      output.error('使哪一招？（武学 查看已解锁招式）');
      return null;
    }
    const pos = world.getComponent(player, Position);
    if (!pos) {
      output.error('你不在任何地方。');
      return null;
    }
    const arsenal = world.getComponent(player, Arsenal);
    if (!arsenal) {
      output.error('你还没学会任何武学。');
      return null;
    }

    // 招式匹配：已习武学 + 已解锁（level ≥ tier），主名/前缀
    let found: { artId: string; moveId: string } | undefined;
    for (const [artId, progress] of Object.entries(arsenal.arts)) {
      const art = ARTS[artId];
      if (!art) continue;
      for (const move of art.moves) {
        if (progress.level >= move.tier && (move.name === args.move || move.name.startsWith(args.move))) {
          found = { artId, moveId: move.id };
          break;
        }
      }
      if (found) break;
    }
    if (!found) {
      output.error(`你没练成「${args.move}」这一招。`);
      return null;
    }

    // 目标：显式指定 → 房间作用域解析（不许指自己）；缺省 → 同房第一个带生命的活物
    let target = args.target ? resolveOccupantIn(world, pos.roomId, args.target) : undefined;
    if (target === player) {
      output.error('你不能攻击自己。');
      return null;
    }
    if (!target) {
      target = occupantsIn(world, pos.roomId).find(
        (id) => id !== player && world.getComponent(id, Health) !== undefined,
      );
    }
    if (!target) {
      output.error('这里没有可出招的对象。');
      return null;
    }

    world.emit(Strike, { attacker: player, target, artId: found.artId, moveId: found.moveId });
    return null;
  },
});

/** 运转命令：practice/运转 <心法>（同时只能运转一门；打坐时涨其熟练度） */
export const ChannelCommand = defineCommand({
  verbs: ['practice', '运转'],
  describe: '运转心法（打坐涨其熟练度；吐纳术使打坐回气翻倍）',
  args: { art: { type: 'word' } },
  handle({ args, output, player, world }) {
    const channel = world.getComponent(player, Channeling);
    if (!channel) {
      output.error('这个世界没有运转机制。');
      return null;
    }
    if (!args.art) {
      return channel.artId
        ? `正在运转「${ARTS[channel.artId]?.name ?? channel.artId}」。`
        : '当前没有运转任何心法。';
    }
    const arsenal = world.getComponent(player, Arsenal);
    const art = Object.values(ARTS).find(
      (a) => a.id === args.art || a.name === args.art || a.name.startsWith(args.art),
    );
    if (!art || !arsenal?.arts[art.id]) {
      output.error(`你没学过「${args.art}」，运转不了。`);
      return null;
    }
    world.emit(ChannelRequested, { entity: player, artId: art.id });
    return null;
  },
});

/** 武学一览：arts/武学（等级/熟练度进度/已解锁招式/运转标记） */
export const ArtsCommand = defineCommand({
  verbs: ['arts', '武学'],
  describe: '已习武学、层数与招式一览',
  handle({ player, world }) {
    const arsenal = world.getComponent(player, Arsenal);
    if (!arsenal || Object.keys(arsenal.arts).length === 0) {
      return '你还没学会任何武学。';
    }
    const channel = world.getComponent(player, Channeling);
    const lines: string[] = ['已习武学：'];
    for (const [artId, progress] of Object.entries(arsenal.arts)) {
      const art = ARTS[artId];
      if (!art) continue;
      const unlocked = art.moves.filter((m) => progress.level >= m.tier).map((m) => m.name);
      const marks: string[] = [];
      if (channel?.artId === artId) marks.push('运转中');
      lines.push(
        `  「${art.name}」第 ${progress.level} 层（熟练 ${progress.exp}/${art.expPerLevel}）` +
          (marks.length ? `［${marks.join('、')}］` : '') +
          (unlocked.length ? `  招式：${unlocked.join('、')}` : '  （心法，无招式）'),
      );
    }
    return lines.join('\n');
  },
});

// ------------------------------------------------------------ 系统 --

/**
 * 武学系统（M2）：`ArtLearned` / `ChannelRequested` 的落地者
 *
 * - 学成：Arsenal 写入 1 级 + 秘籍消耗（destroy——秘籍读完即焚，xkx 惯例）
 * - 运转：Channeling 写 artId（同时只有一门——整体覆盖）
 */
export const MartialSystem = defineSystem({
  name: 'xk.martial',
  on: [ArtLearned, ChannelRequested],
  handle(event, ctx) {
    if (event.token === ArtLearned.token) {
      const { entity, item, artId } = event.data;
      const art = ARTS[artId];
      const arsenal = ctx.getComponent(entity, Arsenal);
      if (!arsenal || !art) return;
      arsenal.arts[artId] = { level: 1, exp: 0 };
      ctx.destroy(item);
      ctx.output.narrative(rich`你翻开《${yellow(art.name)}》，如饥似渴地读了起来——学会了！`);
      return;
    }

    const { entity, artId } = event.data;
    const art = ARTS[artId];
    const channel = ctx.getComponent(entity, Channeling);
    if (!channel || !art) return;
    channel.artId = artId;
    channel.lastTickedAt = 0;
    ctx.output.narrative(`你凝神静气，开始运转「${art.name}」。`);
  },
});
