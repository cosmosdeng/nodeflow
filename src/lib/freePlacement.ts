/**
 * Free Node Placement — 正式纯策略模块(Phase 4B,算法语义来自 freePlacementSpike 验证基线)。
 *
 * 原则:
 *   - Free 是最后一个适应既有布局的对象;只移动 Free Node,不移动 assigned / rowOnly / stageOnly;
 *   - obstacle = 已落位 Node 矩形 + 调用方给出的「禁入带」区间(Band 仍不拥有 Node、不被 Node 移动);
 *   - Level 0 anchor(连线感知,P4 2026-09)→ Level 0.5 band-escape → Level 1 original →
 *     Level 2 local → Level 3 component peripheral → Level 4 global peripheral;
 *   - edge 参与「方向感知锚定」:仅连下游 → 贴到下游左侧;仅连上游 → 贴到上游右侧;
 *     上下游都有 → 贴到两者之间的间隙。锚定位不合法(重叠)时退回原有 original/local/… 序列,
 *     因此「贴流程」永远不会以牺牲不重叠为代价;
 *   - **禁入带(2026-09/P4B)**:调用方可传入 rowBands / colBands(行带 Y 区间、列带 X 区间);
 *     free 节点矩形不得与任何带相交,**且优先于锚定**——锚定位压带时先沿轴最小位移移出带,
 *     宁可离上下游远一点也不压带。两轴独立判定:只有真正发生冲突的那个轴才产生逃逸候选;
 *   - 无连边信息且无带信息时不存在锚定/逃逸候选,行为与 P4 之前完全一致;
 *   - deterministic:输入序 + 固定方向序;无随机 / 迭代优化 / magic 角落;
 *   - 不写 semantic(participantId / Stage.nodeIds / order)与 lane/row 持久化字段。
 */

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type PlacementLevel = 'anchor' | 'band' | 'original' | 'local' | 'component' | 'peripheral';

export interface FreeNodePlacementInput {
  /** 已最终布局的非 free 矩形(assigned / rowOnly / stageOnly 落位后) */
  occupied: { id: string; rect: Rect }[];
  /** 待放置 free(original rect;处理顺序 = 输入序,保持稳定) */
  free: { id: string; rect: Rect }[];
  /** 无向连通(端点可为 occupied 或 free) */
  edges?: { source: string; target: string }[];
  /** 局部搜索步长(间距),默认 16(与 Arrange 既有 FREE_NODE_CLEAR 一致) */
  gap?: number;
  /** 单方向最大步数,默认 4 */
  maxSteps?: number;
  /** 行带 Y 区间(参与方带):free 节点矩形不得与之相交。省略 = 无行带约束 */
  rowBands?: readonly { top: number; bottom: number }[];
  /** 列带 X 区间(阶段带):free 节点矩形不得与之相交。省略 = 无列带约束 */
  colBands?: readonly { left: number; right: number }[];
}

export interface FreeNodePlacementDiagnostic {
  nodeId: string;
  level: PlacementLevel;
  from: { x: number; y: number };
  to: { x: number; y: number };
  displacement: number;
}

export interface FreeNodePlacementResult {
  positions: Map<string, { x: number; y: number }>;
  diagnostics: FreeNodePlacementDiagnostic[];
}

const DEFAULT_GAP = 16;
const DEFAULT_MAX_STEPS = 4;
/** 固定方向优先级:down > right > up > left */
const DIRS: ReadonlyArray<{ dx: number; dy: number; axis: string }> = [
  { dx: 0, dy: 1, axis: 'down' },
  { dx: 1, dy: 0, axis: 'right' },
  { dx: 0, dy: -1, axis: 'up' },
  { dx: -1, dy: 0, axis: 'left' },
];

function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

function clearAt(r: Rect, occ: readonly Rect[]): boolean {
  return !occ.some((o) => overlaps(r, o));
}

const distance = (a: { x: number; y: number }, b: { x: number; y: number }) =>
  Math.abs(a.x - b.x) + Math.abs(a.y - b.y);

function bboxOf(rects: readonly Rect[]): Rect {
  let l = Infinity;
  let t = Infinity;
  let r = -Infinity;
  let b = -Infinity;
  for (const q of rects) {
    l = Math.min(l, q.x);
    t = Math.min(t, q.y);
    r = Math.max(r, q.x + q.w);
    b = Math.max(b, q.y + q.h);
  }
  if (!Number.isFinite(l)) return { x: 0, y: 0, w: 0, h: 0 };
  return { x: l, y: t, w: r - l, h: b - t };
}

