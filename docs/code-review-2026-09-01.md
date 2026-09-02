# mud-engine 代码审查报告

- 审查日期：2026-09-01
- 审查范围：全部 56 文件通读（engine / web-client / demo-adventure / 构建脚本 / 测试）
- 结论先行：**架构分层优秀，但"类型承诺 > 运行时现实"，存在 4 个已验证的运行时缺陷与大量死配置。以库标准发布前必须先修 P0。**
- **修复状态（同日）：P0-1 ~ P0-4 已全部修复并通过回归测试（10/10 绿），详见文末「修复记录」。**

## 总评

| 维度 | 评分 | 说明 |
| --- | --- | --- |
| 架构分层 | ★★★★☆ | core/events/systems/commands/output/persistence/testing 边界清晰，依赖方向正确 |
| 类型安全 | ★★★☆☆ | tsconfig 严格度很高，但大量 `as any` 断言掩盖接口不匹配，类型撒谎 |
| 正确性 | ★★☆☆☆ | 4 个实锤缺陷（含两个静默失效的核心 API） |
| 契约诚信 | ★★☆☆☆ | 约 1/3 的公开类型字段无运行时消费者，按类型写代码会静默失效 |
| 测试 | ★★☆☆☆ | 6 个用例只覆盖 happy path，事件预算/错误策略/命令解析/存档零覆盖 |
| 工程化 | ★★★☆☆ | 双格式产物+零依赖（本轮改造成果），但 validate 脚本指向不存在文件 |

## P0：已验证的运行时缺陷（必须修）

### P0-1 `findEntityByName` 永远失效 —— 哈希 key 与名字 key 混用
`World.findEntityByName`（core/world.ts:213）用字符串 `'name'` 取组件，但 `trait()` 的存储 key 是 djb2 哈希 id（core/trait.ts:13）。验证用例实测：`world.findEntity('酒保')` 永远返回 undefined。
连带失效：`CommandContext.world.findEntity` 整条链路。`WebRenderer.updateStatus`（renderer.ts:231-232）同款问题：`components.get('health')` 永远 undefined，**状态栏从未显示过 HP**（浏览器实测状态栏始终是兜底文本 "MUD 引擎 v0.1.0"）。
根因：组件存储 key 的事实标准（哈希 id）没有传递到所有消费点。demo 命令层全部用 `Position.id`（正确姿势），引擎与渲染器里却散落着字符串字面量（错误姿势）。
修法：findEntityByName 改为接受 `ComponentDefinition` 参数；WebRenderer 的 world 接口增加 `getComponent(entityId, trait)` 类型化访问器，消灭字符串 key。

### P0-2 异步命令反馈静默丢失
`CommandDefinition.handle` 类型声明允许返回 `Promise<string | null>`（commands/types.ts:15），但 `World.execute`（core/world.ts:156-165）对返回值只做 `typeof result === 'string'` 判断——**async 命令永远命中 null 分支**。验证用例实测：async 命令返回 `'异步命令的反馈文本'`，execute 最终返回 `null`，文本消失且无任何警告。
修法：`execute` 改为 async，`await command.handle(context)`；或启动期检测 handle 是 async 函数即抛错（明确不支持异步命令）。签名 `string | null` 需同步收紧。

### P0-3 同动词命令静默覆盖
`registerCommands`（core/world.ts:90-106）对重复动词直接 `Map.set` 覆盖。验证用例实测：先注册 `verbs:['l']→'命令A'`，再注册 `verbs:['l']→'命令B'`，无警告，A 丢失。
对内容驱动的 MUD 引擎这是高频事故：内容包与插件各注册一个 `look` 时排查极难。
修法：registerCommands 里 `verbMap.has(verb) && verbMap.get(verb) !== primaryVerb` 时抛 Error（fail-fast），并提供显式 override 通道。

