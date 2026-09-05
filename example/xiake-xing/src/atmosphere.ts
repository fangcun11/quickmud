/**
 * 侠客行 · 氛围系统（0.14 支线）：时辰 + 天气
 *
 * 每次进房与 look 在房间块之后追加一行环境（「时值子时，天色晴朗。」）。
 * 两者都是派生只读（prefabs atmosphere 纯函数）——零状态、进快照自动一致。
 *
 * 刻度：一昼夜 4 分钟现实时间（12 时辰 × 20 秒），天气每分钟轮换、
 * 各区域可不同天。位置说明：房间块内"环境行"插槽等引擎注入机制后迁入，
 * 当前以块后独立行落地（priority 1，排在房间块 emitters 的 0 之后）。
 */
import { defineSystem } from '@mud/ecs-engine';
import {
  Area, Look, Moved, Position, isNight, shichenOf, weatherLabel, weatherOf,
} from '@mud/prefabs';

/** 狼林区域（夜嚎只在狼林听得到） */
const WOODS_ROOMS = new Set(['woodsgate', 'thicket', 'den']);

export const DAY_LENGTH_MS = 240_000;
export const WEATHER_SEGMENT_MS = 60_000;

export const AtmosphereSystem = defineSystem({
  name: 'xk.atmosphere',
  on: [Look, Moved],
  priority: 1,
  handle(event, ctx) {
    // look <目标> 不报环境（看的是东西不是房间）
    if (event.token === Look.token && event.data.target !== undefined) return;

    const entity = event.data.entity;
    const pos = ctx.getComponent(entity, Position);
    if (!pos) return;

    // 天气按区域推导（区域实体 id 作种子——不同区域可不同天）
    const areaId = ctx.getRelations(pos.roomId, Area)[0] ?? pos.roomId;
    const shichen = shichenOf(event.timestamp, { dayLengthMs: DAY_LENGTH_MS });
    const kind = weatherOf(areaId, event.timestamp, { segmentMs: WEATHER_SEGMENT_MS });
    ctx.output.system(`时值${shichen}，${weatherLabel(kind)}。`);

    // 夜狼嚎（0.14 沉浸钩子）：狼林 + 夜间三时辰 → 远处线索
    if (WOODS_ROOMS.has(pos.roomId) && isNight(event.timestamp, { dayLengthMs: DAY_LENGTH_MS })) {
      ctx.output.narrative('远处传来狼嚎。');
    }
  },
});
