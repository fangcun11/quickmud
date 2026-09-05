/**
 * 侠客行 · 战斗内核（M1，回合制、纯公式、零随机）
 *
 * 复用 prefabs 的 Attack/Died 事件与死亡管线（LootSystem/DeathSystem 白得
 * 掉落与清场），只**替换结算内核**——不注册 prefabs CombatSystem（那是
 * demo 件：固定 10 点伤害、无属性）。三态判定与伤害完全由属性差决定：
 *
 *   dodge 差 = 攻方 dodge − 守方 dodge
 *     ≥ 2    → 命中（全额）
 *     −1..1  → 命中（七成，「被格挡」）
 *     ≤ −2   → 被闪避（零伤）
 *   伤害 = max(1, round(atk − def))；格挡再 ×0.7
 *
 * 回合制语义：玩家下一回合（attack/逃），NPC 被打中后由 NpcRetaliateSystem
 * 自动还手一击（走同一内核）——攻守两向共用一套公式，平衡可推演。
 */
import { defineCommand, defineSystem, Name } from '@mud/ecs-engine';
import type { Segment, SystemContext } from '@mud/ecs-engine';
import { Attack, Died, Health, Position, Moved, displayName, injuryWarning } from '@mud/prefabs';
import { Attacked, Fled, Strike } from './events';
import { Stats, Retaliate, Trail, PlayerTag, Arsenal, Energy } from './traits';
import { ARTS } from './arts';
import { grantArtExp } from './martial';

// ---------------------------------------------------------------- 命令 --

/** 逃/flee：发逃跑意图，成败由 FleeSystem 按身法差结算 */
export const FleeCommand = defineCommand({
  verbs: ['flee', '逃', '逃跑'],
  describe: '拔腿就跑：身法够高退回来路，不够就原地挨一击',
  handle({ output, player, world }) {
    if (!world.getComponent(player, Position)) {
      output.error('你不在任何地方。');
      return null;
    }
    world.emit(Fled, { entity: player });
    return null;
  },
});

// ---------------------------------------------------------------- 文案 --

/**
 * 战斗句式定约（P4）：**句首永远是攻击者**（你 / 「X」），三态同构——
 * 命中（造成 n 伤）→ 格挡（被挡，n 伤）→ 闪避（落空，零伤）。
 * 多方混战时扫一眼句首就知道谁在出手；玩家视角一律「你」。
 * 玩家不在场（NPC 互殴）时双方全名第三人称。
 */
function combatLine(
  atk: string,
  def: string,
  result: 'hit' | 'blocked' | 'dodged',
  damage: number,
  moveName?: string,
): Segment[] | string {
  const ATK = atk === '你' ? '你' : `「${atk}」`;
  const DEF = def === '你' ? '你' : `「${def}」`;
  // xkx 惯例：每回合报招式名（自动选招的「直拳」也报——玩家知道自己在用什么）
  const lead = moveName ? `一记「${moveName}」` : '';
  if (result === 'hit') return `${ATK}${lead}命中${DEF}，造成 ${damage} 点伤害。`;
  if (result === 'blocked') return `${ATK}${lead}全力出手，被${DEF}格挡，只造成 ${damage} 点伤害。`;
  return `${ATK}${lead || '这一击'}落了空——${DEF}轻巧地闪过。`;
}

// ---------------------------------------------------------------- 系统 --

/**
 * 武侠结算内核（on Attack）：
 * 校验（同房间、有生命）→ 三态判定 → 伤害结算 → emit Attacked →
 * HP 归零 → emit Died（掉落/清场交给现有管线）。
 */
