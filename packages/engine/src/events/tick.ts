/**
 * every 系统收到的合成 tick 事件 token
 *
 * World.tick() 直接调用 every 系统的 handle（传 TICK 事件），不走事件泵。
 * 从 core/world.ts 移到独立模块：systems/types.ts 的 TickEventPayload
 * 需要引用它，而 world.ts 反向依赖 systems/types——放这里打破循环。
 */
export const TICK_TOKEN = 'engine:tick' as const;
