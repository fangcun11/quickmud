/**
 * WebRenderer DOM 测试（engine-feedback F5 落地）
 *
 * 主战场是**键盘契约**（这里坏一处，玩家手感就坏一层）：
 * - Enter 永远执行输入框当前内容——弹窗开着也不执行候选；
 * - 候选条开着时 ↑↓ 在候选间移动；关着时 ↑↓ 仍是历史召回（现状不破坏）；
 * - Tab / 点击 chip 补进输入框但**不执行**；
 * - Esc 收起，下一次输入变化重现；
 * - 中文 IME 组合期间（isComposing）一切按键不触发命令；
 * - 顶部无常驻状态栏（MUD 传统：屏面就是文字流）；
 * - 实体标签点击 = look 该实体（既有行为，一并锁住）。
 */
import { describe, it, expect, vi } from 'vitest';
import { WebRenderer } from './renderer';
import type { OutputMessage } from '@mud/ecs-engine';

type FakeWorld = {
  execute: ReturnType<typeof vi.fn>;
  output: { getAll: () => OutputMessage[]; clear: () => void };
};

function mountRenderer(opts?: {
  suggest?: (input: string) => string[];
  messages?: OutputMessage[];
  prompt?: (playerId: string) => string | undefined;
  click?: (seg: { text: string; style?: { tag?: string }; entityRef?: string }) => { command: string; mode?: 'run' | 'prefill'; hint?: string } | null;
  actions?: () => Array<string | { text: string; hint?: string }>;
  persistence?: { key: string; capture: () => unknown; restore: (s: unknown) => void };
}): { renderer: WebRenderer; container: HTMLElement; execute: FakeWorld['execute']; row: HTMLElement; input: HTMLInputElement; status: HTMLElement } {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const execute = vi.fn(async () => null);
  const messages = opts?.messages ?? [];
  const world = {
    execute,
    output: { getAll: () => messages, clear: () => {} },
  };
  const renderer = new WebRenderer({
    container,
    world,
    playerId: 'player-1',
    suggest: opts?.suggest,
    prompt: opts?.prompt,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    click: opts?.click as any,
    actions: opts?.actions,
    persistence: opts?.persistence,
  });
  const row = container.querySelector('#suggest-row') as HTMLElement;
  const input = container.querySelector('#cmd-input') as HTMLInputElement;
  const status = container.querySelector('.mud-status-strip') as HTMLElement;
  return { renderer, container, execute, row, input, status };
}

const press = (input: HTMLInputElement, key: string, init: KeyboardEventInit = {}) =>
  input.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }));

/** 设值 + 触发 input 事件（模拟真实键入） */
const type = (input: HTMLInputElement, text: string) => {
  input.value = text;
  input.dispatchEvent(new Event('input', { bubbles: true }));
};

/** 排空 handleInput → runCommand → execute 的微任务链 */
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

const VERBS = ['attack', '攻击', 'look', '看', '打坐'];

describe('布局 · MUD 传统', () => {
  it('没有顶部状态栏：第一孩子是输出区，屏面上没有常驻 chrome', () => {
    const { container } = mountRenderer();
    expect(container.querySelector('#status-bar')).toBeNull();
    expect((container.firstElementChild as HTMLElement).id).toBe('output');
  });
});

describe('命令建议 · 数据面', () => {
  it('输入触发建议；按最后一个词前缀过滤、上限 8', () => {
    const { input, row } = mountRenderer({ suggest: () => [...VERBS, 'v1', 'v2', 'v3', 'v4', 'v5', 'look2', 'look3', 'look4'] });
    type(input, 'lo');
    expect(row.style.display).toBe('flex');
    const chips = Array.from(row.children).map((c) => c.textContent);
    expect(chips).toEqual(['look', 'look2', 'look3', 'look4']); // attack/攻击/v* 被前缀滤掉
  });

  it('敲完空格：第二个词的候选全量亮出', () => {
    const { input, row } = mountRenderer({ suggest: (i) => (i.startsWith('attack') ? ['野狼', '狼'] : VERBS) });
    type(input, 'attack ');
    expect(row.style.display).toBe('flex');
    expect(Array.from(row.children).map((c) => c.textContent)).toEqual(['野狼', '狼']);
  });

  it('无候选 / 清空输入 → 收起', () => {
    const { input, row } = mountRenderer({ suggest: () => [] });
    type(input, 'zzz');
    expect(row.style.display).toBe('none');
    type(input, '');
    expect(row.style.display).toBe('none');
  });

  it('提供器抛错不挡打字（静默收起）', () => {
    const { input, row } = mountRenderer({ suggest: () => { throw new Error('boom'); } });
    type(input, 'at');
    expect(row.style.display).toBe('none');
    expect(input.value).toBe('at');
  });
});