### P0-4 `defineCommand` 的 verbMap 是死代码 + 类型欺骗
define-command.ts:33-52 构建 `verbMap` 并以 `as CommandDefinition & { verbMap: Map }` 附加到返回值——`CommandDefinition` 接口无此字段，`World.registerCommands` 完全忽略它、自己重建一遍（world.ts:97-104）。同一职责两处实现、其一为死代码，且 Map 不可 JSON 序列化，为内容热加载埋雷。
修法：删除 defineCommand 中的 verbMap 构建（或反向：World 消费它，删 World 里的重建）。二选一，单一职责。

## P1：设计与契约问题（应修）

### P1-1 "确定性模拟"与 Date.now 矛盾
package.json 描述自称 deterministic，但 EventPump 时间戳默认 `Date.now()`。ManualClock 只在 testing 存在，未注入引擎。要么把 clock 作为 WorldConfig 注入并贯穿事件时间戳，要么改掉"确定性"措辞。

### P1-2 大量无人消费的类型承诺（API 超卖）
盘点（类型声明了、运行时无消费者）：
- `SystemDefinition.every/after/delay/emitMode/onError` —— tick() 只有 `tickCount++`，全死
- `EventPumpConfig.defaultEmitMode` / `EventPump.emitImmediate` —— 无调用方
- `EventContext.actions.add` —— 占位空函数，"将由事务系统注入"但事务系统不存在
- `EventDefinition.schema.validate` —— emit 时从不校验
- `SnapshotData.registry/quests/scheduler` —— 恒空对象
- `handleDevCommand` 的 /give /tp —— 返回占位字符串
作为库发布，这是最危险的一类问题：**用户按类型系统写代码，运行时静默无效**。建议策略：未实现就先从公开类型中删除（YAGNI），实现时再加回——类型即 API 合同。

### P1-3 `defineSystem` 的伪校验
emitMode 与 onError "互斥校验"（define-system.ts:22-26）语义不成立（两者正交：一个管传播模式、一个管错误策略），且两者本身都无人消费。该校验会建立错误心智模型，应删除。

### P1-4 组件访问器类型体验差
`Entity.components` 是 `Map<ComponentId, unknown>`，demo 与测试中到处 `as { roomId: string } | undefined` 断言。`EntityManager.getComponent<T>(id, def)` 应提供完整的类型化泛型联动（含 undefined 收窄），让消费侧零断言。

### P1-5 `FsBackend` 跨平台缺陷 + 吞错
save-port.ts：`path.lastIndexOf('/')` 在 Windows 路径返回 -1 → `substring(0,-1)` 得空串 → mkdir('') 抛错。`load` 的 `catch {}` 把 JSON 损坏、权限错误与"文件不存在"混为一谈，SavePort 会误报 "Save file not found"。应使用 `path.dirname` 并区分 ENOENT 与其他错误。

### P1-6 EventPump 错误处理策略名不符实
onError 'skip' 与 'delegate' 行为完全相同（都只 console.error 后继续），'abort' 语义靠 rethrow 实现但无文档说明调用方责任。库代码直接 console.error 污染宿主日志，应注入 logger/回调。

### P1-7 `engineVersion` 双源
World.createSnapshot 硬编码 `'0.1.0'`（world.ts:272），与 package.json 版本脱钩，0.2.0 时 SavePort 迁移判断会静默失效。应从单一来源注入（WorldConfig.engineVersion 已存在字段，但 createSnapshot 没用它！WorldConfig 里声明了 engineVersion 却无人读取——又一处死配置）。

