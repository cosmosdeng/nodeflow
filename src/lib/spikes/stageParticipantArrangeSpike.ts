/**
 * Stage/Participant 带模式统一自动排列策略 — Spike(纯函数验证,不接入生产)。
 *
 * 设计假设(仅验证,不代表产品承诺):
 *   Stage  = X 轴 / When
 *   Participant = Y 轴 / Who
 *   Node   = What
 *
 * 规则:
 *   1. 四类按轴独立分类(与视觉弹性带 elasticBands 一致):
 *        assigned  = pid 有效 && stage 有效
 *        rowOnly   = pid 有效 && stage 无效
 *        stageOnly = pid 无效 && stage 有效   ← 绝不当 free
 *        free      = pid 无效 && stage 无效
 *   2. X 主轴 = Stage 列(stageOrder);不用全局 topology level 直接当列。
 *   3. Y 主轴 = Participant 行(participantOrder 硬约束)。
 *   4. topology(computeLevels)只作为同 cell / 同列 / 同行的次级排序。
 *   5. free:先局部小幅避让(单轴贴边),不无理由弹到矩阵四角。
 *
 * 生产代码不得 import 本文件。
 */
import type { FlowEdge, FlowNode, Participant, Stage } from '../../types';
import { computeLevels } from '../layout';
import { computeMatrixGridStructure } from '../arrange';

export type NodeClass = 'assigned' | 'rowOnly' | 'stageOnly' | 'free';

export interface SpikeInput {
  nodes: FlowNode[];
  edges: FlowEdge[];
  participants: Participant[];
  participantOrder: string[];
  stages: Stage[];
  stageOrder: string[];
}

export interface Placed {
  x: number;
  y: number;
}

export interface FreeMove {
  id: string;
  from: { x: number; y: number };
  to: { x: number; y: number };
  dist: number;
}

export interface Conflict {
  source: string;
  target: string;
  kind: 'x-reverse' | 'y-reverse';
}

export interface SpikeMetrics {
  /** 全部有 stage 语义节点是否落在其 stage 列带内(X 与 Stage 列一致) */
  stageAxisAligned: boolean;
  /** 全部有 pid 语义节点是否落在其 participant 行带内(Y 与 Participant 行一致) */
  participantAxisAligned: boolean;
  /** 进入所属 stage 列的 stageOnly 名单 */
  stageOnlyInColumns: string[];
  /** 仍被当作 free / 未进列的 stageOnly(应为空) */
  stageOnlyMisclassified: string[];
  /** 非 free 之间(source→target)的 y 反向(行列语义固有 trade-off,供显式报告) */
  yConflicts: Conflict[];
  /** 拓扑 X 方向满足率 source.x <= target.x(全部顶层边) */
  xOrderSatisfied: number;
  /** 未满足 x 单调的边 */
  xConflicts: Conflict[];
  /** free 实际避让记录 */
  freeMoves: FreeMove[];
  /** 保持原位、未被移动的 free */
  freeKept: string[];
}

export interface SpikeResult {
  classified: Map<string, NodeClass>;
  spike: Map<string, Placed>;
  metrics: SpikeMetrics;
}

/* ------------------------------------------------------------------ */
/* 常量(独立于生产 arrange,避免互相干扰)                                */
/* ------------------------------------------------------------------ */
const START_X = 80;
const START_Y = 80;
const COL_GAP = 120;
const ROW_GAP = 80;
const CELL_PAD_X = 24;
const STACK_GAP = 40;
const EMPTY_ROW_H = 60;
const EXTEND_X = 16;
const CLEAR = 16;
const DEFAULT_W = 240;
const DEFAULT_H = 150;

function sizeOf(n: FlowNode): { w: number; h: number } {
  const w = n.width ?? n.measured?.width ?? DEFAULT_W;
  const h = n.height ?? n.measured?.height ?? DEFAULT_H;
  return { w, h };
}

const isHidden = (n: FlowNode): boolean => (n as { hidden?: boolean }).hidden === true;

/* ------------------------------------------------------------------ */
/* 1. Scope 与按轴独立分类                                              */
/* ------------------------------------------------------------------ */
function topScope(nodes: readonly FlowNode[]): { topNodes: FlowNode[]; childIds: Set<string> } {
  const childIds = new Set<string>();
  for (const n of nodes) {
    for (const cid of n.data?.composite?.childIds ?? []) childIds.add(cid);
  }
  const topNodes = nodes.filter((n) => !isHidden(n) && !childIds.has(n.id));
  return { topNodes, childIds };
}

