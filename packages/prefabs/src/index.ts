/**
 * @mud/prefabs —— MUD 引擎开箱即用的领域预制件
 *
 * 分层哲学：引擎（@mud/ecs-engine）只提供能力原语（事件驱动 ECS、确定性、
 * 快照/回滚/录像）；本包提供**领域常用件**——移动/房间、查看/描述、背包、
 * 状态。换一个游戏直接复用，不需要从 demo 抄代码。
 *
 * 组件名（trait id）即约定：引擎开发者命令（/tp /give /heal）按
 * position/inventory/health 命名约定工作，这些 trait 由本包定义。
 */
export * from './traits.js';
export * from './events.js';
export * from './behavior.js';
export * from './room.js';
export * from './area.js';
export * from './systems.js';
export * from './commands.js';
export * from './help.js';
export * from './queries.js';
export * from './suggest.js';
export * from './vitals.js';
export * from './atmosphere.js';
