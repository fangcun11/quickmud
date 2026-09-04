# 12 · 存档与回滚

> **本章你会学到**：快照的形态、SavePort 与存储后端、版本迁移链、
> 不落盘的回滚。存档兼容性是文字游戏的命根子。
> 本章代码对应验证示例 [02-save.mts](../examples/02-save.mts)。

---

## 快照：纯 JSON，整世界可序列化

组件是纯数据（三铁律的红利），所以整个世界可以拍成一份纯 JSON：

```ts
import { SavePort } from '@mud/ecs-engine';
import { FsBackend } from '@mud/ecs-engine/node'; // 0.12 起：Node 专属后端拆至子路径

const save = new SavePort(new FsBackend(), '0.1.0'); // 第二个参数 = 内容架构版本
// ↑ 由**游戏方**管理（与 @mud/ecs-engine 的 package.json 版本解耦）；
//   它决定迁移链终点，save() 会把它写入快照的 engineVersion 字段。

// 存：快照是纯 JSON（engineVersion/tickCount/entities），FsBackend 自动建目录
await save.save('./saves/slot1.json', world.createSnapshot());
```

不落盘的"读档"（回滚）同样是一行——恢复实体 + 组件 + tick，清空事件队列：

```ts
// 回滚：改状态 → 回滚 → 状态复原
world.entities.getComponent(player, Health)!.current = 5;
world.rollbackWorld(world.createSnapshot());
assert.strictEqual(world.entities.getComponent(player, Health)!.current, 60);
```

## 读取：宁抛错，不吞错

```ts
// 文件不存在 load 会抛 "Save file not found"——想先探测用 exists；
// JSON 损坏会原样抛错，不会被吞成"无存档"
if (await save.exists('./saves/slot1.json')) {
  const data = await save.load(file);
}
assert.strictEqual(data.engineVersion, '0.1.0'); // 快照版本 = 内容版本（被 SavePort 覆写）
assert.strictEqual(data.entities.length, 1);
```

存档损坏静默变成"没有存档"是最恶心的 bug 源——这里选择让错误当场爆炸。

## 版本迁移链

游戏版本升级后旧存档怎么办？注册迁移链，`load` 会自动逐版本推进：

```ts
// 内容架构升到 0.2.0，旧档 load 时自动沿迁移链推进
const save2 = new SavePort(new FsBackend(), '0.2.0');
save2.registerMigrations({
  from: '0.1.0',
  to: '0.2.0', // 必填：迁移后版本，load 据此推进版本号
  migrate: (snap) => ({
    ...snap,
    entities: snap.entities.map((e) => {
      // 快照里组件按确定性 ID（Health.id）键控，不是名字
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
```

要点：

- 快照里组件按**确定性 ID**（`Health.id`）键控，不是名字——这正是
  [03 章](./03-entities-components.md)确定性 ID 机制的回报；
- 建议每次改组件结构都写一条迁移，并维护好内容架构版本号（迁移链的终点）。

## 浏览器环境

用 `LocalStorageBackend` 替换 `FsBackend` 即可，`SavePort` 的 API 完全一致。

---

[← 上一篇：11 对话与 NPC](./11-dialogue-npc.md) | [下一篇：13 确定性与录像重放 →](./13-determinism.md) | [目录](./index.md)
