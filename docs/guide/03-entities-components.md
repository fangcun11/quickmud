# 03 · 组件与实体

> **本章你会学到**：`trait()` 定义组件、实体只是 ID、确定性 ID 的意义，
> 以及 v0.11 的哈希碰撞防护。本章代码对应验证示例
> [07-systems.mts](../examples/07-systems.mts) 的第 1 节。

---

## 组件：实体的"器官"

```ts
const Health = trait('health', () => ({ current: 100, max: 100 }));
const Locked  = trait('locked');   // 无数据组件（标记用），如"门已上锁"
```

- `trait(name, defaults)`：`name` 用于生成**确定性 ID**（同名组件永远同 ID，
  存档不会漂移）；`defaults` 可传**对象模板或工厂**（等价——每次 `create()`
  返回独立深拷贝）。工厂适合默认值含函数/计算时；纯数据用对象模板更简洁。
- 组件是**纯数据**，不放方法。行为写在系统里。
- 读取/写入走 **World 顶层**（0.13 起组件访问统一入口）：

```ts
const hp = world.getComponent(player, Health); // → { current, max } | undefined
if (hp) hp.current -= 10;                      // 直接改，引擎不做代理
```

> **永远用 `trait()` 的返回值作为 key**，不要手写字符串 ID——那会绕过确定性 ID 机制。
>
> **API 分工**：组件读写一律 `world.getComponent / addComponent / ...`（与系统侧
> `ctx.getComponent` 同名同签名）；`world.entities` 只管实体的创建与销毁
> （`create / createWithId / has / delete`）。

## 按组件查询：findByComponent 与 each（v0.14）

```ts
// 查出所有拥有某组件的实体（输出恒为**创建序**）
const bearers = world.findByComponent(Torch); // → EntityId[]

// 多组件联合迭代（内连接：缺任一组件的实体跳过）
world.each([Position, Health], (id, pos, hp) => {
  if (hp.current <= 0) pos.roomId = 'morgue';
});
```

- `each` 的组件元组会**自动映射为数据元组**——`(id, pos, hp)` 的类型直接
  对上 `[Position, Health]`，无需断言；回调拿到的是活引用（系统侧可原地改）。
- 系统内用 `ctx.each`，命令内用 `world.each`（命令侧只读）——与组件访问
  一样，三层同名。
- v0.14 起查询走**组件反查索引**（挂/摘/删增量维护，快照恢复自动重建）：
  大世界里的查询从全表扫描降为按命中数取候选，语义与之前完全一致。

## 关系：一个实体指向多个实体（v0.15）

一个实体对同一关系可以指向多个目标（"A 的孩子有 B、C"），用 `relation()`
定义、专用 API 维护、反查索引支撑"谁指向 X"：

```ts
import { relation } from '@mud/ecs-engine';

const ChildOf = relation('child_of');

world.addRelation(child, ChildOf, parent);       // 加一条（幂等；目标必须是活实体）
world.hasRelation(child, ChildOf, parent);       // → true
world.getRelations(child, ChildOf);              // → [parent]（拷贝，写走专用 API）
world.removeRelation(child, ChildOf, parent);    // 删一条（最后一条时组件自动摘）

const children = world.findRelated(ChildOf, parent); // 反查：谁指向 parent（创建序）
```

- **数据真相是普通组件**：关系数据就是 `{ targets: EntityId[] }` 的组件，
  进快照零格式变化——回滚 / fork / 读档天然一致（索引自动重建）。
- **写走系统特权**：`addRelation / removeRelation` 系统侧 `ctx` 同名可用，
  命令侧只有只读三件（`getRelations / hasRelation / findRelated`）。
  蓝图 / 世界搭建也可以直写 `{ targets: [...] }`（引擎自动维护索引）。
- **删除不级联**：目标被删后指向它的关系悬挂保留，靠 `EntityDestroyed`
  订阅清扫（见下方已知边界）。

## 实体：只是一张"身份证"

```ts
const id1 = world.entities.create();                 // 自动 ID
const id2 = world.entities.createWithId('goblin-1'); // 指定 ID（可复现存档的关键）
world.addComponent(id2, Health, { current: 30, max: 30 });
world.addComponent(id2, Name, { text: '哥布林', aliases: ['小怪'] });
```

- 实体本身没有数据，只是组件的挂载点。
- `Name` 是引擎内置组件（`{ text, aliases }`），**命令参数按名字找实体靠它**。
  想被 `look goblin` 找到，就必须挂 `Name`。
- 玩家（player）也只是一个普通实体，命令执行时通过 `player` 参数传入它的 ID。

## 确定性 ID 与碰撞防护（v0.11）

组件的存储 key 由 `deterministicId(name)` 生成——一个 32 位 djb2 哈希。
哈希就有碰撞的理论风险（实测 10 万个名字撞 3 对）：两个不同名的组件若静默共享
同一存储槽，数据会互相覆盖，而且这种 bug 极难排查。

v0.11 起 `trait()` / `relation()` 走模块级注册表查重：

```ts
// comp_1r_x / comp_30_x 是实测找到的碰撞对——同 ID 不同名，当场抛错
trait('comp_1r_x', { x: 0 }); // 首次注册：成功
assert.throws(
  () => trait('comp_30_x', { x: 0 }), // 同 ID 不同名：fail-fast
  /冲突|collision/,
);
// 同名重复调用幂等（热重载/重复 import 安全）
assert.strictEqual(trait('comp_1r_x', { x: 1 }).id, trait('comp_1r_x', { x: 2 }).id);
```

这符合 quickmud 的一贯哲学：**冲突在定义期爆炸，绝不静默出错**。

## 已知边界

- `deepClone` 组件默认值是深拷贝——组件数据里放函数会在快照时丢失（函数进不了 JSON）。
  数据归组件，函数归系统/蓝图行为。
- 删除实体不级联清理其他实体对它的引用（详见 [10 物品](./10-items-combat-quests.md)
  的容器边界说明）。但**删除本身可订阅**（v0.14）：

```ts
import { EntityDestroyed } from '@mud/ecs-engine';

defineSystem({
  name: 'reaper',
  on: [EntityDestroyed],          // 引擎合成事件：delete / ctx.destroy 成功时发射
  handle(event, ctx) {
    // event.data.id —— 实体已亡，getComponent 拿不到了；
    // 清理墓碑、扫引用、移除 UI……在这里做
  },
});
```

> 注意：回滚 / fork / 读档的实体重建走 `clear()`，**不会**误发 `entity_destroyed`——
> 状态恢复不是"销毁"。

---

[← 上一篇：02 快速上手](./02-quick-start.md) | [下一篇：04 事件 →](./04-events.md) | [目录](./index.md)
