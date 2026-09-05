/**
 * 侠客行 · 持续战斗（0.14 沉浸支线，参考 xkx 持续回合制）
 *
 * 此前：attack 一拳 → 狼还手一击 → 结束。世界是"静态"的。
 * 现在：attack 一拳 → **进入战斗** → 每息自动交手 → 直到一方倒下 / 逃跑 / 脱战。
 *
 * - `Combat` 组件（**玩家出生即预挂**，与 Verbose 同款）：{ foe, lastRoundAt }
 *   foe = 当前交战对手（'' = 未在战斗）；lastRoundAt 固定网格时间账本。
 * - `CombatRoundSystem`（every 1000）：每息对在战玩家自动交手一轮。
 * - `Aggressive` 标记（挂 NPC）：同房有玩家 → 自动接敌。
 * - 脱战：对手倒下 / 逃跑 / 移动出房 / 停战——清 foe 即可。
 */
import { defineCommand, defineSystem } from '@mud/ecs-engine';
import type { SystemContext, EntityId } from '@mud/ecs-engine';
import { Attack, Health, Position, displayName, WanderHold, resolveOccupantIn } from '@mud/prefabs';
import { PlayerTag, Combat, Aggressive } from './traits';
import { Disengaged } from './events';

/** 进入战斗（设 foe；幂等——已在战则换对手） */
export function enterCombat(ctx: SystemContext, entity: EntityId, foe: EntityId): void {
  const combat = ctx.getComponent(entity, Combat);
  if (!combat) return;
  // 换对手时先放开旧的（WanderHold 关系，见下）
  if (combat.foe && combat.foe !== foe && ctx.getEntity(combat.foe as EntityId)) {
    ctx.removeRelation(combat.foe as EntityId, WanderHold, entity);
  }
  combat.foe = foe;
  // 钉住接战的对手：战斗中不许游走出房（NpcWanderSystem 尊重 WanderHold）
  // ——否则"持续战斗"每息都被游走脱战拆台
  ctx.addRelation(foe, WanderHold, entity);
}

/** 脱战（清 foe + 解除对手的游走钉住） */
export function exitCombat(ctx: SystemContext, entity: EntityId): void {
  const combat = ctx.getComponent(entity, Combat);
  if (!combat) return;
  const foe = combat.foe as EntityId;
  if (foe && ctx.getEntity(foe)) ctx.removeRelation(foe, WanderHold, entity);
  combat.foe = '';
  combat.lastStatus = '';
}

/**
 * 持续战斗系统（every 1000 = 每息）：
 *
 * 1. 自动交手：对在战（foe 非空）的玩家，每息 emit Attack（走正常结算管线）
 * 2. 脱战检查：对手死了 / 不在同房 → 清 foe
 * 3. Aggressive 接敌：同房的 Aggressive NPC → 自动设 foe
 */
