import type { FlowEdge, FlowNode, Organization, Participant, Stage, ViewportState } from '../types';
import { getNodeSize } from './composite';
import { computeLayout, computeLevels } from './layout';
import { classifyMatrixNode, hasValidParticipant, hasValidStage } from './matrixClassification';
import { computeStageOnlyColumnAnchors } from './stageOnlyAnchor';
import { computeFreeNodePlacements } from './freePlacement';

/** 泳道横向内边距 */
const LANE_PAD_X = 40;
/** 泳道顶/底内边距 */
const LANE_PAD_Y = 24;
/** lane 间距 */
const LANE_GAP = 16;
/** 画布起点 */
const START_X = 80;
const START_Y = 80;

export interface SwimlaneBounds {
  participantId: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * 计算每条泳道的 derived bounds(不持久化)。
 * 依据:node.participantId + node.position + lane order。
 * lane 使用固定的流坐标起点(START_X/START_Y),不依赖 viewport 平移。
 * 纯函数 / deterministic。
 */
export function computeSwimlaneBounds(
  nodes: readonly FlowNode[],
  participants: readonly Participant[],
  order: readonly string[],
  _viewport: ViewportState,
): SwimlaneBounds[] {
  // 确定 lane 顺序:order 中的有效参与方;未在 order 的参与方追加
  const orderedIds = order.filter((id) => participants.some((p) => p.id === id));
  const restIds = participants
    .filter((p) => !orderedIds.includes(p.id))
    .map((p) => p.id);
  const laneIds = [...orderedIds, ...restIds];

  const visible = nodes.filter((n) => !n.hidden);
  const lanes: SwimlaneBounds[] = [];
  let cursorY = START_Y;
  for (const pid of laneIds) {
    const members = visible.filter((n) => n.data?.participantId === pid);
    if (members.length === 0) {
      // 空 lane:保留一条最小高度带
      const height = 60;
      lanes.push({ participantId: pid, x: START_X, y: cursorY, width: 200, height });
      cursorY += height + LANE_GAP;
      continue;
    }
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const n of members) {
      const w = n.measured?.width ?? n.width ?? 200;
      const h = n.measured?.height ?? n.height ?? 60;
      minX = Math.min(minX, n.position.x);
      minY = Math.min(minY, n.position.y);
      maxX = Math.max(maxX, n.position.x + w);
      maxY = Math.max(maxY, n.position.y + h);
    }
    // lane 的 x 取节点包围盒左缘,使 lane 紧贴其节点;高度带由 cursorY 逐条纵向排列
    const x = minX === Infinity ? START_X : minX - LANE_PAD_X;
    const y = cursorY;
    const width = maxX - minX + LANE_PAD_X * 2;
    const height = maxY - minY + LANE_PAD_Y * 2;
    lanes.push({ participantId: pid, x, y, width, height });
    cursorY += height + LANE_GAP;
  }
  return lanes;
}

/**
 * Arrange into Swimlanes:根据 participantId + order 计算节点目标位置。
 * 只移动有 participant 的 node;未分配 node 保持原位。
 * 纯函数 / deterministic / 不修改输入 / 不改变 participantId / stage membership / edge semantics。
 * [Legacy / compatibility path. New product Arrange uses computeMatrixLayout.]
 */
export function arrangeSwimlanes(
  nodes: readonly FlowNode[],
  edges: readonly FlowEdge[],
  participants: readonly Participant[],
  order: readonly string[],
  direction: 'horizontal' | 'vertical',
): Map<string, { x: number; y: number }> {
  const result = new Map<string, { x: number; y: number }>();
  const assigned = nodes.filter((n) => n.data?.participantId);

  // lane 顺序(order 有效参与方 + 未在 order 的追加)
  const orderedIds = order.filter((id) => participants.some((p) => p.id === id));
  const restIds = participants.filter((p) => !orderedIds.includes(p.id)).map((p) => p.id);
  const laneIds = [...orderedIds, ...restIds];

  let cursorY = START_Y;
  for (const pid of laneIds) {
    const members = assigned.filter((n) => n.data?.participantId === pid);
    if (members.length === 0) continue;
    // lane 内用现有 computeLayout 排列(relative positions)
    const layout = computeLayout(members, [...edges], direction);
    // 计算 lane 内 node 的相对包围盒,以水平居中 lane
    const minX = Math.min(...members.map((n) => layout.get(n.id)?.x ?? 0));
    // 把 lane 内 node 放到当前 cursorY 带
    const laneY = cursorY;
    let maxY = laneY;
    for (const m of members) {
      const p = layout.get(m.id);
      if (!p) continue;
      const x = START_X + (p.x - minX);
      const y = laneY + p.y;
      result.set(m.id, { x, y });
      const h = m.measured?.height ?? m.height ?? 60;
      maxY = Math.max(maxY, y + h);
    }
    cursorY = maxY + LANE_GAP;
  }
  return result;
}

