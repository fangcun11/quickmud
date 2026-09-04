/**
 * mini-rpg 自动通关测试（v0.7-B）—— 测试即通关录像
 *
 * 用真实 World + execute 序列跑通整条游戏线：接任务 → 杀狼收皮 →
 * 沼泽中毒 → 蛛巢 boss（反咬+毒攻）→ 毒发与消退 → 回村讨茶 → 交任务终局。
 * 时间全部由手动 `world.tick()` 驱动（tickInterval 500ms/tick），
 * 无真实定时器、无 sleep——内容回归不靠手玩，这是内容包的 CI。
 */
import { describe, it, expect, beforeAll } from 'vitest';
import type { World } from '@mud/ecs-engine';
import { Health, Afflicted } from '@mud/prefabs';
import { bootstrap } from './world/bootstrap';

let world: World;
let player: string;

/** 收集当前缓冲的全部输出文本并清空 */
function drain(): string {
  const text = world.output
    .getAll()
    .map((m) => m.segments.map((s) => s.text).join(''))
    .join('\n');
  world.output.clear();
  return text;
}

/** 执行一条命令，返回「命令回显 + 事件链输出」 */
async function run(cmd: string): Promise<string> {
  const result = await world.execute(cmd, player);
  return [result ?? '', drain()].filter(Boolean).join('\n');
}

/** 手动推进 n 个 tick，返回期间系统（毒结算/巡逻/到期）的全部输出 */
function runTicks(n: number): string {
  for (let i = 0; i < n; i++) world.tick();
  return drain();
}

function hp(): number {
  return world.getComponent(player, Health)!.current;
}

function buffCount(): number {
  return world.findByComponent(Afflicted).length;
}

beforeAll(() => {
  const b = bootstrap();
  world = b.world;
  player = b.playerId;
});

