/**
 * agentRevision —— Graph Runtime 统一观察修订号(A-001)。
 * 以「Agent 可观察的 Graph 语义」为指纹推进 revision。
 */
import type { FlowStore } from './types';

/* ------------------------------------------------------------------ */
/* agentRevision —— Graph Runtime 统一观察修订号(A-001)                */
/* ------------------------------------------------------------------ */
/**
 * 以「Agent 可观察的 Graph 语义」为指纹(node/edge/participant/stage/
 * participantOrder/stageOrder/arrangePending)。任何来源(GUI Store Action、
 * Agent Command、Undo/Redo)只要让该指纹变化,就推进 agentRevision。
 *
 * - 纯 Query 不改 state → 不触发;
 * - viewport/selection/show 开关等 runtime 视图态不属 Graph mutation → 不触发;
 * - agentRevision 本身不进指纹 → 不会自激递归;
 * - 不进入 markHistory/GraphSnapshot/.nodeflow 持久化(与历史完全独立)。
 */
export function graphObservableFingerprint(s: FlowStore): string {
  const stageOf = new Map<string, string>();
  for (const st of s.stages) {
    for (const nid of st.nodeIds) if (!stageOf.has(nid)) stageOf.set(nid, st.id);
  }
  return JSON.stringify({
    nodes: s.nodes.map((n) => [
      n.id,
      n.position?.x ?? 0,
      n.position?.y ?? 0,
      n.data?.label ?? '',
      n.data?.participantId ?? null,
      stageOf.get(n.id) ?? null,
      n.data?.actor ?? '',
      n.data?.locked === true,
      n.data?.composite ? n.data.composite.childIds.slice() : null,
      n.data?.gateway ? n.data.gateway.type : null,
    ]),
    edges: s.edges.map((e) => {
      const art = e.data?.artifact;
      return [
        e.id,
        e.source,
        e.target,
        e.sourceHandle ?? null,
        e.targetHandle ?? null,
        typeof e.data?.label === 'string' ? e.data.label : '',
        art ? [art.id, art.kind, art.label, art.description] : null,
      ];
    }),
    participants: s.participants.map((p) => [p.id, p.name, p.type, p.organizationId ?? null]),
    stages: s.stages.map((st) => [st.id, st.name, st.nodeIds.slice()]),
    annotations: s.annotations.map((a) => [
      a.id,
      a.title,
      a.content,
      a.collapsed === true,
      a.target.kind,
      'nodeId' in a.target ? a.target.nodeId : null,
      'edgeId' in a.target ? a.target.edgeId : null,
      'stageId' in a.target ? a.target.stageId : null,
      a.position?.x ?? null,
      a.position?.y ?? null,
    ]),
    participantOrder: s.participantOrder,
    stageOrder: s.stageOrder,
    arrangePending: s.arrangePending,
  });
}
