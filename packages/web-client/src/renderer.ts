import type { OutputMessage, Segment } from '@mud/ecs-engine';
import { ENGINE_VERSION } from '@mud/ecs-engine';

/**
 * 渲染器视角的世界接口（结构化类型，World 实例可直接满足）
 */
export interface RendererWorld {
  execute: (input: string, playerId: string) => string | null | Promise<string | null>;
  output: { getAll: () => OutputMessage[]; clear: () => void };
}

/**
 * 存档接线（v0.2）：把引擎的快照 API 接到 localStorage
 *
 * 渲染器不感知快照格式——capture/restore 由游戏侧注入（一行
 * `world.createSnapshot` / `world.rollbackWorld`），渲染器只负责
 * **时机**：启动时读档恢复、每条命令后自动保存、「重开」清档重来。
 */
export interface RendererPersistence {
  /** localStorage 键（建议 `save:<游戏名>`） */
  key: string;
  /** 取当前世界快照（游戏侧：`() => world.createSnapshot()`） */
  capture: () => unknown;
  /** 把快照写回世界（游戏侧：`(s) => world.rollbackWorld(s as SnapshotData)`） */
  restore: (snapshot: unknown) => void;
  /** 重开命令动词（默认 ['重开', '重新开始']；需要连输两次确认） */
  restartVerbs?: string[];
}

/** 欢迎语定制：游戏名 + 开场文案（不传保持引擎默认） */
export interface WelcomeOptions {
  /** 游戏名（横幅与 document.title；横幅形如 `=== 侠客行 ===`） */
  title?: string;
  /** 开场文案（每行一条 system 消息）；不传显示通用帮助提示 */
  lines?: string[];
}

/**
 * 点击动作（交互标注②）：策略表返回什么，点击就做什么。
 * 命令一律编译回命令层走 execute——与打字同管线（录像/help/建议零漂移）。
 */
export interface ClickAction {
  /** 要执行的命令 */
  command: string;
  /** run=直接执行（默认，安全动词）；prefill=只预填输入框等玩家确认（危险动词用） */
  mode?: 'run' | 'prefill';
  /** hover 提示（不传显示命令本身） */
  hint?: string;
}

/**
 * Web 渲染器 - 将 OutputMessage 转为 DOM
 *
 * 职责：
 * 1. 输出消息 → DOM 节点（语义色/标签渲染）
 * 2. 用户输入 → world.execute()（↑/↓ 输入历史、实体标签点击查看）
 * 3. 命令建议：边输入边弹出候选条（数据由游戏侧 suggest 提供器注入，
 *    渲染器只管展示与前缀过滤；Tab/点击补进输入框，Enter 永远执行
 *    当前输入——建议不替玩家打字）
 * 4. 可选存档接线（启动恢复 / 自动保存 / 重开确认）
 *
 * 与 status/persistence 同一纪律：渲染器不感知世界，世界相关的数据面
 * 全部由游戏侧注入。屏幕上没有常驻状态栏——MUD 传统就是一整面文字流，
 * 属性靠命令查（如 状态/score）。
 */
export class WebRenderer {
  private container: HTMLElement;
  private outputEl: HTMLElement;
  private inputEl: HTMLInputElement;
  private suggestRowEl: HTMLElement;
  private world: RendererWorld;
  private playerId: string;
  private suggestProvider?: (input: string) => Array<string | { text: string; hint?: string }>;
  private promptProvider?: (playerId: string) => string | undefined;
  private clickPolicy?: (seg: Segment) => ClickAction | null;
  private statusEl: HTMLElement;
  private persistence?: RendererPersistence;

  // 输入历史（↑/↓ 召回；MUD 最高频的操作就是重复上一条）
  private history: string[] = [];
  private historyIndex = -1;
  // 命令建议（suggest 提供器给全集，这里做前缀过滤、上限与键盘契约）
  private suggestItems: { text: string; hint?: string }[] = [];
  private suggestIndex = -1;
  private ghostEl: HTMLElement;
  /** Esc/接受后暂不弹（直到下一次输入变化）；避免补全刚收起又被顶回来 */
  private suggestDismissed = false;
  /** 重开两段式确认：第一次输入只提示，第二次才真清档 */
  private restartArmed = false;
  /** 读档结果：true=恢复了存档 / false=存档存在但读不出来（showWelcome 时输出说明） */
  private restoredOk = false;
  private restoreNote?: string;

