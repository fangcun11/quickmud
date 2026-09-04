# 潮汐地窖 · tide-cellar

> quickmud v0.10 的**内容验证包**：一个三层三区域的小世界，把 v0.9 那批
> 「只有单测、没有真实消费者」的房间行为 API 全部用上一遍。

```bash
pnpm dev    # 终端 REPL，自己玩
pnpm walk   # 通关录像：八幕一路打到底，看文案和节奏
pnpm test   # 10 条通关测试（无 sleep、无真实定时器）
```

## 为什么要单独做一个内容包

v0.9 给 `defineRoom` 加了守卫、生命周期钩子、房间心跳、区域层，但它们的消费者
只有 `behavior.test.ts` / `area.test.ts` 里的断言。**单测能证明一个 API 不崩，
不能证明它好用、够用、拼得起来。**真正能问出这三个问题的是内容。

所以这个包的任务不是"做个游戏"，是**拿真实设计去撞 API**：

| v0.9 的 API | 之前只有单测 | 这里怎么用 |
| --- | --- | --- |
| `on.canEnter` | ✓ | 蓄水池水没退干进不去 |
| `on.canLeave` | ✓ | 涨到顶时台阶封死回地面的路（只封 `up`，地窖内部照走） |
| `on.leave` | ✓ | 带着祭器出祭坛，烛火灭 |
| `on.look` | ✓ | 祭坛的刻痕跟着水位变 |
| `on.every` | ✓ | 闸门房每 3 秒喷一次蒸汽，关闸后停 |
| 跨层区域（`up`/`down` 分区域） | ✓ | 废墟 / 地窖 / 钟楼三张独立平面 |
| 区域实体状态 | ✓ | 潮汐挂在 `area:cellar` 上，不属于任何房间 |
| 房间命令 + `state` | ✓ | `turn` / `pray` / `ring`，各自记账（`turn` 只拧得动一次） |

## 世界结构

```
  钟楼 belfry(0,-1)      stair ─up─► bellroom
                           ↑ up
  地面 ruins(0,0)   nave ◄─west─ courtyard ─east─► well
                                                    │ down
  地窖 cellar(0,1)  steps ─south─► cistern ─east─► altar
                     └─east─► valve
```

时间：1 tick = 1000ms；潮汐每 4000ms 一格，闸门房蒸汽每 3000ms 一次。

## 机制：两条解法各管一头

这是内容包真正想说明的事——**跨房间机制不属于任何一个房间**。

潮汐写在 `Tide` 组件上，挂在 `area:cellar` **区域实体**里，由 `TideSystem` 推进。
房间不持有水位，只在守卫和 `look` 里**读**它。把"水位"塞进某个房间的私有变量，
是 MUD room proc 烂掉的老路：四个房间都要知道它，于是四个房间各记一份，然后对不上。

关键设计是**闸门换区间，不是把水放光**：

| 状态 | 涨潮上限 | 退潮下限 | 后果 |
| --- | --- | --- | --- |
| 闸门开着 | 3 | 0 | 涨到 3 ⇒ 台阶 `canLeave` 封死退路 |
| 闸门关了 | 1 | 1 | 退路保住了，但水位**卡在 1**，蓄水池（`canEnter` 门槛 1）照样进不去 |

于是两件事都得做，缺一不可：

- **关闸（`turn`）** 解「退路被封死」，但**不解决**蓄水池；
- **敲钟（`ring`）** 把水逼退一格，从 1 退到 0，**开一个几秒的窗口**——
  水一回来门又关上，得趁窗口冲进去。

`content.test.ts` 第六幕把"窗口开了又关"显式测了一遍：敲完钟等 8 秒，
水位回到 1，同一条 `south` 又被拦下。

## 通关路线

```
look → worldmap                      第一幕：只探明了地面
east → down                          第二幕：下到地窖
（涨到 2）south  ✗ 水还漫着门槛       第三幕：canEnter
（涨到 3）up     ✗ 退路被水封死       第四幕：canLeave
east → turn                          第五幕：关闸（蒸汽也停了）
（退到 1）up → west → west → up → up
        → ring （水位 1 → 0）         第六幕：敲钟开窗口
        → down ×2 → east ×2 → down
        → south ✓
east → pray → take 祭器 → west        第七幕：取祭器
north → up → west                    第八幕：终局
```

## 文件

| 文件 | 作用 |
| --- | --- |
| `src/world/tide.ts` | `Tide` 组件 + `TideSystem`（涨落）+ `EndingSystem`（终局） |
| `src/world/bootstrap.ts` | 三个区域、八个房间、房间行为、玩家装配 |
| `src/commands/help.ts` | 帮助命令 |
| `src/main.ts` | 终端 REPL |
| `src/walk.ts` | 通关录像（`pnpm walk`） |
| `src/content.test.ts` | 10 条测试：八幕通关 + 潮汐节奏 |
