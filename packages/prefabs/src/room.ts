/**
 * 房间布局、坐标推断与地图渲染（v0.8-A，v0.9-B 抽出可复用的平面推断）
 *
 * - `layoutRooms`：**定义期**从 `Exits` 拓扑推断二维坐标，冲突一律 fail-fast
 * - `buildRooms`：注入世界（Name/Description/Exits/Coordinates/Area）
 * - `inferPlane`：把一张「节点 + 出口」图铺进二维平面的通用 BFS
 *   （房间图与区域图同构，所以只写一次——见 `area.ts` 的 `layoutWorld`）
 * - `renderAsciiMap`：ASCII 地图（纯函数，逐行可断言）
 *
 * 单一真相铁律：`Exits` 是拓扑真相，坐标是**派生产物**。
 * 推断在定义期完成而非运行时——冲突在启动阶段就炸，运行时零开销、零非确定性。
 *
 * 房间**模块定义**（`defineRoom`、`RoomDef`）在 `behavior.ts`：一个房间是
 * 数据 + 行为，两边合起来才是 v0.9 的房间。
 */
import type { World, EntityId } from '@mud/ecs-engine';
import { Name } from '@mud/ecs-engine';
import { Exits, Description, Coordinates, Position, Visited, Area, areaEntityId } from './traits.js';
import type { RoomDef } from './behavior.js';


/** 四方向偏移（屏幕坐标系：north 为 y-1） */
const DIRS: Record<string, { x: number; y: number }> = {
  north: { x: 0, y: -1 },
  south: { x: 0, y: 1 },
  east: { x: 1, y: 0 },
  west: { x: -1, y: 0 },
};

/** 反向方向（拓扑自洽检查用） */
const OPPOSITE: Record<string, string> = {
  north: 'south',
  south: 'north',
  east: 'west',
  west: 'east',
};

export { DIRS as DIRECTION_OFFSETS, OPPOSITE as OPPOSITE_DIRECTION };

export type { RoomDef };

/** 平面推断的节点：id + 出口 + 可选显式坐标 */
export interface PlaneNode {
  id: string;
  exits: Record<string, string>;
  coords?: { x: number; y: number };
}

export interface InferPlaneOptions {
  /** 锚点节点 id（坐标系原点） */
  entry: string;
  /** 锚点坐标，默认 (0,0) */
  entryCoords?: { x: number; y: number };
  /** 反向出口自洽检查，默认 true */
  checkReverseExits?: boolean;
  /** 报错文案里的对象名（"房间"/"区域"），让错误信息读得懂 */
  label: string;
  /** 参与推断的节点集合（必须与 `entry` 同图；用于反向出口检查时查表） */
  nodes: PlaneNode[];
}

/**
 * 平面推断：BFS 从锚点铺开，为四方向可达的节点算出二维坐标
 *
 * 房间图与区域图**同构**（都是「节点 + 方向出口」），所以这段 BFS 只写一次。
 * 冲突全部 fail-fast（带节点 id 的明确错误）——静默兜底会让作者在画到第十个
 * 房间时才发现地图像鬼画符。
 *
 * 非四方向边（up/down/enter 之类）只参与可达性，不参与坐标推断：
 * 二维平面装不下它们（它们正是"该另开一个区域"的信号，见 `layoutWorld`）。
 *
 * @returns 节点 id → 坐标（只有四方向可达的节点在内）
 */
