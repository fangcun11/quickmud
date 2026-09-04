/**
 * 区域层（v0.9-B）—— 房间之上的一级：Area
 *
 * ## 为什么要有区域
 *
 * 房间是二维平面上的一个格子，但 MUD 的世界不是一张平面图：
 * 洞穴在森林脚下、塔顶要爬楼梯、船要出海。**跨层连接（up/down/enter）
 * 装不进二维平面**——v0.8 里这类房间直接拿不到坐标，地图上凭空消失。
 *
 * 区域就是"一张二维平面"：每个区域有自己的坐标系，区域之间是另一张图。
 * 于是跨层房间各归各的区域，各自拿到坐标，v0.8 的边界自然消失。
 *
 * ## 单一真相：区域不抄任何东西
 *
 * - 房间声明 `area`，区域**不**维护 `rooms` 数组（谁属于哪个区域是查出来的）
 * - 区域的出口拓扑由**跨区域的房间出口反推**，作者不手写（手写就等于同一份
 *   拓扑存两处，改房间忘改区域 = 世界地图和房间地图对不上）
 * - 区域的坐标与房间同款 BFS 推断（`inferPlane` 复用，房间图与区域图同构）
 *
 * ## 区域是实体，不是字符串标签
 *
 * 区域能带组件 ⇒ 能带状态（天气、危险度、封禁），进快照 / fork / 回滚。
 * 字符串标签做不到这些。
 */
import type { World, EntityId } from '@mud/ecs-engine';
import { Name } from '@mud/ecs-engine';
import { Exits, Description, Coordinates, Area, areaEntityId } from './traits.js';
import type { RoomDef } from './behavior.js';
import type { LayoutOptions, LayoutResult, LayoutRoom, PlaneNode } from './room.js';
import { inferPlane, isReachable, renderAsciiMap } from './room.js';
import type { MapRenderOptions } from './room.js';
import { DIRECTION_OFFSETS } from './room.js';
import type { WorldQuery } from './queries.js';
import { containerOf } from './queries.js';

/** 区域定义：只有数据，拓扑全靠房间反推 */
export interface AreaDef {
  id: string;
  name: string;
  aliases?: string[];
  description?: string;
  /** 可选：显式钉住区域坐标（默认从入口区域 BFS 推断） */
  coords?: { x: number; y: number };
}

/** 区域定义：校验 + 返回纯数据 */
export function defineArea(def: AreaDef): AreaDef {
  if (!def.id) throw new Error('defineArea: 区域 id 不能为空');
  if (!def.name) throw new Error('defineArea: 区域 name 不能为空');
  return {
    id: def.id,
    name: def.name,
    aliases: def.aliases,
    description: def.description,
    coords: def.coords ? { ...def.coords } : undefined,
  };
}

/** 布局后的区域：坐标与出口都是**推断产物** */
export interface LayoutArea extends AreaDef {
  coords?: { x: number; y: number };
  /** 方向 → 区域 id（由跨区域房间出口反推；只有四方向边，地图上画得出来的那些） */
  exits: Record<string, string>;
}

export interface WorldLayoutOptions extends LayoutOptions {
  /** 区域定义；不传 = 无区域世界（v0.8 行为：所有房间共用一张平面） */
  areas?: AreaDef[];
  /** 默认区域：房间未声明 `area` 时的归属（不传则每个房间都必须声明） */
  entryArea?: string;
}

export interface WorldLayoutResult extends LayoutResult {
  /** 无区域世界为空数组 */
  areas: LayoutArea[];
  /** 入口区域 id；无区域世界为 undefined */
  entryArea?: string;
}

/** 房间 id → 区域 id 的查询结果 */
export type RoomAreaMap = Map<string, string>;

/**
 * 世界布局：房间坐标（分区域）+ 区域拓扑与坐标
 *
 * 校验（全部 fail-fast，错误里带 id）：
 * | 检查 | 说明 |
 * | --- | --- |
 * | 重复 / 悬空 / 出口不自洽 | 与 `layoutRooms` 同款 |
 * | 区域不存在 | 房间的 `area` 指向没声明的区域 |
 * | 空区域 | 没有任何房间属于它 |
 * | 孤岛房间 | 从入口不可达（跨区域边也算连通） |
 * | 区内孤岛房间 | 同区域内从锚点走不到——八成是 `area` 标错了 |
 * | 孤岛区域 | 从入口区域走不到 |
 * | 区域出口冲突 | 同一区域同一方向通向两个不同区域（一张平面装不下，得合并或改用 up/down） |
 */
