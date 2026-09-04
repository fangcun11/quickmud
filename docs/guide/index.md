# quickmud 指南

> 面向第一次接触 quickmud 的开发者，从零写到"能存档、能录像、能分叉"的完整文字游戏。
> **文档里的代码是要被机器验证的，不是摆设**——每个示例文件都经过
> `strict` 类型检查 + 运行断言双验证（`node docs/examples/verify-doc-examples.mjs`），
> 正文代码块与验证文件一一对应，既不会腐烂，也不会"骗编译"。

## 学习路径

文档按渐进式组织：**入门篇**建立心智模型并跑通第一个世界；**基础篇**逐个吃透五个核心概念；
**领域篇**用 `@mud/prefabs` 的现成件搭出完整游戏；**深入篇**掌握确定性、存档与测试——
quickmud 真正的杀手锏都在这一篇。

| 篇 | 章节 | 你将学会 |
| --- | --- | --- |
| **入门** | [01 认识 quickmud](./01-introduction.md) | 心智模型、三条铁律、分层哲学 |
| | [02 快速上手](./02-quick-start.md) | 安装 + 30 行跑通最小世界 |
| **基础** | [03 组件与实体](./03-entities-components.md) | trait / 实体 / 确定性 ID / 碰撞防护 |
| | [04 事件](./04-events.md) | defineEvent 柯里化、类型贯通、事件链 |
| | [05 系统](./05-systems.md) | 订阅、定时、错误策略、spawn/destroy |
| | [06 命令](./06-commands.md) | args 五型、动词冲突、输出通道 |
| | [07 输出与渲染](./07-output.md) | 四类输出、三种渲染纯函数 |
| **领域** | [08 房间与地图](./08-rooms-maps.md) | defineRoom、坐标自动推断、ASCII 地图 |
| | [09 区域与房间行为](./09-areas-behaviors.md) | 区域层、守卫、生命周期、房间命令 |
| | [10 物品、战斗与任务](./10-items-combat-quests.md) | Located 关系容器模型、死亡管线、任务、Buff |
| | [11 对话与 NPC](./11-dialogue-npc.md) | 对话树、记忆门控、副作用事件 |
| **深入** | [12 存档与回滚](./12-save-rollback.md) | 快照、SavePort、版本迁移链 |
| | [13 确定性与录像重放](./13-determinism.md) | record / verifyReplay / fork |
| | [14 测试](./14-testing.md) | createTestWorld、可控时钟 |
| | [15 常见坑](./15-pitfalls.md) | 新手 90% 会踩的问题与解法 |
| | [16 API 速查](./16-api-reference.md) | 全 API 一览表 |

## 怎么读

- **只想要个能跑的东西**：读 01、02，然后直接跳领域篇照抄 08。
- **要正经做一个游戏**：按顺序读完全部四篇，总计约一小时。
- **每章自包含**：忘了哪块就翻哪章，不需要重读前文。
- **动手跑**：把示例存成 `.mts` 用 `npx tsx` 运行；仓库内示例全部可执行。

## 本文示例的验证方式

`docs/examples/` 下每个 `.mts` 文件对应正文一个（或一组）可运行示例，
`node docs/examples/verify-doc-examples.mjs` 会先做 strict tsc 类型检查、
再逐一运行断言输出。给本文档贡献代码时，请同步更新对应示例文件——
CI 不过的文档示例等于没有文档。
