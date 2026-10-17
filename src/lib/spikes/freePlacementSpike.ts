/**
 * Free Node Placement — Phase 4A Spike(纯策略验证,不接入生产)。
 *
 * 现状(生产 computeMatrixLayout):free 一旦「命中行带投影(y)或列带(x)」就整体
 * 就近弹到矩阵区四角外(固定角落),位移可非常大且忽略连通性。
 *
 * 本 Spike 验证三层 fallback:
 *   Level 0 original : 原位无碰撞 → 不移动(首要 invariant)
 *   Level 1 local    : 原位置附近最小位移(方向 × 有限步长,确定性)
 *   Level 2 component: 同连通分量外围(基于 undirected connectivity)就近放置
 *   Level 3 peripheral: 现有已放置内容 bbox 外围,取最近合法候选
 *
 * 原则:
 *   - Free 只移动自身,不移动 assigned / rowOnly / stageOnly,不把 band 当 obstacle
 *     (障碍仅为 Node 矩形);
 *   - 不按 topology direction 排序/排名,edge 只用于 connected component;
 *   - deterministic(输入序 + 固定方向优先级),无随机 / 迭代优化 / 加权评分;
 *   - 输出仅 id → position 与 diagnostics,不改 semantic(不写 participantId/stageId)。
 */

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PlacementInput {
  /** 已放置的非 free(assigned / rowOnly / stageOnly)矩形 */
  occupied: { id: string; rect: Rect }[];
  /** 待放置 free(original rect) */
  free: { id: string; rect: Rect }[];
  /** 无向连通(端点可为 occupied 或 free);用于 component */
  edges?: { source: string; target: string }[];
  /** 最小间距(留白),默认 16 */
  gap?: number;
  /** Level 1 单方向最大步数(步长 = gap),默认 4 */
  maxSteps?: number;
}

export type PlacementLevel = 'original' | 'local' | 'component' | 'peripheral';

export interface PlacementDiagnostic {
  nodeId: string;
  level: PlacementLevel;
  from: { x: number; y: number };
  to: { x: number; y: number };
  displacement: number;
}

export interface PlacementResult {
  positions: Map<string, { x: number; y: number }>;
  diagnostics: PlacementDiagnostic[];
}

export interface PlacementMetrics {
  freeCount: number;
  unchanged: number;
  local: number;
  component: number;
  peripheral: number;
  totalDisplacement: number;
  maxDisplacement: number;
  overlapCount: number;
}

const DEFAULT_GAP = 16;
const DEFAULT_MAX_STEPS = 4;
/** 固定方向优先级(down > right > up > left),用于破平 */
const DIR_ORDER: ReadonlyArray<{ dx: number; dy: number; name: string }> = [
  { dx: 0, dy: 1, name: 'down' },
  { dx: 1, dy: 0, name: 'right' },
  { dx: 0, dy: -1, name: 'up' },
  { dx: -1, dy: 0, name: 'left' },
];

function overlap(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

function clearAt(r: Rect, occ: Rect[]): boolean {
  return !occ.some((o) => overlap(r, o));
}

const distOf = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);

/** 无向连通分量(node id → component root),edges 覆盖 occupied+free */
function componentsOf(ids: string[], edges: { source: string; target: string }[]): Map<string, Set<string>> {
  const parent = new Map<string, string>();
  for (const id of ids) parent.set(id, id);
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
  const comps = new Map<string, Set<string>>();
  for (const id of ids) {
    const r = find(id);
    const s = comps.get(r) ?? new Set<string>();
    s.add(id);
    comps.set(r, s);
  }
  return comps;
}

