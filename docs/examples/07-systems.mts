// 文档「基础篇 · 系统」进阶示例：事件类型贯通 / 事件链 / 定时系统 / 错误策略 / 定义期防护
// 由 verify-doc-examples.mjs 实测（strict tsc 类型检查 + 运行断言）
import assert from 'node:assert';
import {
  trait,
  defineEvent,
  defineSystem,
  createTestWorld,
  ManualClock,
  type EventDefinition,
} from '@mud/ecs-engine';

// ---- 1. 定义期防护：trait() 确定性 ID 碰撞 fail-fast（v0.11） ----
// deterministicId 是 32 位 djb2 哈希，理论可碰撞。comp_1r_x / comp_30_x
// 是实测找到的碰撞对——两个不同名的组件若静默共享存储槽，数据会互踩。
trait('comp_1r_x', { x: 0 }); // 首次注册：成功
assert.throws(
  () => trait('comp_30_x', { x: 0 }), // 同 ID 不同名：当场抛错
  /冲突|collision/,
);
// 同名重复调用幂等（热重载/重复 import 安全）
assert.strictEqual(trait('comp_1r_x', { x: 1 }).id, trait('comp_1r_x', { x: 2 }).id);

// ---- 2. 多事件系统：on 传事件定义，handle 收按 token 可收窄的 union（v0.11） ----
const Killed = defineEvent('killed')<{ victim: string; killer?: string }>();
const Looted = defineEvent('looted')<{ item: string }>();

// 编译期自证：第一层柯里化把名字推断为字面量，token 携带 'killed' 而非 string
const _literal: EventDefinition<{ victim: string; killer?: string }, 'killed'> = Killed;

const journal: string[] = [];
const JournalSystem = defineSystem({
  name: 'journal',
  on: [Killed, Looted], // 传事件定义（而非 .token 字符串）——类型贯通的关键
  handle(event) {
    if (event.token === Killed.token) {
      // 这个分支里 event.data 自动收窄为 { victim; killer? }——没有 as
      journal.push(`${event.data.victim} 倒下了`);
    } else {
      journal.push(`捡到了 ${event.data.item}`); // else 分支即 Looted，同样有类型
    }
  },
});

const w1 = createTestWorld({ systems: [JournalSystem] });
w1.emit(Killed.token, { victim: '野狼', killer: '勇者' });
w1.emit(Looted.token, { item: '狼皮' });
w1.runChain(); // 同步跑完整条事件链，断言紧跟其后
assert.deepEqual(journal, ['野狼 倒下了', '捡到了 狼皮']);

// ---- 3. 事件链：系统在 handle 里 emit 新事件（管道式协作） ----
const DamageDealt = defineEvent('damage-dealt')<{ target: string; amount: number }>();
const ArmorBroken = defineEvent('armor-broken')<{ target: string }>();

const trace: string[] = [];
const DamageSystem = defineSystem({
  name: 'damage',
  on: [DamageDealt],
  priority: 10, // 同一事件多个订阅者时，小值先执行
  handle(event, ctx) {
    if (event.data.amount >= 20) {
      trace.push(`重击 ${event.data.target}`);
      ctx.emit(ArmorBroken, { target: event.data.target }); // 发新事件 → 链式传播
    }
  },
});
const ArmorSystem = defineSystem({
  name: 'armor',
  on: [ArmorBroken],
  handle(event) {
    trace.push(`护甲碎裂：${event.data.target}`);
  },
});

const w2 = createTestWorld({ systems: [DamageSystem, ArmorSystem] });
w2.emit(DamageDealt.token, { target: '哥布林', amount: 25 });
w2.runChain(); // 链上所有事件（含系统中途 emit 的）一次排水到空
assert.deepEqual(trace, ['重击 哥布林', '护甲碎裂：哥布林']);

// ---- 4. 定时系统：every 周期 + ctx.after 延时，世界时间是唯一时钟 ----
const Explosion = defineEvent('explosion')<{ room: string }>();
const fired: string[] = [];

const RainSystem = defineSystem({
  name: 'rain',
  every: 300, // 每 300ms 一跳，由 World.tick 驱动（进快照、可回滚）
  handle(payload, ctx) {
    // every 系统（不写 on）的 payload 自动是 tick 载荷：data.time 有类型，无断言
    fired.push(`rain@${payload.data.time}`);
    if (payload.data.time >= 600) {
      ctx.after(100, Explosion, { room: 'hall' }); // 100ms 后补发一个延时事件
    }
  },
});
const BoomSystem = defineSystem({
  name: 'boom',
  on: [Explosion],
  handle(event) {
    fired.push(`boom@${event.data.room}`);
  },
});

const clock = new ManualClock();
const w3 = createTestWorld({ systems: [RainSystem, BoomSystem], clock, tickInterval: 100 });
clock.advance(700); // 真的驱动世界时间：rain 在 300/600 两跳，600 时排下 after(100)
assert.strictEqual(w3.currentTime, 700, '世界时间被推进');
const rainCount = fired.filter((f) => f.startsWith('rain@')).length;
assert.strictEqual(rainCount, 2, `every:300 在 700ms 内触发 2 次：${fired.join(', ')}`);
assert.ok(fired.includes('boom@hall'), 'after 延时事件到点触发');

// ---- 5. 错误策略：一个系统炸了，不炸整条链（v0.11：错误记录带 cause 根因） ----
const errorsSeen: string[] = [];
const BombSystem = defineSystem({
  name: 'bomb',
  on: [Looted],
  onError: 'skip', // 默认 propagate（抛出中止整链）；skip = 记录后继续后续系统
  handle() {
    throw new Error('渲染管线炸了');
  },
});
const DownstreamSystem = defineSystem({
  name: 'downstream',
  on: [Looted],
  handle(event) {
    errorsSeen.push(`照常处理：${event.data.item}`);
  },
});

const w4 = createTestWorld({ systems: [BombSystem, DownstreamSystem] });
w4.emit(Looted.token, { item: '金币' });
w4.runChain(); // 不抛——skip 策略把错误拦在系统层
assert.deepEqual(errorsSeen, ['照常处理：金币'], '后面的系统没有被连坐');

const errors = w4.world.getSystemErrors();
assert.strictEqual(errors.length, 1);
assert.match(errors[0]!.message, /渲染管线炸了/);
assert.ok(errors[0]!.cause instanceof Error, 'v0.11：SystemErrorRecord.cause 保留原始错误');

console.log('07-systems ✓ 类型贯通 / 事件链 / 定时 / 错误策略 / 碰撞防护 全通过');
