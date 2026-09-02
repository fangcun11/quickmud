/**
 * 酒馆 NPC 的对话内容（0.3-B）
 *
 * 演示：remember/requires 驱动的分支解锁——
 * 玩家先"打听身份"（记住 asked_name），再买酒（记住 patron），
 * 第三次搭话才会出现"传闻"选项（requires patron）。
 */
import { defineDialogue } from '@mud/ecs-engine';

export const BarkeepDialogue = defineDialogue('start', [
  {
    id: 'start',
    text: '哟，新面孔。想来点什么？',
    options: [
      { text: '你是谁？', to: 'who', remember: ['asked_name'] },
      { text: '听说这附近有宝藏？', to: 'rumor', requires: ['patron'] },
      { text: '不用了，我随便看看。', reply: '行，随便逛。有事叫我。' },
    ],
  },
  {
    id: 'who',
    text: '我叫老王，这间酒馆的老板。不是我吹，全镇最好的麦酒就在我这儿。',
    options: [{ text: '来一杯麦酒。', to: 'served', remember: ['patron'] }],
  },
  {
    id: 'served',
    text: '好嘞——你的麦酒，慢用。（麦酒的味道比想象中要好。）',
  },
  {
    id: 'rumor',
    text: '嘘——小声点。北边的废弃矿洞里，有人看见过会发光的石头。不过晚上最好别去。',
  },
]);
