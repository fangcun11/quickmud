/**
 * @mud/prefabs 系统（0.3 toolkit）—— 移动 / 描述 / 物品的官方实现
 *
 * 约定：
 * - 移动：`Position.roomId` 指向房间实体 id；房间实体带 `Exits`（方向→房间 id）；
 *   MovementSystem 校验出口，合法才落位并输出目标房间名与描述
 * - 查看：DescriptionSystem 输出所在房间的 Name/Description，并列出地上可拾取物
 * - 物品：物品实体带 `Located { at }`（单源位置）。take/drop 只改 at——
 *   房间/玩家/箱子都是普通实体，均可作容器
 */
import { defineSystem, Name } from '@mud/ecs-engine';
import type { EntityId, SystemContext } from '@mud/ecs-engine';
import { Moved, Look, ItemTaken, ItemDropped } from './events.js';
import { Position, Exits, Description, Located, Portable } from './traits.js';

/** 实体展示名（Name.text，缺省回退 id） */
function nameOf(ctx: SystemContext, id: EntityId): string {
  const text = ctx.getComponent(id, Name)?.text;
  return text && text !== '' ? text : id;
}

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

/** 处理查看（输出所在房间的描述与地上可拾取物） */
export const DescriptionSystem = defineSystem<{
  entity: EntityId;
  target?: string;
}>({
  name: 'prefab.description',
  on: [Look],
  priority: 0,
  handle(event, ctx) {
    const { entity } = event.data;

    const pos = ctx.getComponent(entity, Position);
    if (!pos) return;

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
    const groundItems = ctx
      .findByComponent(Located)
      .filter(
        (id) =>
          ctx.getComponent(id, Located)?.at === pos.roomId &&
          ctx.getComponent(id, Portable) !== undefined,
      );
    if (groundItems.length > 0) {
      ctx.output.narrative(`你可以看到：${groundItems.map((id) => nameOf(ctx, id)).join('、')}。`);
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
  if (!pos) return;

  const loc = ctx.getComponent(item, Located);
  if (!loc || loc.at === null) {
    ctx.output.error('那东西不在这里。');
    return;
  }
  if (loc.at !== pos.roomId) {
    ctx.output.error(`这里没有「${nameOf(ctx, item)}」。`);
    return;
  }
  if (ctx.getComponent(item, Portable) === undefined) {
    ctx.output.error(`你拿不动「${nameOf(ctx, item)}」。`);
    return;
  }

  loc.at = player;
  ctx.output.narrative(`你拿起了「${nameOf(ctx, item)}」。`);
}

function handleDrop(ctx: SystemContext, { player, item }: TakeDrop): void {
  const pos = ctx.getComponent(player, Position);
  if (!pos) return;

  const loc = ctx.getComponent(item, Located);
  if (!loc || loc.at !== player) {
    ctx.output.error(`你没有「${nameOf(ctx, item)}」。`);
    return;
  }

  loc.at = pos.roomId;
  ctx.output.narrative(`你放下了「${nameOf(ctx, item)}」。`);
}
