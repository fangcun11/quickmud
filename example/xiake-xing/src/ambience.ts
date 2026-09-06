/**
 * 侠客行 · 世界兜底与闲聊人味（沉浸感方案 B5）
 *
 * - SafetyNetSystem：人物"没有环境"（房间实体不存在）时移回客栈并给一句
 *   叙事解释——任何异常状态都有叙事出口，不让玩家卡死在系统错误里。
 * - AmbienceSystem：低频闲聊条（dialogue 通道），预写池 + 确定性轮换——
 *   对标北侠闲聊频道的"玩家双簧"，单机里模拟世界的活人感。纯氛围，
 *   不影响任何状态，进快照/重放天然一致。
 */
import { defineSystem } from '@mud/ecs-engine';
import { Position } from '@mud/prefabs';
import { Name } from '@mud/ecs-engine';
import { PlayerTag } from './traits';

const INN = 'inn';

/** 安全网：每息检查玩家所在房间是否真实存在 */
export const SafetyNetSystem = defineSystem({
  name: 'xk.safety-net',
  every: 1000,
  handle(_payload, ctx) {
    for (const id of ctx.findByComponent(PlayerTag)) {
      const pos = ctx.getComponent(id, Position);
      if (!pos) continue;
      const room = ctx.getEntity(pos.roomId as never);
      if (room) continue;
      // 房间不存在（旧档/数据变更）→ 叙事式回收
      const name = ctx.getComponent(id, Name)?.text ?? '你';
      pos.roomId = INN;
      ctx.output.narrative(
        `${name}只觉一阵天旋地转——再睁眼，已站在悦来客栈大堂。掌柜的看了看你说：「客官，梦魇了吧？」`,
      );
    }
  },
});

/** 闲聊池：成对的双簧靠相邻序号自然衔接 */
const CHATTER: string[] = [
  '【闲聊】行脚商人：听说野狼林里的狼皮最近能卖上价了。',
  '【闲聊】货郎：能卖上价？有多少我收多少！',
  '【闲聊】卖包子的大爷：这年头，连馒头都涨了半文钱……',
  '【闲聊】乞儿：大爷，赏口热的吧——唉，人不如狗。',
  '【闲聊】说书人：要说这江湖啊，精彩的不是打打杀杀，是人心。',
  '【闲聊】酒客：掌柜的！再来一壶——没银子？记账上！',
  '【闲聊】货郎： clean 路上见着掉落的干粮别嫌弃，饿死事大。',
  '【闲聊】更夫：天干物燥——小心火烛。',
];

export const AmbienceSystem = defineSystem({
  name: 'xk.ambience',
  every: 21_000, // 与其他 every 网格错开
  handle(payload, ctx) {
    const time = payload.data.time;
    const idx = Math.floor(time / 21_000) % CHATTER.length;
    // 有玩家在世界里才播（单机恒真；防御性判断）
    if (ctx.findByComponent(PlayerTag).length === 0) return;
    let line = CHATTER[idx]!.trim();
    if (line.includes('clean ')) line = line.replace('clean ', ''); // 历史占位清理
    ctx.output.dialogue(line);
  },
});
