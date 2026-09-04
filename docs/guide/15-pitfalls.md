# 15 · 常见坑

> 新手 90% 会踩的问题，症状 → 原因 → 解法。所有解法在对应章节都有展开。

---

| 症状 | 原因 | 解法 |
| --- | --- | --- |
| 命令执行了，什么都没输出 | 命令返回了 null，事件链上也没有系统产出 narrative | 检查系统是否 `ctx.output.narrative(...)`；或直接在命令里用 `output` 通道（v0.11）/返回串；输出要自己从 `world.output` 取（[07 章](./07-output.md)） |
| `world.execute()` 返回了"我不明白你的意思" | 动词没注册，或大小写/全半角不一致 | 动词统一小写注册；`execute` 内部会 lowercase，但全角空格不行 |
| `defineEvent` 编译报错 | 漏了结尾的 `()`：柯里化是 `defineEvent('x')<T>()` | 补上 `()`（[04 章](./04-events.md)） |
| 写成 `defineEvent<T>('x')` 一步到位 | TS 无部分泛型推断，名字会退化成 `string`，token 字面量类型丢失 | 用柯里化两段式：名字一层、载荷一层（[04 章](./04-events.md)） |
| 系统里 `event.data` 是 `unknown`，编辑器全红 | `on` 用了 token 字符串（`on: [Healed.token]`），TS 无法从字符串反推载荷 | `on: [Healed]` 传事件定义，多事件也一样（v0.11 起自动收窄 union，[04 章](./04-events.md)） |
| 多事件系统还有 `as` 断言 | 0.11 前的旧写法 | `on` 数组全部传事件定义，`event.token === X.token` 分支自动收窄，删掉 `as` |
| `trait('x', {...})` 早期写法曾坏 | 0.4 及更早只认工厂形态，传对象会让 create 变数据对象 | v0.5 起对象模板正式支持；工厂/对象二选一即可（[03 章](./03-entities-components.md)） |
| 定义组件报"ID 冲突/collision" | 两个不同名组件的 djb2 哈希撞车（v0.11 起防住的真风险） | 这是故意的。给组件改个名（[03 章](./03-entities-components.md)） |
| 创建出来的实体组件互相"串数据" | 组件默认值工厂返回了同一个共享对象 | 工厂每次 `return` 新对象字面量 |
| args 拿到 `null` 却当 string 用 | `entity` 类型的词可能缺省 | 判空后再用；需要实体用 `world.findEntity(name)`（[06 章](./06-commands.md)） |
| 两个命令的动词报"命令动词冲突" | verbs/abbrev 撞了 | 这是故意的。改名，或复用同一命令（[06 章](./06-commands.md)） |
| 对话结束后 `talk npc 2` 报"没有在和你说话" | 节点说完自动结束（active=null），选择必须发生在对话进行中 | 先 `talk npc` 重启对话，再选序号（[11 章](./11-dialogue-npc.md)） |
| 门控选项"占了编号但选不了" | 误解：门控选项根本不占编号，编号是重排后的 | 选项编号 = 可见选项的序号（[11 章](./11-dialogue-npc.md)） |
| 改了组件结构，旧存档读出来是乱的 | 没写迁移 | 见 `registerMigrations`（[12 章](./12-save-rollback.md)） |
| 快照回滚后实体不见了 | 快照是在创建该实体**之前**拍的 | 快照时机问题，不是引擎 bug |
| verifyReplay 报 `versionMismatch` | 录像来自别的引擎版本，跨版本分叉比对无诊断价值 | 用与录制时同版本的引擎重放（v0.11 护栏，[13 章](./13-determinism.md)） |
| 删了房间/箱子，里面的物品"消失" | 引擎不级联清理 `Located` 关系的悬挂引用 | 删容器前先转移或删除其中物品（[10 章](./10-items-combat-quests.md)） |
| `rewriteRelativeImportExtensions` 没生效 | 它只重写显式 `.ts` 后缀的导入 | 扩展名导入由 build 脚本后处理 `.d.ts`（本仓库已内置，无需操心） |

## 排查通用心法

1. **先看是不是定义期错误**——本引擎大量错误在启动阶段 fail-fast（动词冲突、
   拓扑不自洽、组件 ID 碰撞），错误信息里带双方名字与撞车详情；
2. **事件链问题用 `w.getLog()`**——"事件发生了吗、被谁处理了"一目了然；
3. **状态分叉用录像重放**——`verifyReplay` 的 `diff` 直接给出首个分叉路径。

---

[← 上一篇：14 测试](./14-testing.md) | [下一篇：16 API 速查 →](./16-api-reference.md) | [目录](./index.md)
