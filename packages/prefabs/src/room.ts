/**
 * 房间定义与坐标推断（v0.8-A）
 *
 * 房间是最后一个没有 `define*` 封装的领域对象——本模块补上：
 * - `defineRoom`：纯数据定义（可 JSON、进快照）
 * - `layoutRooms`：**定义期**从 `Exits` 拓扑推断二维坐标，冲突一律 fail-fast
 * - `buildRooms`：注入世界（Name/Description/Exits/Coordinates）
 *
 * 单一真相铁律：`Exits` 是拓扑真相，坐标是**派生产物**。
 * 推断在定义期完成而非运行时——冲突在启动阶段就炸，运行时零开销、零非确定性。
 */
import type { World, EntityId } from '@mud/ecs-engine';
import { Name } from '@mud/ecs-engine';
import { Exits, Description, Coordinates, Position, Visited } from './traits.js';

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

export interface RoomDef {
  id: string;
  name: string;
  aliases?: string[];
  description: string;
  /** 方向 → 房间 id（拓扑的唯一真相） */
  exits: Record<string, string>;
  /** 可选：显式钉住坐标（非欧空间 escape hatch），必须与推断一致 */
  coords?: { x: number; y: number };
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
}

export interface LayoutResult {
  entry: string;
  /** 与输入同序（注入与渲染顺序稳定 ⇒ 确定性） */
  rooms: LayoutRoom[];
}

/** 房间定义：校验 + 返回纯数据 */
export function defineRoom(def: RoomDef): RoomDef {
  if (!def.id) throw new Error('defineRoom: 房间 id 不能为空');
  if (!def.name) throw new Error('defineRoom: 房间 name 不能为空');
  return {
    id: def.id,
    name: def.name,
    aliases: def.aliases,
    description: def.description,
    exits: { ...def.exits },
    coords: def.coords ? { ...def.coords } : undefined,
  };
}

/**
 * 布局：BFS 从入口铺开，为四方向可达的房间推断坐标
 *
 * 冲突全部 fail-fast（带房间 id 的明确错误）——静默兜底会让作者
 * 在画到第十个房间时才发现地图像鬼画符。
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

  const entryCoords = opts.entryCoords ?? { x: 0, y: 0 };
  const checkReverse = opts.checkReverseExits ?? true;

  // 钉住显式坐标（含入口）
  const coords = new Map<string, { x: number; y: number }>();
  const explicit = new Set<string>();
  /** 格子占用表："x,y" → 房间 id（图必须能嵌入平面：一格只能一个房间） */
  const occupied = new Map<string, string>();
  const key = (c: { x: number; y: number }) => `${c.x},${c.y}`;
  const pin = (id: string, c: { x: number; y: number }) => {
    const owner = occupied.get(key(c));
    if (owner) {
      throw new Error(`layoutRooms: 显式坐标重叠：${owner} 与 ${id} 都在 (${c.x},${c.y})`);
    }
    occupied.set(key(c), id);
    coords.set(id, { ...c });
    explicit.add(id);
  };

  const entryDef = byId.get(opts.entry)!;
  if (
    entryDef.coords &&
    (entryDef.coords.x !== entryCoords.x || entryDef.coords.y !== entryCoords.y)
  ) {
    throw new Error(
      `layoutRooms: 显式坐标与推断不一致：入口 ${opts.entry} 声明 ` +
        `(${entryDef.coords.x},${entryDef.coords.y})，entryCoords 为 (${entryCoords.x},${entryCoords.y})`,
    );
  }
  pin(opts.entry, entryCoords);
  for (const def of defs) {
    if (def.id === opts.entry) continue;
    if (def.coords) pin(def.id, def.coords);
  }

  // BFS：所有边参与可达性，仅四方向边参与坐标推断
  const reached = new Set<string>([opts.entry]);
  const queue: string[] = [opts.entry];
  while (queue.length > 0) {
    const cur = queue.shift()!;
    const curDef = byId.get(cur)!;
    const curCoords = coords.get(cur); // undefined：非四方向可达、无坐标

    for (const [dir, target] of Object.entries(curDef.exits)) {
      // 反向出口自洽：对端若声明了指回本房间的**四方向**边，方向必须是 opposite。
      // （只看 opposite 一个方向抓不住「A east→B，B 也 east→A」这种写反的手滑）
      const opposite = OPPOSITE[dir];
      if (checkReverse && opposite) {
        const back = Object.entries(byId.get(target)!.exits)
          .filter(([d, t]) => t === cur && OPPOSITE[d])
          .map(([d]) => d);
        if (back.length > 0 && !back.includes(opposite)) {
          throw new Error(
            `layoutRooms: 反向出口不自洽：${cur} -${dir}-> ${target}，` +
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
              `layoutRooms: 坐标冲突：${cur} -${dir}-> ${target} 落在 (${next.x},${next.y})，` +
                `但该坐标已被 ${owner} 占用（图无法嵌入平面）`,
            );
          }
          occupied.set(key(next), target);
          coords.set(target, next);
        } else if (known.x !== next.x || known.y !== next.y) {
          if (explicit.has(target)) {
            throw new Error(
              `layoutRooms: 显式坐标与推断不一致：${target} 声明 (${known.x},${known.y})，` +
                `但从 ${cur} -${dir}-> 推断为 (${next.x},${next.y})`,
            );
          }
          throw new Error(
            `layoutRooms: 坐标冲突：${cur} -${dir}-> ${target} 推断为 (${next.x},${next.y})，` +
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

  for (const def of defs) {
    if (!reached.has(def.id)) {
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

/** 把布局注入世界：每个房间成为一个实体（Name/Description/Exits/Coordinates） */
export function buildRooms(world: World, layout: LayoutResult): void {
  for (const room of layout.rooms) {
    const id = world.entities.createWithId(room.id as EntityId);
    world.entities.addComponent(id, Name, { text: room.name, aliases: room.aliases ?? [] });
    world.entities.addComponent(id, Description, { text: room.description });
    world.entities.addComponent(id, Exits, { ...room.exits });
    if (room.coords) {
      world.entities.addComponent(id, Coordinates, { ...room.coords });
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
