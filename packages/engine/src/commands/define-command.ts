import type { ArgumentDefinition, CommandDefinition } from './types';

/**
 * 命令定义工厂
 * 创建玩家输入处理的声明式定义
 *
 * 动词 → 命令的映射由 World.registerCommands 统一构建（唯一事实源），
 * 本函数只做定义校验与透传。
 *
 * @example
 * ```typescript
 * const GetCommand = defineCommand({
 *   verbs: ['get', 'take', 'grab', '拿', '拾', '拾取', '捡'],
 *   abbrev: ['g'],
 *   args: {
 *     item: { type: 'entity', filter: (e) => e.isPortable },
 *     from: { type: 'optional_entity', filter: (e) => e.hasContainer },
 *   },
 *   handle({ args, player, raw, world }) {
 *     if (args.from && !args.from.has(Contains(args.item))) {
 *       return `${args.item.name} 不在 ${args.from.name} 里。`;
 *     }
 *     world.emit(TakeCommand, { player, item: args.item, from: args.from });
 *     return null; // 反馈交给事件链末端渲染
 *   }
 * })
 * ```
 */
export function defineCommand<const A extends Record<string, ArgumentDefinition>>(
  definition: CommandDefinition<A>,
): CommandDefinition<A> {
  // 校验动词列表非空
  if (!definition.verbs || definition.verbs.length === 0) {
    throw new Error('Command must have at least one verb');
  }

  return { ...definition };
}