export function layoutWorld(rooms: RoomDef[], opts: WorldLayoutOptions): WorldLayoutResult {
  // 无区域世界：退化成 v0.8 的单一平面（rooms[].area 全为 undefined）
  if (!opts.areas || opts.areas.length === 0) {
    const base = layoutRoomsCompat(rooms, opts);
    return { ...base, areas: [] };
  }

  const areas = opts.areas;

  // ---- 区域表 ----
  const areasById = new Map<string, AreaDef>();
  for (const area of areas) {
    if (areasById.has(area.id)) throw new Error(`layoutWorld: 区域定义重复：${area.id}`);
    areasById.set(area.id, area);
  }

  const roomsById = new Map(rooms.map((r) => [r.id, r]));
  if (!roomsById.has(opts.entry)) {
    throw new Error(`layoutWorld: 入口房间不存在：${opts.entry}`);
  }

  // ---- 入口区域 ----
  if (opts.entryArea !== undefined && !areasById.has(opts.entryArea)) {
    throw new Error(`layoutWorld: 入口区域不存在：${opts.entryArea}`);
  }
  const entryArea = opts.entryArea ?? roomsById.get(opts.entry)?.area;
  if (entryArea === undefined) {
    throw new Error(
      `layoutWorld: 入口房间 ${opts.entry} 未声明 area，且未指定 entryArea（无法锚定区域坐标系）`,
    );
  }
  if (!areasById.has(entryArea)) {
    throw new Error(`layoutWorld: 入口区域不存在：${entryArea}`);
  }

  // ---- 房间去重 / 悬空出口 ----
  if (roomsById.size !== rooms.length) {
    const seen = new Set<string>();
    for (const r of rooms) {
      if (seen.has(r.id)) throw new Error(`layoutWorld: 房间定义重复：${r.id}`);
      seen.add(r.id);
    }
  }
  for (const room of rooms) {
    for (const [dir, target] of Object.entries(room.exits)) {
      if (!roomsById.has(target)) {
        throw new Error(`layoutWorld: 悬空出口：${room.id} -${dir}-> 未知房间 ${target}`);
      }
    }
  }

  // ---- 房间归属（不抄反表：谁属于哪个区域永远是查出来的）----
  const areaOfRoom = new Map<string, string>();
  for (const room of rooms) {
    const areaId = room.area ?? opts.entryArea;
    if (areaId === undefined) {
      throw new Error(
        `layoutWorld: 房间 ${room.id} 未声明 area，且未指定 entryArea 作默认区域`,
      );
    }
    if (!areasById.has(areaId)) {
      throw new Error(`layoutWorld: 房间 ${room.id} 的区域不存在：${areaId}`);
    }
    areaOfRoom.set(room.id, areaId);
  }

  // ---- 空区域（纯成员事实，先于一切拓扑检查报出）----
  const usedAreas = new Set(areaOfRoom.values());
  for (const area of areas) {
    if (!usedAreas.has(area.id)) {
      throw new Error(`layoutWorld: 空区域：${area.id}（没有任何房间属于它）`);
    }
  }

  // ---- 反推区域出口（只收四方向边：它们是地图上画得出来的连接）----
  const areaExits = new Map<string, Record<string, string>>();
  const exitOwner = new Map<string, string>();
  for (const area of areas) areaExits.set(area.id, {});

  /** 全量跨区域邻接（含 up/down），只用于区域连通性检查 */
  const areaAdjacency = new Map<string, string[]>();
  const link = (from: string, to: string) => {
    const list = areaAdjacency.get(from) ?? [];
    if (!list.includes(to)) list.push(to);
    areaAdjacency.set(from, list);
  };

  for (const room of rooms) {
    const from = areaOfRoom.get(room.id)!;
    for (const [dir, target] of Object.entries(room.exits)) {
      const to = areaOfRoom.get(target)!;
      if (from === to) continue;
      link(from, to);

      if (!DIRECTION_OFFSETS[dir]) continue; // 非四方向边：连通但不进平面
      const table = areaExits.get(from)!;
      const prev = table[dir];
      if (prev !== undefined && prev !== to) {
        throw new Error(
          `layoutWorld: 区域出口冲突：区域 ${from} 的 -${dir}-> 既通向 ${prev}` +
            `（来自房间 ${exitOwner.get(`${from}|${dir}`)}）又通向 ${to}（来自房间 ${room.id}）。` +
            `一个区域在平面里只占一格，同方向只能通向一个区域——把它们合并，或改用 up/down 之类的跨层方向`,
        );
      }
      table[dir] = to;
      exitOwner.set(`${from}|${dir}`, room.id);
    }
  }

  // ---- 区域坐标 / 孤岛区域 ----
  const areaNodes: PlaneNode[] = areas.map((a) => ({
    id: a.id,
    exits: areaExits.get(a.id) ?? {},
    coords: a.coords,
  }));
  const entryAreaDef = areasById.get(entryArea)!;
  const areaCoords = inferPlane(areaNodes, {
    entry: entryArea,
    entryCoords: entryAreaDef.coords ?? { x: 0, y: 0 },
    checkReverseExits: opts.checkReverseExits,
    label: '区域',
    nodes: areaNodes,
  });
  for (const area of areas) {
    if (!isReachableAcross(areaAdjacency, entryArea, area.id)) {
      throw new Error(
        `layoutWorld: 孤岛区域：${area.id}（从入口区域 ${entryArea} 走不到）`,
      );
    }
  }

  // ---- 各区域内的房间坐标（每张区域平面独立铺开）----
  const roomCoords = new Map<string, { x: number; y: number }>();
  for (const area of areas) {
    const members = rooms.filter((r) => areaOfRoom.get(r.id) === area.id);
    // 锚点：入口房间若在本区域就用它（它钉在 entryCoords），否则取输入序第一个
    const anchor = members.some((m) => m.id === opts.entry)
      ? opts.entry
      : members[0]!.id;
    const anchorDef = roomsById.get(anchor)!;
    const anchorCoords =
      area.id === entryArea && anchor === opts.entry
        ? (opts.entryCoords ?? { x: 0, y: 0 })
        : (anchorDef.coords ?? { x: 0, y: 0 });

    // 区内子图：只保留同区域的边（跨区域边属于区域图，不进本平面）
    const intraNodes: PlaneNode[] = members.map((m) => ({
      id: m.id,
      exits: Object.fromEntries(
        Object.entries(m.exits).filter(([, t]) => areaOfRoom.get(t) === area.id),
      ),
      coords: m.coords,
    }));

    const coords = inferPlane(intraNodes, {
      entry: anchor,
      entryCoords: anchorCoords,
      checkReverseExits: opts.checkReverseExits,
      label: '房间',
      nodes: intraNodes,
    });
    for (const [id, c] of coords) roomCoords.set(id, c);

    // 区内孤岛：八成是 area 标错了（同区域却在区内走不通）
    for (const m of intraNodes) {
      if (!isReachable(intraNodes, anchor, m.id)) {
        throw new Error(
          `layoutWorld: 区内孤岛房间：${m.id}（区域 ${area.id} 内从锚点 ${anchor} 走不到——` +
            `多半是 area 标错了，或者它其实属于另一个区域）`,
        );
      }
    }
  }

  // ---- 全局孤岛房间（跨区域边也算连通）----
  for (const room of rooms) {
    if (!isReachable(rooms, opts.entry, room.id)) {
      throw new Error(`layoutWorld: 孤岛房间：${room.id}（从入口 ${opts.entry} 不可达）`);
    }
  }

  return {
    entry: opts.entry,
    entryArea,
    rooms: rooms.map((room) => {
      const c = roomCoords.get(room.id);
      return { ...room, area: areaOfRoom.get(room.id), coords: c ? { ...c } : undefined };
    }),
    areas: areas.map((area) => {
      const c = areaCoords.get(area.id);
      return {
        ...area,
        exits: { ...(areaExits.get(area.id) ?? {}) },
        coords: c ? { ...c } : undefined,
      };
    }),
  };
}

