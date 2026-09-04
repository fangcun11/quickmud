/**
 * P0-2：事件 timestamp 语义统一（第二批）
 *
 * 审查发现：普通事件 timestamp = EventPump 内部单调计数器（0,1,2…），
 * 而 World.tick 合成的 TICK 事件 timestamp = 世界毫秒——同一字段两种语义，
 * 系统内读 event.timestamp 无法分辨拿到的是什么。
 *
 * 0.12 定稿：**timestamp = 事件入队时的世界毫秒**（World 注入世界时钟作为
 * 时间源）。信息量大于序号（可与世界时间对齐诊断），TICK 与普通事件一致。
 */
import { describe, it, expect } from 'vitest';
import { World, defineEvent, defineSystem, TICK_TOKEN } from './index';

const Ping = defineEvent('ping')<{ n: number }>();

describe('P0-2 事件 timestamp 语义统一', () => {
  it('普通事件 timestamp = 入队时的世界毫秒（不再是单调计数器）', async () => {
    const seen: number[] = [];
    const Probe = defineSystem({
      name: 'probe',
      on: [Ping],
      handle(event) {
        seen.push(event.timestamp);
      },
    });
    const w = new World({ tickInterval: 100 });
    w.register(Probe);
    const p = w.entities.createWithId('p');

    await w.execute('noop', p); // 动词不存在也没关系——先推进世界时间
    w.tick(); // 世界时间 → 100
    expect(w.currentTime).toBe(100);

    w.eventPump.emit(Ping.token, { n: 1 });
    expect(seen).toEqual([100]); // 入队时世界时间 100，而非 0/1/2… 计数
  });

  it('TICK 事件 timestamp 与 data.time 一致（同一世界毫秒）', () => {
    const seen: Array<{ timestamp: number; time: number }> = [];
    const Probe = defineSystem({
      name: 'probe-tick',
      every: 100,
      handle(event) {
        if (event.token === TICK_TOKEN) {
          seen.push({ timestamp: event.timestamp, time: event.data.time });
        }
      },
    });
    const w = new World({ tickInterval: 100 });
    w.register(Probe);
    w.tick();
    w.tick();
    expect(seen.length).toBe(2);
    for (const s of seen) {
      expect(s.timestamp).toBe(s.time); // 两处同源：都是世界毫秒
    }
    expect(seen[1]!.timestamp).toBe(200);
  });
});
