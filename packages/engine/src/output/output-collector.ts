import type { OutputMessage, Segment } from './types';

/**
 * 输出收集器 - 引擎内部的输出缓冲
 *
 * 收集所有 OutputMessage，供渲染器批量消费。
 * 同时作为命令链处理期间的输出缓冲。
 */
export class OutputCollector {
  private messages: OutputMessage[] = [];

  /**
   * 发送叙事文本
   */
  narrative(segments: Segment[]): void {
    this.messages.push({
      kind: 'narrative',
      segments,
    });
  }

  /**
   * 发送系统消息
   */
  system(segments: Segment[]): void {
    this.messages.push({
      kind: 'system',
      segments,
    });
  }

  /**
   * 发送错误消息
   */
  error(text: string): void {
    this.messages.push({
      kind: 'error',
      segments: [{ text }],
    });
  }

  /**
   * 发送对话
   */
  dialogue(segments: Segment[]): void {
    this.messages.push({
      kind: 'dialogue',
      segments,
    });
  }

  /**
   * 发送标题
   */
  title(text: string): void {
    this.messages.push({
      kind: 'title',
      segments: [{ text }],
    });
  }

  /**
   * 发送提示
   */
  prompt(text: string): void {
    this.messages.push({
      kind: 'prompt',
      segments: [{ text }],
    });
  }

  /**
   * 发送状态
   */
  status(data: unknown): void {
    this.messages.push({
      kind: 'status',
      segments: [{ text: JSON.stringify(data) }],
      meta: data as { entity?: string; action?: string },
    });
  }

  /**
   * 获取所有收集的消息
   */
  getAll(): OutputMessage[] {
    return [...this.messages];
  }

  /**
   * 按类型过滤消息
   */
  ofKind(kind: OutputMessage['kind']): OutputMessage[] {
    return this.messages.filter(m => m.kind === kind);
  }

  /**
   * 获取最后一条消息
   */
  last(): OutputMessage | undefined {
    return this.messages[this.messages.length - 1];
  }

  /**
   * 清空收集器
   */
  clear(): void {
    this.messages = [];
  }

  /**
   * 获取消息数量
   */
  get count(): number {
    return this.messages.length;
  }
}

/**
 * 创建快捷段落构造函数
 */
export function s(text: string): Segment {
  return { text };
}

export function seg(
  text: string,
  style?: Segment['style'] & { entityRef?: string }
): Segment {
  return {
    text,
    style: style ? { color: style.color, bold: style.bold, italic: style.italic, tag: style.tag } : undefined,
    entityRef: style?.entityRef,
  };
}