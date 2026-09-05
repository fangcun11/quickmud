/**
 * 侠客行 · 武学定义表（M2，内容层纯数据）
 *
 * 纯数据：同输入 ⇒ 同招式集合，无随机、无时钟——快照/录像/回滚零成本。
 * 数值原则（与 traits 一致）：小数值起步，M6 统一平衡。
 *
 * - tier = 解锁该招式所需的武学层数（level ≥ tier 即可出招）
 * - cost = 出招内力消耗（attack 自动选招时同样受内力约束）
 * - mult = 伤害系数（atk × mult − def；格挡再 ×0.7）
 * - expPerLevel = 升一层所需熟练度（战斗命中 +1、击杀 +3、打坐运转每息 +1）
 * - 心法（如吐纳术）没有 moves——它是被动运转件，不是出招件
 */
export interface ArtMove {
  id: string;
  name: string;
  tier: number;
  cost: number;
  mult: number;
}

export interface ArtDef {
  id: string;
  name: string;
  school: string;
  maxLevel: number;
  expPerLevel: number;
  moves: ArtMove[];
  /** 心法专用：运转时打坐内力回复倍率（缺省 1） */
  meditateBonus?: number;
}

export const ARTS: Record<string, ArtDef> = {
  kaishan_fist: {
    id: 'kaishan_fist',
    name: '开山拳',
    school: '拳掌',
    maxLevel: 5,
    expPerLevel: 8,
    moves: [
      { id: 'fist_basic', name: '直拳', tier: 0, cost: 0, mult: 1.0 },
      { id: 'fist_heavy', name: '崩拳', tier: 2, cost: 8, mult: 1.7 },
      { id: 'fist_sweep', name: '横扫', tier: 4, cost: 15, mult: 2.4 },
    ],
  },
  basic_sword: {
    id: 'basic_sword',
    name: '基础剑法',
    school: '剑法',
    maxLevel: 5,
    expPerLevel: 10,
    moves: [
      { id: 'sword_basic', name: '直刺', tier: 0, cost: 0, mult: 1.1 },
      { id: 'sword_lift', name: '撩剑', tier: 2, cost: 8, mult: 1.8 },
    ],
  },
  tuna: {
    id: 'tuna',
    name: '吐纳术',
    school: '内功',
    maxLevel: 5,
    expPerLevel: 6,
    moves: [], // 心法：运转件（打坐内力翻倍 + 每息熟练度），不出招
    meditateBonus: 2,
  },
};

/** 出生默认已习：开山拳 1 级（bootstrap 初始化 Arsenal 用） */
export const STARTER_ART = 'kaishan_fist';
