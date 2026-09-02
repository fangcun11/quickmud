/**
 * 对话命令（0.3-B）——把玩家输入翻译成 Talk/Choose 事件
 *
 * 动词：talk / ask / 说 / 对话。参数二选一：
 * - `talk 酒保`              → 搭话/继续（DialogueTalk）
 * - `talk 酒保 2`            → 选第 2 个选项（DialogueChoose，1-based）
 *
 * 校验职责（命令层）：npc 是否存在、是否可对话、序号是否合法数字。
 * 选项是否真的可选（requires）由 DialogueSystem 判定——命令不读分支逻辑。
 */
import { defineCommand } from '../commands/define-command';
import type { AnyCommand } from '../commands/types';
import { Dialogue, DialogueTalk, DialogueChoose } from './traits';

export function createDialogueCommands(): AnyCommand[] {
  return [
    defineCommand({
      verbs: ['talk', 'ask', '说', '对话'],
      args: {
        npc: { type: 'entity' },
        option: { type: 'word' },
      },
      handle({ args, player, world }) {
        if (!args.npc) return '跟谁说？';

        const npc = world.findEntity(args.npc);
        if (!npc) return `这里没有「${args.npc}」。`;
        if (!world.getComponent(npc, Dialogue)) return 'ta 看起来不想和你说话。';

        const option = (args.option ?? '').trim();
        if (option === '') {
          world.emit(DialogueTalk, { player, npc });
          return null;
        }

        const index = Number(option);
        if (!Number.isInteger(index) || index < 1) {
          return `没有「${option}」这个选项。`;
        }
        world.emit(DialogueChoose, { player, npc, option: index });
        return null;
      },
    }),
  ];
}
