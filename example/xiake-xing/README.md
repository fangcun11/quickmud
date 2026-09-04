# 侠客行 · xiake-xing

> 用 quickmud（`@mud/ecs-engine` + `@mud/prefabs`）写的武侠题材文字 RPG。
> 规格与路线图见 `docs/roadmap-xiake-xing.md`，开发过程中的引擎/工具集反馈记
> `docs/engine-feedback.md`。

```bash
pnpm dev    # 终端 REPL，自己玩
pnpm walk   # 通关录像：从客栈走到狼穴再折返，看世界与文案
pnpm test   # 冒烟测试：走遍三区域（无 sleep、无真实定时器）
```

## 当前状态：M0 骨架（v0.1.0）

只搭世界：三区域 12 房 + prefabs 基础件（移动/查看/地图）。零新组件、零新系统。

## 世界结构

区域从北往南一条线，跨区域出口都是 south/north：

```
  青石镇 town(0,0)   inn ◄─west─ street ─east─► gate
                            │north       │south
                       grocery       终南山道 road(0,1)
                            │south        path ─south─► pines ─east─► shrine
                       wuguan                            │south
                                                      fringe
                      野狼林 woods(0,2)         woodsgate ─south─► thicket ─south─► den
```

- **青石镇**：安全区。悦来客栈（出生点）、青石街、杂货铺（M3 买卖）、望岳武馆
  （M2 学艺）、镇口。
- **终南山道**：过渡。南山道、松林道、山神庙（歇脚点）、林缘。
- **野狼林**：野怪区。林口、密林、狼穴——M1 的野狼住这儿。

## 路线

| 期 | 版本 | 内容 |
| --- | --- | --- |
| M0 | 0.1.0 | 世界骨架（本包现状） |
| M1 | 0.2.0 | 内功根基：打坐、内力、战斗内核、野狼 |
| M2 | 0.3.0 | 武学与秘籍：开山拳/基础剑法/吐纳术，升级解锁招式 |