  constructor(config: {
    container: HTMLElement;
    world: RendererWorld;
    playerId: string;
    /**
     * 命令建议提供器（可选，游戏侧注入）。入参 = 输入框当前全文，
     * 返回**候选全集**（渲染器按光标前最后一个词做前缀过滤、取前 8 个）；
     * 候选 = `{ text, hint? }`（动词候选的 hint 用 describe）或纯字符串；
     * 建议用 prefabs 的 createSuggester 生成。
     */
    suggest?: (input: string) => Array<string | { text: string; hint?: string }>;
    /**
     * 提示符状态（0.6，xkx prompt 惯例）：每次提示符出现时求值——
     * 返回一行精简状态（如 `气血 82 · 内力 20`）渲染在输入行上方；
     * 返回 undefined 则隐藏。非世界状态，只是玩家一览。
     */
    prompt?: (playerId: string) => string | undefined;
    /** 主题（0.4）：磷光绿（默认）/ 琥珀——设 <html data-theme>，样式在模板 CSS 变量里 */
    theme?: 'phosphor' | 'amber';
    /** 浏览器标签页标题（不传保持 HTML 模板默认） */
    title?: string;
    /** 存档接线（不传 = 无存档，刷新即重开） */
    persistence?: RendererPersistence;
    /**
     * 点击策略（可选，游戏侧注入）：tag→命令 的分发表。入参是输出段，
     * 返回 `{ command, mode?, hint? }` 或 null（不可点）。
     * 游戏侧有世界知识（ForSale/Portable/Located），按语境选动词：
     * 出口方向→go、铺面商品→buy、地上物→take、敌怪→prefill attack 等。
     * 不传用内置兜底（实体名点击 = look，维持旧行为）。
     */
    click?: (seg: Segment) => ClickAction | null;
  }) {
    this.container = config.container;
    this.world = config.world;
    this.playerId = config.playerId;
    this.suggestProvider = config.suggest;
    this.promptProvider = config.prompt;
    this.clickPolicy = config.click;
    this.persistence = config.persistence;

    if (config.title) {
      document.title = config.title;
    }
    document.documentElement.dataset.theme = config.theme ?? 'phosphor';

    // 清空容器（样式全部在模板 CSS 里：.mud-root 及其后代）
    this.container.innerHTML = '';
    this.container.classList.add('mud-root');

    // 输出区域（限宽居中：宽屏上一行拉满 1200px+ 没法读）
    this.outputEl = document.createElement('div');
    this.outputEl.id = 'output';
    this.container.appendChild(this.outputEl);

    // 底部簇：状态条 + 命令建议条（有候选时才出现）+ 输入行
    const bottomWrap = document.createElement('div');
    bottomWrap.className = 'mud-bottom';

    this.statusEl = document.createElement('div');
    this.statusEl.className = 'mud-status-strip';
    bottomWrap.appendChild(this.statusEl);

    this.suggestRowEl = document.createElement('div');
    this.suggestRowEl.id = 'suggest-row';
    bottomWrap.appendChild(this.suggestRowEl);

    const inputArea = document.createElement('div');
    inputArea.className = 'mud-input-row';

    const prompt = document.createElement('span');
    prompt.textContent = '> ';
    prompt.className = 'mud-prompt';
    inputArea.appendChild(prompt);

    const inputWrap = document.createElement('span');
    inputWrap.className = 'mud-input-wrap';

    this.ghostEl = document.createElement('div');
    this.ghostEl.className = 'mud-ghost';
    this.ghostEl.setAttribute('aria-hidden', 'true');
    inputWrap.appendChild(this.ghostEl);

    this.inputEl = document.createElement('input');
    this.inputEl.id = 'cmd-input';
    this.inputEl.type = 'text';
    this.inputEl.autocomplete = 'off';
    inputWrap.appendChild(this.inputEl);
    inputArea.appendChild(inputWrap);
    bottomWrap.appendChild(inputArea);
    this.container.appendChild(bottomWrap);

    // 绑定事件
    this.inputEl.addEventListener('keydown', (e) => {
      // 中文 IME 组合期间：确认候选词的 Enter、翻候选的 ↑↓ 都不是命令操作
      if (e.isComposing) return;
      if (e.key === 'Enter') {
        this.handleInput();
      } else if (e.key === 'Tab' && this.suggestVisible()) {
        // Tab 接受候选（不执行）；无候选时保留浏览器默认行为
        e.preventDefault();
        this.acceptSuggestion();
      } else if (e.key === 'ArrowRight' && this.suggestVisible() && this.ghostRemainder()) {
        // 光标在行尾时 → 等同 Tab：接受影子补全
        if (this.inputEl.selectionStart === this.inputEl.value.length) {
          e.preventDefault();
          this.acceptSuggestion();
        }
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        // 候选条开着时 ↑↓ 在候选间移动，关着时才是历史召回
        if (this.suggestVisible()) this.moveSuggestSelection(-1);
        else this.recallHistory(-1);
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (this.suggestVisible()) this.moveSuggestSelection(1);
        else this.recallHistory(1);
      } else if (e.key === 'Escape' && this.suggestVisible()) {
        e.preventDefault();
        this.dismissSuggestions();
      }
    });
    this.inputEl.addEventListener('input', () => this.refreshSuggestions());
    this.inputEl.addEventListener('focus', () => this.updateGhost());
    this.inputEl.addEventListener('blur', () => {
      this.ghostEl.textContent = '';
    });

    // 点击容器聚焦输入
    this.container.addEventListener('click', () => {
      this.inputEl.focus();
    });

    // 初始聚焦 + 状态条求值
    this.inputEl.focus();
    this.updatePrompt();

    // 存档：启动时尝试读档（构造即恢复，世界随后就是"上次的样子"）
    if (this.persistence) {
      this.tryRestore();
    }
  }