describe('命令建议 · 键盘契约', () => {
  it('Tab 接受候选：替换最后一个词，不执行', async () => {
    const { input, row, execute } = mountRenderer({ suggest: () => VERBS });
    type(input, 'att');
    press(input, 'Tab');
    expect(input.value).toBe('attack');
    expect(row.style.display).toBe('none');
    expect(execute).not.toHaveBeenCalled();
  });

  it('点击 chip 补进第二个词且不执行', async () => {
    const { input, row, execute } = mountRenderer({ suggest: (i) => (i.includes(' ') ? ['野狼'] : VERBS) });
    type(input, 'attack ');
    (row.children[0] as HTMLElement).click();
    expect(input.value).toBe('attack 野狼');
    expect(row.style.display).toBe('none');
    expect(execute).not.toHaveBeenCalled();
  });

  it('候选条开着：↑↓ 在候选间移动（↑ 先跳最末，与历史同款）', () => {
    const { input, row } = mountRenderer({ suggest: () => ['at1', 'at2', 'at3'] });
    type(input, 'at');
    press(input, 'ArrowUp');
    expect((row.children[2] as HTMLElement).classList.contains('selected')).toBe(true);
    press(input, 'ArrowUp');
    expect((row.children[2] as HTMLElement).classList.contains('selected')).toBe(false);
    expect((row.children[1] as HTMLElement).classList.contains('selected')).toBe(true);
    press(input, 'ArrowDown');
    press(input, 'ArrowDown'); // 1→2→越过最末回到未选中
    expect((row.children[0] as HTMLElement).classList.contains('selected')).toBe(false);
  });

  it('Enter 永远执行当前输入——候选开着也不执行候选', async () => {
    const { input, row, execute } = mountRenderer({ suggest: () => ['attack'] });
    type(input, 'att');
    press(input, 'ArrowUp'); // 选中 attack
    press(input, 'Enter');
    await flush();
    expect(execute).toHaveBeenCalledWith('att', 'player-1'); // 原文，不是候选
    expect(input.value).toBe('');
    expect(row.style.display).toBe('none');
  });

  it('Esc 收起；下一次输入变化重现', () => {
    const { input, row } = mountRenderer({ suggest: () => VERBS });
    type(input, 'at');
    press(input, 'Escape');
    expect(row.style.display).toBe('none');
    type(input, 'att');
    expect(row.style.display).toBe('flex');
  });

  it('候选条关着时 ↑↓ 仍是历史召回', async () => {
    const { input, row } = mountRenderer({ suggest: () => VERBS });
    type(input, 'look');
    press(input, 'Enter');
    await flush();
    type(input, 'at'); // 弹窗开
    press(input, 'Escape'); // 关
    press(input, 'ArrowUp');
    expect(input.value).toBe('look'); // 历史，不是候选 'attack'
    expect(row.style.display).toBe('none');
  });
});

describe('中文 IME 与既有行为', () => {
  it('IME 组合期间 Enter 不执行命令', async () => {
    const { input, execute } = mountRenderer();
    type(input, '打坐');
    press(input, 'Enter', { isComposing: true });
    await flush();
    expect(execute).not.toHaveBeenCalled();
    expect(input.value).toBe('打坐'); // 原文还在，等组合结束
  });

  it('执行后输入清空、进历史（回归锁定）', async () => {
    const { input } = mountRenderer();
    type(input, 'look');
    press(input, 'Enter');
    await flush();
    expect(input.value).toBe('');
    press(input, 'ArrowUp');
    expect(input.value).toBe('look');
  });

  it('实体标签点击 = look 该实体', async () => {
    const { renderer, container, execute } = mountRenderer({
      messages: [{ kind: 'narrative', segments: [{ text: '野狼', style: { tag: 'entity' } }] }],
    });
    await renderer.runCommand('x');
    // 圈定本用例容器——前面用例的输出行还挂在 body 上
    const tag = container.querySelector('.mud-entity') as HTMLElement;
    tag.click();
    await flush();
    // 0.18 调整：实体点击 = 预填 look 命令（不再直发）
    const input0 = container.querySelector('#cmd-input') as HTMLInputElement;
    expect(input0.value).toBe('look 野狼');
  });
});