/** bbox 四侧外扩候选(bottom/right/top/left) */
function around(f: Rect, box: Rect, gap: number): { dx: number; dy: number; axis: string }[] {
  return [
    { dx: 0, dy: box.y + box.h + gap - f.y, axis: 'bottom' },
    { dx: box.x + box.w + gap - f.x, dy: 0, axis: 'right' },
    { dx: 0, dy: box.y - gap - (f.y + f.h), axis: 'top' },
    { dx: box.x - gap - (f.x + f.w), dy: 0, axis: 'left' },
  ];
}

function componentsOf(ids: string[], edges: { source: string; target: string }[]): Map<string, Set<string>> {
  const parent = new Map(ids.map((id) => [id, id]));
  const find = (x: string): string => {
    let r = parent.get(x)!;
    while (r !== parent.get(r)!) r = parent.get(r)!;
    return r;
  };
  for (const e of edges) {
    if (!parent.has(e.source) || !parent.has(e.target)) continue;
    const rs = find(e.source);
    const rt = find(e.target);
    if (rs !== rt) parent.set(rt, rs);
  }
  const out = new Map<string, Set<string>>();
  for (const id of ids) {
    const root = find(id);
    const s = out.get(root) ?? new Set<string>();
    s.add(id);
    out.set(root, s);
  }
  return out;
}

const sortedCandidates = (c: { dx: number; dy: number; axis: string }[]) =>
  c
    .map((x) => ({ ...x, dist: Math.abs(x.dx) + Math.abs(x.dy) }))
    .sort(
      (a, b) => a.dist - b.dist || DIRS.findIndex((d) => d.axis === a.axis) - DIRS.findIndex((d) => d.axis === b.axis),
    );

/**
 * 连线感知的锚定候选(P4):
 *   - 仅连下游 → 贴到下游 bbox 左侧(上游位),纵向与下游居中;
 *   - 仅连上游 → 贴到上游 bbox 右侧(下游位),纵向与上游居中;
 *   - 上下游都有 → 落在两者水平间隙内居中;间隙放不下则退化为「贴上游右侧」。
 * 邻居只取「已落位」集合(occupied + 已 settle 的 free);无邻居返回 null(不做锚定)。
 * 纯函数,只读输入。
 */
function anchorRect(
  id: string,
  self: Rect,
  settledById: ReadonlyMap<string, Rect>,
  edges: readonly { source: string; target: string }[],
  gap: number,
): Rect | null {
  const preds: Rect[] = [];
  const succs: Rect[] = [];
  for (const e of edges) {
    if (e.target === id) {
      const r = settledById.get(e.source);
      if (r) preds.push(r);
    }
    if (e.source === id) {
      const r = settledById.get(e.target);
      if (r) succs.push(r);
    }
  }
  if (preds.length === 0 && succs.length === 0) return null;

  const centerYOf = (rs: Rect[]) => {
    const t = Math.min(...rs.map((r) => r.y));
    const b = Math.max(...rs.map((r) => r.y + r.h));
    return (t + b) / 2;
  };
  const predBox = preds.length > 0 ? bboxOf(preds) : null;
  const succBox = succs.length > 0 ? bboxOf(succs) : null;

  if (predBox && succBox) {
    const left = predBox.x + predBox.w + gap;
    const right = succBox.x - gap - self.w;
    const y = (centerYOf(preds) + centerYOf(succs)) / 2 - self.h / 2;
    // 间隙放得下 → 居中于间隙;放不下 → 贴上游右侧(不越过下游)
    if (right >= left) return { x: (left + right) / 2, y, w: self.w, h: self.h };
    return { x: left, y: centerYOf(preds) - self.h / 2, w: self.w, h: self.h };
  }
  if (succBox) {
    return { x: succBox.x - gap - self.w, y: centerYOf(succs) - self.h / 2, w: self.w, h: self.h };
  }
  return {
    x: predBox!.x + predBox!.w + gap,
    y: centerYOf(preds) - self.h / 2,
    w: self.w,
    h: self.h,
  };
}

/**
 * 单轴候选(带约束):给定起点 v 与长度 len,返回该轴上所有「不压任何禁入区间」的候选起点。
 * - 起点本身已合规 → 只返回起点(该轴不产生移动);
 * - 起点压带 → 返回各禁入区间左右两侧的候选 + 整体放到全部区间之前/之后,按与原点的位移升序。
 * 纯函数,确定性。
 */
