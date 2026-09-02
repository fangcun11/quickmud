// 文档 §5「存档与回滚」示例——save/load/migrate/rollback 全链路实测
import assert from 'node:assert';
import { rm } from 'node:fs/promises';
import { World, trait, SavePort, FsBackend } from '@mud/ecs-engine';

console.log('imports ok');
const Health = trait('health', () => ({ current: 100, max: 100 }));
const world = new World();
const player = world.entities.createWithId('player-1');
world.entities.addComponent(player, Health, { current: 60, max: 100 });

const file = 'saves/slot1.json';
const save = new SavePort(new FsBackend(), '0.1.0');

// 存：嵌套目录自动创建
console.log('saving...');
await save.save(file, world.createSnapshot());
console.log('saved');

// exists 探测 + load
assert.ok(await save.exists(file));
const data = await save.load(file);
assert.strictEqual(data.engineVersion, '0.1.0');
assert.strictEqual(data.entities.length, 1);
console.log('load ok');

// 回滚：改状态 → 回滚 → 状态复原
world.entities.getComponent(player, Health)!.current = 5;
world.rollbackWorld(data);
assert.strictEqual(world.entities.getComponent(player, Health)!.current, 60);
console.log('rollback ok');

// 版本迁移：游戏升到 0.2.0，旧存档 load 时自动推进
const save2 = new SavePort(new FsBackend(), '0.2.0');
save2.registerMigrations({
  from: '0.1.0',
  to: '0.2.0',
  migrate: (snap) => ({
    ...snap,
    entities: snap.entities.map((e) =>
      e.components[Health.id]
        ? { ...e, components: { ...e.components, [Health.id]: { ...e.components[Health.id], max: 150 } } }
        : e,
    ),
  }),
});
const migrated = await save2.load(file);
const hp = migrated.entities[0].components[Health.id] as { max: number };
assert.strictEqual(hp.max, 150, '旧存档经迁移链推进到 0.2.0');
console.log('migrate ok');

await rm('saves', { recursive: true, force: true });
console.log('02-save ✓ 存档/读取/回滚/迁移 全通过');
