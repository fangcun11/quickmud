/**
 * A2 系统错误策略测试
 * onError: propagate（默认 fail-fast）/ skip（记录继续）/ degrade（记录+隔离禁用）
 */
import { describe, it, expect, vi } from 'vitest';
import { World } from './core/world';
import { trait } from './core/trait';
import { defineEvent } from './events/define-event';
import { defineSystem } from './systems/define-system';

const Counter = trait('counter', () => ({ value: 0 }));
const Boom = defineEvent('boom')<{ target: string }>();

function makeSystem(name: string, onError?: 'propagate' | 'skip' | 'degrade', sideEffect?: () => void) {
  return defineSystem({
    name,
    on: [Boom.token],
    ...(onError ? { onError } : {}),
    handle(event, ctx) {
      sideEffect?.();
      if (name === 'bad') throw new Error(`${name} exploded`);
      const c = ctx.getComponent(event.data.target, Counter);
      if (c) c.value += 1;
    },
  });
}

describe('系统错误策略（onError）', () => {
  it('默认 propagate：错误包装后上抛，链路中止', () => {
    const w = new World();
    w.register(makeSystem('bad'));
    w.register(makeSystem('good'));
    const p = w.entities.createWithId('p');
    w.addComponent(p, Counter, { value: 0 });

    expect(() => w.eventPump.emit(Boom.token, { target: p })).toThrow(/bad exploded/);
    expect(w.getSystemErrors()).toHaveLength(0); // propagate 不走日志
  });

  it('skip：记录错误并继续同事件的后续系统', () => {
    const order: string[] = [];
    const w = new World();
    w.register(makeSystem('bad', 'skip', () => order.push('bad')));
    w.register(makeSystem('good', 'skip', () => order.push('good')));
    const p = w.entities.createWithId('p');
    w.addComponent(p, Counter, { value: 0 });

    w.eventPump.emit(Boom.token, { target: p });

    expect(order).toEqual(['bad', 'good']); // 后续系统仍执行
    const errors = w.getSystemErrors();
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ token: 'boom', message: 'bad exploded', policy: 'skip' });
    expect(w.getComponent(p, Counter)!.value).toBe(1);
  });

  it('degrade：出错后该系统被隔离，此后不再响应任何事件', () => {
    const calls = vi.fn();
    const w = new World();
    w.register(makeSystem('bad', 'degrade', calls));
    const p = w.entities.createWithId('p');
    w.addComponent(p, Counter, { value: 0 });

    w.eventPump.emit(Boom.token, { target: p });
    expect(calls).toHaveBeenCalledTimes(1);
    expect(w.getSystemErrors()).toHaveLength(1);

    // 第二次：坏系统已被禁用，不再报错，不再执行
    w.eventPump.emit(Boom.token, { target: p });
    w.eventPump.emit(Boom.token, { target: p });
    expect(calls).toHaveBeenCalledTimes(1);
    expect(w.getSystemErrors()).toHaveLength(1); // 不新增
  });

  it('propagate 上抛时保留原始 error（cause）', () => {
    const w = new World();
    w.register(makeSystem('bad'));
    const p = w.entities.createWithId('p');
    w.addComponent(p, Counter, { value: 0 });

    try {
      w.eventPump.emit(Boom.token, { target: p });
      expect.unreachable();
    } catch (error) {
      const cause = (error as Error).cause as Error | undefined;
      expect(cause).toBeInstanceOf(Error);
      expect(cause?.message).toBe('bad exploded');
      expect(cause?.stack).toBeTruthy(); // 根因堆栈可定位，不再只剩 message 字符串
    }
  });

  it('skip 策略的错误日志记录原始 error（cause）', () => {
    const w = new World();
    w.register(makeSystem('bad', 'skip'));
    const p = w.entities.createWithId('p');
    w.addComponent(p, Counter, { value: 0 });

    w.eventPump.emit(Boom.token, { target: p });
    const errors = w.getSystemErrors();
    expect(errors).toHaveLength(1);
    const cause = errors[0]!.cause as Error | undefined;
    expect(cause).toBeInstanceOf(Error);
    expect(cause?.message).toBe('bad exploded');
  });

  it('clearSystemErrors 清空日志', () => {
    const w = new World();
    w.register(makeSystem('bad', 'skip'));
    const p = w.entities.createWithId('p');
    w.addComponent(p, Counter, { value: 0 });
    w.eventPump.emit(Boom.token, { target: p });
    expect(w.getSystemErrors()).toHaveLength(1);
    w.clearSystemErrors();
    expect(w.getSystemErrors()).toHaveLength(0);
  });
});
