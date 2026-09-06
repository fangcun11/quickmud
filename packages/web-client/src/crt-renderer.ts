/**
 * CRT 渲染器（阶段一：canvas 文字层，无 shader）
 *
 * 与 WebRenderer 同契约（showWelcome / runCommand / restored），供 main-web
 * 按 ?ui=crt 切换。输出区是 **canvas**：引擎的 Segment[] 经 TermBuffer 折行
 * 后直接绘制——这是 WebGL 后处理（阶段二）的纹理源。输入行仍为 DOM
 * （输入法/光标是 DOM 强项）。点击命中 → 点击策略 → 预填输入框。
 *
 * 暂不支持：建议条/输入建议（DOM 渲染器独有）、文本拖选。
 */
import type { OutputMessage, Segment } from '@mud/ecs-engine';
import { ENGINE_VERSION } from '@mud/ecs-engine';
import { TermBuffer, kindColor } from './term-buffer';

export interface RendererPersistence {
  key: string;
  capture: () => unknown;
  restore: (snapshot: unknown) => void;
  restartVerbs?: string[];
}

export interface WelcomeOptions {
  title?: string;
  lines?: string[];
}

export interface ClickAction {
  command: string;
  mode?: 'run' | 'prefill';
  hint?: string;
}

/** 渲染器视角的世界接口（与 WebRenderer 相同） */
export interface RendererWorld {
  execute: (input: string, playerId: string) => string | null | Promise<string | null>;
  output: { getAll: () => OutputMessage[]; clear: () => void };
}

const FONT = '15px "Cascadia Mono", Consolas, "Noto Sans Mono CJK SC", "Microsoft YaHei", monospace';
const LINE_HEIGHT = 22;
const PAD = 12;

export class CrtRenderer {
  private canvas: HTMLCanvasElement;
  private inputEl: HTMLInputElement;
  private world: RendererWorld;
  private playerId: string;
  private persistence?: RendererPersistence;
  private clickPolicy?: (seg: Segment) => ClickAction | null;

  private buffer: TermBuffer;
  private ctx2d: CanvasRenderingContext2D | null;
  private scrollLines = 0;
  private viewLines = 10;
  private dirty = true;
  private restoredOk = false;
  private restoreNote?: string;
  private history: string[] = [];
  private historyIndex = -1;

  private cssResolve(cache: Map<string, string>, varName: string): string {
    if (cache.has(varName)) return cache.get(varName)!;
    const v = getComputedStyle(this.canvas).getPropertyValue(varName.split(',')[0]!) || '#c8ffd4';
    cache.set(varName, v);
    return v;
  }

  constructor(config: {
    container: HTMLElement;
    world: RendererWorld;
    playerId: string;
    title?: string;
    theme?: 'phosphor' | 'amber';
    persistence?: RendererPersistence;
    click?: (seg: Segment) => ClickAction | null;
  }) {
    this.world = config.world;
    this.playerId = config.playerId;
    this.persistence = config.persistence;
    this.clickPolicy = config.click;
    if (config.title) document.title = config.title;
    document.documentElement.dataset.theme = config.theme ?? 'phosphor';

    config.container.innerHTML = '';
    config.container.classList.add('mud-root');

    // 输出 canvas
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'crt-canvas';
    config.container.appendChild(this.canvas);
    this.ctx2d = this.canvas.getContext('2d');
    this.buffer = new TermBuffer(80, (t) => this.measure(t), () => ''); // colorOf 在 render 时解析

    // DOM 输入行（输入法友好）
    const inputRow = document.createElement('div');
    inputRow.className = 'mud-input-row';
    const prompt = document.createElement('span');
    prompt.textContent = '> ';
    prompt.className = 'mud-prompt';
    inputRow.appendChild(prompt);
    this.inputEl = document.createElement('input');
    this.inputEl.id = 'cmd-input';
    this.inputEl.type = 'text';
    this.inputEl.autocomplete = 'off';
    inputRow.appendChild(this.inputEl);
    config.container.appendChild(inputRow);

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      const w = Math.max(320, config.container.clientWidth - PAD * 2);
      const h = Math.max(240, window.innerHeight - 90);
      this.canvas.width = Math.floor(w * dpr);
      this.canvas.height = Math.floor(h * dpr);
      this.canvas.style.width = `${w}px`;
      this.canvas.style.height = `${h}px`;
      this.ctx2d?.setTransform(dpr, 0, 0, dpr, 0, 0);
      this.viewLines = Math.floor((h - PAD * 2) / LINE_HEIGHT);
      if (this.ctx2d) this.ctx2d.font = FONT;
      this.dirty = true;
    };
    window.addEventListener('resize', resize);
    resize();