export function classifyNodes(input: SpikeInput): Map<string, NodeClass> {
  const { topNodes } = topScope(input.nodes);
  const map = new Map<string, NodeClass>();
  for (const n of topNodes) {
    const hasPid = !!n.data?.participantId && input.participants.some((p) => p.id === n.data!.participantId);
    const hasStage = input.stages.some((st) => st.nodeIds.includes(n.id));
    map.set(n.id, hasPid && hasStage ? 'assigned' : hasPid ? 'rowOnly' : hasStage ? 'stageOnly' : 'free');
  }
  return map;
}

/* ------------------------------------------------------------------ */
/* 2. 网格骨架:统一 X=Stage 列 / Y=Participant 行                       */
/* ------------------------------------------------------------------ */
interface Grid {
  colOf: Map<string, number>; // assigned/stageOnly -> stage 列 idx
  rowOf: Map<string, number>; // assigned/rowOnly -> participant 行 idx
  colXs: number[];
  colRights: number[];
  rowYs: Map<number, number>;
  rowBottoms: Map<number, number>;
  colL: number;
  colR: number;
  rowT: number;
  rowB: number;
}

function buildGrid(input: SpikeInput, cls: Map<string, NodeClass>): Grid {
  const { topNodes } = topScope(input.nodes);
  const byId = new Map(topNodes.map((n) => [n.id, n]));
  const structure = computeMatrixGridStructure(input);
  const cols = structure.cols;
  const rows = structure.rows;
  const colIndexOf = structure.colIndexOf;
  const rowIndexOf = structure.rowIndexOf;

  const pidOf = (n: FlowNode) => n.data?.participantId as string | undefined;
  const stageIdOf = (n: FlowNode) => input.stages.find((st) => st.nodeIds.includes(n.id))?.id;

  const topEdges = input.edges.filter((e) => byId.has(e.source) && byId.has(e.target));
  const level = computeLevels(topNodes, topEdges);
  const levelCmp = (a: FlowNode, b: FlowNode) =>
    (level.get(a.id) ?? 0) - (level.get(b.id) ?? 0) || (a.id < b.id ? -1 : 1);

  const cells = new Map<string, FlowNode[]>();
  const stageOnlyByCol = new Map<number, FlowNode[]>();
  const rowOnlyByRow = new Map<number, FlowNode[]>();

  for (const n of topNodes) {
    const c = cls.get(n.id)!;
    const pid = pidOf(n);
    const sid = stageIdOf(n);
    if (c === 'assigned') {
      const r = rowIndexOf.get(pid!);
      const col = colIndexOf.get(sid!);
      if (r === undefined || col === undefined) continue;
      const k = `${r}_${col}`;
      const arr = cells.get(k) ?? [];
      arr.push(n);
      cells.set(k, arr);
    } else if (c === 'rowOnly') {
      const r = rowIndexOf.get(pid!);
      if (r === undefined) continue;
      const arr = rowOnlyByRow.get(r) ?? [];
      arr.push(n);
      rowOnlyByRow.set(r, arr);
    } else if (c === 'stageOnly') {
      const col = colIndexOf.get(sid!);
      if (col === undefined) continue;
      const arr = stageOnlyByCol.get(col) ?? [];
      arr.push(n);
      stageOnlyByCol.set(col, arr);
    }
  }
  for (const arr of cells.values()) arr.sort(levelCmp);
  for (const arr of stageOnlyByCol.values()) arr.sort(levelCmp);
  for (const arr of rowOnlyByRow.values()) arr.sort(levelCmp);

  const colW = new Array<number>(cols.length).fill(0);
  const bumpW = (c: number, w: number) => {
    if (w > colW[c]) colW[c] = w;
  };
  for (const [k, arr] of cells) {
    const c = Number(k.slice(k.indexOf('_') + 1));
    for (const n of arr) bumpW(c, sizeOf(n).w);
  }
  for (const [c, arr] of stageOnlyByCol) for (const n of arr) bumpW(c, sizeOf(n).w);

  const colXs = new Array<number>(cols.length).fill(0);
  let cx = START_X;
  for (let c = 0; c < cols.length; c++) {
    colXs[c] = cx;
    cx += colW[c] + CELL_PAD_X * 2 + COL_GAP;
  }
  const colRights = colXs.map((x, i) => x + colW[i] + CELL_PAD_X * 2);

  const rowContent = new Map<number, number>();
  for (const [k, arr] of cells) {
    const r = Number(k.slice(0, k.indexOf('_')));
    let h = 0;
    for (const n of arr) h += sizeOf(n).h + STACK_GAP;
    const sum = Math.max(0, h - STACK_GAP);
    const cur = rowContent.get(r) ?? 0;
    if (sum > cur) rowContent.set(r, sum);
  }
  for (const [r, arr] of rowOnlyByRow) {
    let h = 0;
    for (const n of arr) h += sizeOf(n).h + STACK_GAP;
    const sum = Math.max(0, h - STACK_GAP);
    const cur = rowContent.get(r) ?? 0;
    if (sum > cur) rowContent.set(r, sum);
  }

  const rowYs = new Map<number, number>();
  const rowBottoms = new Map<number, number>();
  let ry = START_Y;
  for (const r of rows) {
    const ri = rowIndexOf.get(r.participantId)!;
    rowYs.set(ri, ry);
    const content = rowContent.get(ri);
    const h = content !== undefined && content > 0 ? content : EMPTY_ROW_H;
    rowBottoms.set(ri, ry + h);
    ry += h + ROW_GAP;
  }

  const firstRow = rowIndexOf.get(rows[0]?.participantId ?? '');
  const lastRow = rowIndexOf.get(rows[rows.length - 1]?.participantId ?? '');
  const rowT = firstRow !== undefined ? rowYs.get(firstRow)! : START_Y;
  const rowB = lastRow !== undefined ? rowBottoms.get(lastRow)! : ry;
  const colL = colXs[0] ?? START_X;
  const colR = cols.length > 0 ? colRights[colRights.length - 1] : START_X;

  const colOf = new Map<string, number>();
  const rowOf = new Map<string, number>();
  for (const n of topNodes) {
    const c = cls.get(n.id)!;
    const pid = pidOf(n);
    const sid = stageIdOf(n);
    if ((c === 'assigned' || c === 'stageOnly') && sid) {
      const ci = colIndexOf.get(sid);
      if (ci !== undefined) colOf.set(n.id, ci);
    }
    if ((c === 'assigned' || c === 'rowOnly') && pid) {
      const ri = rowIndexOf.get(pid);
      if (ri !== undefined) rowOf.set(n.id, ri);
    }
  }
  return { colOf, rowOf, colXs, colRights, rowYs, rowBottoms, colL, colR, rowT, rowB };
}

