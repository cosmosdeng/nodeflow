/**
 * Agent Interface — Queries(Observe)。
 * 仅通过 useGraphStore.getState() 读取现有 store,返回稳定 DTO。
 * 不暴露 Zustand / React 内部对象。
 */
import { useGraphStore } from '../store/graphStore';
import type { FlowEdge, FlowNode } from '../types';
import type {
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

function toSelectionDto(sel: unknown): AgentSelectionDto {
  if (typeof sel !== 'object' || sel === null) return null;
  const o = sel as Record<string, unknown>;
  if (typeof o.kind !== 'string' || typeof o.id !== 'string') return null;
  if (o.kind === 'node' || o.kind === 'edge' || o.kind === 'stage' || o.kind === 'annotation') {
    return { kind: o.kind, id: o.id };
  }
  return null;
}

function toNodeDto(n: FlowNode, stageId: string | null): AgentNodeDto {
  const data = n.data ?? {};
  const w = n.measured?.width ?? (typeof n.width === 'number' ? n.width : null);
  const h = n.measured?.height ?? (typeof n.height === 'number' ? n.height : null);
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
    isComposite: Boolean(data.composite),
    isGateway: Boolean(data.gateway),
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

export function toViewportDto(v: { x: number; y: number; zoom: number }): AgentViewportDto {
  return { x: v.x, y: v.y, zoom: v.zoom };
}

export function getNodesDto(): AgentNodeDto[] {
  const st = useGraphStore.getState();
  return st.nodes.map((n) => toNodeDto(n, findStageId(n.id, st.stages)));
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
  const nodes = s.nodes.map((n) => toNodeDto(n, findStageId(n.id, s.stages)));
  const stageOf = new Map(nodes.map((n) => [n.id, n.stageId]));
  void stageOf;
  return {
    revision: s.agentRevision,
    nodes,
    edges: s.edges.map(toEdgeDto),
    participants: s.participants.map(toParticipantDto),
    stages: s.stages.map(toStageDto),
    viewport: toViewportDto(s.viewport),
    selection: toSelectionDto(s.selected),
    arrangePending: s.arrangePending,
    showStageBands: s.showStageBands,
    showParticipantBands: s.showParticipantBands,
  };
}