  /** 读档恢复（版本不兼容/脏数据时放弃读档，从新世界开始） */
  private tryRestore(): void {
    const p = this.persistence!;
    try {
      const raw = localStorage.getItem(p.key);
      if (!raw) return;
      p.restore(JSON.parse(raw));
      this.restoredOk = true;
      this.restoreNote = '（已读取上次的进度；想从头开始，输入 重开）';
    } catch {
      try {
        localStorage.removeItem(p.key);
      } catch {
        // 忽略
      }
      this.restoreNote = '（上次的存档读不出来了，已从头开始。）';
    }
  }

  /** 是否成功恢复了上次进度（构造时读档完成；游戏侧可据此自动 look） */
  get restored(): boolean {
    return this.restoredOk;
  }

  /** 每条命令后自动保存（存档失败静默——玩比存重要） */
  private autosave(): void {
    const p = this.persistence;
    if (!p) return;
    try {
      localStorage.setItem(p.key, JSON.stringify(p.capture()));
    } catch {
      // 容量满/隐私模式：忽略
    }
  }

  /** 清档重开（两段式确认的第二段） */
  private restart(): void {
    const p = this.persistence;
    if (p) {
      try {
        localStorage.removeItem(p.key);
      } catch {
        // 忽略
      }
    }
    location.reload();
  }

  /**
   * 处理用户输入
   *
   * async：world.execute 可能等待异步命令的反馈文本。
   */
  private async handleInput(): Promise<void> {
    const input = this.inputEl.value.trim();
    if (!input) return;

    // 重开：两段式确认（误触清档的代价太大）
    const restartVerbs = this.persistence?.restartVerbs ?? ['重开', '重新开始'];
    if (this.persistence && restartVerbs.includes(input)) {
      if (this.restartArmed) {
        this.restart();
        return;
      }
      this.restartArmed = true;
      this.echo(input);
      this.inputEl.value = ''; // 必须清：残留会让下一次输入拼成「重开重开」，永远到不了确认段
      this.appendOutput({
        kind: 'system',
        segments: [{ text: '这会清除当前进度并从头开始——再输入一次「重开」确认（输别的取消）。' }],
      });
      this.scrollToBottom();
      return;
    }
    this.restartArmed = false;

    this.echo(input);
    this.inputEl.value = '';
    this.historyIndex = -1;
    this.hideSuggestions();

    await this.runCommand(input);
  }

