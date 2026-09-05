/**
 * 点击策略回归（0.18 战斗可读性）：点活物 = 预填攻击、点商品 = 买（带价）、
 * 点地上物 = 捡、点出口 = 走。策略只编译命令，全部走 execute 管线。
 */
import { describe, it, expect } from 'vitest';
import { bootstrap } from './world/bootstrap';
import { createClickPolicy } from './click';
import type { Segment } from '@mud/ecs-engine';
import { Located, Portable, Position } from '@mud/prefabs';
import { Name } from '@mud/ecs-engine';

describe('侠客行点击策略', () => {
  it('点活物（Position 判房修复）→ attack 预填；点铺面商品 → buy 带价；点地上物 → take', () => {
    const b = bootstrap();
    const { world, playerId } = b;
    const policy = createClickPolicy(world, playerId);

    // 活物：狼在 thicket，玩家搬到 thicket
    world.getComponent(playerId, Position)!.roomId = 'thicket';
    const wolfSeg: Segment = { text: '野狼', style: { tag: 'entity' }, entityRef: 'wolf-1' };
    const wolf = policy(wolfSeg);
    expect(wolf?.command).toBe('attack 野狼');
    expect(wolf?.mode).toBe('prefill');

    // 商品：玩家去杂货铺
    world.getComponent(playerId, Position)!.roomId = 'grocery';
    const baozi = policy({ text: '馒头', style: { tag: 'entity' }, entityRef: 'baozi' });
    expect(baozi?.command).toBe('buy 馒头');
    expect(baozi?.hint).toContain('2 碎银');

    // 地上可携物（非商品）：狼皮掉在脚下（造一个真实体）
    const peltId = world.entities.createWithId('pelt-1');
    world.addComponent(peltId, Name, { text: '狼皮', aliases: [] });
    world.addComponent(peltId, Portable, {});
    world.addComponent(peltId, Located, { targets: ['grocery'] });
    const pelt = policy({ text: '狼皮', style: { tag: 'entity' }, entityRef: 'pelt-1' });
    expect(pelt?.command).toBe('take 狼皮');
  });

  it('点出口方向 → go（entityRef 机器 id 优先，中文名反查兜底）', () => {
    const b = bootstrap();
    const policy = createClickPolicy(b.world, b.playerId);
    expect(policy({ text: '北', style: { tag: 'direction' }, entityRef: 'north' })?.command).toBe('go north');
    expect(policy({ text: '南', style: { tag: 'direction' } })?.command).toBe('go south');
  });
});
