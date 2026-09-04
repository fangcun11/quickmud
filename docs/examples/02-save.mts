// 文档 §5「存档与回滚」示例——save/load/migrate/rollback 全链路实测
//
// 版本号语义：SavePort 的第二个参数是**内容架构版本**（由游戏方管理，
// 与 @mud/ecs-engine 的 package.json 版本解耦），决定迁移链的终点。
// 快照内的 engineVersion 字段会被覆写为它。
import assert from 'node:assert';
import { rm } from 'node:fs/promises';
import { World, trait, SavePort } from '@mud/ecs-engine';
import { FsBackend } from '@mud/ecs-engine/node'; // 0.12 起 Node 专属后端拆至子路径

console.log('imports ok');
const Health = trait('health', () => ({ current: 100, max: 100 }));
const world = new World();
const player = world.entities.createWithId('player-1');
world.entities.addComponent(player, Health, { current: 60, max: 100 });

const file = 'saves/slot1.json';

// 第一次写档：内容架构 v0.1.0
const save = new SavePort(new FsBackend(), '0.1.0');

// 存：嵌套目录自动创建
console.log('saving...');
await save.save(file, world.createSnapshot());
console.log('saved');

// exists 探测 + load
assert.ok(await save.exists(file));
const data = await save.load(file);
assert.strictEqual(data.engineVersion, '0.1.0'); // 快照版本 = 内容版本（被 SavePort 覆写）
assert.strictEqual(data.entities.length, 1);
console.log('load ok');

// 回滚：改状态 → 回滚 → 状态复原
world.entities.getComponent(player, Health)!.current = 5;
world.rollbackWorld(data);
assert.strictEqual(world.entities.getComponent(player, Health)!.current, 60);
console.log('rollback ok');

// 版本迁移：内容架构升到 0.2.0，旧档 load 时自动沿迁移链推进
const save2 = new SavePort(new FsBackend(), '0.2.0');
save2.registerMigrations({
  from: '0.1.0',
  to: '0.2.0',
  migrate: (snap) => ({
    ...snap,
    entities: snap.entities.map((e) => {
      const health = e.components[Health.id];
      if (!health || typeof health !== 'object') return e;
      return {
        ...e,
        components: {
          ...e.components,
          [Health.id]: { ...(health as { max?: number }), max: 150 },
        },
      };
    }),
  }),
});
const migrated = await save2.load(file);
const hp = migrated.entities[0].components[Health.id] as { max: number };
assert.strictEqual(hp.max, 150, '旧存档经迁移链推进到 0.2.0');
console.log('migrate ok');

await rm('saves', { recursive: true, force: true });
console.log('02-save ✓ 存档/读取/回滚/迁移 全通过');