/* ------------------------------------------------------------------ */
/* 3. 落位:assigned → (row,col);rowOnly → 行内延伸;stageOnly → 列内    */
/* ------------------------------------------------------------------ */
function placeBandMembers(input: SpikeInput, cls: Map<string, NodeClass>, grid: Grid): Map<string, Placed> {
  const { topNodes } = topScope(input.nodes);
  const byId = new Map(topNodes.map((n) => [n.id, n]));
  const topEdges = input.edges.filter((e) => byId.has(e.source) && byId.has(e.target));
  const level = computeLevels(topNodes, topEdges);
  const lvl = (id: string) => level.get(id) ?? 0;

  const result = new Map<string, Placed>();

  // assigned:(row,col) cell 内按拓扑层级堆叠
  const cellCursor = new Map<string, number>();
  for (const n of topNodes) {
    if (cls.get(n.id) !== 'assigned') continue;
    const r = grid.rowOf.get(n.id);
    const col = grid.colOf.get(n.id);
    if (r === undefined || col === undefined) continue;
    const baseY = grid.rowYs.get(r);
    if (baseY === undefined) continue;
    const k = `${r}_${col}`;
    const cur = cellCursor.get(k) ?? 0;
    result.set(n.id, { x: grid.colXs[col] + CELL_PAD_X, y: baseY + cur });
    cellCursor.set(k, cur + sizeOf(n).h + STACK_GAP);
  }

  // rowOnly:该 participant 行带内、stage 列区右缘之外的延伸区
  const rightBound = grid.colR;
  const rowCursor = new Map<number, number>();
  for (const n of topNodes) {
    if (cls.get(n.id) !== 'rowOnly') continue;
    const r = grid.rowOf.get(n.id);
    if (r === undefined) continue;
    const baseY = grid.rowYs.get(r);
    if (baseY === undefined) continue;
    const cur = rowCursor.get(r) ?? 0;
    result.set(n.id, { x: rightBound + EXTEND_X, y: baseY + cur });
    rowCursor.set(r, cur + sizeOf(n).h + STACK_GAP);
  }

  // stageOnly:其 stage 列内纵向排列(y 起点避开同列 assigned 已占区域)
  const colAssignedBottom = new Map<number, number>();
  for (const n of topNodes) {
    if (cls.get(n.id) !== 'assigned') continue;
    const col = grid.colOf.get(n.id);
    const p = result.get(n.id);
    if (col === undefined || !p) continue;
    const bottom = p.y + sizeOf(n).h;
    const cur = colAssignedBottom.get(col) ?? 0;
    if (bottom > cur) colAssignedBottom.set(col, bottom);
  }
  const colCursor = new Map<number, number>();
  const stageOnly = topNodes
    .filter((n) => cls.get(n.id) === 'stageOnly')
    .sort((a, b) => lvl(a.id) - lvl(b.id) || (a.id < b.id ? -1 : 1));
  for (const n of stageOnly) {
    const col = grid.colOf.get(n.id);
    if (col === undefined) continue;
    const start = colAssignedBottom.get(col) ?? START_Y;
    const cur = colCursor.get(col) ?? start;
    result.set(n.id, { x: grid.colXs[col] + CELL_PAD_X, y: cur });
    colCursor.set(col, cur + sizeOf(n).h + STACK_GAP);
  }

  return result;
}

