// 核心
export { EntityManager } from './core/entity';
export { World } from './core/world';
export { trait, relation, deterministicId } from './core/trait';
export type { RelationDefinition, RelationData } from './core/trait';
export { blueprint, spawnBlueprint } from './core/blueprint';
export type {
  EntityBlueprint,
  BlueprintComponent,
  BlueprintComponentInput,
  BlueprintPatch,
  SpawnOptions,
} from './core/blueprint';
export { Name } from './core/name';
export { ENGINE_VERSION } from './version';
export type { Entity, EntityId, ComponentDefinition, ComponentId, ComponentDataTuple, EventToken } from './core/types';

// 事件
export { defineEvent } from './events/define-event';
export { EventPump } from './events/event-pump';
export type { SystemErrorRecord, ScheduledEventHandle } from './events/event-pump';
export type { EventDefinition, EventHandler, EventPayload, EventContext, TypedEmit } from './events/types';

// 系统
export { defineSystem } from './systems/define-system';
export type { SystemDefinition, SystemContext, OutputView } from './systems/types';

// 命令
export { defineCommand } from './commands/define-command';
export {
  createDeveloperCommands,
  registerDeveloperKit,
  DeveloperEffectSystem,
  DevTeleported,
  DevHealed,
} from './commands/developer';
export type { CommandDefinition, CommandContext, ArgumentDefinition, AnyCommand, ParsedArgs, ParsedArgValue } from './commands/types';

// 输出
export { OutputCollector, s, seg } from './output/output-collector';
export { renderAnsi, renderSemanticHtml, renderPlainText } from './output/render';
export type { AnsiRenderOptions } from './output/render';
export type { OutputMessage, Segment, OutputKind, SemanticColor, SegmentTag } from './output/types';

// 持久化（FsBackend 已拆至 @mud/ecs-engine/node 子路径——0.12 breaking，
// 主入口保持浏览器可安全引用）
export { SavePort, LocalStorageBackend } from './persistence/save-port';
export type { SnapshotData, SnapshotMigration, SaveBackend } from './persistence/types';

// 测试工具
export { createTestWorld, TestWorld, ManualClock } from './testing/index';
export { record, replay, verifyReplay, WorldRecorder, firstDiff } from './debug/recorder';
export { TICK_TOKEN } from './core/world';
export { EntityDestroyed } from './events/entity-destroyed';
export type { Recording, RecordedOp, ReplayResult } from './debug/recorder';

// 对话与 NPC（0.3-B）
export { Dialogue, Memory, defineDialogue, DialogueTalk, DialogueChoose, DialogueChoiceMade } from './dialogue/traits';
export type { DialogueData, DialogueNode, DialogueOption, MemoryData } from './dialogue/traits';
export { DialogueSystem } from './dialogue/system';
export { createDialogueCommands } from './dialogue/commands';