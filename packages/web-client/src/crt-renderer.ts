/**
 * CRT 渲染器（阶段二：WebGL 后处理）
 *
 * 管线：引擎 Segment[] → TermBuffer 折行 → 离屏 2D canvas 绘制文字 →
 * 作为纹理上传 → WebGL 后处理（crt-shaders.ts：弯曲/色差/扫描线/荫罩/
 * 辉光/暗角/闪烁/噪点）→ 屏幕。文字不由 shader 绘制——WebGL 只是滤镜。
 *
 * 输入行仍为 DOM（输入法/光标/选择是 DOM 强项），且不受 shader 影响。
 * 无 WebGL 环境自动降级为直出 2D 画布（阶段一行为）。
 * 与 WebRenderer 同契约（showWelcome / runCommand / restored），?ui=crt 切换。
 */
import type { OutputMessage, Segment } from '@mud/ecs-engine';
import { ENGINE_VERSION } from '@mud/ecs-engine';
import { TermBuffer, kindColor } from './term-buffer';
import { CRT_VERT, CRT_FRAG } from './crt-shaders';

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

export interface RendererWorld {
  execute: (input: string, playerId: string) => string | null | Promise<string | null>;
  output: { getAll: () => OutputMessage[]; clear: () => void };
}

const FONT = '15px "Cascadia Mono", Consolas, "Noto Sans Mono CJK SC", "Microsoft YaHei", monospace';
const LINE_HEIGHT = 22;
const PAD = 12;

export class CrtRenderer {
  private world: RendererWorld;
  private playerId: string;
  private persistence?: RendererPersistence;
  private clickPolicy?: (seg: Segment) => ClickAction | null;

  private src: HTMLCanvasElement; // 离屏：文字层
  private srcCtx: CanvasRenderingContext2D | null;
  private view: HTMLCanvasElement; // 屏幕：GL（或降级 2D）呈现
  private viewCtx: CanvasRenderingContext2D | null = null;
  private gl: WebGLRenderingContext | null = null;
  private tex: WebGLTexture | null = null;
  private uTex: WebGLUniformLocation | null = null;
  private uRes: WebGLUniformLocation | null = null;
  private uTime: WebGLUniformLocation | null = null;

  private buffer: TermBuffer;
  private scrollLines = 0;
  private viewLines = 10;
  private dirty = true;
  private restoredOk = false;
  private history: string[] = [];
  private historyIndex = -1;
  private inputEl: HTMLInputElement;

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

    // 离屏文字层（happy-dom 等环境可能没有 2D 上下文——守卫跳过绘制）
    this.src = document.createElement('canvas');
    this.srcCtx = typeof this.src.getContext === 'function' ? this.src.getContext('2d') : null;

    // 呈现层：优先 WebGL
    this.view = document.createElement('canvas');
    this.view.className = 'crt-canvas';
    config.container.appendChild(this.view);
    const gl = typeof this.view.getContext === 'function' ? (this.view.getContext('webgl') as WebGLRenderingContext | null) : null;
    if (gl && this.initGL(gl)) {
      this.gl = gl;
    } else {
      this.viewCtx = typeof this.view.getContext === 'function' ? this.view.getContext('2d') : null; // 降级直出
    }

    // DOM 输入行
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