/** 从参与方解析其所属组织(用于泳道按组织分组显示,可选) */
export function organizationNameOf(participant: Participant, organizations: readonly Organization[]): string {
  if (!participant.organizationId) return '';
  return organizations.find((o) => o.id === participant.organizationId)?.name ?? '';
}

// ---- Unified Matrix Arrange (P3):Semantic → Geometry ----
// Participant → Y(row)、Stage → X(column)。node.position 为唯一几何权威,纯函数不改输入。
//
// 【产品语义 2026-09 修正】不生成「未分配」尾行/尾列,也不渲染未分配带/文案:
// - 参与矩阵排布(assigned)的节点 = 可见顶层节点 且 participantId 有效 且 存在于某 stage.nodeIds;
// - 其它可见顶层节点 =「游离节点」,Arrange 保持其原位;若当前位置与矩阵行列带区域重叠,
//   就近避让到该矩阵区域外(仍在原位置附近)。

/** 矩阵布局起点(world-space) */
const MATRIX_START_X = 80;
const MATRIX_START_Y = 80;
/** 列间距 */
const MATRIX_COL_GAP = 120;
/** 行间距 */
const MATRIX_ROW_GAP = 80;
/** cell 水平内边距(节点距列左缘) */
const MATRIX_CELL_PAD_X = 24;
/** 同 cell 内节点纵向堆叠间距 */
const MATRIX_STACK_GAP = 40;
/** 空 Participant 行视觉带高(3 × label 高约 20) */
const MATRIX_EMPTY_ROW_H = 60;
/** 游离节点避让到矩阵区域外时的留白(world) */
const FREE_NODE_CLEAR = 16;

/**
 * Shared Matrix 语义序结构 —— P3 Arrange 与 Matrix Rendering 共用同一个
 * row/column semantic ordering contract,避免出现两套独立 order 算法。
 *
 * - rows:参与方视觉行序 = participantOrder(有效)+ 未列出者追加;non-empty 在前,
 *   empty(无 Arrange-scope Node)按名称稳定排序置于之后;顺序只决定 geometry,不改 participantOrder。
 * - cols:Stage 列序 = stageOrder(有效)+ 未列出者追加。
 * - 不包含任何「未分配」哨兵行/列(不创建虚拟 Participant/Stage)。
 *
 * 纯函数 / deterministic / 不修改输入 / 无 Store、React、persistence、UI 依赖。
 */
export interface MatrixGridStructure {
  /** Arrange-scope 顶层节点(可见且非任意组合的 child) */
  topNodes: FlowNode[];
  /** 参与方视觉行序(non-empty → empty) */
  rows: { participantId: string; isEmpty: boolean }[];
  /** participantId → rows index */
  rowIndexOf: Map<string, number>;
  /** Stage 列序(stageOrder 有效 + 未列出者追加) */
  cols: string[];
  /** stageId → cols index */
  colIndexOf: Map<string, number>;
}

