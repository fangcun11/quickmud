/**
 * 侠客行 · 环境行文案池（沉浸感方案 M1/B1）
 *
 * 对标北侠「高秋」播报：时辰行不是固定模板，而是**文学化文案池轮换**——
 * 同一时辰多条候选，按（房间 id + 时段哈希）确定性取用（可重放、进快照一致）。
 * 雨雪天气有覆盖句（天气信息融进文案本体，不再单列）。
 */

/** 晴（基准）天气：12 时辰 × 2 条 */
const SHICHEN_LINES: Record<string, string[]> = {
  子时: ['夜深了，四下里只剩虫声与更梆。', '万籁俱寂，连风都放轻了脚步。'],
  丑时: ['夜色最浓的时辰，灯油也熬去了大半。', '更夫敲过三更，街面空得能听见自己的心跳。'],
  寅时: ['天边泛起一线鱼肚白，早起的鸟儿试探着叫了一声。', '残星未落，晨雾已经悄悄漫上了街角。'],
  卯时: ['日头初升，露水在草叶上亮晶晶的。', '城门开了，挑担的、赶车的陆陆续续进了镇。'],
  辰时: ['早市开张，吆喝声此起彼伏。', '早点摊子的热气混着晨光，暖洋洋的。'],
  巳时: ['日头爬高了，街上行人渐多。', '茶棚里坐满了歇脚的过客。'],
  午时: ['日正当中，影子缩成一小团。', '饭铺里飘出饭菜香，伙计忙得团团转。'],
  未时: ['日头偏西，晒得人有些懒洋洋。', '树影拉长了，蝉声有一下没一下。'],
  申时: ['暮蝉声里，赶路的人加快了脚步。', '日头斜了，把街道染成一片金黄。'],
  酉时: ['暮色四合，家家点起了灯，饭香混着铁匠铺的炉火气。', '收市的摊贩正收拾家什，麻雀在房檐上吵成一片。'],
  戌时: ['掌灯时分，酒旗在晚风里晃。', '街上行人稀了，更夫提着灯笼上了岗。'],
  亥时: ['夜市收了摊，只有酒楼还亮着灯火。', '万家灯火次第熄灭，江湖在夜里醒着。'],
};

/** 雨雪覆盖句（天气信息融进文案本体） */
const WEATHER_LINES: Record<string, string[]> = {
  雨: ['淅淅沥沥的雨下个不停，路面泛着水光。', '雨丝斜斜地织着，行人缩着脖子赶路。'],
  雪: ['鹅毛大雪纷纷扬扬，屋顶树梢都白了。', '雪粒子打在脸上生疼，天地间一片素白。'],
};

/** 确定性小哈希（FNV-1a）：同输入必同输出，快照/重放安全 */
function hashOf(seed: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * 取环境行：格式 `【酉时】暮色四合，……`
 * 时段键 = 天气段起点（与 weatherOf 同一粒度，段内稳定）。
 */
export function atmosphereLine(
  shichen: string,
  weatherKind: string,
  weatherLabelStr: string,
  roomId: string,
  timeMs: number,
  segmentMs: number,
): string {
  const segKey = String(Math.floor(timeMs / segmentMs));
  const h = hashOf(roomId + ':' + segKey);
  const pool = WEATHER_LINES[weatherKind] ?? SHICHEN_LINES[shichen] ?? [];
  const body = pool.length > 0 ? pool[h % pool.length]! : `${weatherLabelStr}。`;
  return `【${shichen}】${body}`;
}
