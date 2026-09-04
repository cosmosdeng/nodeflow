/**
 * Agent Interface — Queries(Observe)。
 * 仅通过 useGraphStore.getState() 读取现有 store,返回稳定 DTO。
 * Composite hierarchy(childIds / parentCompositeId)由 Query 层从真实 host.childIds 派生,
 * 不新增持久化字段;Artifact/Annotation 取自 edge.data.artifact 与 store annotations。
 */
import { useGraphStore } from '../store/graphStore';
import type { Annotation, FlowEdge, FlowNode } from '../types';
import type {
  AgentAnnotationDto,
  AgentArtifactDto,
  AgentEdgeDto,
  AgentGraphState,
  AgentNodeDto,
  AgentParticipantDto,
  AgentSelectionDto,
  AgentStageDto,
  AgentViewportDto,
} from './types';

function findStageId(nodeId: string, stages: { id: string; nodeIds: string[] }[]): string | null {
  for (const s of stages) if (s.nodeIds.includes(nodeId)) return s.id;
  return null;
}

function parentsOf(nodes: readonly FlowNode[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const n of nodes) {
    const ids = n.data?.composite?.childIds;
    if (Array.isArray(ids)) {
      for (const c of ids) if (!map.has(c)) map.set(c, n.id);
    }
  }
  return map;
}

function toSelectionDto(sel: unknown): AgentSelectionDto {
  if (typeof sel !== 'object' || sel === null) return null;
  const o = sel as Record<string, unknown>;
  if (typeof o.kind !== 'string' || typeof o.id !== 'string') return null;
  if (o.kind === 'node' || o.kind === 'edge' || o.kind === 'stage' || o.kind === 'annotation') {
    return { kind: o.kind, id: o.id };
  }
  return null;
}

function toNodeDto(n: FlowNode, stageId: string | null, parentOf: Map<string, string>): AgentNodeDto {
  const data = n.data ?? {};
  const w = n.measured?.width ?? (typeof n.width === 'number' ? n.width : null);
  const h = n.measured?.height ?? (typeof n.height === 'number' ? n.height : null);
  const comp = data.composite && typeof data.composite === 'object'
    ? (data.composite as { childIds?: unknown })
    : null;
  const childIds = Array.isArray(comp?.childIds) ? comp.childIds.filter((x): x is string => typeof x === 'string') : [];
  const gw = data.gateway && typeof data.gateway === 'object'
    ? (data.gateway as { type?: unknown })
    : null;
  const gwType =
    gw && (gw.type === 'exclusive' || gw.type === 'parallel' || gw.type === 'inclusive')
      ? gw.type
      : null;
  return {
    id: n.id,
    type: n.type ?? 'flow',
    label: typeof data.label === 'string' ? data.label : n.id,
    position: { x: n.position?.x ?? 0, y: n.position?.y ?? 0 },
    width: typeof w === 'number' && Number.isFinite(w) ? w : null,
    height: typeof h === 'number' && Number.isFinite(h) ? h : null,
    participantId:
      typeof data.participantId === 'string' && data.participantId ? data.participantId : null,
    stageId,
    actor: typeof data.actor === 'string' ? data.actor : 'machine',
    locked: data.locked === true,
    childIds,
    parentCompositeId: parentOf.get(n.id) ?? null,
    isComposite: childIds.length > 0,
    isGateway: gwType !== null,
    gatewayType: gwType,
  };
}

function toArtifactDto(a: unknown): AgentArtifactDto | null {
  if (typeof a !== 'object' || a === null) return null;
  const o = a as Record<string, unknown>;
  if (typeof o.id !== 'string') return null;
  return {
    id: o.id,
    kind: typeof o.kind === 'string' ? o.kind : 'other',
    label: typeof o.label === 'string' ? o.label : '',
    description: typeof o.description === 'string' ? o.description : '',
  };
}