/** 无区域世界：v0.8 的单一平面（内部用，避免与 layoutRooms 相互 import） */
function layoutRoomsCompat(rooms: RoomDef[], opts: LayoutOptions): LayoutResult {
  const byId = new Map<string, RoomDef>();
  for (const def of rooms) {
    if (byId.has(def.id)) throw new Error(`layoutWorld: 房间定义重复：${def.id}`);
    byId.set(def.id, def);
  }
  if (!byId.has(opts.entry)) throw new Error(`layoutWorld: 入口房间不存在：${opts.entry}`);
  for (const def of rooms) {
    for (const [dir, target] of Object.entries(def.exits)) {
      if (!byId.has(target)) {
        throw new Error(`layoutWorld: 悬空出口：${def.id} -${dir}-> 未知房间 ${target}`);
      }
    }
  }

  const coords = inferPlane(rooms, {
    entry: opts.entry,
    entryCoords: opts.entryCoords,
    checkReverseExits: opts.checkReverseExits,
    label: '房间',
    nodes: rooms,
  });

  const out: LayoutRoom[] = rooms.map((def) => {
    const c = coords.get(def.id);
    return { ...def, coords: c ? { ...c } : undefined };
  });

  for (const def of rooms) {
    if (!isReachable(rooms, opts.entry, def.id)) {
      throw new Error(`layoutWorld: 孤岛房间：${def.id}（从入口 ${opts.entry} 不可达）`);
    }
  }
  return { entry: opts.entry, rooms: out };
}

