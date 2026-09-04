/**
 * 伤势警示（xkx「你受伤颇重」惯例，P2）
 *
 * 受击结算后按**血量档位变化**插一行流内提示：只在掉档那一刻出现
 * （同档连击不刷屏），死亡档不提示（死亡句自有分量）。
 *
 * 档位：> 2/3 无恙 → > 1/3 轻伤 → > 0 重伤 → 0 死亡。
 *
 * 返回 null = 本击无警示；颜色语义：黄 = 轻伤预警，红 = 危急。
 */
export type InjuryLine = { text: string; color: 'yellow' | 'red' };

export function injuryWarning(
  before: number,
  after: number,
  max: number,
  opts: { isPlayerTarget: boolean; name: string },
): InjuryLine | null {
  const tier = (hp: number): number => {
    if (hp <= 0) return 3;
    if (hp <= max / 3) return 2;
    if (hp <= (max * 2) / 3) return 1;
    return 0;
  };
  const from = tier(before);
  const to = tier(after);
  if (to <= from || to === 3) return null;

  const who = opts.isPlayerTarget ? '你' : `「${opts.name}」`;
  if (to === 1) {
    return { text: `${who}受了些伤，气息渐乱。`, color: 'yellow' };
  }
  return {
    text: opts.isPlayerTarget ? '你伤得不轻，眼前阵阵发黑！' : `「${opts.name}」伤得不轻，摇摇欲坠！`,
    color: 'red',
  };
}
