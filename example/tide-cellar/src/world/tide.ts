/**
 * 潮汐地窖的**跨房间机制**（v0.10）
 *
 * 设计边界（v0.9 铁律）：水位影响地窖四个房间，所以它**不属于任何一个房间**——
 * `Tide` 挂在**区域实体**上，由全局周期系统推进；房间只通过守卫（canEnter/canLeave）
 * 和 look **读**水位。把跨房间机制塞进单个房间，是 MUD room proc 烂掉的老路。
 */
import { blueprint, defineSystem, trait, Name } from '@mud/ecs-engine';
import { Located, Moved, areaEntityId } from '@mud/prefabs';

/** 地窖的潮汐水位（挂在 `area:cellar` 区域实体上） */
export const Tide = trait('tide', () => ({
  /** 0（干）~ 3（没顶） */
  level: 0,
  rising: true,
  /** 闸门关上后潮水最多漫到第 1 级 */
  valveShut: false,
}));

/**
 * 每 4 秒涨落一格（tickInterval 1000ms ⇒ 4 tick 一格）
 *
 * 闸门的意义是**换一个区间**，不是"把水放光"：
 * 关闸后水位锁死在 1（涨不上去、也退不干净）。于是两条解法各管一头——
 * 关闸解「退路被封死」，但蓄水池照样进不去；要进去只能敲钟，而敲钟只开一个
 * 几秒的窗口，水一回来门又关上。机制咬合，玩家两件事都得做。
 */
export const TideSystem = defineSystem({
  name: 'tide.system',
  every: 4000,
  handle(_payload, ctx) {
    const tide = ctx.getComponent(areaEntityId('cellar'), Tide);
    if (!tide) return;

    const ceiling = tide.valveShut ? 1 : 3;
    const floor = tide.valveShut ? 1 : 0;
    if (tide.rising) {
      if (tide.level < ceiling) tide.level += 1;
      else tide.rising = false;
    } else {
      if (tide.level > floor) tide.level -= 1;
      else tide.rising = true;
    }
  },
});

/** 终局标记（做成实体而非布尔变量：进快照，fork/回滚跟着走） */
export const Ending = trait('ending', () => ({ done: true }));

/**
 * 终局：带着青铜祭器回到地面庭院
 * （只结算一次——世界里出现 Ending 实体即代表已通关）
 */
export const EndingSystem = defineSystem({
  name: 'tide.ending',
  on: [Moved],
  handle(payload, ctx) {
    const { entity, to } = payload.data;
    if (to !== 'courtyard') return;
    if (ctx.findByComponent(Ending).length > 0) return;

    const hasRelic = ctx
      .findRelated(Located, entity) // 谁指向我 = 我背包/脚边的东西（索引直查）
      .some((id) => ctx.getComponent(id, Name)?.text === '青铜祭器');
    if (!hasRelic) return;

    ctx.spawn(blueprint({ components: [[Ending, { done: true }]] }));
    ctx.output.narrative(
      '【终局】你把青铜祭器放在庭院的石板上。井里还在响着水声，但那已经和你没关系了——\n' +
        '太阳正落到废墟外面去。',
    );
  },
});
