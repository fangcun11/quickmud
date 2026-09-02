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
 * const GreetCommand = defineCommand({
 *   verbs: ['greet', 'hi', '你好'],
 *   args: { target: { type: 'optional_entity' } },
 *   handle({ args, player, world }) {
 *     world.emit(Greeted, { player, name: args.target ?? '陌生人' });
 *     return null; // 反馈交给事件链末端产出
 *   },
 * });
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