export function inferPlane(
  nodes: PlaneNode[],
  opts: InferPlaneOptions,
): Map<string, { x: number; y: number }> {
  const byId = new Map<string, PlaneNode>();
  for (const node of nodes) {
    byId.set(node.id, node);
  }
  if (!byId.has(opts.entry)) {
    throw new Error(`inferPlane: ${opts.label}锚点不存在：${opts.entry}`);
  }

  const entryCoords = opts.entryCoords ?? { x: 0, y: 0 };
  const checkReverse = opts.checkReverseExits ?? true;
  const L = opts.label;

  // 钉住显式坐标（含锚点）
  const coords = new Map<string, { x: number; y: number }>();
  const explicit = new Set<string>();
  /** 格子占用表："x,y" → 节点 id（图必须能嵌入平面：一格只能一个节点） */
  const occupied = new Map<string, string>();
  const key = (c: { x: number; y: number }) => `${c.x},${c.y}`;
  const pin = (id: string, c: { x: number; y: number }) => {
    const owner = occupied.get(key(c));
    if (owner) {
      throw new Error(
        `inferPlane: ${L}显式坐标重叠：${owner} 与 ${id} 都在 (${c.x},${c.y})`,
      );
    }
    occupied.set(key(c), id);
    coords.set(id, { ...c });
    explicit.add(id);
  };

  const entryNode = byId.get(opts.entry)!;
  if (
    entryNode.coords &&
    (entryNode.coords.x !== entryCoords.x || entryNode.coords.y !== entryCoords.y)
  ) {
    throw new Error(
      `inferPlane: ${L}显式坐标与推断不一致：锚点 ${opts.entry} 声明 ` +
        `(${entryNode.coords.x},${entryNode.coords.y})，entryCoords 为 (${entryCoords.x},${entryCoords.y})`,
    );
  }
  pin(opts.entry, entryCoords);
  for (const node of nodes) {
    if (node.id === opts.entry) continue;
    if (node.coords) pin(node.id, node.coords);
  }

  // BFS：所有边参与可达性，仅四方向边参与坐标推断
  const reached = new Set<string>([opts.entry]);
  const queue: string[] = [opts.entry];
  while (queue.length > 0) {
    const cur = queue.shift()!;
    const curNode = byId.get(cur)!;
    const curCoords = coords.get(cur); // undefined：非四方向可达、无坐标

    for (const [dir, target] of Object.entries(curNode.exits)) {
      const opposite = OPPOSITE[dir];
      if (checkReverse && opposite) {
        const back = Object.entries(byId.get(target)?.exits ?? {})
          .filter(([d, t]) => t === cur && OPPOSITE[d])
          .map(([d]) => d);
        if (back.length > 0 && !back.includes(opposite)) {
          throw new Error(
            `inferPlane: ${L}反向出口不自洽：${cur} -${dir}-> ${target}，` +
              `但 ${target} 用 ${back.map((d) => `-${d}->`).join('')} 指回 ${cur}` +
              `（应为 -${opposite}->）`,
          );
        }
      }

      const d = DIRS[dir];
      if (d && curCoords) {
        const next = { x: curCoords.x + d.x, y: curCoords.y + d.y };
        const known = coords.get(target);
        if (known === undefined) {
          const owner = occupied.get(key(next));
          if (owner && owner !== target) {
            throw new Error(
              `inferPlane: ${L}坐标冲突：${cur} -${dir}-> ${target} 落在 (${next.x},${next.y})，` +
                `但该坐标已被 ${owner} 占用（图无法嵌入平面）`,
            );
          }
          occupied.set(key(next), target);
          coords.set(target, next);
        } else if (known.x !== next.x || known.y !== next.y) {
          if (explicit.has(target)) {
            throw new Error(
              `inferPlane: ${L}显式坐标与推断不一致：${target} 声明 (${known.x},${known.y})，` +
                `但从 ${cur} -${dir}-> 推断为 (${next.x},${next.y})`,
            );
          }
          throw new Error(
            `inferPlane: ${L}坐标冲突：${cur} -${dir}-> ${target} 推断为 (${next.x},${next.y})，` +
              `而 ${target} 已定为 (${known.x},${known.y})`,
          );
        }
      }

      if (!reached.has(target)) {
        reached.add(target);
        queue.push(target);
      }
    }
  }

  return coords;
}

export interface LayoutOptions {
  /** 入口房间 id（必填：坐标系锚点） */
  entry: string;
  /** 入口坐标，默认 (0,0) */
  entryCoords?: { x: number; y: number };
  /** 反向出口自洽检查，默认 true */
  checkReverseExits?: boolean;
}

export interface LayoutRoom extends RoomDef {
  /** 推断结果；跨层/非欧可达的房间没有坐标（二维平面装不下） */
  coords?: { x: number; y: number };
  /** 归属区域（v0.9-B；无区域的世界为 undefined） */
  area?: string;
}

export interface LayoutResult {
  entry: string;
  /** 与输入同序（注入与渲染顺序稳定 ⇒ 确定性） */
  rooms: LayoutRoom[];
}

/**
 * 布局：BFS 从入口铺开，为四方向可达的房间推断坐标
 *
 * 平面推断本身在 `inferPlane`（区域图复用同一段 BFS），这里只做房间的
 * 前置校验：重复定义、悬空出口、孤岛房间。
 */
export function layoutRooms(defs: RoomDef[], opts: LayoutOptions): LayoutResult {
  const byId = new Map<string, RoomDef>();
  for (const def of defs) {
    if (byId.has(def.id)) throw new Error(`layoutRooms: 房间定义重复：${def.id}`);
    byId.set(def.id, def);
  }
  if (!byId.has(opts.entry)) throw new Error(`layoutRooms: 入口房间不存在：${opts.entry}`);

  for (const def of defs) {
    for (const [dir, target] of Object.entries(def.exits)) {
      if (!byId.has(target)) {
        throw new Error(`layoutRooms: 悬空出口：${def.id} -${dir}-> 未知房间 ${target}`);
      }
    }
  }

  const coords = inferPlane(defs, {
    entry: opts.entry,
    entryCoords: opts.entryCoords,
    checkReverseExits: opts.checkReverseExits,
    label: '房间',
    nodes: defs,
  });

  for (const def of defs) {
    if (!isReachable(defs, opts.entry, def.id)) {
      throw new Error(`layoutRooms: 孤岛房间：${def.id}（从入口 ${opts.entry} 不可达）`);
    }
  }

  return {
    entry: opts.entry,
    rooms: defs.map((def) => {
      const c = coords.get(def.id);
      return { ...def, coords: c ? { ...c } : undefined };
    }),
  };
}