    this.buffer = new TermBuffer(80, (t) => this.measure(t), this.colorOf);

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      const w = Math.max(320, config.container.clientWidth - PAD * 2);
      const h = Math.max(240, window.innerHeight - 90);
      for (const c of [this.src, this.view]) {
        c.width = Math.floor(w * dpr);
        c.height = Math.floor(h * dpr);
        c.style.width = `${w}px`;
        c.style.height = `${h}px`;
      }
      this.srcCtx?.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (this.srcCtx) this.srcCtx.font = FONT;
      this.viewCtx?.setTransform(dpr, 0, 0, dpr, 0, 0);
      this.viewLines = Math.floor((h - PAD * 2) / LINE_HEIGHT);
      this.dirty = true;
    };
    window.addEventListener('resize', resize);
    resize();

    this.view.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.scrollLines = Math.max(0, this.scrollLines + (e.deltaY > 0 ? 3 : -3));
      this.dirty = true;
    });
    this.view.addEventListener('click', (e) => this.onCanvasClick(e));
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

    const t0 = performance.now();
    const loop = () => {
      if (this.dirty) {
        this.renderText();
        this.dirty = false;
      }
      this.present((performance.now() - t0) / 1000);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);

    if (this.persistence) this.tryRestore();
  }

  private measure(text: string): number {
    return this.srcCtx ? this.srcCtx.measureText(text).width : text.length * 9;
  }

  private colorOf = (kind: string, seg: Segment): string => {
    const cache = new Map<string, string>();
    return kindColor(kind, seg, (v) => {
      if (cache.has(v)) return cache.get(v)!;
      const real = this.srcCtx ? getComputedStyle(this.src).getPropertyValue(v.slice(4, -1)) || '#c8ffd4' : '#c8ffd4';
      cache.set(v, real);
      return real;
    });
  };

  appendOutput(msg: OutputMessage): void {
    this.buffer.width = Math.max(320, (this.view.clientWidth || 800) - PAD * 2);
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
    if (this.persistence && input === '存档') {
      this.appendOutput({ kind: 'system', segments: [{ text: this.saveNow() ? '已存档。' : '存档失败。' }] });
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

  /** 行缓冲行数（测试/调试用） */
  get lines(): number {
    return this.buffer.lines.length;
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
    const rect = this.view.getBoundingClientRect();
    const seg = this.buffer.hitTest(
      this.scrollLines,
      this.viewLines,
      e.clientX - rect.left - PAD,
      e.clientY - rect.top - PAD,
      LINE_HEIGHT,
    );
    if (!seg) return;
    const probe: Segment = {
      text: seg.text,
      style: { color: 'white', bold: seg.bold, italic: seg.italic, tag: seg.tag as 'entity' },
      entityRef: seg.entityRef,
    };
    const action = this.clickPolicy?.(probe);
    if (action) {
      this.inputEl.value = action.command; // 预填（不直发）
      this.inputEl.focus();
    }
  }

  /** 把文字画进离屏层（仅脏时） */
  private renderText(): void {
    const ctx = this.srcCtx;
    if (!ctx) return;
    const w = this.src.clientWidth;
    const h = this.src.clientHeight;
    const bg = getComputedStyle(this.src).getPropertyValue('--bg') || '#000';
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
        ctx.font = `${seg.italic ? 'italic ' : ''}${seg.bold ? 'bold ' : ''}${FONT}`;
        // 磷光辉光（对标 typed-crt 每行辉光）：同色 shadow 双次绘制
        ctx.shadowColor = seg.color;
        ctx.shadowBlur = 9;
        ctx.fillText(seg.text, PAD + seg.x, y);
        ctx.shadowBlur = 0;
        ctx.fillText(seg.text, PAD + seg.x, y);
      }
    }
    if (start + this.viewLines < total) {
      ctx.fillStyle = 'rgba(125,255,176,0.5)';
      ctx.fillText('── 更多（滚轮下翻）──', PAD, h - 18);
    }
  }

  // ---------------- WebGL 后处理（typed-crt 移植） ----------------

  private initGL(gl: WebGLRenderingContext): boolean {
    const compile = (type: number, src: string) => {
      const sh = gl.createShader(type)!;
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh) ?? 'shader');
      return sh;
    };
    const prog = gl.createProgram()!;
    gl.attachShader(prog, compile(gl.VERTEX_SHADER, CRT_VERT));
    gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, CRT_FRAG));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return false;
    gl.useProgram(prog);

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'aPos');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

    this.tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    this.uTex = gl.getUniformLocation(prog, 'uTex');
    this.uRes = gl.getUniformLocation(prog, 'uRes');
    this.uTime = gl.getUniformLocation(prog, 'uTime');
    if (this.uTex) gl.uniform1i(this.uTex, 0);
    return true;
  }

  /** 每帧呈现：脏时重画文字层，GL 常驻滤镜（时间驱动动画） */
  private present(timeSec: number): void {
    const w = this.view.width;
    const h = this.view.height;
    if (this.gl && this.tex) {
      const gl = this.gl;
      gl.viewport(0, 0, w, h);
      gl.bindTexture(gl.TEXTURE_2D, this.tex);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 1);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.src);
      gl.uniform2f(this.uRes, w, h);
      gl.uniform1f(this.uTime, timeSec);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    } else if (this.viewCtx) {
      this.viewCtx.clearRect(0, 0, w, h);
      this.viewCtx.drawImage(this.src, 0, 0, w, h);
    }
  }

  showWelcome(options?: WelcomeOptions): void {
    const title = options?.title ?? `MUD 文字游戏引擎 v${ENGINE_VERSION}`;
    this.appendOutput({ kind: 'title', segments: [{ text: `=== ${title} ===` }] });
    for (const text of options?.lines ?? ['输入 help 查看可用命令']) {
      this.appendOutput({ kind: 'system', segments: [{ text }] });
    }
  }
}
