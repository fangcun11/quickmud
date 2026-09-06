/**
 * 侠客行 · 修炼（M1 内功根基）
 *
 * 打坐是内力的唯一来源：玩家出生即预挂 `Cultivating`，打坐时 `on` 置位，每 tick 由 MeditationSystem
 * 结算回复；移动、受击自动打断（InterruptSystem）。「状态」命令是属性
 * 一览，替换 prefabs 的 ScoreCommand（那是 demo 件，只报生命和房间 id）。
 *
 * 命令不改状态（引擎铁律）：打坐/停只发意图事件，挂/摘 Cultivating
 * 由 CultivationToggleSystem 落地。
 */
import { defineCommand, defineSystem, Name } from '@mud/ecs-engine';
import { Health, Position, Moved, displayName } from '@mud/prefabs';
import { Energy, Stats, Cultivating, Channeling, Purse, Combat, Arsenal } from './traits';
import { Consumable as ItemConsumable } from '@mud/prefabs';
import { Consumed } from '@mud/prefabs';
import { ARTS } from './arts';
import { grantArtExp } from './martial';
import { Attacked, MeditateRequested, StopRequested } from './events';

/** 每 tick 吐纳回复的内力（打坐 5 tick 内从 20 回满 100） */
export const MEDITATE_GAIN = 20;

// ---------------------------------------------------------------- 命令 --

/** 打坐/meditate：发打坐意图（on 翻转由系统落地） */
export const MeditateCommand = defineCommand({
  verbs: ['meditate', '打坐', '运功'],
  describe: '盘膝打坐回内力（每息 +20；移动或被打会收功）',
  handle({ output, player, world }) {
    if (!world.getComponent(player, Energy)) {
      output.error('你还没有内力可修。');
      return null;
    }
    if (world.getComponent(player, Cultivating)?.on) {
      output.error('你已在打坐中。');
      return null;
    }
    world.emit(MeditateRequested, { entity: player });
    return null;
  },
});

/** 停/stop：发收功意图 */
export const StopCommand = defineCommand({
  verbs: ['stop', '停', '收功'],
  describe: '结束打坐（内力保留）',
  handle({ output, player, world }) {
    if (!world.getComponent(player, Cultivating)?.on) {
      output.error('你并没有在打坐。');
      return null;
    }
    world.emit(StopRequested, { entity: player });
    return null;
  },
});

/** 状态/stats：北侠式一屏全知面板（B2 沉浸感方案） */
export const StatusCommand = defineCommand({
  verbs: ['stats', '状态', '属性'],
  describe: '个人状态：气血/内力/武学/银两/所在，一屏全知',
  handle({ player, world }) {
    const hp = world.getComponent(player, Health);
    const energy = world.getComponent(player, Energy);
    const stats = world.getComponent(player, Stats);
    const pos = world.getComponent(player, Position);
    const roomName = pos ? world.getComponent(pos.roomId, Name) : undefined;
    const purse = world.getComponent(player, Purse);
    const combat = world.getComponent(player, Combat);
    const cultivating = world.getComponent(player, Cultivating);
    const channel = world.getComponent(player, Channeling);
    const arsenal = world.getComponent(player, Arsenal);

    // 气血条：8 格，1 格以上保底可见（0 = 全空）
    const bar = (cur: number, max: number) => {
      const filled = max > 0 ? Math.max(cur > 0 ? 1 : 0, Math.round((cur / max) * 8)) : 0;
      return '█'.repeat(filled) + '░'.repeat(8 - filled);
    };

    const lines: string[] = ['┌───个人状态──────────────────────┐'];
    if (hp) lines.push(`│ 气血  ${hp.current}/${hp.max}   ${bar(hp.current, hp.max)}`);
    if (energy) lines.push(`│ 内力  ${energy.current}/${energy.max}   ${bar(energy.current, energy.max)}`);
    if (stats) lines.push(`│ 三围  攻 ${stats.atk} · 防 ${stats.def} · 身法 ${stats.dodge}`);
    if (purse) lines.push(`│ 银两  ${purse.silver} 碎银`);
    if (arsenal) {
      const arts = Object.entries(arsenal.arts)
        .map(([id, p]) => `${ARTS[id]?.name ?? id}(${p.level}层)`)
        .join(' · ');
      if (arts) lines.push(`│ 武学  ${arts}`);
      if (channel?.artId) lines.push(`│ 心法  运转中：${ARTS[channel.artId]?.name ?? channel.artId}`);
    }
    const flags: string[] = [];
    if (cultivating?.on) flags.push('打坐中');
    if (combat?.foe) flags.push('交战中');
    if (flags.length === 0) flags.push('无事一身轻');
    lines.push(`│ 状态  ${flags.join(' · ')}`);
    if (roomName) lines.push(`│ 所在  ${roomName.text}`);
    lines.push('└──────────────────────────────┘');
    return lines.join('\n');
  },
});

