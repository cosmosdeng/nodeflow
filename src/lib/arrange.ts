import type { FlowEdge, FlowNode, Organization, Participant, Stage, ViewportState } from '../types';
import { getNodeSize } from './composite';
import { computeLayout } from './layout';

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

/**
 * 计算 Unified Matrix Arrange 后的节点目标位置。
 *
 * 语义 → 几何映射:
 * - Participant → Y 行:顺序 = participantOrder(有效参与方)+ 未列入者追加;
 *   non-empty 行在前,empty 行(无 Arrange scope Node)按名称稳定排序置于之后;
 *   unassigned(participantId 缺失/指向不存在)节点归入尾随独立行。
 * - Stage → X 列:顺序 = stageOrder(有效 stage)+ 未列入者追加;
 *   无 stage membership 的节点归入尾随独立列(哨兵列,不创建虚拟 Stage)。
 * - 同一 (Participant, Stage) cell 内多个 Node 沿 Y 纵向堆叠,次序 = position.y → x → id。
 * - 只处理可见的顶层 Node(排除任意 composite.childIds 成员);不修改任何 semantic 数据。
 *
 * 纯函数 / deterministic / 不修改输入 / 不使用 viewport 坐标。
 */
export function computeMatrixLayout(input: {
  nodes: readonly FlowNode[];
  participants: readonly Participant[];
  participantOrder: readonly string[];
  stages: readonly Stage[];
  stageOrder: readonly string[];
}): Map<string, { x: number; y: number }> {
  const { nodes, participants, participantOrder, stages, stageOrder } = input;
  const result = new Map<string, { x: number; y: number }>();

  const participantById = new Map(participants.map((p) => [p.id, p]));
  const stageById = new Map(stages.map((st) => [st.id, st]));

  // 顶层 scope:可见且不是任何组合的 child
  const compositeChildIds = new Set<string>();
  for (const n of nodes) {
    for (const cid of n.data?.composite?.childIds ?? []) compositeChildIds.add(cid);
  }
  const top = nodes.filter((n) => !n.hidden && !compositeChildIds.has(n.id));

  // Participant 行顺序:participantOrder(有效)+ 追加未列入;non-empty → empty(name 稳定排序)
  const orderedIds = participantOrder.filter((id) => participantById.has(id));
  const orderedSet = new Set(orderedIds);
  const restIds = participants.filter((p) => !orderedSet.has(p.id)).map((p) => p.id);
  const baseRowIds = [...orderedIds, ...restIds];

  const nonEmptyRows: string[] = [];
  const emptyRows: string[] = [];
  for (const pid of baseRowIds) {
    const hasMember = top.some((n) => n.data?.participantId === pid);
    (hasMember ? nonEmptyRows : emptyRows).push(pid);
  }
  emptyRows.sort((a, b) => {
    const na = participantById.get(a)!.name;
    const nb = participantById.get(b)!.name;
    const cmp = na.localeCompare(nb, 'zh-CN', { sensitivity: 'base', numeric: true });
    return cmp || (a < b ? -1 : a > b ? 1 : 0);
  });
  const assignedRowIds = [...nonEmptyRows, ...emptyRows];
  const rowIndexOf = new Map(assignedRowIds.map((id, idx) => [id, idx]));

  // Stage 列顺序:stageOrder(有效)+ 追加未列入
  const colStageIds = stageOrder.filter((id) => stageById.has(id));
  const colStageSet = new Set(colStageIds);
  for (const st of stages) {
    if (!colStageSet.has(st.id)) {
      colStageIds.push(st.id);
      colStageSet.add(st.id);
    }
  }
  const UNASSIGNED_COL = colStageIds.length; // 尾随 unassigned 列 index(不创建虚拟 Stage)
  const colCount = UNASSIGNED_COL + 1;

  /** 节点归属列:按列序取首个含它的 stage;都不含 → 哨兵 unassigned 列 */
  const colIndexOfNode = (n: FlowNode): number => {
    for (let i = 0; i < colStageIds.length; i++) {
      const st = stageById.get(colStageIds[i])!;
      if (st.nodeIds.includes(n.id)) return i;
    }
    return UNASSIGNED_COL;
  };

  // 归类到 cell(row,col),row 为参与方 index 或尾随 unassigned 行 index
  const UNASSIGNED_ROW = assignedRowIds.length;
  const cellKey = (r: number, c: number) => `${r}_${c}`;
  const cells = new Map<string, { n: FlowNode; stackY: number }[]>();
  let hasUnassignedRow = false;
  const pushCell = (r: number, c: number, n: FlowNode) => {
    const k = cellKey(r, c);
    const arr = cells.get(k) ?? [];
    arr.push({ n, stackY: 0 });
    cells.set(k, arr);
  };
  for (const n of top) {
    const pid = n.data?.participantId;
    if (pid && participantById.has(pid)) {
      pushCell(rowIndexOf.get(pid)!, colIndexOfNode(n), n);
    } else {
      hasUnassignedRow = true;
      pushCell(UNASSIGNED_ROW, colIndexOfNode(n), n); // unassigned participant → 尾随行
    }
  }

  // 同 cell 排序 + 纵向堆叠偏移(position.y → x → id)
  for (const arr of cells.values()) {
    arr.sort(
      (a, b) =>
        a.n.position.y - b.n.position.y ||
        a.n.position.x - b.n.position.x ||
        (a.n.id < b.n.id ? -1 : a.n.id > b.n.id ? 1 : 0),
    );
    let y = 0;
    for (const it of arr) {
      it.stackY = y;
      y += getNodeSize(it.n).h + MATRIX_STACK_GAP;
    }
  }

  // 列宽(跨所有行取该列最大节点宽)+ 列 X
  const colWidths = new Array<number>(colCount).fill(0);
  for (const [k, arr] of cells) {
    const c = Number(k.slice(k.indexOf('_') + 1));
    for (const it of arr) {
      const w = getNodeSize(it.n).w;
      if (w > colWidths[c]) colWidths[c] = w;
    }
  }
  const colX = new Array<number>(colCount).fill(0);
  let cx = MATRIX_START_X;
  for (let c = 0; c < colCount; c++) {
    colX[c] = cx;
    cx += colWidths[c] + MATRIX_CELL_PAD_X * 2 + MATRIX_COL_GAP;
  }

  // 行内容高度(每 cell 顶部对齐;行高 = 该行最大 cell 堆叠高度)
  const rowHeights = new Map<number, number>();
  for (const [k, arr] of cells) {
    const r = Number(k.slice(0, k.indexOf('_')));
    const last = arr[arr.length - 1];
    const h = last ? last.stackY + getNodeSize(last.n).h : 0;
    const cur = rowHeights.get(r) ?? 0;
    if (h > cur) rowHeights.set(r, h);
  }

  // 行 Y:assigned 行(non-empty 行高 = 内容;empty 行 = 固定视觉带),unassigned 行尾随
  const rowY = new Map<number, number>();
  let ry = MATRIX_START_Y;
  for (const pid of assignedRowIds) {
    const r = rowIndexOf.get(pid)!;
    rowY.set(r, ry);
    const content = rowHeights.get(r) ?? 0;
    ry += (content > 0 ? content : MATRIX_EMPTY_ROW_H) + MATRIX_ROW_GAP;
  }
  if (hasUnassignedRow) {
    rowY.set(UNASSIGNED_ROW, ry);
  }

  // 写位置(cell 内容顶部对齐于行顶;列内左对齐 + cell pad)
  for (const [k, arr] of cells) {
    const r = Number(k.slice(0, k.indexOf('_')));
    const c = Number(k.slice(k.indexOf('_') + 1));
    const baseY = rowY.get(r);
    if (baseY === undefined) continue;
    const baseX = colX[c] + MATRIX_CELL_PAD_X;
    for (const it of arr) {
      result.set(it.n.id, { x: baseX, y: baseY + it.stackY });
    }
  }
  return result;
}
