// 文档 §6「写测试」示例——与正文代码一致，由 verify-doc-examples.mjs 实测（含 tsc 类型检查）
import assert from 'node:assert';
import { createTestWorld, trait, defineEvent, defineSystem } from '@mud/ecs-engine';

const Health = trait('health', () => ({ current: 100, max: 100 }));
const Healed = defineEvent('healed')<{ target: string; amount: number }>();

const HealSystem = defineSystem<{ target: string; amount: number }>({
  name: 'heal',
  on: [Healed],
  priority: 10,
  handle(event, ctx) {
    const hp = ctx.getComponent(event.data.target, Health);
    if (!hp) return;
    hp.current = Math.min(hp.max, hp.current + event.data.amount);
  },
});

// 确定性：不启动游戏循环、不依赖真实时间——
// w.emit + w.runChain() 同步驱动事件链，断言可直接跟在后面
const w = createTestWorld({ systems: [HealSystem] });
const p = w.entities.create();
w.entities.addComponent(p, Health, { current: 90, max: 100 });

w.emit(Healed.token, { target: p, amount: 30 });
w.runChain(); // 手动驱动事件链，同步执行

assert.strictEqual(w.entities.getComponent(p, Health)!.current, 100, '回血不超过上限');
assert.ok(w.getLog().includes(Healed.token), '事件日志可断言');
console.log('03-test ✓ 测试工具用法全通过');