/** 计算 shared Matrix 语义序结构(participant row / stage col)。 */
export function computeMatrixGridStructure(input: {
  nodes: readonly FlowNode[];
  participants: readonly Participant[];
  participantOrder: readonly string[];
  stages: readonly Stage[];
  stageOrder: readonly string[];
}): MatrixGridStructure {
  const { nodes, participants, participantOrder, stages, stageOrder } = input;
  const participantById = new Map(participants.map((p) => [p.id, p]));

  // 顶层 scope:可见且不是任何组合的 child
  const compositeChildIds = new Set<string>();
  for (const n of nodes) {
    for (const cid of n.data?.composite?.childIds ?? []) compositeChildIds.add(cid);
  }
  const topNodes = nodes.filter((n) => !n.hidden && !compositeChildIds.has(n.id));

  // Participant 行顺序:participantOrder(有效)+ 追加未列入;non-empty → empty(name 稳定排序)
  const orderedIds = participantOrder.filter((id) => participantById.has(id));
  const orderedSet = new Set(orderedIds);
  const restIds = participants.filter((p) => !orderedSet.has(p.id)).map((p) => p.id);
  const baseRowIds = [...orderedIds, ...restIds];

  const nonEmptyRows: string[] = [];
  const emptyRows: string[] = [];
  for (const pid of baseRowIds) {
    const hasMember = topNodes.some((n) => n.data?.participantId === pid);
    (hasMember ? nonEmptyRows : emptyRows).push(pid);
  }
  emptyRows.sort((a, b) => {
    const na = participantById.get(a)!.name;
    const nb = participantById.get(b)!.name;
    const cmp = na.localeCompare(nb, 'zh-CN', { sensitivity: 'base', numeric: true });
    return cmp || (a < b ? -1 : a > b ? 1 : 0);
  });
  const rows = [...nonEmptyRows, ...emptyRows].map((participantId) => ({
    participantId,
    isEmpty: !topNodes.some((n) => n.data?.participantId === participantId),
  }));
  const rowIndexOf = new Map(rows.map((r, idx) => [r.participantId, idx]));

  // Stage 列顺序:stageOrder(有效)+ 追加未列入
  const cols = stageOrder.filter((id) => stages.some((st) => st.id === id));
  const colSet = new Set(cols);
  for (const st of stages) {
    if (!colSet.has(st.id)) {
      cols.push(st.id);
      colSet.add(st.id);
    }
  }
  const colIndexOf = new Map(cols.map((sid, idx) => [sid, idx]));

  return { topNodes, rows, rowIndexOf, cols, colIndexOf };
}

/**
 * Derived Matrix 几何骨架 —— P3 Arrange 与 Matrix Rendering 共用同一个 geometry
 * 计算,渲染不得复制任何列宽/行高/锚点规则。
 *
 * - cells 只包含「已入矩阵」节点(participant 有效且在某 stage.nodeIds 中)。
 * - colXs/colRights 只覆盖实际 Stage 列;rowYs/rowBottoms 只覆盖实际 Participant 行。
 * - avoidanceZone:矩阵行列带占用区域(world);仅当同时存在 rows 与 cols 时给出,
 *   供 Arrange 对游离节点做「就近避让」、供渲染确认是否绘制矩阵带。
 *
 * 纯函数 / deterministic / 不修改输入。
 */
export interface MatrixGridGeometry {
  structure: MatrixGridStructure;
  /** 已入矩阵的顶层节点集合(participant 有效 + stage membership) */
  assignedNodes: FlowNode[];
  /** 行内节点(participant 有效但无 stage membership):Arrange 排入其 participant 行的带内延伸区 */
  rowOnlyNodes: FlowNode[];
  /** stageOnly 节点(participant 无效但 stage 有效):路由进其 Stage 列,不进入 free */
  stageOnlyNodes: FlowNode[];
  /** 完全游离节点(两轴均无效):不归属任何带,沿用现有避让处理 */
  freeNodes: FlowNode[];
  /** cellKey(`${rowIndex}_${colIndex}`) → 已排序节点(含 stackY);排序 position.y → x → id */
  cells: Map<string, { n: FlowNode; stackY: number }[]>;
  /** 每列(仅实际 Stage 列)的 world X */
  colXs: number[];
  /** 每列内容右缘(world)= colXs[i] + 列最大节点宽 + 2×cell pad */
  colRights: number[];
  /** visual row index → world top(含 empty 行) */
  rowYs: Map<number, number>;
  /** visual row index → 行带底(world)= rowY + 行高(内容/空行高) */
  rowBottoms: Map<number, number>;
  /** 矩阵行列带占用区(rows×cols);无 rows 或 cols 时为 undefined(此时无矩阵带) */
  avoidanceZone?: { l: number; t: number; r: number; b: number };
}

export interface MatrixGridInput {
  nodes: readonly FlowNode[];
  participants: readonly Participant[];
  participantOrder: readonly string[];
  stages: readonly Stage[];
  stageOrder: readonly string[];
}

/**
 * 确定性拓扑排序值:「源在前、目标在后」。
 * - 只对给定 nodes(调用方提供 Arrange scope 的可见顶层节点)与其中 edges 排序;
 * - Kahn 稳定取零入度中 baseIndex(node 列表序)最小者 → 与输入顺序无关?否:结果与 node 输入序相关,
 *   但同一输入确定不变(deterministic);有环时残余节点按 baseIndex 追加。
 * 用途:格内/带内节点按依赖方向稳定排序,避免来回交叉,使节点树沿连线方向可读。
 */