/** 在邻接表上做可达性（跨区域边含 up/down，用不了 isReachable 的 PlaneNode 形态） */
function isReachableAcross(adj: Map<string, string[]>, from: string, to: string): boolean {
  const seen = new Set<string>([from]);
  const queue = [from];
  while (queue.length > 0) {
    const cur = queue.shift()!;
    if (cur === to) return true;
    for (const next of adj.get(cur) ?? []) {
      if (!seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
    }
  }
  return false;
}

/**
 * 把区域注入世界：每个区域成为一个实体（Name/Description/Exits/Coordinates）
 *
 * 区域实体用 `createWithId(area.id)`，与房间同款——`Area { id }` 直接指过去。
 * 区域是**实体**而非字符串标签，所以能挂自己的状态组件（天气、危险度、封禁），
 * 并随快照 / fork / 回滚一起走。
 */
export function buildAreas(world: World, layout: WorldLayoutResult): void {
  for (const area of layout.areas) {
    const id = world.entities.createWithId(areaEntityId(area.id));
    world.addComponent(id, Name, { text: area.name, aliases: area.aliases ?? [] });
    world.addComponent(id, Description, { text: area.description ?? '' });
    // 推断出的出口存的是区域定义 id；实体层的 Exits 与房间同款指实体 id
    world.addComponent(
      id,
      Exits,
      Object.fromEntries(
        Object.entries(area.exits).map(([dir, target]) => [dir, areaEntityId(target)]),
      ),
    );
    if (area.coords) {
      world.addComponent(id, Coordinates, { ...area.coords });
    }
  }
}

/** 可渲染的地图节点（区域与房间共用：都有 id / coords / exits） */
export type Mappable = {
  id: string;
  coords?: { x: number; y: number };
  exits: Record<string, string>;
};

/**
 * 世界地图（区域级）：画的是"区域与区域之间怎么连"
 *
 * 与房间图完全同构，所以直接复用 `renderAsciiMap`——不另写一套渲染。
 */
export function renderAsciiWorldMap(areas: Mappable[], opts: MapRenderOptions = {}): string {
  return renderAsciiMap(areas, opts);
}

/**
 * 查询口径：某个区域里有哪些房间
 *
 * 刻意**不维护反表**——"区域里有什么"永远是查出来的。反表是第二份真相，
 * 迟早和房间的 `area` 对不上。
 */
export function roomsOfArea(q: WorldQuery, areaId: EntityId): EntityId[] {
  return q.findByComponent(Area).filter((id) => q.getComponent(id, Area)?.id === areaId);
}

/** 实体当前所在区域（先查房间的 Area，没有就是无区域世界） */
export function areaOf(q: WorldQuery, entity: EntityId): EntityId | undefined {
  const room = containerOf(q, entity);
  return room ? q.getComponent(room, Area)?.id : undefined;
}