  /** 回显输入并入历史（连续重复只记一次）；块间留一行呼吸（xkx 空行节奏） */
  private echo(input: string): void {
    if (this.outputEl.childNodes.length > 0) {
      const spacer = document.createElement('div');
      spacer.className = 'mud-spacer';
      this.outputEl.appendChild(spacer);
    }
    this.appendOutput(
      { kind: 'system', segments: [{ text: `> ${input}` }] },
      'mud-echo',
    );
    if (this.history[this.history.length - 1] !== input) {
      this.history.push(input);
    }
  }

  /**
   * ↑/↓ 召回历史
   *
   * ↑：未在浏览时跳到最新一条，继续↑往旧走，到最旧停住；
   * ↓：往新走，越过最新一条回到空输入。
   */
  private recallHistory(delta: -1 | 1): void {
    const len = this.history.length;
    if (len === 0) return;
    let next: number;
    if (delta === -1) {
      next = this.historyIndex === -1 ? len - 1 : Math.max(0, this.historyIndex - 1);
    } else {
      next = this.historyIndex + 1;
      if (next >= len) {
        this.historyIndex = -1;
        this.inputEl.value = '';
        this.inputEl.setSelectionRange(0, 0);
        return;
      }
    }
    this.historyIndex = next;
    this.inputEl.value = this.history[next] ?? '';
    // 光标移到行尾（浏览历史时接着改才顺手）
    this.inputEl.setSelectionRange(this.inputEl.value.length, this.inputEl.value.length);
  }

  // ---------- 命令建议 ----------
  //
  // 红线：建议被动出现、绝不替玩家打字——Tab/点击才补进输入框，
  // Enter 永远执行输入框当前内容；Esc 收起到下一次输入变化。

  private suggestVisible(): boolean {
    return this.suggestRowEl.style.display !== 'none' && this.suggestItems.length > 0;
  }

  /** 影子补全余段：选中（或首个）候选按光标前最后词取差；无差/未聚焦 → 隐藏 */
  private ghostRemainder(): string {
    if (!this.suggestVisible() || document.activeElement !== this.inputEl) return '';
    const best = this.suggestItems[this.suggestIndex >= 0 ? this.suggestIndex : 0];
    if (!best) return '';
    const input = this.inputEl.value;
    const lastWord = input.endsWith(' ') ? '' : this.lastWordOf(input);
    if (!lastWord) return ''; // 空词不预填（避免整词压屏）
    return best.text.toLowerCase().startsWith(lastWord.toLowerCase())
      ? best.text.slice(lastWord.length)
      : '';
  }

  /** 提示符状态刷新（prompt 回调求值；undefined 隐藏） */
  private updatePrompt(): void {
    const text = this.promptProvider?.(this.playerId);
    if (text === undefined) {
      this.statusEl.style.display = 'none';
      return;
    }
    this.statusEl.textContent = text;
    this.statusEl.style.display = 'block';
  }

  private updateGhost(): void {
    const rest = this.ghostRemainder();
    if (!rest) {
      this.ghostEl.textContent = '';
      return;
    }
    this.ghostEl.textContent = '';
    const typed = document.createElement('span');
    typed.style.visibility = 'hidden';
    typed.textContent = this.inputEl.value;
    const restSpan = document.createElement('span');
    restSpan.textContent = rest;
    this.ghostEl.append(typed, restSpan);
  }