export function computeFlowRank(
  nodes: readonly FlowNode[],
  edges: readonly FlowEdge[],
): Map<string, number> {
  const rank = new Map<string, number>();
  const baseIndex = new Map<string, number>();
  nodes.forEach((n, i) => baseIndex.set(n.id, i));
  const out = new Map<string, string[]>();
  const indeg = new Map<string, number>();
  for (const n of nodes) {
    out.set(n.id, []);
    indeg.set(n.id, 0);
  }
  for (const e of edges) {
    if (!out.has(e.source) || !out.has(e.target)) continue;
    out.get(e.source)!.push(e.target);
    indeg.set(e.target, (indeg.get(e.target) ?? 0) + 1);
  }
  let used = 0;
  while (used < nodes.length) {
    // 零入度中取 node 列表序最小者 → 稳定、确定
    let pick: string | null = null;
    let pickIdx = Infinity;
    for (const n of nodes) {
      if (rank.has(n.id)) continue;
      if ((indeg.get(n.id) ?? 0) !== 0) continue;
      const bi = baseIndex.get(n.id) ?? Infinity;
      if (bi < pickIdx) {
        pick = n.id;
        pickIdx = bi;
      }
    }
    if (pick === null) break; // 剩余为环,下方按 baseIndex 兜底
    rank.set(pick, used);
    used += 1;
    for (const t of out.get(pick)!) {
      indeg.set(t, (indeg.get(t) ?? 0) - 1);
    }
  }
  const rest = nodes
    .filter((n) => !rank.has(n.id))
    .sort((a, b) => (baseIndex.get(a.id) ?? 0) - (baseIndex.get(b.id) ?? 0));
  for (const n of rest) {
    rank.set(n.id, used);
    used += 1;
  }
  return rank;
}

