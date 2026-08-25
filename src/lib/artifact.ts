import type { Artifact, FlowEdge, FlowEdgeData } from '../types';

/** 在一条边上设置 / 清除中间产物,返回新的边 */
export function setEdgeArtifact(
  edge: FlowEdge,
  artifact: Artifact | null,
): FlowEdge {
  return {
    ...edge,
    data: { ...(edge.data ?? { label: '', artifact: null }), artifact } as FlowEdgeData,
  };
}

/** 更新一条边的中间产物字段(仅当存在产物时),返回新的边 */
export function updateEdgeArtifact(
  edge: FlowEdge,
  patch: Partial<Artifact>,
): FlowEdge {
  if (!edge.data?.artifact) return edge;
  return {
    ...edge,
    data: { ...edge.data, artifact: { ...edge.data.artifact, ...patch } } as FlowEdgeData,
  };
}

/** 判断某条边是否挂了中间产物 */
export function hasArtifact(edge: FlowEdge): boolean {
  return !!edge.data?.artifact;
}
