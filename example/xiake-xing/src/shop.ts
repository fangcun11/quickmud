/**
 * 侠客行 · 铁匠铺买卖（M3）
 *
 * - 铁匠铺房间地上摆着**在售**商品（`ForSale` 标记 + 价格）
 * - `买/buy <商品>`：扣碎银（Purse），商品转移进背包
 * - `卖/sell <物品>`：按价折半回收（向上取整），物品回到铁匠铺
 * - 卖价表 `SELL_VALUES`：内容层按名字给回收价（狼皮等战利品）
 *
 * 铁律照旧：命令 emit 意图（Bought/Sold），写状态的是 ShopSystem。
 */
import { defineCommand, defineSystem } from '@mud/ecs-engine';
import type { ComponentDefinition, EntityId } from '@mud/ecs-engine';
import { resolveInContainer, displayName, Position, Located } from '@mud/prefabs';
import { Purse, ForSale } from './traits';
import { Bought, Sold } from './events';

export const SMITHY_ROOM_ID = 'smithy';

/** 回收价表（按展示名）；未登记的东西只值 1 碎银 */
export const SELL_VALUES: Record<string, number> = {
  狼皮: 3,
  铁剑: 8,
  皮甲: 6,
  护身符: 5,
};

export function sellPriceOf(name: string): number {
  return SELL_VALUES[name] ?? 1;
}

function inShopRoom(
  world: { getComponent: <T>(id: EntityId, c: ComponentDefinition<T>) => T | undefined },
  player: EntityId,
): boolean {
  const pos = world.getComponent(player, Position);
  return !!pos && pos.roomId === SMITHY_ROOM_ID;
}

/** 买命令：buy/买 <商品>（须在铁匠铺；银足则商品进背包） */
export const BuyCommand = defineCommand({
  verbs: ['buy', '买'],
  describe: '买铁匠铺的在售商品（buy 铁剑；碎银自动结算）',
  args: { item: { type: 'entity' } },
  handle({ args, output, player, world }) {
    if (!inShopRoom(world, player)) {
      output.error('买东西得去铁匠铺。');
      return null;
    }
    if (!args.item) {
      output.error('买什么？（铁匠铺地上的：铁剑/皮甲/护身符）');
      return null;
    }
    const itemId = resolveInContainer(world, SMITHY_ROOM_ID, args.item);
    if (!itemId) {
      output.error(`铁匠铺没有「${args.item}」。`);
      return null;
    }
    const sale = world.getComponent(itemId, ForSale);
    if (!sale) {
      output.error(`「${args.item}」是非卖品。`);
      return null;
    }
    const purse = world.getComponent(player, Purse);
    if (!purse || purse.silver < sale.price) {
      output.error(`碎银不够——「${args.item}」要 ${sale.price} 碎银。`);
      return null;
    }
    world.emit(Bought, { entity: player, item: itemId, price: sale.price });
    return null;
  },
});

/** 卖命令：sell/卖 <物品>（须在铁匠铺；按回收价折半向上取整） */
export const SellCommand = defineCommand({
  verbs: ['sell', '卖'],
  describe: '向铁匠铺卖东西（sell 狼皮；按回收价折半结算）',
  args: { item: { type: 'entity' } },
  handle({ args, output, player, world }) {
    if (!inShopRoom(world, player)) {
      output.error('卖东西得去铁匠铺。');
      return null;
    }
    if (!args.item) {
      output.error('卖什么？');
      return null;
    }
    const itemId = resolveInContainer(world, player, args.item);
    if (!itemId) {
      output.error(`你背包里没有「${args.item}」。`);
      return null;
    }
    const price = Math.ceil(sellPriceOf(displayName(world, itemId)) / 2);
    world.emit(Sold, { entity: player, item: itemId, price });
    return null;
  },
});

/**
 * 买卖落地（M3）：扣银/给银 + 物品转移（ Located 单源位置：
 * 买 → 玩家背包；卖 → 回铁匠铺地上）
 */
export const ShopSystem = defineSystem({
  name: 'xk.shop',
  on: [Bought, Sold],
  handle(event, ctx) {
    const purse = ctx.getComponent(event.data.entity, Purse);
    if (!purse) return;
    if (event.token === Bought.token) {
      const { item, price } = event.data;
      purse.silver -= price;
      ctx.removeRelation(item, Located, event.data.entity);
      ctx.addRelation(item, Located, event.data.entity);
      ctx.output.narrative(`你付了 ${price} 碎银，买下了「${displayName(ctx, item)}」。`);
      return;
    }
    const { item, price } = event.data;
    purse.silver += price;
    ctx.removeRelation(item, Located, event.data.entity);
    ctx.addRelation(item, Located, SMITHY_ROOM_ID);
    ctx.output.narrative(`你卖出「${displayName(ctx, item)}」，得了 ${price} 碎银。`);
  },
});
