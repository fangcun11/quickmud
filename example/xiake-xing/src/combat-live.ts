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
import type { ComponentDefinition, EntityId } from '@mud/ecs-engine';
import { Attack, Health, Position, displayName } from '@mud/prefabs';
import { PlayerTag, Combat, Aggressive } from './traits';

/** 进入战斗（设 foe；幂等——已在战则换对手） */
export function enterCombat(
  ctx: { getComponent: <T>(id: EntityId, c: ComponentDefinition<T>) => T | undefined },
  entity: EntityId,
  foe: EntityId,
): void {
  const combat = ctx.getComponent(entity, Combat);
  if (combat) combat.foe = foe;
}

/** 脱战（清 foe） */
export function exitCombat(
  ctx: { getComponent: <T>(id: EntityId, c: ComponentDefinition<T>) => T | undefined },
  entity: EntityId,
): void {
  const combat = ctx.getComponent(entity, Combat);
  if (combat) combat.foe = '';
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
  handle(payload, ctx) {
    const time = payload.data.time;

    for (const id of ctx.findByComponent(Combat)) {
      const combat = ctx.getComponent(id, Combat)!;
      if (!combat.foe) continue; // 未在战斗
      if (combat.lastRoundAt === time) continue;
      combat.lastRoundAt = time;

      const pos = ctx.getComponent(id, Position);
      const foeHp = ctx.getComponent(combat.foe as EntityId, Health);
      const foePos = ctx.getComponent(combat.foe as EntityId, Position);

      // 对手死了 / 不在同房 → 脱战
      if (!foeHp || foeHp.current <= 0 || !foePos || !pos || foePos.roomId !== pos.roomId) {
        combat.foe = '';
        continue;
      }

      // 自动出招（走正常管线——招式选择/伤势/击杀/升层全由 WuxiaCombatSystem 处理）
      ctx.emit(Attack, { attacker: id, target: combat.foe as EntityId });
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
      playerCombat.foe = npc;
      ctx.output.narrative(`「${displayName(ctx, npc)}」呲着牙向你扑来！`);
      break;
    }
  },
});

/** 停战命令：停战/脱离（清 foe；Aggressive 对手下息会再接敌） */
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
    combat.foe = '';
    output.narrative(`你脱离了与「${foeName}」的战斗。`);
    return null;
  },
});
