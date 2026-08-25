import type { FlowNode, Stage } from '../types';
import { getNodeSize } from './composite';

/** 阶段域与节点的完全包含判定:节点完全位于域内才归属 */
export function stageContainsNode(
  st: Pick<Stage, 'x' | 'y' | 'width' | 'height'>,
  nx: number,
  ny: number,
  w: number,
  h: number,
): boolean {
  return nx >= st.x && ny >= st.y && nx + w <= st.x + st.width && ny + h <= st.y + st.height;
}

/**
 * 计算每个可见节点归属的阶段域(完全包含判定)。
 * 返回 Map<nodeId, stageId>;一个节点只归属一个域(首个匹配的)。
 */
export function computeStageMembership(
  nodes: readonly FlowNode[],
  stages: readonly Stage[],
): Map<string, string> {
  const owned = new Map<string, string>();
  for (const n of nodes) {
    if (n.hidden) continue;
    const { w, h } = getNodeSize(n);
    for (const st of stages) {
      if (stageContainsNode(st, n.position.x, n.position.y, w, h)) {
        owned.set(n.id, st.id);
        break;
      }
    }
  }
  return owned;
}

/**
 * 把一批节点从所有阶段域中脱离,返回新的 stages 数组。
 * 不修改原数组。
 */
export function detachNodeIdsFromStages(stages: readonly Stage[], nodeIds: readonly string[]): Stage[] {
  const ids = new Set(nodeIds);
  return stages.map((st) =>
    st.nodeIds.some((n) => ids.has(n)) ? { ...st, nodeIds: st.nodeIds.filter((n) => !ids.has(n)) } : st,
  );
}

/**
 * 把节点加入某阶段域;若已在其它域则先移出(一节点只属一个域)。
 * 返回新的 stages 数组,不修改原数组。
 */
export function addNodeToStage(stages: readonly Stage[], stageId: string, nodeId: string): Stage[] {
  return stages.map((st) => {
    if (st.id === stageId) {
      return st.nodeIds.includes(nodeId) ? st : { ...st, nodeIds: [...st.nodeIds, nodeId] };
    }
    return st.nodeIds.includes(nodeId) ? { ...st, nodeIds: st.nodeIds.filter((n) => n !== nodeId) } : st;
  });
}

/**
 * 计算阶段域覆盖所有归属可见节点所需的最小尺寸(含内边距 pad),
 * 并叠加绝对最小尺寸(minW / minH)。返回 { minW, minH }。
 */
export function computeStageMinSize(
  stage: Pick<Stage, 'x' | 'y' | 'nodeIds'>,
  nodes: readonly FlowNode[],
  pad: number,
  minW = 140,
  minH = 100,
): { minW: number; minH: number } {
  let mw = minW;
  let mh = minH;
  for (const nid of stage.nodeIds) {
    const n = nodes.find((x) => x.id === nid);
    if (!n || n.hidden) continue;
    const { w, h } = getNodeSize(n);
    mw = Math.max(mw, n.position.x + w - stage.x + pad);
    mh = Math.max(mh, n.position.y + h - stage.y + pad);
  }
  return { minW: mw, minH: mh };
}

/**
 * 计算一批归属可见节点的包围盒(流坐标)。
 * 无可见节点时返回 null。
 */
export function computeStageBounds(
  nodeIds: readonly string[],
  nodes: readonly FlowNode[],
): { minX: number; minY: number; maxX: number; maxY: number } | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const nid of nodeIds) {
    const n = nodes.find((x) => x.id === nid);
    if (!n || n.hidden) continue;
    const { w, h } = getNodeSize(n);
    minX = Math.min(minX, n.position.x);
    minY = Math.min(minY, n.position.y);
    maxX = Math.max(maxX, n.position.x + w);
    maxY = Math.max(maxY, n.position.y + h);
  }
  if (minX === Infinity) return null;
  return { minX, minY, maxX, maxY };
}

/** 由包围盒 + 内边距推出目标域框 */
export function boundsToStageBox(
  b: { minX: number; minY: number; maxX: number; maxY: number },
  pad: number,
): { x: number; y: number; width: number; height: number } {
  return {
    x: b.minX - pad,
    y: b.minY - pad,
    width: b.maxX - b.minX + pad * 2,
    height: b.maxY - b.minY + pad * 2,
  };
}