function axisCandidates(v: number, len: number, intervals: readonly (readonly [number, number])[]): number[] {
  if (intervals.length === 0) return [v];
  if (intervals.every(([a, b]) => v + len <= a || v >= b)) return [v];

  const raw = new Set<number>();
  let minA = Infinity;
  let maxB = -Infinity;
  for (const [a, b] of intervals) {
    raw.add(a - len);
    raw.add(b);
    if (a < minA) minA = a;
    if (b > maxB) maxB = b;
  }
  raw.add(minA - len);
  raw.add(maxB);
  return [...raw]
    .filter((c) => intervals.every(([a, b]) => c + len <= a || c >= b))
    .sort((p, q) => Math.abs(p - v) - Math.abs(q - v) || p - q);
}

/**
 * 带逃逸:把 preferred 移到「不压行带 / 不压列带且不与已落位内容重叠」的位置。
 * - preferred 本身合规 → 原样返回(位移 0);
 * - 否则按 (X 候选 × Y 候选) 枚举,取总位移最小且合法的组合;全不合法返回 null。
 * 两轴独立:只有真正压带的那个轴才会产生逃逸候选。纯函数,确定性。
 */
function escapeFromBands(
  preferred: { x: number; y: number },
  w: number,
  h: number,
  colIntervals: readonly (readonly [number, number])[],
  rowIntervals: readonly (readonly [number, number])[],
  settled: readonly Rect[],
): { x: number; y: number } | null {
  const xs = axisCandidates(preferred.x, w, colIntervals);
  const ys = axisCandidates(preferred.y, h, rowIntervals);
  const combos: { x: number; y: number; d: number }[] = [];
  for (const x of xs) {
    for (const y of ys) {
      combos.push({ x, y, d: Math.abs(x - preferred.x) + Math.abs(y - preferred.y) });
    }
  }
  combos.sort((a, b) => a.d - b.d || a.x - b.x || a.y - b.y);
  for (const c of combos) {
    if (clearAt({ x: c.x, y: c.y, w, h }, settled)) return { x: c.x, y: c.y };
  }
  return null;
}

/**
 * 带外兜底:当所有解带候选都被已落位 Node 占住时,取「带外四角」中最近的一个。
 * 结果**保证不压带**(宁可远离内容,也不压带 —— 产品决策:带约束优先)。
 */
function nearestOutsideBands(
  w: number,
  h: number,
  colIntervals: readonly (readonly [number, number])[],
  rowIntervals: readonly (readonly [number, number])[],
  settled: readonly Rect[],
  from: { x: number; y: number },
): { x: number; y: number } {
  const xs =
    colIntervals.length > 0
      ? [Math.min(...colIntervals.map(([a]) => a)) - w, Math.max(...colIntervals.map(([, b]) => b))]
      : [from.x];
  const ys =
    rowIntervals.length > 0
      ? [Math.min(...rowIntervals.map(([a]) => a)) - h, Math.max(...rowIntervals.map(([, b]) => b))]
      : [from.y];
  const cands: { x: number; y: number; d: number }[] = [];
  for (const x of xs) {
    for (const y of ys) {
      cands.push({ x, y, d: Math.abs(x - from.x) + Math.abs(y - from.y) });
    }
  }
  cands.sort((a, b) => a.d - b.d || a.x - b.x || a.y - b.y);
  const clear = cands.find((c) => clearAt({ x: c.x, y: c.y, w, h }, settled));
  return clear ?? { x: cands[0].x, y: cands[0].y };
}

