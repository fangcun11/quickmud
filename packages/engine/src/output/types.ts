import type { EntityId } from '../core/types';

/**
 * 输出消息类型
 */
export type OutputKind = 'narrative' | 'system' | 'error' | 'dialogue' | 'title' | 'prompt' | 'status';

/**
 * 语义颜色
 */
export type SemanticColor = 'red' | 'green' | 'yellow' | 'blue' | 'gray' | 'white' | 'cyan' | 'magenta';

/**
 * 标签类型
 */
export type SegmentTag = 'entity' | 'direction' | 'item' | 'hp' | 'keyword';

/**
 * 输出段
 */
export interface Segment {
  text: string;
  style?: {
    color?: SemanticColor;
    bold?: boolean;
    italic?: boolean;
    tag?: SegmentTag;
  };
  entityRef?: EntityId;
}

/**
 * 输出消息
 */
export interface OutputMessage {
  kind: OutputKind;
  segments: Segment[];
  meta?: {
    entity?: EntityId;
    action?: string;
  };
}

/**
 * 输出端口 - 引擎与渲染器的接口
 */
export interface OutputPort {
  /** 发送叙事文本 */
  narrative(segments: Segment[]): void;
  /** 发送系统消息 */
  system(segments: Segment[]): void;
  /** 发送错误消息 */
  error(text: string): void;
  /** 发送对话 */
  dialogue(segments: Segment[]): void;
  /** 发送标题 */
  title(text: string): void;
  /** 发送提示 */
  prompt(text: string): void;
  /** 发送状态 */
  status(data: unknown): void;
}