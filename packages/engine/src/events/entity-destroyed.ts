import { defineEvent } from './define-event';
import type { EntityId } from '../core/types';

/**
 * 实体销毁事件（0.14）
 *
 * 引擎合成事件：`entities.delete(id)` / `ctx.destroy(id)` 成功删除时
 * 由引擎自动发射，载荷为 `{ id }`。订阅它即可做死亡清场、引用清扫、
 * UI 移除等响应——"删除不级联"从已知边界升级为**可订阅契约**。
 *
 * 静默路径（绝不发射此事件）：
 * - `entities.clear()` —— 回滚 / fork / 读档的实体重建走 clear，
 *   状态恢复不是"销毁"，观察者不应感知。
 *
 * 事件分发时实体已不存在：处理器中 getComponent(id) 返回 undefined，
 * 需要临终数据的请在删除前自行读取（与 Bevy Despawned 只带 entity
 * 的语义一致——保持最小载荷，不加新机制）。
 */
export const EntityDestroyed = defineEvent('entity_destroyed')<{ id: EntityId }>();
