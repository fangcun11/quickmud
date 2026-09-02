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
 * （原 OutputPort 接口为孤儿——无运行时消费者，仅类型声明，已删除。
 *  引擎的输出的实际形态是 OutputCollector + OutputMessage，见 output-collector.ts）
 */
