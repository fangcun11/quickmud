/**
 * 房间布局、坐标推断与地图渲染（v0.8-A，v0.9-B 抽出可复用的平面推断）
 *
 * - `layoutRooms`：**定义期**从 `Exits` 拓扑推断二维坐标，冲突一律 fail-fast
 * - `buildRooms`：注入世界（Name/Description/Exits/Coordinates/Area）
 * - `inferPlane`：把一张「节点 + 出口」图铺进二维平面的通用 BFS
 *   （房间图与区域图同构，所以只写一次——见 `area.ts` 的 `layoutWorld`）
 * - `renderAsciiMap`：地名地图（纯函数，逐行可断言；v0.12 起地名直书）
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
  up: 'down',
  down: 'up',
  in: 'out',
  out: 'in',
};

/**
 * 方向 id → 中文名（**只用于面向玩家的文案**）
 *
 * `Exits` 的键、命令动词、`MoveRequested.to` 一律是英文 id（机器真相），
 * 但把 id 直接拼进中文句子会吐出「你不能往up走。」——拿 id 当文案是懒。
 * 查不到就原样返回：自定义方向（比如 `enter`）不该因为这里缺表就变成空白。
 */
export const DIRECTION_LABELS: Record<string, string> = {
  north: '北',
  south: '南',
  east: '东',
  west: '西',
  up: '上',
  down: '下',
  in: '里',
  out: '外',
};

export { DIRS as DIRECTION_OFFSETS, OPPOSITE as OPPOSITE_DIRECTION };

/** 方向的中文名（未知方向退回 id 本身，宁可露 id 也不说空话） */
export function directionLabel(dir: string): string {
  return DIRECTION_LABELS[dir] ?? dir;
}

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
    world.addComponent(id, Name, { text: room.name, aliases: room.aliases ?? [] });
    world.addComponent(id, Description, { text: room.description });
    world.addComponent(id, Exits, { ...room.exits });
    if (room.coords) {
      world.addComponent(id, Coordinates, { ...room.coords });
    }
    if (room.area) {
      // Area 是关系（v0.10）：直写 targets，引擎自动维护反查索引
      world.addComponent(id, Area, { targets: [areaEntityId(room.area)] });
    }
  }
}

export interface MapNode {
  id: string;
  /** 地名直书（v0.12 地图改为「地名 + 连线」）；缺省退回 id */
  name?: string;
  coords?: { x: number; y: number };
  exits: Record<string, string>;
}

export interface MapRenderOptions {
  /** 当前所在房间/区域（名字后缀标 (你)） */
  current?: string;
  /** 已探明节点；不传 = 渲染全图 */
  visited?: string[];
}

/** 显示宽度：ASCII 与制表符号算 1，中文/全角/★ 算 2（等宽字体下的视觉列数） */
function displayWidth(text: string): number {
  let w = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    w += cp >= 0x2e80 || (cp >= 0x2600 && cp <= 0x27bf) ? 2 : 1;
  }
  return w;
}

/** 列间隙：` ─── `（空格 + 三横 + 空格） */
const H_GAP = 5;
const H_DASH = '─';
const V_LINE = '│';

/**
 * 地名地图渲染（纯函数：同输入 ⇒ 同字符串，可直接断言每一行）
 *
 * v0.12 起从符号网格（`@—·` + 图例）改为**地名直书**：每个地点画自己的
 * 名字，四方向连线标注方位，当前所在名字后缀标 `(你)`。连线只在两端都
 * 探明时画实线；指向未探明/图外（含跨区域）的出口画一小段**断线**——
 * 告诉玩家"这边还有路"，但看不清通向哪里。
 *
 * 布局是**约束排版**而非坐标网格：位置只由可见格子互相约束——同一 x 的
 * 格子共享中心（垂直线才能是一条直线），且每个格子以自己**完整显示名**
 * （含 `(你)` 标注）的中心对齐锚点，方向指示符相对玩家看到的整个名字
 * 居中；同一行相邻排布的两格之间至少留 ` ─── ` 的连线位；连线与东西
 * 断线**点对点贴着名字两端**画。迷雾外的格子不占位，地图随探索长出。
 * 行块之间夹一行放垂直连线；中文名按显示宽 2 列计。
 */
