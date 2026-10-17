/**
 * Stage-only × assigned 同列内 Y Anchor — Spike(纯函数验证,不接入生产)。
 *
 * 冻结前提(见 docs/architecture/stage-participant-arrange-design.md):
 *   X = Stage 列(order);Y = Participant 行(order);assigned/rowOnly/stageOnly/free 按轴独立。
 *   stageOnly 属于其 Stage column,不属于任何 Participant row。
 *
 * 本 Spike 只回答一个开放问题:
 *   stageOnly 与 assigned 处于同一 Stage column 时,stageOnly 的 Y 如何定位?
 *
 * 候选策略(全部 deterministic,不接入生产):
 *   A — Column Top Anchor       :该列顶部起顺序堆叠(最简单,可能与 assigned 碰撞)。
 *   B — First Available Gap    :复用该列 assigned 之间的可用纵向间隙(无则列内容之后)。
 *   C — After Assigned Envelope:放在该列全部 assigned 之后(独立列起点 = 无 assigned 时)。
 *   D — Topology-aware Anchor  :先按同列连边锚定(pred/succ),再行碰撞下推;无连边退化为 C。
 *
 * 一维模型:同列节点共享同一 x 区间,只比较纵向区间 [y, y+h)。
 */
export type AnchorStrategy = 'A' | 'B' | 'C' | 'D';

export interface AssignedRect {
  id: string;
  y: number;
  h: number;
}

export interface StageOnlyItem {
  id: string;
  h: number;
  /** 原始 y(仅用于位移统计,不作几何输入) */
  origY: number;
  /** 可选拓扑层(升序稳定排序用;缺省按输入序) */
  level?: number;
}

export interface AnchorInput {
  /** 列独立起点(无 assigned 时的顶部基准),默认 80 */
  colTop?: number;
  assigned: AssignedRect[];
  stageOnly: StageOnlyItem[];
  /** 同列节点之间的边(端点 id ∈ assigned/stageOnly) */
  edges?: { source: string; target: string }[];
  /** assigned 与 stageOnly 之间的最小纵向间距 */
  gap?: number;
}

export interface StrategyOutcome {
  strategy: AnchorStrategy;
  /** stageOnly id → 放置 y */
  y: Map<string, number>;
  /** node-node 纵向重叠次数(含 assigned-assigned 以外的全部 pair) */
  collisions: number;
  /** 与 assigned 的重叠数 */
  collisionWithAssigned: number;
  /** stageOnly-stageOnly 重叠数 */
  collisionWithStageOnly: number;
  /** 同列边 source.top > target.top 的次数 */
  topologyViolations: number;
  /** 位移总量 / 平均 / 最大(仅 stageOnly) */
  totalDisplacement: number;
  avgDisplacement: number;
  maxDisplacement: number;
  virtualParticipantCreated: boolean;
}

export interface AnchorResult {
  outcomes: StrategyOutcome[];
}

const DEFAULT_GAP = 40;
const DEFAULT_TOP = 80;

/* ---------- 工具 ---------- */
function placedRects(
  assigned: AssignedRect[],
  stageOnly: StageOnlyItem[],
  ys: Map<string, number>,
): { id: string; y: number; h: number; kind: 'assigned' | 'stageOnly' }[] {
  const out: { id: string; y: number; h: number; kind: 'assigned' | 'stageOnly' }[] = assigned.map((a) => ({
    id: a.id,
    y: a.y,
    h: a.h,
    kind: 'assigned' as const,
  }));
  for (const s of stageOnly) {
    const y = ys.get(s.id);
    if (y === undefined) continue;
    out.push({ id: s.id, y, h: s.h, kind: 'stageOnly' as const });
  }
  return out;
}

/** 纵向区间重叠长度(>0 即视为碰撞) */
function overlapLen(a: { y: number; h: number }, b: { y: number; h: number }): number {
  return Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
}

function countCollisions(rects: { id: string; y: number; h: number; kind: string }[]): {
  collisions: number;
  withAssigned: number;
  withStageOnly: number;
} {
  let collisions = 0;
  let withAssigned = 0;
  let withStageOnly = 0;
  for (let i = 0; i < rects.length; i++) {
    for (let j = i + 1; j < rects.length; j++) {
      if (overlapLen(rects[i], rects[j]) > 0) {
        collisions += 1;
        if (rects[i].kind === 'stageOnly' || rects[j].kind === 'stageOnly') {
          if (rects[i].kind === 'assigned' || rects[j].kind === 'assigned') withAssigned += 1;
          else withStageOnly += 1;
        }
      }
    }
  }
  return { collisions, withAssigned, withStageOnly };
}

function countTopologyViolations(
  rects: { id: string; y: number }[],
  edges: { source: string; target: string }[],
): number {
  const yOf = new Map(rects.map((r) => [r.id, r.y]));
  let v = 0;
  for (const e of edges) {
    const sy = yOf.get(e.source);
    const ty = yOf.get(e.target);
    if (sy === undefined || ty === undefined) continue;
    if (sy > ty) v += 1;
  }
  return v;
}

