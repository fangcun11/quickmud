/**
 * 玩家出生脚手架（F1 下沉，0.17）
 *
 * 把四个 example 间逐字复制的"玩家出生四件套"（Position/Name/Visited +
 * markVisited）抽到这里。游戏层在此基础上追加自己的组件（Energy/Stats/…）。
 */
import type { EntityId } from '@mud/ecs-engine';
import { World, Name } from '@mud/ecs-engine';
import { Position, Visited } from './traits.js';
import { markVisited } from './room.js';

export interface SpawnPlayerOptions {
  /** 出生房间 id */
  roomId: EntityId;
  /** 展示名 */
  name: string;
  /** 别名（可选） */
  aliases?: string[];
  /** 最大生命（默认 100） */
  maxHp?: number;
}

/**
 * 创建玩家实体并挂通用出生组件。
 *
 * 返回 playerId——游戏层在此之上追加自己的组件（Energy/Stats/Combat/…）
 * 并调用 markVisited(world, playerId) 种子出生房间。
 */
export function spawnPlayerAt(
  world: World,
  opts: SpawnPlayerOptions,
): EntityId {
  const playerId = world.entities.create();
  world.addComponent(playerId, Position, { roomId: opts.roomId });
  world.addComponent(playerId, Name, { text: opts.name, aliases: opts.aliases ?? [] });
  world.addComponent(playerId, Visited);
  void opts.maxHp; // Health 由游戏层决定（不同游戏初始值不同）
  markVisited(world, playerId);
  return playerId;
}
