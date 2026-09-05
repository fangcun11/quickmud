/**
 * 命令建议器（web 输入补全的数据面，0.13）
 *
 * 渲染器（web-client）不感知世界——它只把"当前输入"交给本工厂产出的
 * 提供器，展示候选并维护键盘契约；这里负责回答"该补什么"：
 *
 * - 第一个词 → **动词**：从游戏注册的命令常量枚举 `.verbs`（与
 *   `registerCommands` 用同一份数组即零漂移），方向口语别名一并入列；
 * - 第二个词 → 按该动词的 args 声明分流：`direction` 参数补**方向词**，
 *   `entity` / `optional_entity` 参数补**房间内实体名**（`Position` 活体
 *   + `Located` 地上物，主名与别名都给），其余参数类型不补。
 *
 * 提供器返回**全集**，前缀过滤与候选上限由渲染器做（它知道光标前
 * 正在敲的是哪个词）。
 */
import type { AnyCommand, EntityId } from '@mud/ecs-engine';
import { Name } from '@mud/ecs-engine';
import { itemsInContainer, occupantsIn, type WorldQuery } from './queries.js';
import { Position } from './traits.js';

export interface SuggesterOptions {
  /** 游戏注册的全部命令（与 registerCommands 同一份数组） */
  commands: AnyCommand[];
  /** 只读世界查询（World 顶层方法直接满足） */
  query: WorldQuery;
  /** 玩家实体（建议里排除自己） */
  playerId: EntityId;
  /** go <方向> 的第二词候选；canonical 短词放前面（空第二词时先亮出来） */
  directions: string[];
}

/** 候选项：text = 补全词；hint = 说明行（动词候选带 describe，供候选条渲染） */
export interface SuggestItem {
  text: string;
  hint?: string;
}

export function createSuggester(opts: SuggesterOptions): (input: string) => SuggestItem[] {
  // 命令分类只算一次：动词总表（带 describe 说明）+ go 类动词 + 实体类动词
  const verbs: SuggestItem[] = [];
  const seenVerb = new Set<string>();
  const goWords = new Set<string>();
  const entityWords = new Set<string>();
  for (const cmd of opts.commands) {
    // AnyCommand 的 args 泛型在存储层收敛为 any，这里只需要参数类型名
    const defs = (cmd.args ?? {}) as Record<string, { type: string }>;
    const argTypes = Object.values(defs).map((a) => a.type);
    const isGo = argTypes.includes('direction');
    const wantsEntity = argTypes.some((t) => t === 'entity' || t === 'optional_entity');
    for (const verb of cmd.verbs) {
      if (seenVerb.has(verb)) continue;
      seenVerb.add(verb);
      verbs.push({ text: verb, hint: cmd.describe });
      if (isGo) goWords.add(verb);
      else if (wantsEntity) entityWords.add(verb);
    }
  }
  const directionWords = Array.from(new Set(opts.directions)).map((d) => ({ text: d }));

  /** 房间内实体名（主名 + 别名，去重；活体在前、地上物在后，玩家除外） */
  const roomEntityNames = (): SuggestItem[] => {
    const pos = opts.query.getComponent(opts.playerId, Position);
    if (!pos) return [];
    const ids = [
      ...occupantsIn(opts.query, pos.roomId),
      ...itemsInContainer(opts.query, pos.roomId),
    ];
    const names: SuggestItem[] = [];
    const seen = new Set<string>();
    for (const id of ids) {
      if (id === opts.playerId) continue;
      const nc = opts.query.getComponent(id, Name);
      if (!nc) continue;
      for (const n of [nc.text, ...(nc.aliases ?? [])]) {
        if (n && !seen.has(n)) {
          seen.add(n);
          names.push({ text: n });
        }
      }
    }
    return names;
  };

  return (input: string): SuggestItem[] => {
    const trailingSpace = /\s$/.test(input);
    const parts = input.trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0 || parts.length > 2) return [];

    // 第一个词：全部动词（渲染器按前缀过滤）
    if (parts.length === 1 && !trailingSpace) return verbs;

    // 第二个词（或刚敲完空格）：按第一个词的参数声明分流
    const first = parts[0]!;
    if (!seenVerb.has(first)) return [];
    if (goWords.has(first)) return directionWords;
    if (entityWords.has(first)) return roomEntityNames();
    return [];
  };
}
