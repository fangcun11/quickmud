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
  // 校验 describe（0.15）：help 自动归集依赖它——没描述的命令注册不进来
  if (!definition.describe || !definition.describe.trim()) {
    throw new Error(
      `defineCommand: 动词「${definition.verbs[0]}」缺少 describe（help 自动归集依赖它，一句话说明用法）`,
    );
  }

  return { ...definition };
}