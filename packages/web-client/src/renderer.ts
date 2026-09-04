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
 * Web 渲染器 - 将 OutputMessage 转为 DOM
 *
 * 职责：
 * 1. 输出消息 → DOM 节点（语义色/标签渲染）
 * 2. 用户输入 → world.execute()（↑/↓ 输入历史、实体标签点击查看）
 * 3. 状态栏常驻显示
 * 4. 可选存档接线（启动恢复 / 自动保存 / 重开确认）
 *
 * 状态栏内容由 status 回调提供（渲染器不感知具体组件结构，
 * 由游戏侧用各自的 trait 定义读取并拼装文本）。
 */
export class WebRenderer {
  private container: HTMLElement;
  private outputEl: HTMLElement;
  private inputEl: HTMLInputElement;
  private statusEl: HTMLElement;
  private world: RendererWorld;
  private playerId: string;
  private statusProvider?: (playerId: string) => string | undefined;
  private persistence?: RendererPersistence;

  // 输入历史（↑/↓ 召回；MUD 最高频的操作就是重复上一条）
  private history: string[] = [];
  private historyIndex = -1;
  /** 重开两段式确认：第一次输入只提示，第二次才真清档 */
  private restartArmed = false;
  /** 读档结果：true=恢复了存档 / false=存档存在但读不出来（showWelcome 时输出说明） */
  private restoredOk = false;
  private restoreNote?: string;

  constructor(config: {
    container: HTMLElement;
    world: RendererWorld;
    playerId: string;
    /** 状态栏文本提供者（可选），返回 undefined 则显示兜底文案 */
    status?: (playerId: string) => string | undefined;
    /** 浏览器标签页标题（不传保持 HTML 模板默认） */
    title?: string;
    /** 存档接线（不传 = 无存档，刷新即重开） */
    persistence?: RendererPersistence;
  }) {
    this.container = config.container;
    this.world = config.world;
    this.playerId = config.playerId;
    this.statusProvider = config.status;
    this.persistence = config.persistence;

    if (config.title) {
      document.title = config.title;
    }

    // 清空容器
    this.container.innerHTML = '';
    this.container.style.cssText = `
      font-family: 'Courier New', Courier, monospace;
      background: #1a1a2e;
      color: #e0e0e0;
      height: 100vh;
      display: flex;
      flex-direction: column;
      margin: 0;
      padding: 0;
    `;

    // 状态栏
    this.statusEl = document.createElement('div');
    this.statusEl.id = 'status-bar';
    this.statusEl.style.cssText = `
      background: #16213e;
      padding: 8px 16px;
      border-bottom: 1px solid #0f3460;
      font-size: 14px;
      color: #a0a0a0;
    `;
    this.container.appendChild(this.statusEl);

    // 输出区域（限宽居中：宽屏上一行拉满 1200px+ 没法读）
    this.outputEl = document.createElement('div');
    this.outputEl.id = 'output';
    this.outputEl.style.cssText = `
      flex: 1;
      overflow-y: auto;
      padding: 16px;
      line-height: 1.6;
      width: 100%;
      max-width: 68em;
      margin: 0 auto;
    `;
    this.container.appendChild(this.outputEl);

    // 输入区域
    const inputArea = document.createElement('div');
    inputArea.style.cssText = `
      display: flex;
      background: #16213e;
      border-top: 1px solid #0f3460;
      padding: 8px 16px;
    `;

    const prompt = document.createElement('span');
    prompt.textContent = '> ';
    prompt.style.cssText = 'color: #53a8b6; font-weight: bold; line-height: 32px;';
    inputArea.appendChild(prompt);

    this.inputEl = document.createElement('input');
    this.inputEl.id = 'cmd-input';
    this.inputEl.type = 'text';
    this.inputEl.autocomplete = 'off';
    this.inputEl.style.cssText = `
      flex: 1;
      background: transparent;
      border: none;
      color: #e0e0e0;
      font-family: inherit;
      font-size: 16px;
      outline: none;
      caret-color: #53a8b6;
    `;
    inputArea.appendChild(this.inputEl);
    this.container.appendChild(inputArea);

    // 绑定事件
    this.inputEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        this.handleInput();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        this.recallHistory(-1);
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        this.recallHistory(1);
      }
    });

    // 点击容器聚焦输入
    this.container.addEventListener('click', () => {
      this.inputEl.focus();
    });

    // 初始聚焦
    this.inputEl.focus();

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

    await this.runCommand(input);
  }

  /** 回显输入并入历史（连续重复只记一次） */
  private echo(input: string): void {
    this.appendOutput({
      kind: 'system',
      segments: [{ text: `> ${input}`, style: { color: 'gray' } }],
    });
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

    // 存档 + 滚动 + 状态
    this.autosave();
    this.scrollToBottom();
    this.updateStatus();
  }

  private scrollToBottom(): void {
    this.outputEl.scrollTop = this.outputEl.scrollHeight;
  }

  /**
   * 渲染 OutputMessage 到 DOM
   */
  private appendOutput(msg: OutputMessage): void {
    const line = document.createElement('div');
    line.className = `output-line output-${msg.kind}`;
    // 保留文本内换行（ASCII 地图/help 多行文案），长段落仍自动折行
    line.style.whiteSpace = 'pre-wrap';

    // 根据 kind 设置样式
    switch (msg.kind) {
      case 'error':
        line.style.color = '#e74c3c';
        break;
      case 'system':
        line.style.color = '#a0a0a0';
        break;
      case 'title':
        line.style.fontWeight = 'bold';
        line.style.color = '#f39c12';
        break;
      default:
        line.style.color = '#e0e0e0';
    }

    // 渲染 segments
    for (const seg of msg.segments) {
      const span = this.renderSegment(seg);
      line.appendChild(span);
    }

    this.outputEl.appendChild(line);
  }

  /**
   * 渲染单个 Segment
   */
  private renderSegment(seg: Segment): HTMLSpanElement {
    const span = document.createElement('span');
    span.textContent = seg.text;

    if (seg.style) {
      // 语义色映射
      const colorMap: Record<string, string> = {
        red: '#e74c3c',
        green: '#2ecc71',
        yellow: '#f1c40f',
        blue: '#3498db',
        gray: '#95a5a6',
        white: '#ecf0f1',
        cyan: '#1abc9c',
        magenta: '#9b59b6',
      };

      if (seg.style.color) {
        span.style.color = colorMap[seg.style.color] ?? seg.style.color;
      }
      if (seg.style.bold) {
        span.style.fontWeight = 'bold';
      }
      if (seg.style.italic) {
        span.style.fontStyle = 'italic';
      }

      // 标签样式：实体名可点击（= look 该实体），不是假 affordance
      if (seg.style.tag === 'entity') {
        span.style.borderBottom = '1px dashed #53a8b6';
        span.style.cursor = 'pointer';
        span.addEventListener('click', (e) => {
          e.stopPropagation();
          const name = seg.text.trim();
          if (name) {
            this.inputEl.focus();
            void this.runCommand(`look ${name}`);
          }
        });
      }
    }

    return span;
  }

  /**
   * 更新状态栏
   *
   * 文本由构造时注入的 status 回调提供；渲染器自身不读取任何组件，
   * 避免硬编码组件 key（组件的存储 key 是哈希 id，不是组件名）。
   */
  private updateStatus(): void {
    const text = this.statusProvider?.(this.playerId);
    this.statusEl.textContent = text ?? `MUD 引擎 v${ENGINE_VERSION}`;
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
    this.updateStatus();
  }
}