  /** 输入变化 → 取候选全集 → 按光标前最后一个词前缀过滤 → 渲染（上限 8） */
  private refreshSuggestions(): void {
    this.suggestDismissed = false;
    const input = this.inputEl.value;
    if (!input.trim() || !this.suggestProvider) {
      this.hideSuggestions();
      return;
    }
    let raw: Array<string | { text: string; hint?: string }>;
    try {
      raw = this.suggestProvider(input);
    } catch {
      raw = []; // 游戏侧建议出错不能挡住打字
    }
    const candidates = raw.map((c) => (typeof c === 'string' ? { text: c } : c));
    const lastWord = input.endsWith(' ') ? '' : this.lastWordOf(input);
    const filtered = candidates.filter(
      (c) => c.text !== lastWord && c.text.toLowerCase().startsWith(lastWord.toLowerCase()),
    );
    this.renderSuggestions(filtered.slice(0, 8));
    this.updateGhost();
  }

  private lastWordOf(input: string): string {
    const cut = input.lastIndexOf(' ');
    return cut === -1 ? input : input.slice(cut + 1);
  }

  private renderSuggestions(tokens: { text: string; hint?: string }[]): void {
    this.suggestItems = tokens;
    this.suggestIndex = -1;
    this.suggestRowEl.innerHTML = '';
    if (tokens.length === 0 || this.suggestDismissed) {
      this.hideSuggestions();
      return;
    }
    tokens.forEach((item) => {
      const chip = document.createElement('span');
      chip.className = 'suggest-chip';
      chip.append(item.text);
      if (item.hint) {
        const hint = document.createElement('span');
        hint.className = 'chip-hint';
        hint.textContent = item.hint;
        chip.append(hint);
      }
      chip.addEventListener('click', (e) => {
        e.stopPropagation();
        this.acceptSuggestion(item.text);
      });
      this.suggestRowEl.appendChild(chip);
    });
    this.suggestRowEl.style.display = 'flex';
  }

  private moveSuggestSelection(delta: -1 | 1): void {
    const len = this.suggestItems.length;
    if (len === 0) return;
    if (delta === -1) {
      // 未选中时 ↑ 直接到最末一个（与历史召回同款手感），再 ↑ 往回走
      this.suggestIndex = this.suggestIndex === -1 ? len - 1 : Math.max(0, this.suggestIndex - 1);
    } else {
      this.suggestIndex += 1;
      if (this.suggestIndex >= len) this.suggestIndex = -1; // 越过最末回到未选中
    }
    this.updateChipStyles();
    this.updateGhost();
  }

  private updateChipStyles(): void {
    const chips = this.suggestRowEl.children;
    for (let i = 0; i < chips.length; i++) {
      (chips[i] as HTMLElement).classList.toggle('selected', i === this.suggestIndex);
    }
  }

  /** 把候选补进输入框（替换最后一个词）；不执行，Enter 仍由玩家敲 */
  private acceptSuggestion(token?: string): void {
    const item = token ?? this.suggestItems[this.suggestIndex >= 0 ? this.suggestIndex : 0];
    const pick = typeof item === 'string' ? item : item?.text;
    if (!pick) return;
    const input = this.inputEl.value;
    const cut = input.lastIndexOf(' ');
    this.inputEl.value = cut === -1 ? pick : input.slice(0, cut + 1) + pick;
    this.suggestDismissed = true;
    this.hideSuggestions();
    this.inputEl.focus();
    const end = this.inputEl.value.length;
    this.inputEl.setSelectionRange(end, end);
  }

  private dismissSuggestions(): void {
    this.suggestDismissed = true;
    this.hideSuggestions();
  }

  private hideSuggestions(): void {
    this.suggestItems = [];
    this.suggestIndex = -1;
    this.suggestRowEl.style.display = 'none';
    this.suggestRowEl.innerHTML = '';
    this.ghostEl.textContent = '';
  }

  /**
   * 执行一条命令并渲染结果（键盘输入、实体标签点击与游戏侧编程调用共用）
   */
  async runCommand(input: string): Promise<void> {
    // 执行命令
    const result = await this.world.execute(input, this.playerId);

    // 直接反馈
    if (result) {
      this.appendOutput({
        kind: 'narrative',
        segments: [{ text: result }],
      });
    }

    // 事件链输出
    const messages = this.world.output.getAll();
    for (const msg of messages) {
      this.appendOutput(msg);
    }
    this.world.output.clear();

    // 提示符状态 + 存档 + 滚动
    this.updatePrompt();
    this.autosave();
    this.scrollToBottom();
  }