// ---------------------------------------------------------------- 系统 --

/** 打坐/收功意图落地：翻转 Cultivating.on（预挂组件，与 VerboseSystem 同款） */
export const CultivationToggleSystem = defineSystem({
  name: 'xk.meditation-toggle',
  on: [MeditateRequested, StopRequested],
  handle(event, ctx) {
    const c = ctx.getComponent(event.data.entity, Cultivating);
    if (!c) return; // 没预挂的世界没有打坐（静默忽略）
    if (event.token === MeditateRequested.token) {
      c.on = true;
      ctx.output.narrative('你盘膝坐下，凝神静气，开始吐纳运功。');
    } else {
      c.on = false;
      ctx.output.narrative('你缓缓收功，睁开双眼。');
    }
  },
});

/**
 * 吐纳结算（every 1000，与 world.tickInterval 对齐）：
 * 每个打坐中的实体内力 +MEDITATE_GAIN，封顶 max。
 *
 * 反馈聚合（P5）：每息只报一行**压灰短讯**（进度型信息不是世界叙事，
 * 走 system 通道），充满那一刻给一句里程碑 + 自动收功——不再无限吐纳。
 *
 * 引擎的 every 时相本身是 drift-free 固定网格（k × every），
 * `Cultivating.lastTickedAt` 记录上次结算时间，为快照/回滚后的一致性兜底。
 */
/** 消耗品的内力回复（侠客行层）：ConsumableSystem 处理 hp，此处补 energy */
export const EnergyConsumableSystem = defineSystem({
  name: 'xk.energy-consume',
  on: [Consumed],
  // priority −10：prefab.consume（同为 Consumed 订阅者）读组件后 destroy 物品，
  // 内力数值必须抢在它前面读走
  priority: -10,
  handle(event, ctx) {
    const { entity, item } = event.data;
    const consumable = ctx.getComponent(item, ItemConsumable);
    if (!consumable || consumable.energy <= 0) return;
    const energy = ctx.getComponent(entity, Energy);
    if (!energy) return;
    energy.current = Math.min(energy.max, energy.current + consumable.energy);
    ctx.output.narrative(`内力回复至 ${energy.current}/${energy.max}。`);
  },
});

export const MeditationSystem = defineSystem({
  name: 'xk.meditation',
  every: 1000,
  handle(payload, ctx) {
    const time = payload.data.time;
    for (const id of ctx.findByComponent(Cultivating)) {
      const c = ctx.getComponent(id, Cultivating)!;
      if (!c.on) continue; // 预挂但未在打坐
      if (c.lastTickedAt === time) continue; // 同一网格只结算一次
      c.lastTickedAt = time;
      const energy = ctx.getComponent(id, Energy);
      if (!energy) continue; // 组件不全 → 静默跳过
      if (energy.current >= energy.max) continue; // 已满：保持打坐状态，不再回复
      // 运转心法的两项收益（M2）：吐纳术打坐内力翻倍；运转心法每息熟练度 +1
      const channel = ctx.getComponent(id, Channeling);
      const bonus = ARTS[channel?.artId ?? '']?.meditateBonus ?? 1;
      energy.current = Math.min(energy.max, energy.current + MEDITATE_GAIN * bonus);
      if (channel?.artId) grantArtExp(ctx, id, channel.artId, 1);
      if (energy.current >= energy.max) {
        // 充满：里程碑一句 + 自动收功（继续吐纳没有收益，纯占状态）
        ctx.output.narrative([
          { text: `内力已然充盈（${energy.current}/${energy.max}），你缓缓收功。`, style: { color: 'yellow' } },
        ]);
        c.on = false;
      } else {
        ctx.output.system(`内力 ${energy.current}/${energy.max}。`);
      }
    }
  },
});

/**
 * 打断（on Attacked / Moved）：
 * - 移动 → 「收功起身」（逃跑成功撤退也一样，语义自然成立）
 * - 被命中 → 「被打得气血翻涌」——注意打断的是**被打者**的修炼
 */
export const InterruptSystem = defineSystem({
  name: 'xk.interrupt',
  on: [Moved, Attacked],
  handle(event, ctx) {
    const [id, who] =
      event.token === Moved.token
        ? [event.data.entity, '你收功起身。']
        : [event.data.target, null];
    const c = ctx.getComponent(id, Cultivating);
    if (c?.on) {
      c.on = false;
      ctx.output.narrative(who ?? `${displayName(ctx, id)}被打得气血翻涌，收功护体！`);
    }
  },
});
