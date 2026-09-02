/**
 * mini-rpg NPC 对话内容（v0.7-B）
 *
 * 村长：任务叙述氛围（quests/turnin 才是接交任务的正式通道）。
 * 药婆：讨茶选项（remember: tea）——HerbalistEffectsSystem 据此 spawn 回春 buff。
 */
import { defineDialogue } from '@mud/ecs-engine';

export const ElderDialogue = defineDialogue('start', [
  {
    id: 'start',
    text: '老头子我守着这村子四十年了。东边森林、南边沼泽，都不太平——有心事就来找我。',
    options: [
      { text: '听说您的传家宝丢了？', to: 'heirloom', remember: ['asked_heirloom'] },
      { text: '路上有什么要小心的？', to: 'advice' },
    ],
  },
  {
    id: 'heirloom',
    text: '提起来就疼。那是祖上传下来的平安玉佩，前些日子被一只巨蛛叼进了沼泽东边的洞穴。我用 quests 挂了赏格——取回来，村子记你一辈子的恩。',
    options: [{ text: '交给我吧。', reply: '好！带上狼皮褥子前先把身子骨养结实了。' }],
  },
  {
    id: 'advice',
    text: '森林里的狼好对付，徒手也打得过。沼泽的毒雾沾上就甩不掉，快进快出。至于洞穴里那位……被它咬一口，毒走得比你想的快。',
    options: [{ text: '多谢提醒。', reply: '去南边药婆那儿讨碗茶，能顶一阵子。' }],
  },
]);

export const HerbalistDialogue = defineDialogue('start', [
  {
    id: 'start',
    text: '老婆子我在晒药草呢。年轻人脸色发白，是中了毒吧？',
    options: [
      { text: '讨一碗草药茶喝。', to: 'tea', remember: ['tea'] },
      { text: '沼泽的毒有解吗？', to: 'antidote' },
    ],
  },
  {
    id: 'tea',
    text: '慢点喝，去去湿气。一碗下去，伤口自己会收口。',
  },
  {
    id: 'antidote',
    text: '解药?那毒雾沾上就走不了路。我的茶只能压一压——真要进洞穴，记得离那大蜘蛛的毒牙远一点。',
    options: [{ text: '还是来碗茶吧。', to: 'tea', remember: ['tea'] }],
  },
]);
