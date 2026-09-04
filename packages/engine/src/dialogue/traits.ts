/**
 * 对话与 NPC（0.3-B）——对话树的数据模型与内置组件
 *
 * 设计要点：
 * - 对话内容（节点树）是**纯数据**，随 Dialogue 组件挂在 NPC 实体上，
 *   因此天然进入快照/回滚/存档——NPC"说到哪了"随存档走。
 * - 分支条件与记忆用 flags（Memory 组件），不用 DSL、不用函数：
 *   `requires` = 需要已记住的 flag 才显示/可选；`remember` = 选中后记住。
 *   组件数据保持可 JSON 序列化，与确定性约束兼容。
 * - 状态推进（active 指针）由 DialogueSystem 负责（唯一改状态的手）；
 *   命令只负责把输入翻译成 Talk/Choose 事件。
 * - 选项被选中会 emit `DialogueChoiceMade` 供游戏层效果系统订阅
 *   （给物品、发任务等副作用走事件链，不在本模块内实现）。
 *
 * 已知边界：节点文本为单段纯文本；多段/语义段（Segment）与多轮记忆
 * 留待后续版本按真实需求扩展。
 */
import { trait } from '../core/trait';
import { defineEvent } from '../events/define-event';
import type { ComponentDefinition, EntityId } from '../core/types';

/** 对话选项 */
export interface DialogueOption {
  /** 选项文本（展示给玩家） */
  text: string;
  /** 跳转目标节点 id；缺省表示对话到此结束 */
  to?: string;
  /** 结束语：无 to（结束）时 NPC 的回应；有 to 时忽略 */
  reply?: string;
  /** 需要 Memory.flags 已包含的 flag（全部满足才显示/可选） */
  requires?: string[];
  /** 选中后写入 Memory.flags（去重） */
  remember?: string[];
}

/** 对话节点 */
export interface DialogueNode {
  /** 节点 id（entry 与 option.to 均引用它） */
  id: string;
  /** 节点文本（NPC 说的话） */
  text: string;
  /** 可用选项；空或全部被 requires 挡住 → 话说完了，对话自动结束 */
  options?: DialogueOption[];
}

/**
 * Dialogue 组件数据：对话树 + 当前指针
 *
 * 用 type 别名而非 interface：type 的对象字面量在赋给带 index signature
 * 的泛型约束（trait<T extends Record<string, unknown>>）时不受 TS#15300
 * 的限制。active 可变（系统推进），树与 entry 只读约定（内容作者自持）。
 */
export type DialogueData = {
  /** 入口节点 id（重新开始对话时回到这里） */
  entry: string;
  /** 节点表，按节点 id 索引 */
  nodes: Record<string, DialogueNode>;
  /** 当前所在节点 id；null = 当前不在对话中 */
  active: string | null;
};

/** Memory 组件数据：已记住的 flag */
export type MemoryData = {
  flags: string[];
};

/** 对话组件：挂在可对话 NPC 上（内容树 + 状态指针） */
export const Dialogue: ComponentDefinition<DialogueData> = trait('dialogue', () => ({
  entry: 'start',
  nodes: {},
  active: null,
}) as DialogueData);

/** 记忆组件：挂在需要记忆的 NPC 上（配合 requires/remember 条件） */
export const Memory: ComponentDefinition<MemoryData> = trait('memory', () => ({ flags: [] }) as MemoryData);

// ---------- 引擎内置对话事件 ----------

/** 玩家主动搭话：{ player, npc } */
export const DialogueTalk = defineEvent('dialogue:talk')<{
  player: EntityId;
  npc: EntityId;
}>();

/** 玩家选择了选项序号（1-based，对应展示时的编号）：{ player, npc, option } */
export const DialogueChoose = defineEvent('dialogue:choose')<{
  player: EntityId;
  npc: EntityId;
  option: number;
}>();

/** 选项生效（供游戏层效果系统订阅）：{ player, npc, optionText, remember } */
export const DialogueChoiceMade = defineEvent('dialogue:choice-made')<{
  player: EntityId;
  npc: EntityId;
  optionText: string;
  remember?: string[];
}>();

/**
 * 构建对话内容（蓝图/常量的便利入口）
 *
 * 校验（fail-fast，与内容内联代码的项目惯例一致）：
 * - 至少一个节点
 * - 节点 id 全局唯一
 * - entry 必须引用存在的节点
 * - 每个 option.to 必须引用存在的节点
 *
 * @example
 * ```ts
 * const Greeting = defineDialogue('start', [
 *   { id: 'start', text: '欢迎光临酒馆。', options: [
 *     { text: '你是谁？', to: 'who', remember: ['asked_name'] },
 *     { text: '再见。', reply: '慢走，欢迎再来。' },
 *   ]},
 *   { id: 'who', text: '我是这里的酒保。' },  // 无 options → 说完自动结束
 * ]);
 * ```
 */
export function defineDialogue(entry: string, nodes: DialogueNode[]): DialogueData {
  if (nodes.length === 0) {
    throw new Error('defineDialogue: 至少需要一个对话节点');
  }

  const seen = new Set<string>();
  const byId: Record<string, DialogueNode> = {};

  for (const node of nodes) {
    if (typeof node.id !== 'string' || node.id === '') {
      throw new Error(`defineDialogue: 节点缺少合法的 id：${JSON.stringify(node)}`);
    }
    if (seen.has(node.id)) {
      throw new Error(`defineDialogue: 节点 id 重复：${node.id}`);
    }
    seen.add(node.id);
    byId[node.id] = node;

    for (const option of node.options ?? []) {
      if (option.to !== undefined && !nodes.some((n) => n.id === option.to)) {
        throw new Error(
          `defineDialogue: 节点 ${node.id} 的选项「${option.text}」跳转到不存在的节点 ${option.to}`,
        );
      }
    }
  }

  if (!byId[entry]) {
    throw new Error(
      `defineDialogue: 入口节点 ${entry} 不存在。可用节点：${[...seen].join(', ')}`,
    );
  }

  return { entry, nodes: byId, active: null };
}
