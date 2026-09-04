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
  的容器边界说明）。

---

[← 上一篇：02 快速上手](./02-quick-start.md) | [下一篇：04 事件 →](./04-events.md) | [目录](./index.md)