export function renderAsciiMap(nodes: MapNode[], opts: MapRenderOptions = {}): string {
  const placed = nodes.filter((node) => node.coords);
  if (placed.length === 0) return '';

  const visible = opts.visited ? new Set(opts.visited) : new Set(placed.map((n) => n.id));
  const vis = placed.filter((n) => visible.has(n.id));
  const label = (n: MapNode): string => (n.id === opts.current ? `${n.name ?? n.id}(你)` : n.name ?? n.id);

  // 可见格查询（迷雾外的房间对布局/连线/断线完全隐形）
  const at = (x: number, y: number): MapNode | undefined =>
    vis.find((n) => n.coords!.x === x && n.coords!.y === y);

  // ---- 行画布：视觉列 → 字符（宽字符占 2 格，第二格写空串占位）----
  const newRow = (): Map<number, string> => new Map();
  const writeText = (row: Map<number, string>, col: number, text: string) => {
    let i = col;
    for (const ch of text) {
      row.set(i, ch);
      if (displayWidth(ch) === 2) row.set(i + 1, '');
      i += displayWidth(ch);
    }
  };
  const putCell = (row: Map<number, string>, col: number, ch: string) => row.set(col, ch);
  const renderRow = (row: Map<number, string>, minCol: number): string => {
    let max = -1;
    for (const k of row.keys()) max = Math.max(max, k);
    let s = '';
    for (let c = minCol; c <= max; c++) s += row.get(c) ?? ' ';
    return s.replace(/\s+$/, '');
  };

  const xs = [...new Set(vis.map((n) => n.coords!.x))].sort((a, b) => a - b);
  const ys = [...new Set(vis.map((n) => n.coords!.y))].sort((a, b) => a - b);
  // 行块（y 偶数索引）放名字，夹行（奇数索引）放垂直连线
  const rows: Map<number, string>[] = Array.from({ length: 2 * ys.length - 1 }, newRow);
  const blockRow = (y: number) => rows[2 * ys.indexOf(y)]!;
  const midRow = (yi: number) => rows[2 * yi + 1]!; // 行块 yi 与 yi+1 之间
  const topRow = newRow();
  const bottomRow = newRow();

  // ---- 约束排版：格子以**完整显示名**（含 `(你)` 标注）的中心放在列锚点上 ----
  // 同一 x 的格子共享中心（垂直线才能是一条直线）；同一行排布相邻的两
  // 格之间至少留 ` ─── ` 的连线位。方向指示符相对玩家看到的整个名字
  // 居中；名字长短只影响自己，不撑大"整列"。
  const geo = (n: MapNode) => {
    const half = Math.floor(displayWidth(label(n)) / 2);
    return { left: half, right: displayWidth(label(n)) - half };
  };

  // 列中心求解：左→右递推。每列取「自身最大左伸」与「同行左邻约束
  // cx' + 右伸 + H_GAP + 左伸」的较大者；同行跨空档的对经 lastInRow
  // 传递约束，保证同行格子永不重叠。
  const cx = new Map<number, number>();
  {
    const lastInRow = new Map<number, { x: number; n: MapNode }>();
    for (const x of xs) {
      let cand = 0;
      for (const y of ys) {
        const n = at(x, y);
        if (!n) continue;
        cand = Math.max(cand, geo(n).left);
        const prev = lastInRow.get(y);
        if (prev && prev.x !== x) {
          cand = Math.max(cand, cx.get(prev.x)! + geo(prev.n).right + H_GAP + geo(n).left);
        }
      }
      cx.set(x, cand);
      for (const y of ys) {
        const n = at(x, y);
        if (n) lastInRow.set(y, { x, n });
      }
    }
  }

  // ---- 名字 ----
  for (const n of vis) {
    writeText(blockRow(n.coords!.y), cx.get(n.coords!.x)! - geo(n).left, label(n));
  }

  // ---- 连线判定：存在任一方向的出口边使两格坐标相邻 ----
  const hasStep = (from: MapNode, to: MapNode): boolean =>
    Object.keys(from.exits).some((dir) => {
      const d = DIRS[dir];
      return (
        !!d &&
        !!from.coords &&
        !!to.coords &&
        from.coords.x + d.x === to.coords.x &&
        from.coords.y + d.y === to.coords.y
      );
    });
  const linked = (a: MapNode, b: MapNode): boolean => hasStep(a, b) || hasStep(b, a);

  // ---- 水平连线：同行相邻排布对，点对点贴着两端名字 ----
  for (let i = 0; i < xs.length - 1; i++) {
    for (const y of ys) {
      const a = at(xs[i]!, y);
      const b = at(xs[i + 1]!, y);
      if (!a || !b || !linked(a, b)) continue;
      const from = cx.get(xs[i]!)! + geo(a).right + 1;
      const to = cx.get(xs[i + 1]!)! - geo(b).left - 2;
      const row = blockRow(y);
      for (let k = from; k <= to; k++) putCell(row, k, H_DASH);
    }
  }

  // ---- 垂直连线：同列相邻行块 ----
  for (const x of xs) {
    for (let yi = 0; yi < ys.length - 1; yi++) {
      const a = at(x, ys[yi]!);
      const b = at(x, ys[yi + 1]!);
      if (!a || !b || !linked(a, b)) continue;
      putCell(midRow(yi), cx.get(x)!, V_LINE);
    }
  }

  // ---- 断线：出口指向迷雾外/图外（含跨区域）——画一小段，暗示"这边有路" ----
  for (const n of vis) {
    const { x, y } = n.coords!;
    const yi = ys.indexOf(y);
    const g = geo(n);
    for (const [dir] of Object.entries(n.exits)) {
      const d = DIRS[dir];
      if (!d) continue; // up/down 跨层无平面坐标，不画
      if (at(x + d.x, y + d.y)) continue; // 邻格可见：归实线逻辑
      if (dir === 'north') {
        putCell(yi === 0 ? topRow : midRow(yi - 1), cx.get(x)!, V_LINE);
      } else if (dir === 'south') {
        putCell(yi === ys.length - 1 ? bottomRow : midRow(yi), cx.get(x)!, V_LINE);
      } else if (dir === 'west') {
        const row = blockRow(y);
        putCell(row, cx.get(x)! - g.left - 1, H_DASH);
        putCell(row, cx.get(x)! - g.left - 2, H_DASH);
      } else if (dir === 'east') {
        const row = blockRow(y);
        putCell(row, cx.get(x)! + g.right, H_DASH);
        putCell(row, cx.get(x)! + g.right + 1, H_DASH);
      }
    }
  }

  // ---- 组装（顶/底断线行按需挂载；中间夹行保留结构位）----
  const out: Map<number, string>[] = [];
  if (topRow.size > 0) out.push(topRow);
  out.push(...rows);
  if (bottomRow.size > 0) out.push(bottomRow);
  // 西断线可能落到 0 左侧（首列锚点 = 左伸时为 -1/-2）——按全图最小列
  // 统一各行左边界，保证带前导断线的行与普通行视觉对齐
  const minCol = Math.min(0, ...out.flatMap((r) => [...r.keys()]));
  const lines = out.map((r) => renderRow(r, minCol));
  while (lines.length > 0 && lines[0]!.trim() === '') lines.shift();
  while (lines.length > 0 && lines[lines.length - 1]!.trim() === '') lines.pop();
  return lines.join('\n');
}

export function markVisited(world: World, entity: EntityId, roomId?: EntityId): void {
  const visited = world.getComponent(entity, Visited);
  if (!visited) return;
  const room = roomId ?? world.getComponent(entity, Position)?.roomId;
  if (!room) return;
  if (!visited.rooms.includes(room)) visited.rooms.push(room);
}
