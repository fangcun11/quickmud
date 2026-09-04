# 侠客行 · xiake-xing

> 用 quickmud（`@mud/ecs-engine` + `@mud/prefabs`）写的武侠题材文字 RPG。
> 规格与路线图见 `docs/roadmap-xiake-xing.md`，开发过程中的引擎/工具集反馈记
> `docs/engine-feedback.md`。

```bash
pnpm dev    # 终端 REPL，自己玩
pnpm walk   # 通关录像：从客栈走到狼穴再折返，看世界与文案
pnpm test   # 冒烟测试：走遍三区域（无 sleep、无真实定时器）
```

## 当前状态：M1 内功根基（v0.2.0）

M0 铺世界，M1 上功夫：

- **打坐回气**：`打坐/运功` 挂吐纳状态，每息 +20 内力；`停/收功` 主动收；
  移动、被咬自动打断。`状态/属性` 一览生命/内力/三围/位置
- **战斗内核**（纯公式、零随机）：`attack <目标>` 走三态判定——
  身法差 ≥2 命中全额、−1..1 被格挡（七成伤）、≤−2 被闪避（零伤）；
  伤害 = max(1, atk − def)，格挡再 ×0.7。NPC 被攻击自动还手一击
- **逃跑**：`逃/flee` 身法够高退回来路，不够原地挨一击
- **野狼×3**：密林一只、狼穴两只（hp25/atk6/def1/身法2），倒下掉狼皮
  （M3 卖钱），`拿/take` 捡进背包

新组件 Energy/Stats/Cultivating/Retaliate/Trail，领域件全部留在游戏包内
（分层纪律：等第二个武侠游戏再下沉）。

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