/* ------------------------------------------------------------------ */
/* 4. free:先局部单轴避让,不无理由弹四角                                 */
/* ------------------------------------------------------------------ */
function zoneHit(r: { x: number; y: number; w: number; h: number }, grid: Grid): boolean {
  const yHit = r.y < grid.rowB && r.y + r.h > grid.rowT;
  const xHit = r.x < grid.colR && r.x + r.w > grid.colL;
  return yHit || xHit;
}

const AXIS_PRIORITY: Record<string, number> = { down: 0, right: 1, up: 2, left: 3, tl: 4, bl: 5, tr: 6, br: 7 };

function placeFree(
  input: SpikeInput,
  cls: Map<string, NodeClass>,
  grid: Grid,
  base: Map<string, Placed>,
): { placed: Map<string, Placed>; moves: FreeMove[]; kept: string[] } {
  const { topNodes } = topScope(input.nodes);
  const idSet = new Set(topNodes.map((n) => n.id));
  const placedSet = new Set(base.keys());
  const isPlacedTop = (id: string) => placedSet.has(id) && cls.get(id) !== 'free';

  const roleOf = (id: string): { asSource: boolean; asTarget: boolean } => {
    let asSource = false;
    let asTarget = false;
    for (const e of input.edges) {
      if (!idSet.has(e.source) || !idSet.has(e.target)) continue;
      if (e.source === id && isPlacedTop(e.target)) asSource = true;
      if (e.target === id && isPlacedTop(e.source)) asTarget = true;
    }
    return { asSource, asTarget };
  };

  const result = new Map(base);
  const moves: FreeMove[] = [];
  const kept: string[] = [];

  const frees = topNodes.filter((n) => cls.get(n.id) === 'free');
  for (const n of frees) {
    const { w, h } = sizeOf(n);
    const x = n.position.x;
    const y = n.position.y;
    if (!zoneHit({ x, y, w, h }, grid)) {
      kept.push(n.id);
      continue;
    }
    const { asSource, asTarget } = roleOf(n.id);
    const cands = [
      { dx: 0, dy: grid.rowB + CLEAR - y, axis: 'down' },
      { dx: 0, dy: grid.rowT - CLEAR - (y + h), axis: 'up' },
      { dx: grid.colR + CLEAR - x, dy: 0, axis: 'right' },
      { dx: grid.colL - CLEAR - (x + w), dy: 0, axis: 'left' },
    ];
    const clearAt = (c: { dx: number; dy: number }) => !zoneHit({ x: x + c.dx, y: y + c.dy, w, h }, grid);
    const distOf = (c: { dx: number; dy: number }) => Math.abs(c.dx) + Math.abs(c.dy);
    const score = (c: { dx: number; dy: number; axis: string }) => {
      let d = distOf(c);
      // 方向偏好:作为 source(上游)时惩罚向下/向右;作为 target(下游)时惩罚向上/向左
      const downOrRight = c.axis === 'down' || c.axis === 'right';
      if (asSource && !asTarget && downOrRight) d *= 1.25;
      if (asTarget && !asSource && !downOrRight) d *= 1.25;
      return d;
    };

    const singles = cands
      .filter((c) => clearAt(c))
      .sort((a, b) => score(a) - score(b) || distOf(a) - distOf(b) || AXIS_PRIORITY[a.axis] - AXIS_PRIORITY[b.axis]);
    let pick: { dx: number; dy: number };
    if (singles.length > 0) {
      pick = { dx: singles[0].dx, dy: singles[0].dy };
    } else {
      const corners: { dx: number; dy: number; axis: string }[] = [
        { dx: grid.colL - CLEAR - w - x, dy: grid.rowT - CLEAR - h - y, axis: 'tl' },
        { dx: grid.colL - CLEAR - w - x, dy: grid.rowB + CLEAR - y, axis: 'bl' },
        { dx: grid.colR + CLEAR - x, dy: grid.rowT - CLEAR - h - y, axis: 'tr' },
        { dx: grid.colR + CLEAR - x, dy: grid.rowB + CLEAR - y, axis: 'br' },
      ];
      corners.sort((a, b) => distOf(a) - distOf(b) || AXIS_PRIORITY[a.axis] - AXIS_PRIORITY[b.axis]);
      pick = corners[0];
    }
    const nx = Math.round(x + pick.dx);
    const ny = Math.round(y + pick.dy);
    result.set(n.id, { x: nx, y: ny });
    moves.push({ id: n.id, from: { x, y }, to: { x: nx, y: ny }, dist: Math.abs(pick.dx) + Math.abs(pick.dy) });
  }
  return { placed: result, moves, kept };
}