  private scrollToBottom(): void {
    this.outputEl.scrollTop = this.outputEl.scrollHeight;
  }

  /**
   * 渲染 OutputMessage 到 DOM
   *
   * 样式全部由 CSS 类承担（模板的 .output-{kind} / .mud-* 系列）——
   * 主题切换只动 CSS 变量，渲染器不感知颜色值。
   */
  private appendOutput(msg: OutputMessage, extraClass?: string): void {
    const line = document.createElement('div');
    line.className = `output-line output-${msg.kind}` + (extraClass ? ` ${extraClass}` : '');

    // 渲染 segments
    for (const seg of msg.segments) {
      const span = this.renderSegment(seg);
      line.appendChild(span);
    }

    this.outputEl.appendChild(line);
  }

  /** 已知语义色集合：命中的走 CSS 类（随主题换色），其余按具体色值内联（兼容） */
  private static KNOWN_COLORS = new Set(['red', 'green', 'yellow', 'blue', 'gray', 'white', 'cyan', 'magenta']);

  /**
   * 渲染单个 Segment
   */
  private renderSegment(seg: Segment): HTMLSpanElement {
    const span = document.createElement('span');
    span.textContent = seg.text;

    if (seg.style) {
      if (seg.style.color) {
        if (WebRenderer.KNOWN_COLORS.has(seg.style.color)) {
          span.classList.add(`mud-c-${seg.style.color}`);
        } else {
          span.style.color = seg.style.color; // 内容直接给了色值
        }
      }
      if (seg.style.bold) span.classList.add('mud-bold');
      if (seg.style.italic) span.classList.add('mud-italic');
    }

    // 交互标注：策略表给的动作用可点击样式呈现（= 真 affordance，
    // 不是假链接——点击执行的命令与打字完全同管线）
    const action = this.clickActionFor(seg);
    if (action) {
      if (seg.style?.tag === 'entity') span.classList.add('mud-entity');
      else if (seg.style?.tag === 'direction') span.classList.add('mud-direction');
      span.title = action.hint ?? action.command;
      span.addEventListener('click', (e) => {
        e.stopPropagation();
        if (action.mode === 'prefill') {
          // 危险动词：只预填，等玩家按回车确认
          this.inputEl.value = action.command;
          this.inputEl.focus();
          return;
        }
        this.inputEl.focus();
        void this.runCommand(action.command);
      });
    }

    return span;
  }

  /**
   * 点击策略解析：游戏侧注入优先；未注入时内置兜底——
   * 实体名点击 = look（v0.4 起的旧行为），方向段不可点。
   */
  private clickActionFor(seg: Segment): ClickAction | null {
    if (this.clickPolicy) return this.clickPolicy(seg);
    if (seg.style?.tag === 'entity') {
      const name = seg.text.trim();
      return name ? { command: `look ${name}`, hint: `看看「${name}」` } : null;
    }
    return null;
  }

  /**
   * 显示欢迎消息（可定制游戏名与开场文案；不传保持引擎默认）
   */
  showWelcome(options?: WelcomeOptions): void {
    const title = options?.title ?? `MUD 文字游戏引擎 v${ENGINE_VERSION}`;
    this.appendOutput({
      kind: 'title',
      segments: [{ text: `=== ${title} ===` }],
    });
    // 读档说明放在横幅之后（构造即恢复，提示若在横幅前会盖住开场）
    if (this.restoreNote) {
      this.appendOutput({
        kind: 'system',
        segments: [{ text: this.restoreNote }],
      });
    }
    const lines = options?.lines ?? [`输入 help 查看可用命令`];
    for (const text of lines) {
      this.appendOutput({
        kind: 'system',
        segments: [{ text }],
      });
    }
    this.appendOutput({
      kind: 'narrative',
      segments: [{ text: '' }],
    });
    this.updatePrompt();
  }
}