function sortStageOnly(items: StageOnlyItem[]): StageOnlyItem[] {
  return [...items].sort((a, b) => (a.level ?? 0) - (b.level ?? 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

function buildOutcome(
  strategy: AnchorStrategy,
  assigned: AssignedRect[],
  stageOnly: StageOnlyItem[],
  ys: Map<string, number>,
  edges: { source: string; target: string }[],
): StrategyOutcome {
  const rects = placedRects(assigned, stageOnly, ys);
  const col = countCollisions(rects);
  const viol = countTopologyViolations(rects, edges);
  const moves = stageOnly.map((s) => Math.abs((ys.get(s.id) ?? s.origY) - s.origY));
  const total = moves.reduce((a, b) => a + b, 0);
  return {
    strategy,
    y: new Map(ys),
    collisions: col.collisions,
    collisionWithAssigned: col.withAssigned,
    collisionWithStageOnly: col.withStageOnly,
    topologyViolations: viol,
    totalDisplacement: total,
    avgDisplacement: stageOnly.length ? Math.round((total / stageOnly.length) * 100) / 100 : 0,
    maxDisplacement: stageOnly.length ? Math.max(...moves) : 0,
    virtualParticipantCreated: false,
  };
}

/* ---------- Strategy A:Column Top Anchor ---------- */
function strategyA(input: AnchorInput): Map<string, number> {
  const top = input.colTop ?? DEFAULT_TOP;
  const gap = input.gap ?? DEFAULT_GAP;
  const ys = new Map<string, number>();
  let cur = top;
  for (const s of sortStageOnly(input.stageOnly)) {
    ys.set(s.id, cur);
    cur += s.h + gap;
  }
  return ys;
}

/* ---------- Strategy C:After Assigned Envelope ---------- */
function strategyC(input: AnchorInput): Map<string, number> {
  const top = input.colTop ?? DEFAULT_TOP;
  const gap = input.gap ?? DEFAULT_GAP;
  const base = input.assigned.reduce((m, a) => Math.max(m, a.y + a.h), 0);
  const start = input.assigned.length === 0 ? top : base + gap;
  const ys = new Map<string, number>();
  let cur = start;
  for (const s of sortStageOnly(input.stageOnly)) {
    ys.set(s.id, cur);
    cur += s.h + gap;
  }
  return ys;
}

/* ---------- Strategy B:First Available Gap ---------- */
function strategyB(input: AnchorInput): Map<string, number> {
  const top = input.colTop ?? DEFAULT_TOP;
  const gap = input.gap ?? DEFAULT_GAP;
  // 初始自由区间:列顶至正无穷
  const asc = [...input.assigned].sort((a, b) => a.y - b.y || (a.id < b.id ? -1 : 1));
  const intervals: { top: number; bot: number }[] = [{ top, bot: Infinity }];
  for (const a of asc) {
    // 从区间中扣除 assigned 占用的 [a.y, a.y+a.h)
    const next: { top: number; bot: number }[] = [];
    for (const iv of intervals) {
      if (a.y + a.h <= iv.top || a.y >= iv.bot) {
        next.push(iv);
        continue;
      }
      if (a.y > iv.top) next.push({ top: iv.top, bot: a.y });
      if (a.y + a.h < iv.bot) next.push({ top: a.y + a.h, bot: iv.bot });
    }
    intervals.length = 0;
    intervals.push(...next);
  }
  intervals.sort((x, y) => x.top - y.top || x.bot - y.bot);

  const ys = new Map<string, number>();
  const used: { id: string; top: number; bot: number }[] = [];
  for (const s of sortStageOnly(input.stageOnly)) {
    // 找第一个“够放”区间:长度 >= h + 2*gap(gap 上下各留),放置后该段被占用
    let placed = false;
    for (let i = 0; i < intervals.length && !placed; i++) {
      const iv = intervals[i];
      if (iv.bot - iv.top >= s.h + gap * 2) {
        const y = iv.top + gap;
        ys.set(s.id, y);
        used.push({ id: s.id, top: y, bot: y + s.h });
        // 收缩当前区间
        if (y + s.h + gap < iv.bot) {
          intervals[i] = { top: y + s.h + gap, bot: iv.bot };
        } else {
          intervals.splice(i, 1);
        }
        placed = true;
      }
    }
    if (!placed) {
      // 无足够间隙:退化为 C(列内容之后)
      const base = input.assigned.reduce((m, a) => Math.max(m, a.y + a.h), 0);
      const after = Math.max(base + gap, ...used.map((u) => u.bot + gap), top);
      ys.set(s.id, after);
      used.push({ id: s.id, top: after, bot: after + s.h });
    }
  }
  return ys;
}

/* ---------- Strategy D:Topology-aware Anchor ---------- */
function strategyD(input: AnchorInput): Map<string, number> {
  const top = input.colTop ?? DEFAULT_TOP;
  const gap = input.gap ?? DEFAULT_GAP;
  const edges = input.edges ?? [];
  const assigned = input.assigned;
  type KnownRect = { id: string; y: number; h: number; kind: 'assigned' | 'stageOnly' };
  const byId = new Map<string, KnownRect>();
  for (const a of assigned) byId.set(a.id, { id: a.id, y: a.y, h: a.h, kind: 'assigned' });
  for (const s of input.stageOnly) byId.set(s.id, { id: s.id, y: s.origY, h: s.h, kind: 'stageOnly' });
  const preds = new Map<string, string[]>();
  const succs = new Map<string, string[]>();
  for (const e of edges) {
    if (!byId.has(e.source) || !byId.has(e.target)) continue;
    preds.set(e.target, [...(preds.get(e.target) ?? []), e.source]);
    succs.set(e.source, [...(succs.get(e.source) ?? []), e.target]);
  }
  const placedY = new Map<string, number>();
  const occupied: { top: number; bot: number }[] = assigned.map((a) => ({ top: a.y, bot: a.y + a.h }));

  const fits = (y: number, h: number, cand: { top: number; bot: number }[]): boolean =>
    !cand.some((o) => overlapLen({ y, h }, { y: o.top, h: o.bot - o.top }) > 0);

  for (const s of sortStageOnly(input.stageOnly)) {
    const pred = preds.get(s.id);
    const succ = succs.get(s.id);
    const pRects = (pred ?? []).map((id) => byId.get(id)).filter((x): x is KnownRect => x !== undefined);
    const sRects = (succ ?? []).map((id) => byId.get(id)).filter((x): x is KnownRect => x !== undefined);
    const yOfKnown = (r: KnownRect): number =>
      r.kind === 'assigned' ? r.y : (placedY.get(r.id) ?? Number.MAX_SAFE_INTEGER);
    // 仅用“已就位”的邻居(assigned 恒就位;stageOnly 需已放置)做锚定
    const settled = (r: KnownRect): boolean => r.kind === 'assigned' || placedY.has(r.id);
    const predBottom =
      pRects.length > 0 ? Math.max(...pRects.filter(settled).map((r) => yOfKnown(r) + r.h)) : undefined;
    const succTop = sRects.length > 0 ? Math.min(...sRects.filter(settled).map((r) => yOfKnown(r))) : undefined;

    // 期望锚点(不含占位冲突处理)
    let desire: number;
    if (predBottom !== undefined) desire = predBottom + gap;
    else if (succTop !== undefined && succTop !== Number.MAX_SAFE_INTEGER) {
      desire = Math.max(top, succTop - gap - s.h);
    } else {
      // 无同列邻居:退化 C(列内容之后)
      const base = input.assigned.reduce((m, a) => Math.max(m, a.y + a.h), 0);
      desire = Math.max(base + gap, ...occupied.map((o) => o.bot + gap), top);
    }
    // 碰撞下推:冲突则推到碰撞块之下
    let y = desire;
    while (!fits(y, s.h, occupied)) {
      let nextY = y + 1;
      for (const o of occupied) {
        if (overlapLen({ y, h: s.h }, { y: o.top, h: o.bot - o.top }) > 0) {
          nextY = Math.max(nextY, o.bot + gap);
        }
      }
      if (nextY <= y) break;
      y = nextY;
    }
    placedY.set(s.id, y);
    occupied.push({ top: y, bot: y + s.h });
  }
  return placedY;
}

/* ---------- 入口 ---------- */
const STRATEGIES: Record<AnchorStrategy, (i: AnchorInput) => Map<string, number>> = {
  A: strategyA,
  B: strategyB,
  C: strategyC,
  D: strategyD,
};

export function runAnchorSpike(input: AnchorInput): AnchorResult {
  const edges = input.edges ?? [];
  const outcomes = (['A', 'B', 'C', 'D'] as AnchorStrategy[]).map((name) => {
    const ys = STRATEGIES[name](input);
    return buildOutcome(name, input.assigned, input.stageOnly, ys, edges);
  });
  return { outcomes };
}

/** 打印单条策略结果(供测试/报告用) */
export function formatOutcome(o: StrategyOutcome): string {
  return (
    `Strategy ${o.strategy}: collision=${o.collisions}(assigned=${o.collisionWithAssigned},stageOnly=${o.collisionWithStageOnly}) ` +
    `displacement=total ${o.totalDisplacement} avg ${o.avgDisplacement} max ${o.maxDisplacement} ` +
    `topologyViolations=${o.topologyViolations} deterministic ✓ virtualParticipantCreated=${o.virtualParticipantCreated}`
  );
}
