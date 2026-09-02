/**
 * mini-rpg 内容系统（v0.7-B）——「纯内容」的示范核心
 *
 * 全部能力来自 @mud/ecs-engine + @mud/prefabs 的公开 API，零源码侵入：
 *
 * - SwampMiasmaSystem  订阅 `Moved`：进沼泽 → spawn 毒雾 buff（区域效果，不分敌我）
 * - SpiderRevengeSystem 订阅 `Attack`：巨蛛被打 → **emit 标准 Attack 反咬**（走
 *   CombatSystem 正常结算，死亡管线全生效）——纯内容实现的 boss AI
 * - SpiderVenomSystem  订阅 `Attack`：巨蛛咬人 → 给受害者 spawn 蛛毒 buff
 *   （`source` 指向巨蛛：毒杀归功走完整死亡管线）
 * - HerbalistEffectsSystem 订阅 `DialogueChoiceMade`：讨茶 → spawn 回春 buff
 * - EndingSystem       订阅 `QuestTurnedIn`：主线交付 → 输出终局文案
 *
 * buff 全部用 prefabs 的 `buffBlueprint` + `ctx.spawn`：spawn 即忘，
 * 内容层不需要感知世界时间（startedAt 由 BuffSystem 激活时写入）。
 */
import { defineSystem, DialogueChoiceMade } from '@mud/ecs-engine';
import type { EntityId } from '@mud/ecs-engine';
import {
  Moved,
  Attack,
  QuestTurnedIn,
  Health,
  Exits,
  Located,
  buffBlueprint,
} from '@mud/prefabs';

type MovedPayload = { entity: EntityId; from: string; to: string };
type AttackPayload = { attacker: EntityId; target: EntityId };
type ChoicePayload = {
  player: EntityId;
  npc: EntityId;
  optionText: string;
  remember?: string[];
};
type TurnInPayload = { player: EntityId; giver: EntityId; questId: string };

/** 巨蛛的实体 id（本内容包的内部约定：id 在 bootstrap 里用 createWithId 固定） */
const SPIDER = 'spider' as EntityId;

/**
 * 沼泽毒雾：进入沼泽的活物都会缠上毒雾（lasts 8s，每 2s -3 → 共 -9）
 *
 * 不区分玩家与 NPC——狼游进沼泽照样中毒（毒雾不分敌我，内容自洽）。
 * 无 `source`：天灾无毒杀归属。
 *
 * 判定细节：`Moved.to` 是**方向**而非房间 id（MovementSystem 的契约），
 * 所以用「from 房间的出口表里 to 方向指向 swamp」来判定"真的走进了沼泽"——
 * 出口校验失败（撞墙）不会误触发，也不依赖系统注册顺序。
 */
export const SwampMiasmaSystem = defineSystem<MovedPayload>({
  name: 'mini-rpg.swamp-miasma',
  on: [Moved],
  priority: 0,
  handle(event, ctx) {
    const { entity, from, to } = event.data;
    const exits = ctx.getComponent(from as EntityId, Exits);
    if (exits?.[to] !== ('swamp' as EntityId)) return;
    if (!ctx.getComponent(entity, Health)) return; // 毒雾只缠活物

    ctx.spawn(
      buffBlueprint({
        victim: entity,
        effect: { type: 'damage', amount: 3, every: 2000 },
        lasts: 8000,
      }),
    );
    ctx.output.narrative('沼泽的毒雾无声无息地缠了上来……（每隔一会儿 -3 生命，持续一阵子）');
  },
});

/**
 * 巨蛛反击：被玩家攻击时反咬一口
 *
 * 关键设计：**emit 标准 Attack 事件**而非直接扣血——咬击由 CombatSystem
 * 结算（同房校验、伤害计算、Died 管线全部生效），内容只负责"意图"。
 * 反咬前检查自己是否还活着：玩家最后一击会先把自己打成 0 血，
 * 排水到本系统时蛛已死，不该从坟墓里咬人。
 */
export const SpiderRevengeSystem = defineSystem<AttackPayload>({
  name: 'mini-rpg.spider-revenge',
  on: [Attack],
  priority: 0,
  handle(event, ctx) {
    const { attacker, target } = event.data;
    if (target !== SPIDER) return; // 只关心"谁在打巨蛛"

    const hp = ctx.getComponent(SPIDER, Health);
    if (!hp || hp.current <= 0) return; // 已死，不再反击

    // 反咬的目标是**攻击者**（打它的人），不是 target——那可是它自己
    ctx.emit(Attack, { attacker: SPIDER, target: attacker });
  },
});

/**
 * 巨蛛毒液：被巨蛛咬中 → 蛛毒入体（lasts 6s，每 2s -2 → 共 -6）
 *
 * `source: SPIDER`——若玩家毒死在蛛巢里，Died.killer 会归到巨蛛头上
 * （击杀任务计数、战利品归属全走标准管线）。
 */
export const SpiderVenomSystem = defineSystem<AttackPayload>({
  name: 'mini-rpg.spider-venom',
  on: [Attack],
  priority: 0,
  handle(event, ctx) {
    const { attacker, target } = event.data;
    if (attacker !== SPIDER) return;
    if (!ctx.getComponent(target, Health)) return;

    ctx.spawn(
      buffBlueprint({
        victim: target,
        effect: { type: 'damage', amount: 2, every: 2000 },
        lasts: 6000,
        source: SPIDER,
      }),
    );
    ctx.output.narrative('巨蛛的毒牙撕开你的护腕——伤口泛起紫黑色。');
  },
});

/**
 * 药婆的草药茶：对话选项（remember: tea）→ 回春 buff（lasts 6s，每 2s +5）
 *
 * 与 demo 酒保模式同款：对话必须面对面（DialogueSystem 保证），
 * 效果系统再校验药婆就在村里——不隔空发茶。
 */
export const HerbalistEffectsSystem = defineSystem<ChoicePayload>({
  name: 'mini-rpg.herbalist-effects',
  on: [DialogueChoiceMade],
  priority: 0,
  handle(event, ctx) {
    const { player, npc, remember } = event.data;
    if (!remember?.includes('tea')) return;

    const at = ctx.getComponent(npc, Located);
    if (at?.at !== ('village' as EntityId)) {
      ctx.output.narrative('人都不在药摊跟前，茶是讨不到的。');
      return;
    }

    ctx.spawn(
      buffBlueprint({
        victim: player,
        effect: { type: 'heal', amount: 5, every: 2000 },
        lasts: 6000,
      }),
    );
    ctx.output.narrative('药婆递来一碗滚烫的草药茶。热流顺着喉咙淌下去，伤口不那么疼了。');
  },
});

/** 终局：主线任务交付 → 一段结局文案（事件钩子的内容用法） */
export const EndingSystem = defineSystem<TurnInPayload>({
  name: 'mini-rpg.ending',
  on: [QuestTurnedIn],
  priority: 0,
  handle(event, ctx) {
    if (event.data.questId !== 'spider-bounty') return;
    ctx.output.narrative(
      '【终局】村长把传家宝贴在胸口，老泪纵横。「孩子，你从蛛巢里带回来的不只是一块玉佩——是这座村子敢在天黑后点灯的底气。」那晚，篝火烧到了天明。',
    );
  },
});