describe('点击策略表（交互标注②：tag→命令分发 + 危险预填）', () => {
  it('策略注入：出口方向点击 = go；hover title = 策略给的提示', async () => {
    const { renderer, container, execute } = mountRenderer({
      messages: [{ kind: 'narrative', segments: [{ text: '北', style: { tag: 'direction' } }] }],
      click: (seg) =>
        seg.style?.tag === 'direction'
          ? { command: 'go north', hint: '往北走' }
          : null,
    });
    await renderer.runCommand('x');
    const dir = container.querySelector('.mud-direction') as HTMLElement;
    expect(dir).toBeTruthy();
    expect(dir.title).toBe('往北走');
    dir.click();
    await flush();
    // 0.18 调整：点击一律预填输入框，不再替玩家按键
    const inputRow = container.querySelector('#cmd-input') as HTMLInputElement;
    expect(inputRow.value).toBe('go north');
    expect(execute).toHaveBeenCalledTimes(1); // 仅初始 runCommand('x')
  });

  it('危险动词 mode:prefill → 只预填输入框不执行，回车才走', async () => {
    const { renderer, container, execute, input } = mountRenderer({
      messages: [{ kind: 'narrative', segments: [{ text: '野狼', style: { tag: 'entity' } }] }],
      click: () => ({ command: 'attack 野狼', mode: 'prefill' }),
    });
    await renderer.runCommand('x');
    const tag = container.querySelector('.mud-entity') as HTMLElement;
    tag.click();
    await flush();
    expect(execute).not.toHaveBeenCalledWith('attack 野狼', 'player-1');
    expect(input.value).toBe('attack 野狼');
    // 玩家按回车 → 执行预填的命令
    press(input, 'Enter');
    await flush();
    expect(execute).toHaveBeenLastCalledWith('attack 野狼', 'player-1');
  });

  it('策略返回 null 的段不可点（无交互类与事件）', async () => {
    const { renderer, container, execute } = mountRenderer({
      messages: [{ kind: 'narrative', segments: [{ text: '旁白', style: { tag: 'keyword' } }] }],
      click: () => null,
    });
    await renderer.runCommand('x');
    const span = container.querySelector('.output-line span') as HTMLElement;
    span.click();
    await flush();
    expect(execute).toHaveBeenCalledTimes(1); // 只有 runCommand('x') 那一次
  });
});

describe('语境动作条与输入行收起（0.18 ③）', () => {
  it('输入行默认收起；动作条芯片点击 = 直接执行命令', async () => {
    const { container, execute, input } = mountRenderer({
      actions: () => [{ text: '状态', hint: '一览' }, '打坐'],
    });
    const inputRow = container.querySelector('.mud-input-row') as HTMLElement;
    expect(inputRow.style.display).not.toBe('none'); // 0.18：输入行常驻
    const chips = container.querySelectorAll('.mud-action-chip');
    expect(chips.length).toBe(3); // ⌨ + 状态 + 打坐
    const statusChip = chips[1] as HTMLElement;
    expect(statusChip.title).toBe('一览');
    statusChip.click();
    await flush();
    // 预填而非直发
    expect(input.value).toBe('状态');
    expect(execute).not.toHaveBeenCalled();
  });

  it('输入行常驻；Esc 可收起，⌨ 与 / 可唤出', () => {
    const { container, input } = mountRenderer({ actions: () => [] });
    const inputRow = container.querySelector('.mud-input-row') as HTMLElement;
    expect(inputRow.style.display).not.toBe('none'); // 默认常驻
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    expect(inputRow.style.display).toBe('none');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: '/', bubbles: true, cancelable: true }));
    expect(inputRow.style.display).toBe('flex');
    const kbd = container.querySelector('.mud-kbd-toggle') as HTMLElement;
    kbd.click(); // 再收起
    expect(inputRow.style.display).toBe('none');
  });

  it('动作条随语境刷新：战斗芯片在提示符刷新后出现', async () => {
    let inCombat = false;
    const { renderer, container, execute } = mountRenderer({
      actions: () => (inCombat ? ['停战'] : ['打坐']),
    });
    expect(container.textContent).toContain('打坐');
    inCombat = true;
    await renderer.runCommand('attack 野狼'); // 每条命令后重画动作条
    expect(container.textContent).toContain('停战');
    void execute;
  });
});

