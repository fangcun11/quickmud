/**
 * 侠客行 · 铺面买卖（M3；M4 泛化为"有在售商品的房间就是铺面"）
 *
 * 规则不绑定具体房间：地上摆着**在售**商品（`ForSale` 标记 + 价格）的
 * 房间就是铺面——铁匠铺卖兵器、杂货铺卖干粮，同一套买卖：
 * - `买/buy <商品>`：扣碎银（Purse），商品转移进背包
 * - `卖/sell <物品>`：按价折半回收（向上取整），物品回到当前铺面地上
 * - 卖价表 `SELL_VALUES`：内容层按名字给回收价（狼皮等战利品）
 *
 * 铁律照旧：命令 emit 意图（Bought/Sold），写状态的是 ShopSystem。
 */
import { defineCommand, defineSystem } from '@mud/ecs-engine';
import type { ComponentDefinition, EntityId } from '@mud/ecs-engine';
import { resolveInContainer, displayName, Position, Located, containerOf } from '@mud/prefabs';
import { Purse, ForSale } from './traits';
import { Bought, Sold } from './events';

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

function currentRoomId(
  world: { getComponent: <T>(id: EntityId, c: ComponentDefinition<T>) => T | undefined },
  player: EntityId,
): string | undefined {
  const pos = world.getComponent(player, Position);
  return pos?.roomId;
}

/** 买命令：buy/买 <商品>（须在有在售商品的铺面；银足则商品进背包） */
export const BuyCommand = defineCommand({
  verbs: ['buy', '买'],
  describe: '买脚下铺面的在售商品（buy 铁剑 / buy 馒头；碎银自动结算）',
  args: { item: { type: 'entity' } },
  handle({ args, output, player, world }) {
    const roomId = currentRoomId(world, player);
    if (!roomId) {
      output.error('你不在任何地方。');
      return null;
    }
    if (!args.item) {
      output.error('买什么？（铺面地上摆着的都能买）');
      return null;
    }
    const itemId = resolveInContainer(world, roomId, args.item);
    if (!itemId) {
      output.error(`这里没有「${args.item}」。`);
      return null;
    }
    const sale = world.getComponent(itemId, ForSale);
    if (!sale) {
      output.error(`「${args.item}」是非卖品。`);
      return null;
    }
    const purse = world.getComponent(player, Purse);
    if (!purse || purse.silver < sale.price) {
      output.error(`你摸了摸钱袋——还差 ${sale.price - (purse?.silver ?? 0)} 碎银。「${args.item}」的价钱挂在那儿呢。`);
      return null;
    }
    world.emit(Bought, { entity: player, item: itemId, price: sale.price });
    return null;
  },
});

/** 卖命令：sell/卖 <物品>（须在有在售商品的铺面；按回收价折半向上取整） */
export const SellCommand = defineCommand({
  verbs: ['sell', '卖'],
  describe: '向脚下铺面卖东西（sell 狼皮；按回收价折半结算）',
  args: { item: { type: 'entity' } },
  handle({ args, output, player, world }) {
    const roomId = currentRoomId(world, player);
    if (!roomId) {
      output.error('你不在任何地方。');
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
 * 买卖落地（M3）：扣银/给银 + 物品转移（Located 单源位置：
 * 买 → 玩家背包；卖 → 回当前铺面地上）
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
    // 卖回给脚下这家铺子：物品落在当前房间地上
    const room = containerOf(ctx, event.data.entity);
    ctx.addRelation(item, Located, room ?? '');
    ctx.output.narrative(`你卖出「${displayName(ctx, item)}」，得了 ${price} 碎银。`);
  },
});
