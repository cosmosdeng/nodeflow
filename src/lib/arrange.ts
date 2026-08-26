import type { FlowEdge, FlowNode, Organization, Participant, ViewportState } from '../types';
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
