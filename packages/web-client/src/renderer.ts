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
 * Web 渲染器 - 将 OutputMessage 转为 DOM
 *
 * 职责：
 * 1. 输出消息 → DOM 节点（语义色/标签渲染）
 * 2. 用户输入 → world.execute()
 * 3. 状态栏常驻显示
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

  constructor(config: {
    container: HTMLElement;
    world: RendererWorld;
    playerId: string;
    /** 状态栏文本提供者（可选），返回 undefined 则显示兜底文案 */
    status?: (playerId: string) => string | undefined;
  }) {
    this.container = config.container;
    this.world = config.world;
    this.playerId = config.playerId;
    this.statusProvider = config.status;

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

    // 输出区域
    this.outputEl = document.createElement('div');
    this.outputEl.id = 'output';
    this.outputEl.style.cssText = `
      flex: 1;
      overflow-y: auto;
      padding: 16px;
      line-height: 1.6;
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
      }
    });

    // 点击容器聚焦输入
    this.container.addEventListener('click', () => {
      this.inputEl.focus();
    });

    // 初始聚焦
    this.inputEl.focus();
  }

  /**
   * 处理用户输入
   *
   * async：world.execute 可能等待异步命令的反馈文本。
   */
  private async handleInput(): Promise<void> {
    const input = this.inputEl.value.trim();
    if (!input) return;

    // 显示输入
    this.appendOutput({
      kind: 'system',
      segments: [{ text: `> ${input}`, style: { color: 'gray' } }],
    });

    // 清空输入框
    this.inputEl.value = '';

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

    // 滚动到底部
    this.outputEl.scrollTop = this.outputEl.scrollHeight;

    // 更新状态
    this.updateStatus();
  }

  /**
   * 渲染 OutputMessage 到 DOM
   */
  private appendOutput(msg: OutputMessage): void {
    const line = document.createElement('div');
    line.className = `output-line output-${msg.kind}`;

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

      // 标签样式
      if (seg.style.tag === 'entity') {
        span.style.borderBottom = '1px dashed #53a8b6';
        span.style.cursor = 'pointer';
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
   * 显示欢迎消息
   */
  showWelcome(): void {
    this.appendOutput({
      kind: 'title',
      segments: [{ text: `=== MUD 文字游戏引擎 v${ENGINE_VERSION} ===` }],
    });
    this.appendOutput({
      kind: 'system',
      segments: [{ text: '输入 help 查看可用命令' }],
    });
    this.appendOutput({
      kind: 'narrative',
      segments: [{ text: '' }],
    });
    this.updateStatus();
  }
}
