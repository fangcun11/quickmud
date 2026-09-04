/**
 * 类型贯通测试（0.11 P1-1）
 *
 * defineEvent 第一层把名字推断为字面量（token 随之携带字面量类型），
 * defineSystem 的 on 传**事件定义数组**时，handle 收到 discriminated union：
 * `event.token === X.token` 自动收窄 `event.data`——运行时行为等价于
 * token 订阅，类型层面消灭 as 断言。
 */
import { describe, it, expect, vi } from 'vitest';
import { World, defineEvent, defineSystem } from './index';
import type { EventDefinition } from './events/types';

const Killed = defineEvent('killed')<{ victim: string }>();
const Looted = defineEvent('looted')<{ chest: string }>();

// 编译期断言：名字字面量保留在 token 类型上（收窄的物理前提）
const asLiteral: EventDefinition<{ victim: string }, 'killed'> = Killed;
void asLiteral;

describe('多事件系统的类型贯通', () => {
  it('token 收窄：各分支拿到正确的载荷类型（运行时行为不变）', () => {
    const seen: string[] = [];
    const w = new World();
    const system = defineSystem({
      name: 'narrowed',
      on: [Killed, Looted],
      handle(event, ctx) {
        if (event.token === Killed.token) {
          seen.push(`kill:${event.data.victim}`);
          void ctx;
        } else {
          seen.push(`loot:${event.data.chest}`);
        }
      },
    });
    w.register(system);
    w.eventPump.emit(Killed.token, { victim: 'goblin' });
    w.eventPump.emit(Looted.token, { chest: 'box' });

    expect(seen).toEqual(['kill:goblin', 'loot:box']);
  });

  it('on 传 token 字符串仍可用（兼容形态，data 为 unknown）', () => {
    const handler = vi.fn();
    const w = new World();
    w.register(defineSystem({ name: 'by-token', on: [Killed.token], handle: handler }));
    w.eventPump.emit(Killed.token, { victim: 'orc' });

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0]![0].data).toEqual({ victim: 'orc' });
  });
});
