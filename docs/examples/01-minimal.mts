// 文档 §3「五分钟最小可运行示例」——与正文代码一致，由 verify-doc-examples.mjs 实测（含 tsc 类型检查）
import {
  World, trait, defineEvent, defineSystem, defineCommand, Name,
} from '@mud/ecs-engine';

const Health = trait('health', () => ({ current: 100, max: 100 }));

const Healed = defineEvent('healed')<{ target: string; amount: number }>();

// 订阅传事件定义 on: [Healed]（而非 token 字符串）——
// 载荷类型自动贯通，handle 里的 event.data 即 { target, amount }，无需断言
const HealSystem = defineSystem({
  name: 'heal',
  on: [Healed],
  priority: 10,
  handle(event, ctx) {
    const hp = ctx.getComponent(event.data.target, Health);
    if (!hp) return;
    hp.current = Math.min(hp.max, hp.current + event.data.amount);
    ctx.output.narrative([{ text: `你恢复了 ${event.data.amount} 点生命。` }]);
  },
});

const RestCommand = defineCommand({ describe: '测试用命令',
  verbs: ['rest', '休息'],
  args: { minutes: { type: 'word' } },
  handle({ args, player, world }) {
    const amount = Math.min(50, Number(args.minutes) || 10);
    world.emit(Healed, { target: player, amount });
    return null;
  },
});

const world = new World();
world.register(HealSystem);
world.registerCommands(RestCommand);

const player = world.entities.createWithId('player-1');
world.addComponent(player, Health, { current: 60, max: 100 });
world.addComponent(player, Name, { text: '勇者', aliases: [] });

const feedback = await world.execute('休息 30', player);
if (feedback) console.log(feedback);
for (const msg of world.output.ofKind('narrative')) {
  console.log(msg.segments.map((s) => s.text).join(''));
}