describe('影子补全与候选说明（0.5 快速选择）', () => {
  it('影子补全：输入 at → ghost 余段 tack；选中变化随之更新', () => {
    const { input, row, container } = mountRenderer({ suggest: () => ['attack', 'attach'] });
    input.focus();
    type(input, 'at');
    const ghostText = () => input.parentElement!.querySelector('.mud-ghost')!.textContent;
    expect(ghostText()).toBe('at' + 'tack'); // 首个候选 attack → 余段 tack（hidden 值段占位）
    press(input, 'ArrowUp'); // 选中 attach（↑ 未选中时跳最末）
    expect(ghostText()).toBe('attach'); // value 'at'（隐藏占位）+ 余段 'tach'
  });

  it('→ 在行尾时等同 Tab：接受影子补全', () => {
    const { input, container, execute } = mountRenderer({ suggest: () => ['attack'] });
    input.focus();
    type(input, 'at');
    input.setSelectionRange(input.value.length, input.value.length);
    press(input, 'ArrowRight');
    expect(input.value).toBe('attack');
    expect(execute).not.toHaveBeenCalled();
  });

  it('动词候选带 describe 提示（chip-hint）', () => {
    const { input, row } = mountRenderer({ suggest: () => [{ text: 'attack', hint: '攻击同房间的目标' }] });
    type(input, 'at');
    const hint = row.querySelector('.chip-hint');
    expect(hint?.textContent).toBe('攻击同房间的目标');
  });
});

describe('提示符状态（0.6,xkx prompt 惯例）', () => {
  it('命令执行后刷新状态条;undefined 隐藏', async () => {
    let text: string | undefined = '气血 82 · 内力 20';
    const { input, status, execute } = mountRenderer({ prompt: () => text });
    expect(status.style.display).toBe('block'); // 构造即求值（有文本）
    type(input, 'look');
    press(input, 'Enter');
    await flush();
    expect(status.textContent).toBe('气血 82 · 内力 20');
    text = undefined;
    type(input, 'look');
    press(input, 'Enter');
    await flush();
    expect(status.style.display).toBe('none');
    void execute;
  });
});


describe('存档命令（0.18：显式命令化）', () => {
  it('存档 → 手动写入；读档 → 回滚世界并重看周围', async () => {
    const calls = { capture: 0, restore: 0 };
    const { container, execute, input } = mountRenderer({
      persistence: {
        key: 'test-save',
        capture: () => { calls.capture++; return { n: calls.capture }; },
        restore: () => { calls.restore++; },
      },
    });
    (container.querySelector('.mud-kbd-toggle') as HTMLElement).click(); // 唤出输入行
    type(input, '存档');
    press(input, 'Enter');
    await flush();
    expect(calls.capture).toBeGreaterThan(0);
    expect(container.textContent).toContain('已存档');

    type(input, '读档');
    press(input, 'Enter');
    await flush();
    expect(calls.restore).toBe(1);
    expect(container.textContent).toContain('已读档');
    // 读档后自动 look 重看周围
    expect(execute).toHaveBeenLastCalledWith('look', 'player-1');
  });

  it('无存档时读档 → 明说', async () => {
    const { container, input } = mountRenderer({
      persistence: { key: 'empty-save', capture: () => ({}), restore: () => {} },
    });
    (container.querySelector('.mud-kbd-toggle') as HTMLElement).click();
    type(input, '读档');
    press(input, 'Enter');
    await flush();
    expect(container.textContent).toContain('还没有任何存档');
  });

  it('清档 是 重开 的别名（两段式确认保留）', async () => {
    const { container, input } = mountRenderer({
      persistence: { key: 'k', capture: () => ({}), restore: () => {} },
    });
    (container.querySelector('.mud-kbd-toggle') as HTMLElement).click();
    type(input, '清档');
    press(input, 'Enter');
    await flush();
    expect(container.textContent).toContain('从头开始');
    void container;
  });
});