/** rank 优先、稳定回退 position→id 的确定性比较 */
const rankThenPosCompare = (
  a: FlowNode,
  b: FlowNode,
  rankOf?: ReadonlyMap<string, number>,
): number => {
  if (rankOf) {
    const ra = rankOf.get(a.id);
    const rb = rankOf.get(b.id);
    if (ra !== undefined && rb !== undefined && ra !== rb) return ra - rb;
    if (ra !== undefined && rb === undefined) return -1;
    if (ra === undefined && rb !== undefined) return 1;
  }
  return (
    a.position.y - b.position.y ||
    a.position.x - b.position.x ||
    (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  );
};

export interface MatrixGridLayoutOptions {
  /** 仅单 cell 排序用的流序(拓扑)值(无 edges 时使用) */
  rankOf?: ReadonlyMap<string, number>;
  /** 参与方行内连边:存在时启用「跨 Stage 流等级对齐」 */
  edges?: readonly FlowEdge[];
}

/**
 * 同一参与方行内的纵向「流层」分配:
 * - 每行任务含所属 col;对行内连边 u→v:同 col 时 level(v) ≥ level(u)+1,异 col 时 level(v) ≥ level(u);
 * - 同 cell(同 col)内 level 互不相同(冲突顺延),保证下游节点永远不会高于其行内上游;
 * - globalLevels(可选):跨 Participant/跨 Stage 计算的全局拓扑层,作为「就绪节点」选择时的
 *   主要排序参考(global topology 参与行内相对顺序);缺省回退 (col, 列表序)。
 * - 环兜底:确定性取 (global, col, 列表序) 最小者先行。
 * 返回 nodeId → 行内纵向层(非绝对 Y)。纯函数 / deterministic。
 */
const assignFlowLevels = (
  items: { id: string; col: number }[],
  edgePairs: ReadonlyArray<readonly [string, string]>,
  globalLevels?: ReadonlyMap<string, number>,
): Map<string, number> => {
  const colOf = new Map(items.map((it) => [it.id, it.col]));
  const orderOf = new Map(items.map((it, i) => [it.id, i]));
  const gOf = (id: string) => globalLevels?.get(id) ?? Number.MAX_SAFE_INTEGER;
  // 每行内 preferred vertical slot = 该行内节点全局层经压缩后的序号(0..k):
  // global topology 直接成为 Node 在 row 内的 Y placement 参考,而不是只影响队列顺序。
  let prefRank = new Map<string, number>();
  if (globalLevels && items.length > 0) {
    const gs = items
      .map((it) => globalLevels.get(it.id))
      .filter((v): v is number => v !== undefined);
    const uniq = [...new Set(gs)].sort((a, b) => a - b);
    for (const it of items) {
      const g = globalLevels.get(it.id);
      const idx = g === undefined ? -1 : uniq.indexOf(g);
      if (idx >= 0) prefRank.set(it.id, idx);
    }
  }
  const out = new Map<string, string[]>();
  const predsOf = new Map<string, string[]>();
  const indeg = new Map<string, number>();
  for (const it of items) {
    out.set(it.id, []);
    predsOf.set(it.id, []);
    indeg.set(it.id, 0);
  }
  for (const [s, t] of edgePairs) {
    if (!colOf.has(s) || !colOf.has(t) || s === t) continue;
    out.get(s)!.push(t);
    predsOf.get(t)!.push(s);
    indeg.set(t, (indeg.get(t) ?? 0) + 1);
  }
  const levels = new Map<string, number>();
  const usedLevelsByCol = new Map<number, Set<number>>();
  const usedOf = (col: number) => {
    let set = usedLevelsByCol.get(col);
    if (!set) {
      set = new Set();
      usedLevelsByCol.set(col, set);
    }
    return set;
  };
  const pickCmp = (a: string, b: string) => {
    const ga = gOf(a);
    const gb = gOf(b);
    if (globalLevels && ga !== gb) return ga - gb;
    return (colOf.get(a)! - colOf.get(b)!) || (orderOf.get(a)! - orderOf.get(b)!);
  };
  const remaining = new Set(items.map((it) => it.id));
  while (remaining.size > 0) {
    let cands = [...remaining].filter((id) => (indeg.get(id) ?? 0) === 0);
    if (cands.length === 0) {
      // 行内成环:确定性兜底
      cands = [...remaining];
    }
    cands.sort(pickCmp);
    const v = cands[0];
    remaining.delete(v);
    let base = 0;
    for (const p of predsOf.get(v)!) {
      const lp = levels.get(p);
      if (lp === undefined) continue;
      const need = lp + (colOf.get(p) === colOf.get(v) ? 1 : 0);
      if (need > base) base = need;
    }
    // 行内同列依赖(同 cell):硬约束 source 必须在 target 上方;
    // 行内异列:由 local 约束保证 target 不高于 source(preferred 常更大时自然下沉)。
    const pref = prefRank.get(v);
    const minLevel = pref !== undefined && pref > base ? pref : base;
    const used = usedOf(colOf.get(v)!);
    let level = minLevel;
    while (used.has(level)) level += 1;
    used.add(level);
    levels.set(v, level);
    for (const t of out.get(v)!) {
      indeg.set(t, (indeg.get(t) ?? 0) - 1);
    }
  }
  return levels;
};

export function computeMatrixGridGeometry(
  input: MatrixGridInput,
  opts?: MatrixGridLayoutOptions,
): MatrixGridGeometry {
  const { stages } = input;
  const rankOf = opts?.rankOf;
  const stageById = new Map(stages.map((st) => [st.id, st]));
  const structure = computeMatrixGridStructure(input);
  const { topNodes, rows, rowIndexOf, cols } = structure;

  // 分类统一来自 matrixClassification(Phase 2 起 Arrange 不再自行解释轴有效性):
  // assigned → 矩阵 cell;rowOnly → participant 行;stageOnly → 其 Stage 列;free → 现有游离处理。
  const clsOf = new Map(
    topNodes.map((n) => [n.id, classifyMatrixNode(n, { participants: input.participants, stages }).classification]),
  );
  const ofClass = (c: 'assigned' | 'rowOnly' | 'stageOnly' | 'free') =>
    topNodes.filter((n) => clsOf.get(n.id) === c);
  const assignedNodes = ofClass('assigned');
  const rowOnlyNodes = ofClass('rowOnly');
  const stageOnlyNodes = ofClass('stageOnly');
  const freeNodes = ofClass('free');

  // 归类到 cell(row,col)
  const cellKey = (r: number, c: number) => `${r}_${c}`;
  const cells = new Map<string, { n: FlowNode; stackY: number }[]>();
  const pushCell = (r: number, c: number, n: FlowNode) => {
    const k = cellKey(r, c);
    const arr = cells.get(k) ?? [];
    arr.push({ n, stackY: 0 });
    cells.set(k, arr);
  };
  for (const n of assignedNodes) {
    const pid = n.data?.participantId as string;
    const row = rowIndexOf.get(pid);
    if (row === undefined) continue;
    let col = -1;
    for (let i = 0; i < cols.length; i++) {
      if (stageById.get(cols[i])!.nodeIds.includes(n.id)) {
        col = i;
        break;
      }
    }
    if (col < 0) continue;
    pushCell(row, col, n);
  }

  // 列宽(实际 Stage 列 assigned cell + stageOnly 内容)+ 列 X(与排序无关)
  const colCount = cols.length;
  const colWidths = new Array<number>(colCount).fill(0);
  const bumpColW = (c: number, w: number) => {
    if (w > colWidths[c]) colWidths[c] = w;
  };
  for (const [k, arr] of cells) {
    const c = Number(k.slice(k.indexOf('_') + 1));
    for (const it of arr) bumpColW(c, getNodeSize(it.n).w);
  }
  for (const n of stageOnlyNodes) {
    for (let i = 0; i < cols.length; i++) {
      if (stageById.get(cols[i])!.nodeIds.includes(n.id)) {
        bumpColW(i, getNodeSize(n).w);
        break;
      }
    }
  }
  const colXs = new Array<number>(colCount).fill(0);
  let cx = MATRIX_START_X;
  for (let c = 0; c < colCount; c++) {
    colXs[c] = cx;
    cx += colWidths[c] + MATRIX_CELL_PAD_X * 2 + MATRIX_COL_GAP;
  }
  const colRights = colXs.map((x, i) => x + colWidths[i] + MATRIX_CELL_PAD_X * 2);

  const rowHeights = new Map<number, number>();
  const flowEdges = opts?.edges ?? [];
  const flowEnabled =
    rows.length > 0 && cols.length > 0 && flowEdges.length > 0 && assignedNodes.length > 0;

  if (flowEnabled) {
    // 跨 Stage 流等级对齐:同一参与方行内节点共用一个纵轴(下游不高于上游,同格不重叠)。
    const idToNode = new Map<string, FlowNode>();
    const byRowCol = new Map<string, { row: number; col: number }>();
    const byRow = new Map<number, { id: string; col: number }[]>();
    for (const [k, arr] of cells) {
      const r = Number(k.slice(0, k.indexOf('_')));
      const c = Number(k.slice(k.indexOf('_') + 1));
      for (const it of arr) {
        idToNode.set(it.n.id, it.n);
        byRowCol.set(it.n.id, { row: r, col: c });
        const list = byRow.get(r) ?? [];
        list.push({ id: it.n.id, col: c });
        byRow.set(r, list);
      }
    }
    const levels = new Map<string, number>();
    const rowStep = new Map<number, number>();
    // 全局拓扑层(跨 Participant / 跨 Stage 都计入):作为行内 Y 的“主要参考序”,
    // 保证 A(P1)→B(P2)→C(P3) 这类 handoff 不会因行内仅用局部序而各自从 0 漂移。
    const assignedSet = new Set(assignedNodes.map((n) => n.id));
    const scopeEdges = flowEdges.filter((e) => assignedSet.has(e.source) && assignedSet.has(e.target));
    const gLevels = computeLevels(assignedNodes as FlowNode[], scopeEdges);
    for (const [r, list] of byRow) {
      const edgePairs: Array<readonly [string, string]> = [];
      for (const e of flowEdges) {
        const s = byRowCol.get(e.source);
        const t = byRowCol.get(e.target);
        if (s && t && s.row === r && t.row === r) edgePairs.push([e.source, e.target]);
      }
      const lv = assignFlowLevels(list, edgePairs, gLevels);
      for (const [id, level] of lv) levels.set(id, level);
      let maxH = 0;
      for (const it of list) {
        const h = getNodeSize(idToNode.get(it.id)!).h;
        if (h > maxH) maxH = h;
      }
      rowStep.set(r, maxH + MATRIX_STACK_GAP);
    }
    for (const [k, arr] of cells) {
      const r = Number(k.slice(0, k.indexOf('_')));
      const step = rowStep.get(r)!;
      for (const it of arr) {
        it.stackY = (levels.get(it.n.id) ?? 0) * step;
      }
      arr.sort(
        (a, b) =>
          a.stackY - b.stackY ||
          (a.n.id < b.n.id ? -1 : a.n.id > b.n.id ? 1 : 0),
      );
    }
    for (const [r, list] of byRow) {
      const step = rowStep.get(r)!;
      let maxBottom = 0;
      for (const it of list) {
        const level = levels.get(it.id) ?? 0;
        const bottom = level * step + getNodeSize(idToNode.get(it.id)!).h;
        if (bottom > maxBottom) maxBottom = bottom;
      }
      rowHeights.set(r, maxBottom);
    }
  } else {
    // 无连线信息:保持单 cell 内排序 + 堆叠(rank 可选;每行高度 = 最大 cell 堆叠)
    for (const arr of cells.values()) {
      arr.sort((a, b) => rankThenPosCompare(a.n, b.n, rankOf));
      let y = 0;
      for (const it of arr) {
        it.stackY = y;
        y += getNodeSize(it.n).h + MATRIX_STACK_GAP;
      }
    }
    for (const [k, arr] of cells) {
      const r = Number(k.slice(0, k.indexOf('_')));
      const last = arr[arr.length - 1];
      const h = last ? last.stackY + getNodeSize(last.n).h : 0;
      const cur = rowHeights.get(r) ?? 0;
      if (h > cur) rowHeights.set(r, h);
    }
  }

  // 行 Y:assigned 行(non-empty 行高 = 内容;empty 行 = 固定视觉带)
  const rowYs = new Map<number, number>();
  const rowBottoms = new Map<number, number>();
  const bandHeightOf = (ri: number) => {
    const content = rowHeights.get(ri) ?? 0;
    return content > 0 ? content : MATRIX_EMPTY_ROW_H;
  };
  let ry = MATRIX_START_Y;
  for (const r of rows) {
    const ri = rowIndexOf.get(r.participantId)!;
    rowYs.set(ri, ry);
    const bandH = bandHeightOf(ri);
    rowBottoms.set(ri, ry + bandH);
    ry += bandH + MATRIX_ROW_GAP;
  }

  let avoidanceZone: MatrixGridGeometry['avoidanceZone'];
  if (rows.length > 0 && cols.length > 0) {
    const t = rowYs.get(0);
    const b = rowBottoms.get(rows.length - 1);
    if (t !== undefined && b !== undefined) {
      avoidanceZone = { l: colXs[0], t, r: colRights[cols.length - 1], b };
    }
  }

  return {
    structure,
    assignedNodes,
    rowOnlyNodes,
    stageOnlyNodes,
    freeNodes,
    cells,
    colXs,
    colRights,
    rowYs,
    rowBottoms,
    avoidanceZone,
  };
}

/**
 * 计算 Unified Matrix Arrange 后的节点目标位置。
 *
 * - 已入矩阵(participant 有效 + stage 归属)节点排入 (row, col) 网格;
 * - 游离节点保持原位;仅当其当前包围盒与矩阵行列带区域(avoidanceZone)重叠时,
 *   沿位移最小的方向就近避让到区域外(含 FREE_NODE_CLEAR 留白),仍贴近原位;
 * - 不生成任何「未分配」尾行/尾列。
 *
 * 纯函数 / deterministic / 不修改输入 / 不使用 viewport 坐标。
 */
export function computeMatrixLayout(
  input: MatrixGridInput,
  opts?: MatrixGridLayoutOptions,
): Map<string, { x: number; y: number }> {
  const rankOf = opts?.rankOf;
  const result = new Map<string, { x: number; y: number }>();
  const geo = computeMatrixGridGeometry(input, { rankOf, edges: opts?.edges });
  const { structure, cells, colXs, colRights, rowYs, rowOnlyNodes, stageOnlyNodes, freeNodes } = geo;
  const { rows, rowIndexOf, cols, topNodes } = structure;
  const topSet = new Set(topNodes.map((n) => n.id));
  const topEdges = (opts?.edges ?? []).filter((e) => topSet.has(e.source) && topSet.has(e.target));

  // 已入矩阵:写 cell 目标位置;同时记录每列 assigned 矩形(供 Stage-only Anchor 的 envelope floor)
  const colAssigned = new Map<number, { id: string; top: number; h: number }[]>();
  for (const [k, arr] of cells) {
    const r = Number(k.slice(0, k.indexOf('_')));
    const c = Number(k.slice(k.indexOf('_') + 1));
    const baseY = rowYs.get(r);
    if (baseY === undefined) continue;
    const baseX = colXs[c] + MATRIX_CELL_PAD_X;
    const rects = colAssigned.get(c) ?? [];
    for (const it of arr) {
      const y = baseY + it.stackY;
      result.set(it.n.id, { x: baseX, y });
      rects.push({ id: it.n.id, top: y, h: getNodeSize(it.n).h });
    }
    colAssigned.set(c, rects);
  }

  // stageOnly → 其 Stage 列 + Stage-only Y Anchor(正式:C Primary + D 窄化;由 stageOnlyAnchor.ts 负责)
  if (stageOnlyNodes.length > 0) {
    const levelOf = computeLevels([...topNodes], topEdges);
    const lvl = (id: string) => levelOf.get(id) ?? 0;
    const orderIdx = new Map(topNodes.map((n, i) => [n.id, i]));
    const hasTopo = topEdges.length > 0;
    for (const sid of cols) {
      const c = cols.indexOf(sid);
      const members = stageOnlyNodes
        .filter((n) => input.stages.some((st) => st.id === sid && st.nodeIds.includes(n.id)))
        .sort((a, b) => {
          const la = lvl(a.id);
          const lb = lvl(b.id);
          if (la !== lb) return la - lb;
          // 有拓扑信息 → id 破平;无拓扑信息(调用方未提供 edges)→ 原始输入序破平(稳定)
          if (hasTopo) return a.id < b.id ? -1 : 1;
          return (orderIdx.get(a.id) ?? 0) - (orderIdx.get(b.id) ?? 0);
        });
      if (members.length === 0) continue;
      const assignedRects = colAssigned.get(c) ?? [];
      const colIdSet = new Set<string>([
        ...assignedRects.map((a) => a.id),
        ...members.map((m) => m.id),
      ]);
      const colEdges = topEdges.filter((e) => colIdSet.has(e.source) && colIdSet.has(e.target));
      const anchored = computeStageOnlyColumnAnchors({
        assigned: assignedRects,
        stageOnly: members.map((m) => ({ id: m.id, h: getNodeSize(m).h })),
        edges: colEdges,
        columnStartY: MATRIX_START_Y,
        gap: MATRIX_STACK_GAP,
      });
      const baseX = colXs[c] + MATRIX_CELL_PAD_X;
      for (const m of members) {
        const y = anchored.y.get(m.id);
        if (y !== undefined) result.set(m.id, { x: baseX, y });
      }
    }
  }

  // rowOnly(有 participant、无 stage)——统一放入其 participant 行:
  //   · 存在 Stage 语义轴(cols>0):仍为 Stage 列区右缘之外的带内延伸(与既有 dual 行为一致);
  //   · 无 Stage 语义轴(cols==0,participant-only):整行横向 slot(不制造虚拟 Stage 列)。
  if (rowOnlyNodes.length > 0) {
    const hasStageAxis = cols.length > 0;
    const rightBound = hasStageAxis ? colRights[colRights.length - 1] : START_X - MATRIX_CELL_PAD_X;
    for (const r of rows) {
      const ri = rowIndexOf.get(r.participantId);
      const rowTop = ri !== undefined ? rowYs.get(ri) : undefined;
      if (rowTop === undefined) continue;
      const members = rowOnlyNodes.filter((n) => n.data?.participantId === r.participantId);
      if (members.length === 0) continue;
      members.sort((a, b) => rankThenPosCompare(a, b, rankOf));
      let curY = rowTop;
      if (hasStageAxis) {
        const extX = rightBound + FREE_NODE_CLEAR;
        for (const m of members) {
          result.set(m.id, { x: extX, y: curY });
          curY += getNodeSize(m).h + FREE_NODE_CLEAR;
        }
      } else {
        // participant-only:同一行带内横向排布(X 无 Stage 语义约束 → 由输入稳定序决定,确定性)
        const slotW = Math.max(...members.map((m) => getNodeSize(m).w)) + MATRIX_STACK_GAP;
        let x = START_X;
        for (const m of members) {
          result.set(m.id, { x, y: rowTop });
          x += slotW;
        }
      }
    }
  }

  // free → 正式 Free Placement(Phase 4B;obstacle = 最终落位的 assigned/rowOnly/stageOnly 矩形,
  // 多个 free 依输入序顺序 settle;Band 不是 obstacle;free 是最后适应既有布局的对象)。
  if (freeNodes.length > 0) {
    const clsOf = (n: FlowNode) =>
      classifyMatrixNode(n, { participants: input.participants, stages: input.stages }).classification;
    const occupied = topNodes
      .filter((n) => clsOf(n) !== 'free' && result.has(n.id))
      .map((n) => ({
        id: n.id,
        rect: {
          x: result.get(n.id)!.x,
          y: result.get(n.id)!.y,
          w: getNodeSize(n).w,
          h: getNodeSize(n).h,
        },
      }));
    const freeItems = freeNodes.map((n) => ({
      id: n.id,
      rect: {
        x: n.position.x,
        y: n.position.y,
        w: getNodeSize(n).w,
        h: getNodeSize(n).h,
      },
    }));
    const placement = computeFreeNodePlacements({
      occupied,
      free: freeItems,
      edges: topEdges,
      gap: FREE_NODE_CLEAR,
      maxSteps: 4,
    });
    for (const [id, p] of placement.positions) {
      result.set(id, { x: p.x, y: p.y });
    }
  }

  return result;
}