function toEdgeDto(e: FlowEdge): AgentEdgeDto {
  return {
    id: e.id,
    source: e.source,
    target: e.target,
    sourceHandle: e.sourceHandle ?? null,
    targetHandle: e.targetHandle ?? null,
    label: typeof e.data?.label === 'string' ? e.data.label : '',
    artifact: toArtifactDto(e.data?.artifact),
  };
}

function toParticipantDto(p: { id: string; name?: string; type?: string; organizationId?: string }): AgentParticipantDto {
  return {
    id: p.id,
    name: typeof p.name === 'string' ? p.name : p.id,
    type: typeof p.type === 'string' ? p.type : 'role',
    organizationId: p.organizationId ?? null,
  };
}

function toStageDto(s: { id: string; name?: string; nodeIds?: string[] }): AgentStageDto {
  return {
    id: s.id,
    name: typeof s.name === 'string' ? s.name : s.id,
    nodeIds: Array.isArray(s.nodeIds) ? [...s.nodeIds] : [],
  };
}

function toAnnotationDto(a: Annotation): AgentAnnotationDto {
  const t = a.target;
  return {
    id: a.id,
    title: a.title,
    content: a.content,
    collapsed: a.collapsed === true,
    target:
      t.kind === 'canvas'
        ? { kind: 'canvas', tabId: t.tabId }
        : t.kind === 'node'
          ? { kind: 'node', nodeId: t.nodeId }
          : t.kind === 'edge'
            ? { kind: 'edge', edgeId: t.edgeId }
            : t.kind === 'artifact'
              ? { kind: 'artifact', edgeId: t.edgeId }
              : { kind: 'stage', stageId: t.stageId },
    position: a.position ? { x: a.position.x, y: a.position.y } : null,
  };
}

export function toViewportDto(v: { x: number; y: number; zoom: number }): AgentViewportDto {
  return { x: v.x, y: v.y, zoom: v.zoom };
}

export function getNodesDto(): AgentNodeDto[] {
  const st = useGraphStore.getState();
  const parentOf = parentsOf(st.nodes);
  return st.nodes.map((n) => toNodeDto(n, findStageId(n.id, st.stages), parentOf));
}

export function getEdgesDto(): AgentEdgeDto[] {
  return useGraphStore.getState().edges.map(toEdgeDto);
}

export function getParticipantsDto(): AgentParticipantDto[] {
  return useGraphStore.getState().participants.map(toParticipantDto);
}

export function getStagesDto(): AgentStageDto[] {
  return useGraphStore.getState().stages.map(toStageDto);
}

export function getViewportDto(): AgentViewportDto {
  const s = useGraphStore.getState();
  return toViewportDto(s.viewport);
}

export function getSelectionDto(): AgentSelectionDto {
  return toSelectionDto(useGraphStore.getState().selected);
}

export function getAnnotationsDto(): AgentAnnotationDto[] {
  return useGraphStore.getState().annotations.map(toAnnotationDto);
}

/** 轻量文档信息(当前活动文档 id/名字在 store documents 中) */
export function getDocumentDto(): {
  documentId: string;
  activeTabId: string;
  nodeCount: number;
  edgeCount: number;
} {
  const s = useGraphStore.getState();
  return {
    documentId: s.activeDocumentId,
    activeTabId: s.activeTabId,
    nodeCount: s.nodes.length,
    edgeCount: s.edges.length,
  };
}

export function getGraphStateDto(): AgentGraphState {
  const s = useGraphStore.getState();
  const parentOf = parentsOf(s.nodes);
  return {
    revision: s.agentRevision,
    nodes: s.nodes.map((n) => toNodeDto(n, findStageId(n.id, s.stages), parentOf)),
    edges: s.edges.map(toEdgeDto),
    participants: s.participants.map(toParticipantDto),
    stages: s.stages.map(toStageDto),
    viewport: toViewportDto(s.viewport),
    selection: toSelectionDto(s.selected),
    annotations: s.annotations.map(toAnnotationDto),
    arrangePending: s.arrangePending,
    showStageBands: s.showStageBands,
    showParticipantBands: s.showParticipantBands,
  };
}