### P1-8 demo 的 validate 脚本指向不存在的文件
demo package.json `validate: tsx scripts/validate-content.ts`，仓库中无此文件；content/*.yaml 内容同样无任何代码消费（bootstrap.ts 硬编码实体）——数据驱动是口号，未落地。

## P2：工程化建议（可选）

1. **测试补强优先级**：EventPump（maxEvents 预算触发、优先级顺序、三种 onError）> 命令解析（args 四种类型、动词归一化、缩写）> SavePort 迁移链 > FsBackend round-trip。coverage 已配 provider，建议加 thresholds（先 60% 起步）。
2. **`s()`/`seg()` 重复 API**：seg 完全覆盖 s 的功能，建议保留一个。
3. **exports 补 `./package.json`**：工具链（如 pnpm pack 检查、某些 bundler）惯例需要。
4. **WebRenderer 的 `(this.world as any).entities`**：自欺式类型断言，应扩展 world 接口类型而非 as any；263 行手写 DOM 构建建议抽模板。
5. **`runChain()` 忙等**（testing/test-world.ts）：`while(queueLength>0){}` 空转，若队列真的非空会卡死进程；emit 的 monkey-patch 也应换为官方 hook。
6. **registerCommands 后命令无 name/描述字段**，help 文本只能在 demo 层硬编码（info.ts:70-81 手写命令列表，与注册表脱钩，加命令必忘改 help）。
7. **i18n**：`'zh-CN' ?? 'en'` 硬编码 fallback，建议 locale 进 WorldConfig。

## 亮点（值得保持）

- **分层与依赖方向**：core 不依赖 output/persistence，事件驱动解耦命令与系统，是教科书式的架构骨架
- **`trait()` 确定性哈希 id**：热重载/重复定义稳定，设计意图正确（问题只在消费端混用 key）
- **tsconfig 严格度**：strict + noUncheckedIndexedAccess + noUnusedLocals，起点高于多数同类项目
- **`createDirectionCommand` 工厂消除四方向重复**、bootstrap 抽出共享消除 REPL/Web 双入口重复——DRY 意识好
- **零运行时依赖 + ESM/CJS 双格式 + prepack**（本轮库化改造）：发布基建是健全的

## 修复路线图（建议顺序）

| 阶段 | 内容 | 验证方式 |
| --- | --- | --- |
| 1. 止血 | P0-1 ~ P0-4（全为小 diff，各 < 30 行） | 每个 bug 一个回归测试（先红后绿） |
| 2. 诚 types | P1-2 删除死字段 / P1-3 删伪校验 / P1-7 版本单源 | typecheck + 现有 6 测试回归 |
| 3. 补契约 | 命令解析测试、EventPump 策略测试、SavePort round-trip | 覆盖率 ≥60% |
| 4. 体验 | P1-4 类型化组件访问器、P1-5 FsBackend 修复 | demo 侧零 `as` 断言 |

## 修复记录（2026-09-01 同日，阶段 1 完成）

按 TDD 逐个修复：先写 4 个回归测试确认全红，再逐项修复转绿。

| 编号 | 修复内容 | 验证 |
| --- | --- | --- |
| P0-1 | trait.ts 导出 `deterministicId`；`findEntityByName` 改用 `deterministicId('name')` 取组件；WebRenderer 移除硬编码 `'health'`/`'position'` 字符串 key，状态栏改为注入式 `status` 回调（由游戏侧用自己的 trait 定义拼装），demo main-web.ts 同步提供 | 回归测试 + 浏览器实测状态栏从兜底文案变为 `HP: 100/100 \| 位置: 城镇广场`，移动后正确刷新 |
| P0-2 | `World.execute` 改为 `async execute(): Promise<string \| null>`，内部 `await command.handle(context)`；REPL 与 WebRenderer.handleInput 同步适配 async；main-web.ts 去掉 `as any`（RendererWorld 结构化接口） | 回归测试：async 命令反馈文本完整返回 |
| P0-3 | `registerCommands` 对 verbs+abbrevs 全量冲突检测：动词已被其他命令占用即抛 `命令动词冲突` 错误；同命令重复注册幂等；主动词槽位统一小写归一 | 回归测试：冲突抛错、幂等不抛 |
| P0-4 | 删除 defineCommand 中的 verbMap 死代码与 `as` 类型欺骗，动词映射唯一事实源收敛到 World.registerCommands | 回归测试：返回对象无 verbMap 字段 |

**附带修复（P0-2 引出的隐藏缺陷）**：REPL 原实现用嵌套 `rl.question` + 同步回调，async 化后管道 stdin 的批量行派发会丢失后续命令（question 未及重新注册）。重写为「队列 + 串行排水」模式（line 入队、单一 drain 循环逐条 await、EOF 置标志后排空退出），并消除 close 事件与在途命令的竞态。

**修复后全量验证**：engine 单测 10/10 绿（含 4 个新回归）；tsc --noEmit 通过；REPL 冒烟（look/north/score/quit 输出完整、干净退出）；web 构建 38.9KB 浏览器实测（状态栏 HP/位置显示与刷新、无 JS 错误）；`pnpm pack` 外部项目 ESM/CJS 双格式消费回归全绿。

## 修复记录 · 阶段 2（2026-09-01 16:43，"诚 types" 完成）

| 编号 | 修复内容 | 验证 |
| --- | --- | --- |
| P1-2 | 删除无运行时消费者的类型字段：SystemDefinition 的 every/after/delay/emitMode/onError、EventContext.actions.add、EventPumpConfig.defaultEmitMode/onError（WorldConfig.engineVersion 顺带删除——save-port 已单独要求版本） | tsc + 10/10 测试回归 |
| P1-3 | 删除 defineSystem 的 emitMode/onError"互斥"伪校验；EventPump.handleError 收敛为唯一 fail-fast 策略 | 同上 |
| P1-7 | 版本单源化：新增 scripts/write-version.mjs 从 package.json 生成 src/version.generated.ts，ENGINE_VERSION 经主入口导出；快照 engineVersion / WebRenderer 欢迎语与状态栏 / REPL 横幅全部改读该常量；build/test/typecheck/prepack 均前置生成 | 改 package.json version → 重建 → 全部显示位联动 |
| P1-8 | validate 脚本落地：demo scripts/validate-content.mjs（零依赖极简 YAML 解析），校验 id/文件名一致性（kebab↔snake 归一）、names.zh-CN/desc.zh-CN 必填、房间出口连通性、NPC room 引用；package.json validate 改为 node 直跑 | 成功路径 + 故意破坏出口引用触发 exit=1 再恢复 |

**类型面变化（破坏性）**：`SystemDefinition` 移除 every/after/delay/emitMode/onError；`EventContext` 移除 actions；`WorldConfig` 移除 engineVersion。这些字段此前无运行时消费者，删除不改变任何行为——使用它们的老代码本就静默无效。

**全量回归**：validate ✓ / 单测 10/10 / tsc ✓ / REPL ✓ / web 38.4KB 浏览器实测（HP 状态栏 + 欢迎横幅正常）/ 外部 ESM+CJS 消费 ✓。

**阶段 2 后遗留（待做）**：P1-4（类型化组件访问器 getComponent(trait)）、P1-5（FsBackend Windows 路径 + 吞错）、P1-6（i18n locale 配置化）、阶段 3 契约测试补齐。

## 结构决策记录（2026-09-01 16:56）：删除 YAML 内容层，文本内联

**决策**：删除 `content/` YAML 内容目录与 validate 脚本；暂停 i18n；文本内联到代码。

**理由**：YAML 是从未被运行时消费的平行通道（实体由 bootstrap.ts 构建），validate 校验的是没人用的数据；i18n 迫使 Name 组件携带 `Record<locale, string>`，所有消费点硬编码 locale fallback。

**实施**：
1. 删除 `content/`、`scripts/validate-content.mjs`、根与 demo 的 validate npm script
2. 引擎新增内置 `Name` trait（单语言 `{ text, aliases? }`，core/name.ts）并经主入口导出——findEntityByName 的查找契约从此有唯一主人，P1-6（i18n 配置化）随之取消：待真实需求以独立本地化组件回归
3. demo 的 traits/bootstrap/commands/systems/渲染器状态全部切换简化形状，删除全部 `names['zh-CN']` 查找
4. demo `build` 脚本从坏掉的 `mud build`（bin 不存在）改为直接调用 `scripts/build-html.js`

**连带发现修复**：sed 删 npm script 行留下尾逗号导致 JSON 解析失败（esbuild/pnpm 均报错），两处 package.json 已重写修正——教训：结构化文件编辑不用行级 sed。

**回归**：单测 10/10（P0-1 回归已更新为内置 Name 契约）/ tsc ✓ / 构建 ✓ / REPL ✓ / web 37.9KB 浏览器实测状态栏正常 / 外部 ESM+CJS ✓。

## 修复记录 · P1-4（2026-09-01 18:33，类型化组件访问器完成）

**改动**：
1. `SystemContext` / `CommandContext.world` 注入 `getComponent<T>(id, trait): T | undefined`（World 侧桥接 EntityManager 泛型访问器）
2. demo 全部组件读取切换为 `world.getComponent / ctx.getComponent`，**组件类 `as` 断言清零**（movement/info 命令、movement/description 系统、渲染器状态栏、引擎测试的 CombatSystem）
3. 测试 CombatSystem 改用新 API，成为 getComponent 的契约用例

**连带工程卫生修复（demo tsc 首次全绿）**：
- demo 补 `@types/node` + tsconfig 加 DOM lib 与 types——此前 `tsc --noEmit` 在 demo 从未跑过，一批预存环境错误（console/process/document undefined）被掩盖
- demo package.json 补 `@mud/web-client` 依赖声明（main-web.ts 一直在 import 却未声明，靠 workspace 解析侥幸运行）
- web-client 首次产出 dist 构建产物（类型声明 index.d.ts 等）
- **nanoid 移回 engine devDependencies**：库化时误删——源码 import nanoid，tsc 编译期需要其类型；此前靠根 node_modules 残留侥幸通过，局部 install 触发重链后暴露。产物仍由 esbuild 打包（运行时零依赖不变）

**验证**：单测 10/10 / engine tsc ✓ / demo tsc ✓（首次）/ REPL ✓ / web 浏览器实测（移动+状态栏刷新）✓ / 外部 ESM+CJS 全新安装 ✓。

**遗留**：demo 尚存 2 处事件载荷断言（`event.data as {...}`）——`defineEvent<T>` 的泛型未传导至 `EventPayload`，属事件类型链断裂的独立问题（建议下一轮处理）；P1-5 FsBackend、阶段 3 契约测试仍在路线图。

## 修复记录 · 事件泛型链（2026-09-01 20:33，事件载荷断言清零）

**改动**：
1. `SystemDefinition<T>` 泛型化：`on` 接受 `EventDefinition<T> | EventToken`，`handle` 收到的 `event.data` 即 `T`
2. `defineSystem<T>({ on: [Moved], ... })` 显式声明载荷类型；运行时把 on 中的 EventDefinition 归一化为 token（唯一事实源仍是 token）
3. 新增 `TypedEmit`（events/types.ts）双形态重载：`emit(Moved, data)` 类型约束 / `emit('moved', data)` 宽松；`SystemContext.emit` 与 `CommandContext.world.emit` 均升级，`World.makeEmit()` 统一桥接
4. `World.register` 接受 `AnySystemDefinition`，事件注册归一化 + 类型断言收敛到唯一一处（注册循环内 T 已擦除，注释说明类型责任在 defineSystem 侧）；原 `payload as any` 消除

**效果**：demo 的 movement/description 系统 `on: [Moved]`（不再 `.token`），`event.data.entity/.to` 直接带类型；命令侧 `world.emit(Moved, {...})` 载荷字段受编译期检查。demo 事件载荷断言全部删除（剩余 `as` 仅为字面量构造提示与 args 解析，后者属参数解析器类型化议题）。

**验证**：单测 10/10 / engine+demo tsc ✓ / REPL ✓ / web 37.6KB 浏览器实测（north 移动+状态栏）✓ / 外部 ESM+CJS 全新安装 ✓。
