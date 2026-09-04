/**
 * demo-adventure · help 覆盖测试（P8 防漂移）
 *
 * 注册表里每个命令都必须能在 help 文案里找到自己的动词/缩写——
 * 加了命令忘改 help 的话，这里先红。
 */
import { describe, it, expect } from 'vitest';
import { bootstrap } from './world/bootstrap';

describe('demo-adventure · help 覆盖', () => {
  it('注册表里每个命令都能在 help 里找到自己', async () => {
    const { world, playerId, commands } = bootstrap();
    const text = (await world.execute('help', playerId)) ?? '';
    for (const cmd of commands) {
      const hit =
        cmd.verbs.some((v) => text.includes(v)) ||
        (cmd.abbrev ?? []).some((a) => text.includes(a));
      expect(hit, `help 缺少命令：${cmd.verbs.join('/')}`).toBe(true);
    }
  });
});
