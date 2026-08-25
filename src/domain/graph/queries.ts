import type { FlowNode, FlowEdge } from '../../types';

/**
 * P5-02 Graph Domain — 纯查询
 *
 * 与 React / Zustand / Electron 完全解耦,可独立测试。
 * 目标:让 Store 调用有业务语义的查询,而不是散落各处的手写 `nodes.find(...)`。
 */

export function findNodeById(nodes: readonly FlowNode[], id: string): FlowNode | undefined {
  return nodes.find((n) => n.id === id);
}

export function findEdgeById(edges: readonly FlowEdge[], id: string): FlowEdge | undefined {
  return edges.find((e) => e.id === id);
}

/** 批量按 id 查找节点(返回存在的节点) */
export function findNodesByIds(nodes: readonly FlowNode[], ids: Iterable<string>): FlowNode[] {
  const set = new Set(ids);
  return nodes.filter((n) => set.has(n.id));
}

/** 查找引用指定节点(作为 source 或 target)的所有连线 */
export function findEdgesForNode(edges: readonly FlowEdge[], nodeId: string): FlowEdge[] {
  return edges.filter((e) => e.source === nodeId || e.target === nodeId);
}

/** 节点是否被任何连线引用(作为 source 或 target) */
export function isNodeReferencedByEdge(edges: readonly FlowEdge[], nodeId: string): boolean {
  return edges.some((e) => e.source === nodeId || e.target === nodeId);
}

/** 连线是否悬空(其 source 或 target 节点在当前节点集中不存在) */
export function isEdgeDangling(edges: readonly FlowEdge[], nodes: readonly FlowNode[], edgeId: string): boolean {
  const e = findEdgeById(edges, edgeId);
  if (!e) return true;
  const idSet = new Set(nodes.map((n) => n.id));
  return !idSet.has(e.source) || !idSet.has(e.target);
}

/** 检查 id 集合是否唯一(重复返回重复的 id 列表) */
export function findDuplicateIds(ids: Iterable<string>): string[] {
  const seen = new Set<string>();
  const dup: string[] = [];
  for (const id of ids) {
    if (seen.has(id)) dup.push(id);
    seen.add(id);
  }
  return dup;
}