describe('mini-rpg 自动通关（蛛巢悬赏）', () => {
  it('第一幕：村长挂赏，森林杀狼收狼皮', async () => {
    // 出生点只见过村庄 → 区域地图只有自己（迷雾：未探明区域不显示）
    expect(await run('map')).toBe('【村庄】\n\n村庄(你)──');

    // 村庄里能看到两条任务
    const board = await run('quests');
    expect(board).toContain('巨蛛悬赏（0/1）');
    expect(board).toContain('狼皮褥子（0/2）');

    await run('east'); // 村庄 → 森林小径

    // 野狼 15 HP / 徒手 10 → 2 击；独眼老狼 20 HP → 2 击
    await run('attack 野狼');
    const wolfDown = await run('attack 野狼');
    expect(wolfDown).toContain('倒下了');

    await run('attack 独眼老狼');
    const oldWolfDown = await run('attack 独眼老狼');
    expect(oldWolfDown).toContain('倒下了');

    // 两张狼皮落地，全部捡走 → collect 目标（狼皮×2）即刻达标
    await run('take 狼皮');
    const pelts = await run('take 狼皮');
    expect(pelts).toContain('任务「狼皮褥子」完成');

    const inv = await run('inventory');
    expect(inv).toContain('狼皮');
    expect(hp()).toBe(100); // 徒手猎狼无伤
  });

  it('第二幕：沼泽毒雾缠身（v0.9：毒雾是沼泽房间的 on.enter）', async () => {
    const enter = await run('south'); // 森林 → 沼泽
    expect(enter).toContain('毒雾无声无息地缠了上来');

    // buff 已挂上但未激活（等 BuffSystem 首个网格写入世界时间）
    expect(buffCount()).toBe(1);

    // 未经结算就离开沼泽 → 毒还跟着你（区域效果的一次性触发）
    const east = await run('east'); // 沼泽 → 蛛巢洞穴
    expect(buffCount()).toBe(1);
    // 蛛巢的 firstEnter：只在该实体第一次进入时播报
    expect(east).toContain('你第一次踏进这里');
  });

  it('第三幕：蛛巢 boss 战——反咬与毒攻', async () => {
    // 巨蛛 40 HP / 徒手 10 → 4 击；前 3 击各被反咬一次（-6）+ 中毒一次
    await run('look 巨蛛');
    const hit1 = await run('attack 洞穴巨蛛');
    expect(hit1).toContain('毒牙'); // 毒攻文案

    await run('attack 洞穴巨蛛');
    await run('attack 洞穴巨蛛');
    const hit4 = await run('attack 洞穴巨蛛');
    expect(hit4).toContain('倒下了');

    // boss 死亡 → 掉传家宝；反咬 3 次 × 6 = -18（毒尚未结算）
    expect(world.entities.has('spider')).toBe(false);
    expect(hp()).toBe(82);
    expect(buffCount()).toBe(4); // 1 沼毒 + 3 蛛毒

    const take = await run('take 平安玉佩');
    expect(take).toContain('平安玉佩');

    // 房间命令 search：state 组件记账（搜过就没有了），spawn 出来的铜币真捡得走
    const found = await run('search');
    expect(found).toContain('旧铜币');
    expect(await run('search')).toContain('翻了个底朝天');
    expect(await run('take 旧铜币')).toContain('旧铜币');
  });

  it('第四幕：毒发与消退——定时效果的完整生命周期', async () => {
    const text = runTicks(40); // t=0 → 20000ms

    // 毒真的发作了（结算文案来自 BuffSystem）
    expect(text).toContain('受到持续伤害');

    // t=1000 激活；蛛毒 lasts 6000 → t=3000/5000 结算、t=7000 到期（-4/只）
    // 沼毒 lasts 8000 → t=3000/5000/7000 结算（-9）、t=9000 到期
    expect(hp()).toBe(100 - 18 - 12 - 9); // = 61
    expect(buffCount()).toBe(0); // 全部到期，不留孤儿
  });

  it('第五幕：回村穿沼泽再中毒，讨一碗草药茶回春', async () => {
    const back = await run('west'); // 洞穴 → 沼泽（回程必经，再次缠毒）
    expect(back).toContain('毒雾无声无息地缠了上来');
    await run('north'); // 沼泽 → 森林
    await run('west'); // 森林 → 村庄

    // 与药婆对话：进入 → 选选项 1「讨一碗草药茶喝」
    await run('talk 药婆');
    const tea = await run('talk 药婆 1');
    expect(tea).toContain('草药茶');

    // 茶才 +10（lasts 6000 每 2000 +5，第三结算被到期吃掉），沼毒二次 -9
    runTicks(20); // t=20000 → 30000
    expect(hp()).toBe(61 - 9 + 10); // = 62
    expect(buffCount()).toBe(0);
  });

  it('第六幕：交任务领赏，终局', async () => {
    // 两个任务都已完成 → turnin 按村长任务表顺序先交主线（数组序在前）
    const main = await run('turnin');
    expect(main).toContain('巨蛛悬赏');
    expect(main).toContain('【终局】'); // EndingSystem：QuestTurnedIn 钩子
    expect(hp()).toBe(62 + 20); // 主线奖励 heal 20

    const side = await run('turnin');
    expect(side).toContain('银币'); // 支线奖励

    const board = await run('quests');
    expect(board).toContain('巨蛛悬赏（已交付）');
    expect(board).toContain('狼皮褥子（已交付）');
  });

  it('第七幕：区域地图只画当前区域，世界地图画区域拓扑', async () => {
    // 踏遍四境后：房间地图（迷雾全亮）只画**村庄区域**；
    // 世界地图画三个区域的连接 village -east-> wilds -east-> lair
    expect(await run('map')).toBe('【村庄】\n\n村庄(你)──');
    expect(await run('worldmap')).toBe(
      '村庄(你) ─── 野地 ─── 蛛巢',
    );

    // 房间命令的位置校验：search 是蛛巢的动词，在村庄里就是"听不懂"
    expect(await run('search')).toBe('我不明白你的意思。');
  });
});