/** 可达性（所有边都算，含 up/down 这类非四方向边） */
export function isReachable(nodes: PlaneNode[], from: string, to: string): boolean {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  if (!byId.has(from) || !byId.has(to)) return false;
  const seen = new Set<string>([from]);
  const queue = [from];
  while (queue.length > 0) {
    const cur = queue.shift()!;
    if (cur === to) return true;
    for (const target of Object.values(byId.get(cur)?.exits ?? {})) {
      if (!seen.has(target)) {
        seen.add(target);
        queue.push(target);
      }
    }
  }
  return false;
}

/**
 * 把布局注入世界：每个房间成为一个实体（Name/Description/Exits/Coordinates/Area）
 *
 * 房间有 `area` 时挂上 `Area` 组件（`layoutWorld` 会填它）——区域是实体，
 * 所以能带自己的状态（天气、危险度、封禁）并进快照/fork/回滚。
 */
export function buildRooms(world: World, layout: { rooms: LayoutRoom[] }): void {
  for (const room of layout.rooms) {
    const id = world.entities.createWithId(room.id as EntityId);
    world.entities.addComponent(id, Name, { text: room.name, aliases: room.aliases ?? [] });
    world.entities.addComponent(id, Description, { text: room.description });
    world.entities.addComponent(id, Exits, { ...room.exits });
    if (room.coords) {
      world.entities.addComponent(id, Coordinates, { ...room.coords });
    }
    if (room.area) {
      world.entities.addComponent(id, Area, { id: areaEntityId(room.area) });
    }
  }
}

export interface MapRenderOptions {
  /** 入口房间（标 `S`；内容层自定义命令时才用得上——世界不存"谁是入口"） */
  entry?: string;
  /** 当前所在房间（标 `@`，覆盖 `S`/`·`） */
  current?: string;
  /** 已探明房间；不传 = 渲染全图 */
  visited?: string[];
}

/**
 * ASCII 地图渲染（纯函数：同输入 ⇒ 同字符串，可直接断言每一行）
 *
 * 网格：房间占 `(2x, 2y)`，连线占其间的奇数格。
 * 迷雾规则：只画已探明房间，且**连线两端都探明才画**——
 * 从已探明房间指向未知房间的连线会泄漏邻接信息，不画。
 */
export function renderAsciiMap(
  rooms: Array<{ id: string; coords?: { x: number; y: number }; exits: Record<string, string> }>,
  opts: MapRenderOptions = {},
): string {
  const placed = rooms.filter((room) => room.coords);
  if (placed.length === 0) return '';

  const visible = opts.visited
    ? new Set(opts.visited)
    : new Set(placed.map((room) => room.id));

  const xs = placed.map((room) => room.coords!.x);
  const ys = placed.map((room) => room.coords!.y);
  const x0 = Math.min(...xs);
  const y0 = Math.min(...ys);
  const W = 2 * (Math.max(...xs) - x0) + 1;
  const H = 2 * (Math.max(...ys) - y0) + 1;
  const grid: string[][] = Array.from({ length: H }, () => Array(W).fill(' '));
  const gx = (c: { x: number; y: number }) => 2 * (c.x - x0);
  const gy = (c: { x: number; y: number }) => 2 * (c.y - y0);
  const put = (x: number, y: number, char: string) => {
    const row = grid[y];
    if (row) row[x] = char;
  };

  for (const room of placed) {
    if (!visible.has(room.id)) continue;
    const char = room.id === opts.current ? '@' : room.id === opts.entry ? 'S' : '·';
    put(gx(room.coords!), gy(room.coords!), char);
  }

  for (const room of placed) {
    if (!visible.has(room.id)) continue;
    for (const [dir, target] of Object.entries(room.exits)) {
      const d = DIRS[dir];
      if (!d || !visible.has(target)) continue;
      const neighbor = placed.find((other) => other.id === target);
      if (!neighbor) continue;
      put(gx(room.coords!) + d.x, gy(room.coords!) + d.y, d.x !== 0 ? '—' : '│');
    }
  }

  // 坐标系按**全图**定 bounds（房间的相对位置必须固定，否则地图会随探索跳动），
  // 只裁掉尾部空行——中间的空白行要保留，那是未探明区域
  return grid
    .map((row) => row.join('').replace(/\s+$/, ''))
    .join('\n')
    .replace(/\s+$/, '');
}

/**
 * 记一次探索（seed 用：玩家的初始位置没有 `Moved` 事件可订阅）
 *
 * 没挂 `Visited` 的实体直接忽略——系统不能替内容补组件。
 */
export function markVisited(world: World, entity: EntityId, roomId?: EntityId): void {
  const visited = world.entities.getComponent(entity, Visited);
  if (!visited) return;
  const room = roomId ?? world.entities.getComponent(entity, Position)?.roomId;
  if (!room) return;
  if (!visited.rooms.includes(room)) visited.rooms.push(room);
}