export const WuxiaCombatSystem = defineSystem({
  name: 'xk.combat',
  on: [Attack, Strike],
  priority: 0,
  handle(event, ctx) {
    const attacker = event.data.attacker;
    const target = event.data.target;

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
    if (hp.current <= 0) return; // 已经死了（同轮多重 Attack 的防御）

    // ---- 招式解析（M2）：attack 自动选已解锁且内力够的最高系数；
    // use 命令（Strike）显式指定（此处再校验一次——系统是执行者） ----
    let mult = 1.0;
    let artId = '';
    let moveName: string | undefined;
    if (event.token === Strike.token) {
      const { artId: aid, moveId } = event.data;
      const progress = ctx.getComponent(attacker, Arsenal)?.arts[aid];
      const move = ARTS[aid]?.moves.find((m) => m.id === moveId);
      const energy = ctx.getComponent(attacker, Energy);
      if (!progress || !move || progress.level < move.tier) {
        ctx.output.error('你还没练成这一招。');
        return;
      }
      if (!energy || energy.current < move.cost) {
        ctx.output.error('内力不济，使不出这一招。');
        return;
      }
      energy.current -= move.cost;
      artId = aid;
      mult = move.mult;
      moveName = move.name;
    } else {
      const picked = autoSelectMove(ctx, attacker);
      artId = picked.artId;
      mult = picked.mult;
      moveName = picked.moveName;
      if (picked.cost > 0) {
        const energy = ctx.getComponent(attacker, Energy)!;
        energy.current -= picked.cost;
      }
    }

    // ---- 纯公式三态（mult 进伤害式） ----
    const atkStats = ctx.getComponent(attacker, Stats);
    const defStats = ctx.getComponent(target, Stats);
    const diff = (atkStats?.dodge ?? 0) - (defStats?.dodge ?? 0);
    const result = diff >= 2 ? 'hit' : diff >= -1 ? 'blocked' : 'dodged';

    const targetName = displayName(ctx, target);
    const atkName = displayName(ctx, attacker);
    const atkIsPlayer = !!ctx.getComponent(attacker, PlayerTag);
    const defIsPlayer = !!ctx.getComponent(target, PlayerTag);
    const atkLabel = atkIsPlayer ? '你' : atkName;
    const defLabel = defIsPlayer ? '你' : targetName;

    if (result === 'dodged') {
      ctx.output.narrative(combatLine(atkLabel, defLabel, 'dodged', 0, moveName));
      ctx.emit(Attacked, { attacker, target, damage: 0, result });
      return;
    }

    let damage = Math.max(1, Math.round((atkStats?.atk ?? 1) * mult - (defStats?.def ?? 0)));
    if (result === 'blocked') damage = Math.max(1, Math.round(damage * 0.7));

    const before = hp.current;
    hp.current = Math.max(0, hp.current - damage);
    ctx.output.narrative(combatLine(atkLabel, defLabel, result, damage, moveName));

    // 伤势警示（P2）：被打者掉档才出现（黄=轻伤、红=危急）
    const warn = injuryWarning(before, hp.current, hp.max, {
      isPlayerTarget: defIsPlayer,
      name: targetName,
    });
    if (warn) ctx.output.narrative([{ text: warn.text, style: { color: warn.color } }]);

    ctx.emit(Attacked, { attacker, target, damage, result });

    // ---- 熟练度（M2）：命中即 +1（闪避无心得）；击杀再 +3 ----
    if (artId) grantArtExp(ctx, attacker, artId, 1);

    if (before > 0 && hp.current <= 0) {
      if (artId) grantArtExp(ctx, attacker, artId, 3);
      // 死亡是视觉事件（xkx 惯例）：独立强调
      ctx.output.narrative([
        { text: `「${targetName}」惨嚎一声，轰然倒地。`, style: { color: 'red', bold: true } },
      ]);
      ctx.emit(Died, { entity: target, killer: attacker, roomId: tgtPos.roomId });
    }
  },
});

/**
 * 自动选招（attack 增强，M2）：已习武学里**已解锁且内力够**的最高系数招式；
 * 一个都凑不出来 → 直拳档（mult 1.0，零耗）。野怪没有 Arsenal → 普通攻击。
 */