export const CombatRoundSystem = defineSystem({
  name: 'xk.combat-round',
  every: 1000,
  on: [Disengaged],
  handle(payload, ctx) {
    // 停战事实：解除对手的游走钉住（命令侧关系只读，写走本系统）
    if (payload.token === Disengaged.token) {
      exitCombat(ctx, (payload.data as { entity: EntityId }).entity);
      return;
    }
    const time = (payload.data as unknown as { time: number }).time;

    for (const id of ctx.findByComponent(Combat)) {
      const combat = ctx.getComponent(id, Combat)!;
      if (!combat.foe) continue; // 未在战斗
      if (combat.lastRoundAt === time) continue;
      combat.lastRoundAt = time;

      const pos = ctx.getComponent(id, Position);
      const foeHp = ctx.getComponent(combat.foe as EntityId, Health);
      const foePos = ctx.getComponent(combat.foe as EntityId, Position);

      // 对手死了 / 不在同房 → 脱战（同时解除游走钉住）
      if (!foeHp || foeHp.current <= 0 || !foePos || !pos || foePos.roomId !== pos.roomId) {
        if (ctx.getEntity(combat.foe as EntityId)) {
          ctx.removeRelation(combat.foe as EntityId, WanderHold, id);
        }
        if (foeHp && foeHp.current > 0) {
          // 对手还活着只是不在眼前（玩家被拉开等）：明说，别让战斗无声消失
          ctx.output.narrative(`「${displayName(ctx, combat.foe as EntityId)}」脱离了你的攻击范围，你收回了攻势。`);
        }
        combat.foe = '';
        combat.lastStatus = '';
        continue;
      }

      // 自动出招（走正常管线——招式选择/伤势/击杀/升层全由 WuxiaCombatSystem 处理）
      ctx.emit(Attack, { attacker: id, target: combat.foe as EntityId });

      // 状态行（0.18 战斗可读性）：每息交手后报双方气血，数字没变不重刷
      const meHp = ctx.getComponent(id, Health);
      const foeNow = ctx.getComponent(combat.foe as EntityId, Health);
      if (meHp && foeNow) {
        const line = `（你 ${meHp.current}/${meHp.max} ┋ ${displayName(ctx, combat.foe as EntityId)} ${foeNow.current}/${foeNow.max}）`;
        if (line !== combat.lastStatus) {
          combat.lastStatus = line;
          ctx.output.system(line);
        }
      }
    }

    // ---- Aggressive 接敌：同房的 Aggressive NPC → 自动进战斗 ----
    const player = ctx.findByComponent(PlayerTag)[0];
    if (!player) return;
    const playerPos = ctx.getComponent(player, Position);
    if (!playerPos) return;
    const playerCombat = ctx.getComponent(player, Combat);
    if (!playerCombat || playerCombat.foe) return; // 已在战斗

    for (const npc of ctx.findByComponent(Aggressive)) {
      const npcPos = ctx.getComponent(npc, Position);
      const npcHp = ctx.getComponent(npc, Health);
      if (!npcPos || npcPos.roomId !== playerPos.roomId) continue;
      if (!npcHp || npcHp.current <= 0) continue;
      enterCombat(ctx, player, npc);
      ctx.output.narrative(`「${displayName(ctx, npc)}」呲着牙向你扑来！`);
      break;
    }
  },
});

/** 停战命令：停战/脱离（emit 事实；解钉走系统——命令侧关系只读） */
export const DisengageCommand = defineCommand({
  verbs: ['停战', '脱离'],
  describe: '脱离当前战斗（对手还在的话，Aggressive 会再接敌）',
  handle({ output, player, world }) {
    const combat = world.getComponent(player, Combat);
    if (!combat || !combat.foe) {
      output.error('你没有在战斗中。');
      return null;
    }
    const foeName = displayName(world, combat.foe as EntityId);
    world.emit(Disengaged, { entity: player });
    output.narrative(`你脱离了与「${foeName}」的战斗。`);
    return null;
  },
});

/**
 * 攻击命令（侠客行版，0.18 战斗可读性）：替换 prefabs 的 AttackCommand——
 * 战斗中 `attack` **不带目标 = 续打当前对手**（xkx 惯例：不必每次重复点名）；
 * 带目标则照常解析（可换对手）。其余门控与 prefabs 版一致：
 * 房间作用域解析、不许攻击自己、emit Attack 走统一结算管线。
 */
export const AttackCommand = defineCommand({
  verbs: ['attack', 'kill', '攻击', '打'],
  describe: '攻击（战斗中不带目标 = 继续打当前对手）',
  args: { target: { type: 'optional_entity' } },
  handle({ args, output, player, world }) {
    const combat = world.getComponent(player, Combat);
    // 续打：不带目标时直接用 foe 的实体 id——它不是名字，走解析反而查不到
    if (!args.target) {
      if (!combat?.foe) {
        output.error('攻击谁？');
        return null;
      }
      world.emit(Attack, { attacker: player, target: combat.foe as EntityId });
      return null;
    }
    const pos = world.getComponent(player, Position);
    if (!pos) {
      output.error('你不在任何地方。');
      return null;
    }
    const resolved = resolveOccupantIn(world, pos.roomId, args.target);
    if (!resolved) {
      output.error(`这里没有「${args.target}」。`);
      return null;
    }
    if (resolved === player) {
      output.error('你不能攻击自己。');
      return null;
    }
    world.emit(Attack, { attacker: player, target: resolved });
    return null;
  },
});
