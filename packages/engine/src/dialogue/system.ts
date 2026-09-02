/**
 * 对话系统（0.3-B）——唯一负责推进对话状态的手
 *
 * 职责：
 * - 订阅 DialogueTalk / DialogueChoose 事件
 * - 展示当前节点文本与"可用选项"（requires 门过滤）
 * - 推进选项：写 Memory.flags（remember）、emit DialogueChoiceMade
 *   （游戏层效果系统的钩子）、跳转 to 节点或收尾
 *
 * 规则（确定性、无隐藏状态）：
 * - active 为空 → talk 从 entry 开始；active 非空 → talk 重复展示当前节点
 * - 节点无可用选项（无 options 或全被 requires 挡住）→ 说完自动结束（active=null）
 * - 选项 choose：requires 不满足的选项在展示时被过滤，choose 时也防御性拒绝
 * - 所有状态变更都在 Dialogue 组件上，随快照/回滚/存档走
 *
 * 文档约定（内容作者遵守）：带 requires/remember 的对话树，NPC 需挂 Memory 组件。
 */
import { defineSystem } from '../systems/define-system';
import type { SystemContext, SystemDefinition } from '../systems/types';
import type { EntityId } from '../core/types';
import type { Segment } from '../output/types';
import {
  Dialogue,
  Memory,
  DialogueTalk,
  DialogueChoose,
  DialogueChoiceMade,
} from './traits';
import type { DialogueData, DialogueNode, DialogueOption } from './traits';

type TalkPayload = { player: EntityId; npc: EntityId };
type ChoosePayload = { player: EntityId; npc: EntityId; option: number };

/** 读取 NPC 记忆 flags（未挂 Memory 视为空） */
function flagsOf(ctx: SystemContext, npc: EntityId): string[] {
  return ctx.getComponent(npc, Memory)?.flags ?? [];
}

/** 可用选项：requires 全部满足才可见 */
function availableOptions(node: DialogueNode, flags: string[]): DialogueOption[] {
  return (node.options ?? []).filter(
    (o) => !o.requires || o.requires.every((f) => flags.includes(f)),
  );
}

/**
 * 展示节点：输出 NPC 台词；有可用选项则输出编号列表并保持 active；
 * 无可用选项则输出台词后自动结束（active=null）。
 */
function showNode(ctx: SystemContext, dlg: DialogueData, node: DialogueNode, npc: EntityId): void {
  ctx.output.dialogue(node.text);

  const opts = availableOptions(node, flagsOf(ctx, npc));
  if (opts.length === 0) {
    dlg.active = null;
    return;
  }
  for (let i = 0; i < opts.length; i++) {
    const segs: Segment[] = [{ text: `${i + 1}. ` }, { text: opts[i]!.text }];
    ctx.output.dialogue(segs);
  }
}

/** talk：进入/继续对话（无全局状态需要入参之外的东西） */
function handleTalk(ctx: SystemContext, data: TalkPayload): void {
  const dlg = ctx.getComponent(data.npc, Dialogue);
  if (!dlg) return; // 命令层已拦截；防御直接 emit 的场景

  const target = dlg.active ?? dlg.entry;
  const node = dlg.nodes[target] ?? dlg.nodes[dlg.entry];
  if (!node) return; // 对话内容损坏（理论上 defineDialogue 已校验）

  dlg.active = node.id;
  showNode(ctx, dlg, node, data.npc);
}

/** choose：处理选项推进 */
function handleChoose(ctx: SystemContext, data: ChoosePayload): void {
  const dlg = ctx.getComponent(data.npc, Dialogue);
  if (!dlg) return;

  if (dlg.active === null) {
    ctx.output.error('ta 现在没有在和你说话。');
    return;
  }

  const node = dlg.nodes[dlg.active];
  if (!node) {
    ctx.output.error('ta 有些前言不搭后语。');
    dlg.active = null;
    return;
  }

  const opts = availableOptions(node, flagsOf(ctx, data.npc));
  const index = data.option - 1; // 用户输入 1-based
  if (!Number.isInteger(index) || index < 0 || index >= opts.length) {
    ctx.output.error('ta 没有听懂你的选择。');
    return;
  }

  const chosen = opts[index]!;

  // 1) 写记忆（remember）——必须先于展示跳转目标，让新节点条件立即可见
  const memory = ctx.getComponent(data.npc, Memory);
  if (memory && chosen.remember) {
    for (const flag of chosen.remember) {
      if (!memory.flags.includes(flag)) memory.flags.push(flag);
    }
  }

  // 2) 通知游戏层（效果系统订阅这个事件做给物品/发任务等副作用）
  ctx.emit(DialogueChoiceMade, {
    player: data.player,
    npc: data.npc,
    optionText: chosen.text,
    remember: chosen.remember,
  });

  // 3) 推进
  if (chosen.to !== undefined) {
    const next = dlg.nodes[chosen.to];
    if (!next) {
      // defineDialogue 已校验 to 引用；防御外部手改组件数据
      dlg.active = null;
      return;
    }
    dlg.active = next.id;
    showNode(ctx, dlg, next, data.npc);
  } else {
    if (chosen.reply !== undefined) {
      ctx.output.dialogue(chosen.reply);
    }
    dlg.active = null; // 无跳转 → 对话结束
  }
}

/**
 * 对话系统实例：注册进 World 即获得 talk/ask 对话能力
 *
 * @example
 * world.register(DialogueSystem);
 */
export const DialogueSystem: SystemDefinition<unknown> = defineSystem({
  name: 'dialogue',
  on: [DialogueTalk.token, DialogueChoose.token],
  handle(event, ctx) {
    if (event.token === DialogueTalk.token) {
      handleTalk(ctx, event.data as TalkPayload);
    } else {
      handleChoose(ctx, event.data as ChoosePayload);
    }
  },
});