function autoSelectMove(
  ctx: SystemContext,
  attacker: string,
): { artId: string; cost: number; mult: number; moveName?: string } {
  const arsenal = ctx.getComponent(attacker, Arsenal);
  const energy = ctx.getComponent(attacker, Energy);
  if (!arsenal || !energy) return { artId: '', cost: 0, mult: 1, moveName: undefined };
  let best: { artId: string; cost: number; mult: number; moveName: string } | null = null;
  for (const [artId, progress] of Object.entries(arsenal.arts)) {
    const art = ARTS[artId];
    if (!art) continue;
    for (const move of art.moves) {
      if (progress.level < move.tier) continue; // 未解锁
      if (energy.current < move.cost) continue; // 内力不够
      if (!best || move.mult > best.mult) best = { artId, cost: move.cost, mult: move.mult, moveName: move.name };
    }
  }
  return best ?? { artId: '', cost: 0, mult: 1, moveName: undefined };
}

/**
 * 还手（on Attacked，priority 10 → 排在打断之后）：
 * 被打者挂了 Retaliate 且还活着 → 对攻击者自动还击一击（emit Attack
 * 走同一内核）。玩家没挂 Retaliate——狼打玩家不会触发"玩家还手"，
 * 玩家的回合是玩家自己下的指令。
 */
export const NpcRetaliateSystem = defineSystem({
  name: 'xk.retaliate',
  on: [Attacked],
  priority: 10,
  handle(event, ctx) {
    const { attacker, target } = event.data;
    if (!ctx.getComponent(target, Retaliate)) return;
    const hp = ctx.getComponent(target, Health);
    if (!hp || hp.current <= 0) return; // 倒下的不再还手
    ctx.emit(Attack, { attacker: target, target: attacker });
  },
});

/**
 * 逃跑结算（on Fled）：
 * 身法差 = 逃者 dodge − 房内最强敌人 dodge，≥ 2 逃回来路（Trail）；
 * 不然原地挨最强敌人一击。没有来路记录（从未移动过）等同失败处理。
 */
export const FleeSystem = defineSystem({
  name: 'xk.flee',
  on: [Fled],
  handle(event, ctx) {
    const id = event.data.entity;
    const pos = ctx.getComponent(id, Position);
    if (!pos) return;

    // 房内还活着的敌对目标（挂 Retaliate 的）
    const foes = [...ctx.findByComponent(Retaliate)].filter((f) => {
      if (f === id) return false;
      const fp = ctx.getComponent(f, Position);
      const fh = ctx.getComponent(f, Health);
      return fp?.roomId === pos.roomId && !!fh && fh.current > 0;
    });
    if (foes.length === 0) {
      ctx.output.narrative('周围没有威胁，不必逃。');
      return;
    }

    const myDodge = ctx.getComponent(id, Stats)?.dodge ?? 0;
    const strongest = foes
      .sort((a, b) => (ctx.getComponent(b, Stats)?.dodge ?? 0) - (ctx.getComponent(a, Stats)?.dodge ?? 0))[0]!;
    const diff = myDodge - (ctx.getComponent(strongest, Stats)?.dodge ?? 0);

    const trail = ctx.getComponent(id, Trail);
    const from = pos.roomId;
    if (diff >= 2 && trail && trail.roomId && trail.roomId !== from) {
      pos.roomId = trail.roomId;
      const roomName = ctx.getComponent(trail.roomId, Name)?.text ?? trail.roomId;
      // 成功脱身是转折事件：黄色提示，与普通过招区分
      ctx.output.narrative([
        { text: `你拔腿就跑，一口气退回「${roomName}」。`, style: { color: 'yellow' } },
      ]);
      // 手动改位置不走 MovementSystem，Moved 要自己发（打断打坐、记录来路都靠它）
      ctx.emit(Moved, { entity: id, from, to: trail.roomId, direction: 'flee' });
      return;
    }

    ctx.output.narrative(`你脚下一乱没能脱身——「${displayName(ctx, strongest)}」扑了上来！`);
    ctx.emit(Attack, { attacker: strongest, target: id });
  },
});

/**
 * 来路记录（on Moved，priority 20 → 打断处理完再记账）：
 * 只给挂了 Trail 的实体（玩家）记 from——逃跑的"退回上一步"依据。
 */
export const TrailSystem = defineSystem({
  name: 'xk.trail',
  on: [Moved],
  priority: 20,
  handle(event, ctx) {
    const trail = ctx.getComponent(event.data.entity, Trail);
    if (trail) trail.roomId = event.data.from;
  },
});
