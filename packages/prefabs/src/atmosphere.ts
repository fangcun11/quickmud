/**
 * 时辰与天气（0.14 氛围支线，纯函数）
 *
 * 两件都是**派生只读**：不进快照、不占组件——同一 (seed, timeMs) 永远同一
 * 结果，快照/回滚/分叉/录像自动一致。引擎禁随机，xkx 的随机天气在这里换成
 * **确定性轮换**（区域 id × 时段槽 的哈希取模，晴多坏少）。
 *
 * 时间刻度由内容层定（世界毫秒是抽象的）：默认一昼夜 4 分钟、一时辰 20 秒、
 * 天气每 1 分钟轮换——都可通过 options 调。
 */
export const SHICHEN_NAMES = ['子', '丑', '寅', '卯', '辰', '巳', '午', '未', '申', '酉', '戌', '亥'] as const;

/**
 * 开局偏移：time=0 对应**卯时**（清晨）——与开场叙事（晨光）一致，开局是白天。
 * 十二时辰序不变，只是把 time=0 锚在卯上。
 */
const SHICHEN_OFFSET = 3;

export interface ShichenOptions {
  /** 一昼夜的现实时长（毫秒）；默认 240_000（4 分钟 = 12 时辰 × 20 秒） */
  dayLengthMs?: number;
}

/** 时辰（派生只读）：timeMs → 「子时」～「亥时」 */
export function shichenOf(timeMs: number, options?: ShichenOptions): string {
  const day = options?.dayLengthMs ?? 240_000;
  const index = Math.floor(((timeMs % day) + day) % day / (day / 12));
  return `${SHICHEN_NAMES[(index + SHICHEN_OFFSET) % 12]}时`;
}

export type WeatherKind = 'clear' | 'rain' | 'snow' | 'mist';

const WEATHER_LABELS: Record<WeatherKind, string> = {
  clear: '天色晴朗',
  rain: '落着细雨',
  snow: '飘着大雪',
  mist: '山间薄雾',
};

export function weatherLabel(kind: WeatherKind): string {
  return WEATHER_LABELS[kind];
}

/** 夜间判定（戌/亥/子三时辰）——夜狼、星象类玩法钩子的共享判据 */
const NIGHT_INDEX = new Set([10, 11, 0]); // 偏移后序：戌(10)/亥(11)/子(0)
export function isNight(timeMs: number, options?: ShichenOptions): boolean {
  const day = options?.dayLengthMs ?? 240_000;
  const index = Math.floor(((timeMs % day) + day) % day / (day / 12));
  return NIGHT_INDEX.has((index + SHICHEN_OFFSET) % 12);
}

export interface WeatherOptions {
  /** 天气轮换段长（毫秒）；默认 60_000——每分钟换一次档（同档内恒定） */
  segmentMs?: number;
}

/** FNV-1a：确定性哈希（引擎禁随机，天气的"随机感"由它给出） */
function hash32(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

// 晴多坏少：8 槽里 4 晴 / 2 雨 / 1 雪 / 1 雾——坏天气是调味，不是主菜
const WEATHER_ROTATION: WeatherKind[] = ['clear', 'clear', 'mist', 'rain', 'clear', 'snow', 'clear', 'rain'];

/** 天气（派生只读）：(区域, timeMs) → 晴/雨/雪/雾——不同区域可不同天 */
export function weatherOf(areaId: string, timeMs: number, options?: WeatherOptions): WeatherKind {
  const segment = options?.segmentMs ?? 60_000;
  const slot = Math.floor(timeMs / segment);
  return WEATHER_ROTATION[hash32(`${areaId}@${slot}`) % WEATHER_ROTATION.length]!;
}