export function computeFreeNodePlacements(input: FreeNodePlacementInput): FreeNodePlacementResult {
  const gap = input.gap ?? DEFAULT_GAP;
  const maxSteps = input.maxSteps ?? DEFAULT_MAX_STEPS;
  const edges = input.edges ?? [];

  const positions = new Map<string, { x: number; y: number }>();
  const diagnostics: FreeNodePlacementDiagnostic[] = [];
  const settled: Rect[] = input.occupied.map((o) => ({ ...o.rect }));
  const settledById = new Map<string, Rect>();
  for (const o of input.occupied) settledById.set(o.id, o.rect);

  const comps = componentsOf([...input.occupied.map((o) => o.id), ...input.free.map((f) => f.id)], edges);

  // 禁入带(轴独立):行带 Y 区间 / 列带 X 区间。两者都为空 = 无带约束(行为同 P4 之前)
  const rowIntervals = (input.rowBands ?? []).map((b) => [b.top, b.bottom] as const);
  const colIntervals = (input.colBands ?? []).map((b) => [b.left, b.right] as const);
  const clearsBands = (r: Rect) =>
    colIntervals.every(([a, b]) => r.x + r.w <= a || r.x >= b) &&
    rowIntervals.every(([a, b]) => r.y + r.h <= a || r.y >= b);

  // 处理顺序:先「有已落位邻居」的 free(可一次锚定),再处理其余(可能依赖前者先落位)。
  // 这样 free → free → assigned 这类链接也能逐段贴到流程上;完全无连边时两者都退回输入序。
  const hasSettledNeighbor = (id: string) =>
    edges.some((e) => (e.target === id && settledById.has(e.source)) || (e.source === id && settledById.has(e.target)));
  const ordered = [
    ...input.free.filter((f) => hasSettledNeighbor(f.id)),
    ...input.free.filter((f) => !hasSettledNeighbor(f.id)),
  ];

  for (const f of ordered) {
    const from = { x: f.rect.x, y: f.rect.y };
    const rect = { ...f.rect };
    let level: PlacementLevel = 'original';

    // Level 0:anchor(连线感知)→ 再解带。带约束优先于锚定(X/Y 两轴独立)。
    const anchor = anchorRect(f.id, rect, settledById, edges, gap);
    const preferred = anchor ? { x: anchor.x, y: anchor.y } : { x: rect.x, y: rect.y };
    const escaped = escapeFromBands(preferred, rect.w, rect.h, colIntervals, rowIntervals, settled);
    if (escaped) {
      const moved = escaped.x !== preferred.x || escaped.y !== preferred.y;
      rect.x = escaped.x;
      rect.y = escaped.y;
      level = moved ? 'band' : anchor ? 'anchor' : 'original';
    } else if (clearAt(rect, settled)) {
      // 带回退:锚定与解带都不成立时,原位优先(P4 之前行为)
      level = 'original';
    } else {
      // Level 2:local(方向 × {1..maxSteps}·gap,最小位移 + 固定方向序);优先同时满足带约束者
      const localCands = [] as { dx: number; dy: number; axis: string }[];
      for (const d of DIRS) {
        for (let s = 1; s <= maxSteps; s++) {
          const step = s * gap;
          localCands.push({ dx: d.dx * step, dy: d.dy * step, axis: d.axis });
        }
      }
      const sortedLocal = sortedCandidates(localCands);
      const hit =
        sortedLocal.find((c) => {
          const r = { x: rect.x + c.dx, y: rect.y + c.dy, w: rect.w, h: rect.h };
          return clearAt(r, settled) && clearsBands(r);
        }) ?? sortedLocal.find((c) => clearAt({ ...rect, x: rect.x + c.dx, y: rect.y + c.dy }, settled));
      if (hit) {
        rect.x += hit.dx;
        rect.y += hit.dy;
        level = 'local';
      } else {
        // Level 2:component peripheral(分量内已 settle 成员 bbox 外围最近合法位)
        const comp = [...comps.entries()].find(([, s]) => s.has(f.id))?.[1] ?? new Set([f.id]);
        const compSettled = [...comp].filter((id) => id !== f.id && settledById.has(id));
        let placed = false;
        if (compSettled.length > 0) {
          const box = bboxOf(compSettled.map((id) => settledById.get(id)!));
          const cHit = sortedCandidates(around(rect, box, gap)).find((c) =>
            clearAt({ ...rect, x: rect.x + c.dx, y: rect.y + c.dy }, settled),
          );
          if (cHit) {
            rect.x += cHit.dx;
            rect.y += cHit.dy;
            level = 'component';
            placed = true;
          }
        }
        if (!placed) {
          // Level 3:global peripheral(全部已 settle 内容 bbox 外最近合法位)
          const box = bboxOf(settled);
          const cHit = sortedCandidates(around(rect, box, gap)).find((c) =>
            clearAt({ ...rect, x: rect.x + c.dx, y: rect.y + c.dy }, settled),
          );
          if (cHit) {
            rect.x += cHit.dx;
            rect.y += cHit.dy;
          }
          level = 'peripheral';
        }
      }
    }

    // 绝对保证:任何路径(含 original / local / component / peripheral 兜底)产出的位置
    // 都不得压带;兜底路径漏检时在此强制解带。
    if (!clearsBands(rect)) {
      const forced =
        escapeFromBands(rect, rect.w, rect.h, colIntervals, rowIntervals, settled) ??
        nearestOutsideBands(rect.w, rect.h, colIntervals, rowIntervals, settled, rect);
      rect.x = forced.x;
      rect.y = forced.y;
      level = 'band';
    }

    positions.set(f.id, { x: rect.x, y: rect.y });
    settled.push({ ...rect });
    settledById.set(f.id, { ...rect });
    diagnostics.push({
      nodeId: f.id,
      level,
      from,
      to: { x: rect.x, y: rect.y },
      displacement: distance(from, { x: rect.x, y: rect.y }),
    });
  }

  return { positions, diagnostics };
}