/* ------------------------------------------------------------------ */
/* 5. 度量与校验                                                       */
/* ------------------------------------------------------------------ */
function evaluate(
  input: SpikeInput,
  cls: Map<string, NodeClass>,
  positions: Map<string, Placed>,
  grid: Grid,
  freeMoves: FreeMove[],
  freeKept: string[],
): SpikeMetrics {
  const { topNodes } = topScope(input.nodes);
  const byId = new Map(topNodes.map((n) => [n.id, n]));

  const stageOnly = [...cls.entries()].filter(([, c]) => c === 'stageOnly').map(([id]) => id);
  const stageOnlyMisclassified: string[] = [];
  const stageOnlyInColumns: string[] = [];
  for (const id of stageOnly) {
    const n = byId.get(id);
    const ci = grid.colOf.get(id);
    const p = positions.get(id);
    if (!n || ci === undefined || !p) {
      stageOnlyMisclassified.push(id);
      continue;
    }
    const inside = p.x >= grid.colXs[ci] && p.x + sizeOf(n).w <= grid.colRights[ci];
    if (inside) stageOnlyInColumns.push(id);
    else stageOnlyMisclassified.push(id);
  }

  const stageAxisAligned = [...grid.colOf.entries()].every(([id, ci]) => {
    const n = byId.get(id);
    const p = positions.get(id);
    if (!n || !p) return true;
    return p.x >= grid.colXs[ci] && p.x + sizeOf(n).w <= grid.colRights[ci];
  });
  const participantAxisAligned = [...grid.rowOf.entries()].every(([id, ri]) => {
    const p = positions.get(id);
    if (!p) return true;
    const top = grid.rowYs.get(ri) ?? 0;
    const bot = grid.rowBottoms.get(ri) ?? top;
    return p.y >= top && p.y + sizeOf(byId.get(id)!).h <= bot;
  });

  const xConflicts: Conflict[] = [];
  const yConflicts: Conflict[] = [];
  let okCount = 0;
  let totalCount = 0;
  for (const e of input.edges) {
    if (!byId.has(e.source) || !byId.has(e.target)) continue;
    const s = positions.get(e.source);
    const t = positions.get(e.target);
    if (!s || !t) continue;
    totalCount += 1;
    if (s.x <= t.x) okCount += 1;
    else xConflicts.push({ source: e.source, target: e.target, kind: 'x-reverse' });
    const freePair = cls.get(e.source) === 'free' || cls.get(e.target) === 'free';
    if (!freePair && s.y > t.y) {
      yConflicts.push({ source: e.source, target: e.target, kind: 'y-reverse' });
    }
  }

  return {
    stageAxisAligned,
    participantAxisAligned,
    stageOnlyInColumns,
    stageOnlyMisclassified,
    yConflicts,
    xOrderSatisfied: totalCount === 0 ? 1 : okCount / totalCount,
    xConflicts,
    freeMoves,
    freeKept,
  };
}

/* ------------------------------------------------------------------ */
/* 6. 顶层入口                                                          */
/* ------------------------------------------------------------------ */
export function runSpike(input: SpikeInput): SpikeResult {
  const cls = classifyNodes(input);
  const grid = buildGrid(input, cls);
  const base = placeBandMembers(input, cls, grid);
  const { placed, moves, kept } = placeFree(input, cls, grid, base);

  const metrics = evaluate(input, cls, placed, grid, moves, kept);
  return { classified: cls, spike: placed, metrics };
}

export const spikeConstants = { START_X, START_Y, CELL_PAD_X, EMPTY_ROW_H };