    this.canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.scrollLines = Math.max(0, this.scrollLines + (e.deltaY > 0 ? 3 : -3));
      this.dirty = true;
    });
    this.canvas.addEventListener('click', (e) => this.onCanvasClick(e));
    this.inputEl.addEventListener('keydown', (e) => {
      if (e.isComposing) return;
      if (e.key === 'Enter') void this.handleInput();
      else if (e.key === 'ArrowUp') {
        e.preventDefault();
        this.recallHistory(-1);
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        this.recallHistory(1);
      }
    });

    // 渲染循环（脏区重绘）
    const loop = () => {
      if (this.dirty) {
        this.draw();
        this.dirty = false;
      }
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);

    if (this.persistence) this.tryRestore();
  }

  private measure(text: string): number {
    if (!this.ctx2d) return text.length * 9;
    return this.ctx2d.measureText(text).width;
  }

  private colorOf = (kind: string, seg: Segment): string => {
    const cache = new Map<string, string>();
    return kindColor(kind, seg, (v) => {
      if (cache.has(v)) return cache.get(v)!;
      const real = getComputedStyle(this.canvas).getPropertyValue(v.slice(4, -1)) || '#c8ffd4';
      cache.set(v, real);
      return real;
    });
  };

  /** 追加一条输出（WebRenderer 同契约） */
  appendOutput(msg: OutputMessage): void {
    this.buffer.width = Math.max(320, (this.canvas.clientWidth || 800) - PAD * 2);
    this.buffer.pushMessage(msg);
    this.scrollLines = Math.max(0, this.buffer.lines.length - this.viewLines);
    this.dirty = true;
  }

  private echo(input: string): void {
    this.appendOutput({ kind: 'system', segments: [{ text: `> ${input}` }] });
  }

  async runCommand(input: string): Promise<void> {
    const result = await this.world.execute(input, this.playerId);
    if (result) this.appendOutput({ kind: 'narrative', segments: [{ text: result }] });
    for (const msg of this.world.output.getAll()) this.appendOutput(msg);
    this.world.output.clear();
    this.autosave();
  }

  private async handleInput(): Promise<void> {
    const input = this.inputEl.value.trim();
    if (!input) return;
    this.echo(input);
    this.inputEl.value = '';
    if (!this.history.length || this.history[this.history.length - 1] !== input) this.history.push(input);
    this.historyIndex = -1;
    // 存档命令（与 WebRenderer 同语义）
    if (this.persistence && input === '存档') {
      const ok = this.saveNow();
      this.appendOutput({ kind: 'system', segments: [{ text: ok ? '已存档。' : '存档失败。' }] });
      return;
    }
    if (this.persistence && input === '读档') {
      const note = this.restoreLast();
      this.appendOutput({ kind: 'system', segments: [{ text: note }] });
      if (note.startsWith('已读档')) await this.runCommand('look');
      return;
    }
    await this.runCommand(input);
  }

  private saveNow(): boolean {
    const p = this.persistence;
    if (!p) return false;
    try {
      localStorage.setItem(p.key, JSON.stringify(p.capture()));
      return true;
    } catch {
      return false;
    }
  }

  private restoreLast(): string {
    const p = this.persistence;
    if (!p) return '这个页面没有存档系统。';
    try {
      const raw = localStorage.getItem(p.key);
      if (!raw) return '还没有任何存档。';
      p.restore(JSON.parse(raw));
      return '已读档——你回到了上一次存档的那一刻。';
    } catch {
      return '存档读不出来了——用「重开」从头开始吧。';
    }
  }

  private autosave(): void {
    const p = this.persistence;
    if (!p) return;
    try {
      localStorage.setItem(p.key, JSON.stringify(p.capture()));
    } catch {
      // 忽略
    }
  }

  private tryRestore(): void {
    const p = this.persistence!;
    try {
      const raw = localStorage.getItem(p.key);
      if (!raw) return;
      p.restore(JSON.parse(raw));
      this.restoredOk = true;
    } catch {
      try {
        localStorage.removeItem(p.key);
      } catch {
        // 忽略
      }
    }
  }

  get restored(): boolean {
    return this.restoredOk;
  }

  private recallHistory(delta: -1 | 1): void {
    const len = this.history.length;
    if (len === 0) return;
    let next: number;
    if (delta === -1) next = this.historyIndex === -1 ? len - 1 : Math.max(0, this.historyIndex - 1);
    else {
      next = this.historyIndex + 1;
      if (next >= len) {
        this.historyIndex = -1;
        this.inputEl.value = '';
        return;
      }
    }
    this.historyIndex = next;
    this.inputEl.value = this.history[next] ?? '';
  }

  private onCanvasClick(e: MouseEvent): void {
    const rect = this.canvas.getBoundingClientRect();
    const seg = this.buffer.hitTest(
      this.scrollLines,
      this.viewLines,
      e.clientX - rect.left - PAD,
      e.clientY - rect.top - PAD,
      LINE_HEIGHT,
    );
    if (!seg) return;
    const probe: Segment = { text: seg.text, style: { color: 'white', bold: seg.bold, italic: seg.italic, tag: seg.tag as 'entity' }, entityRef: seg.entityRef };
    const action = this.clickPolicy?.(probe);
    if (action) {
      this.inputEl.value = action.command; // 预填（不直发）
      this.inputEl.focus();
    }
  }

  private draw(): void {
    const ctx = this.ctx2d;
    if (!ctx) return;
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    const bg = getComputedStyle(this.canvas).getPropertyValue('--bg') || '#000';
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);
    const total = this.buffer.lines.length;
    const start = Math.max(0, Math.min(this.scrollLines, total - this.viewLines));
    const end = Math.min(total, start + this.viewLines);
    ctx.textBaseline = 'top';
    for (let i = start; i < end; i++) {
      const line = this.buffer.lines[i]!;
      const y = PAD + (i - start) * LINE_HEIGHT;
      for (const seg of line.segs) {
        ctx.fillStyle = seg.color;
        ctx.font = `${seg.italic ? 'italic ' : ''}${seg.bold ? 'bold ' : ''}${FONT.slice(FONT.indexOf('15px') >= 0 ? FONT.indexOf('15px') : 0)}`.replace('15px', `${seg.bold ? 'bold ' : ''}15px`);
        ctx.fillText(seg.text, PAD + seg.x, y);
      }
    }
    // 底部提示：滚离底部时
    if (start + this.viewLines < total) {
      ctx.fillStyle = 'rgba(125,255,176,0.5)';
      ctx.fillText('── 更多（滚轮下翻）──', PAD, h - 18);
    }
  }

  showWelcome(options?: WelcomeOptions): void {
    const title = options?.title ?? `MUD 文字游戏引擎 v${ENGINE_VERSION}`;
    this.appendOutput({ kind: 'title', segments: [{ text: `=== ${title} ===` }] });
    if (this.restoreNote) this.appendOutput({ kind: 'system', segments: [{ text: this.restoreNote }] });
    for (const text of options?.lines ?? ['输入 help 查看可用命令']) {
      this.appendOutput({ kind: 'system', segments: [{ text }] });
    }
  }
}