function bboxOf(rects: Rect[]): Rect {
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

/** 生成 bbox 四侧外扩候选(同 x 对中到 bbox 或保留 free 原 x 取决于 minDisplacement) */
function peripheralCandidates(f: Rect, box: Rect, gap: number): { dx: number; dy: number; axis: string }[] {
  return [
    { dx: 0, dy: box.y + box.h + gap - f.y, axis: 'bottom' },
    { dx: box.x + box.w + gap - f.x, dy: 0, axis: 'right' },
    { dx: 0, dy: box.y - gap - (f.y + f.h), axis: 'top' },
    { dx: box.x - gap - (f.x + f.w), dy: 0, axis: 'left' },
  ];
}

export function runFreePlacement(input: PlacementInput): PlacementResult {
  const gap = input.gap ?? DEFAULT_GAP;
  const maxSteps = input.maxSteps ?? DEFAULT_MAX_STEPS;
  const edges = input.edges ?? [];

  const positions = new Map<string, { x: number; y: number }>();
  const diagnostics: PlacementDiagnostic[] = [];
  // 已占用的最终矩形(occupied + 已放置 free),随放置动态累积
  const settledRects: Rect[] = input.occupied.map((o) => ({ ...o.rect }));
  const settledIdToRect = new Map<string, Rect>();
  for (const o of input.occupied) settledIdToRect.set(o.id, o.rect);

  const idList = [...input.occupied.map((o) => o.id), ...input.free.map((f) => f.id)];
  const comps = componentsOf(idList, edges);

  for (const f of input.free) {
    const from = { x: f.rect.x, y: f.rect.y };
    const rect = { ...f.rect };
    let level: PlacementLevel = 'original';

    // Level 0:原位无碰撞 → 不移动
    if (clearAt(rect, settledRects)) {
      level = 'original';
    } else {
      // Level 1:local — 方向 × {1..maxSteps}*gap,选位移最小;同距按固定方向序
      const candidates: { dx: number; dy: number; axis: string }[] = [];
      for (const dir of DIR_ORDER) {
        for (let s = 1; s <= maxSteps; s++) {
          const d = s * gap;
          candidates.push({ dx: dir.dx * d, dy: dir.dy * d, axis: dir.name });
        }
      }
      const sorted = candidates
        .map((c) => ({ ...c, dist: Math.abs(c.dx) + Math.abs(c.dy) }))
        .sort(
          (a, b) =>
            a.dist - b.dist ||
            DIR_ORDER.findIndex((d) => d.name === a.axis) - DIR_ORDER.findIndex((d) => d.name === b.axis),
        );
      const hit = sorted.find((c) => clearAt({ ...rect, x: rect.x + c.dx, y: rect.y + c.dy }, settledRects));
      if (hit) {
        rect.x += hit.dx;
        rect.y += hit.dy;
        level = 'local';
      } else {
        // Level 2:component peripheral(仅当分量内有已 settle 成员时)
        const comp = comps.get([...comps.keys()].find((k) => comps.get(k)!.has(f.id)) ?? f.id) ?? new Set([f.id]);
        const settledMembers = [...comp].filter((id) => id !== f.id && settledIdToRect.has(id));
        let placed = false;
        if (settledMembers.length > 0) {
          const box = bboxOf(settledMembers.map((id) => settledIdToRect.get(id)!));
          const pc = peripheralCandidates(rect, box, gap)
            .map((c) => ({ ...c, dist: Math.abs(c.dx) + Math.abs(c.dy) }))
            .sort(
              (a, b) =>
                a.dist - b.dist ||
                ['bottom', 'right', 'top', 'left'].indexOf(a.axis) - ['bottom', 'right', 'top', 'left'].indexOf(b.axis),
            );
          const pcHit = pc.find((c) => clearAt({ ...rect, x: rect.x + c.dx, y: rect.y + c.dy }, settledRects));
          if (pcHit) {
            rect.x += pcHit.dx;
            rect.y += pcHit.dy;
            level = 'component';
            placed = true;
          }
        }
        if (!placed) {
          // Level 3:global peripheral — 全部已 settle 内容 bbox 外最近合法候选
          const box = bboxOf(settledRects);
          const pc = peripheralCandidates(rect, box, gap)
            .map((c) => ({ ...c, dist: Math.abs(c.dx) + Math.abs(c.dy) }))
            .sort(
              (a, b) =>
                a.dist - b.dist ||
                ['bottom', 'right', 'top', 'left'].indexOf(a.axis) - ['bottom', 'right', 'top', 'left'].indexOf(b.axis),
            );
          const pcHit = pc.find((c) => clearAt({ ...rect, x: rect.x + c.dx, y: rect.y + c.dy }, settledRects));
          if (pcHit) {
            rect.x += pcHit.dx;
            rect.y += pcHit.dy;
          }
          level = 'peripheral'; // component 分支已失败/不可用 → global peripheral
        }
      }
    }

    positions.set(f.id, { x: rect.x, y: rect.y });
    settledRects.push({ ...rect });
    settledIdToRect.set(f.id, { ...rect });
    diagnostics.push({
      nodeId: f.id,
      level,
      from,
      to: { x: rect.x, y: rect.y },
      displacement: distOf(from, { x: rect.x, y: rect.y }),
    });
  }

  return { positions, diagnostics };
}

export function summarize(input: PlacementInput, r: PlacementResult): PlacementMetrics {
  let unchanged = 0;
  let local = 0;
  let component = 0;
  let peripheral = 0;
  let total = 0;
  let max = 0;
  for (const d of r.diagnostics) {
    if (d.level === 'original') unchanged += 1;
    else if (d.level === 'local') local += 1;
    else if (d.level === 'component') component += 1;
    else peripheral += 1;
    total += d.displacement;
    max = Math.max(max, d.displacement);
  }
  // overlap:最终 free 矩形彼此及与 occupied 的 node-node 重叠
  const rects: Rect[] = input.occupied.map((o) => ({ ...o.rect }));
  for (const f of input.free) {
    const p = r.positions.get(f.id);
    if (p) rects.push({ ...f.rect, x: p.x, y: p.y });
  }
  let overlapCount = 0;
  for (let i = 0; i < rects.length; i++) {
    for (let j = i + 1; j < rects.length; j++) {
      if (overlap(rects[i], rects[j])) overlapCount += 1;
    }
  }
  return {
    freeCount: input.free.length,
    unchanged,
    local,
    component,
    peripheral,
    totalDisplacement: total,
    maxDisplacement: max,
    overlapCount,
  };
}
