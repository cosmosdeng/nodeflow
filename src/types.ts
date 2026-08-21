import type { Node, Edge } from '@xyflow/react';

/** 节点执行主体类型 */
export type ActorType = 'human' | 'machine' | 'hybrid';

/** 中间产物类型 */
export type ArtifactKind = 'document' | 'image' | 'video' | 'audio' | 'code' | 'data' | 'other';

/** 节点的输入/输出端口描述 */
export interface PortDef {
  id: string;
  name: string;
}

/** 节点数据 */
export interface FlowNodeData {
  label: string;
  description: string;
  actor: ActorType;
  inputs: PortDef[];
  outputs: PortDef[];
  [key: string]: unknown;
}

/** 中间产物(挂在连线上的对象) */
export interface Artifact {
  id: string;
  kind: ArtifactKind;
  label: string;
  description: string;
}

/** 连线数据 */
export interface FlowEdgeData {
  label: string;
  artifact: Artifact | null;
  [key: string]: unknown;
}

export type FlowNode = Node<FlowNodeData, 'flow'>;
export type FlowEdge = Edge<FlowEdgeData, 'flow'>;

/** 画布视口 */
export interface ViewportState {
  x: number;
  y: number;
  zoom: number;
}

/** 一份可回溯的历史快照 */
export interface GraphSnapshot {
  nodes: FlowNode[];
  edges: FlowEdge[];
  viewport: ViewportState;
  /** 快照创建时间戳 */
  at?: number;
}

export interface GraphState {
  nodes: FlowNode[];
  edges: FlowEdge[];
  viewport: ViewportState;
}

/** 人工 / 机器 / 人机协同 标签的图标与颜色配置 */
export const ACTOR_META: Record<
  ActorType,
  { label: string; color: string; bg: string; icon: string }
> = {
  human: { label: '人工', color: '#e8b028', bg: 'rgba(232,176,40,.14)', icon: '👤' },
  machine: { label: '机器', color: '#4ea1ff', bg: 'rgba(78,161,255,.14)', icon: '🤖' },
  hybrid: { label: '人机协同', color: '#9d6bff', bg: 'rgba(157,107,255,.14)', icon: '🤝' },
};

/** 中间产物类型的元信息 */
export const ARTIFACT_META: Record<ArtifactKind, { label: string; icon: string; color: string }> = {
  document: { label: '文档', icon: '📄', color: '#3b82f6' },
  image: { label: '图像', icon: '🖼️', color: '#10b981' },
  video: { label: '视频', icon: '🎬', color: '#f59e0b' },
  audio: { label: '音频', icon: '🎵', color: '#ec4899' },
  code: { label: '代码', icon: '💻', color: '#8b5cf6' },
  data: { label: '数据', icon: '📊', color: '#06b6d4' },
  other: { label: '其他', icon: '📦', color: '#64748b' },
};

export const ACTOR_KINDS: ActorType[] = ['human', 'machine', 'hybrid'];
export const ARTIFACT_KINDS: ArtifactKind[] = [
  'document',
  'image',
  'video',
  'audio',
  'code',
  'data',
  'other',
];

export function uid(prefix = 'id'): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/** 创建一个默认节点 */
export function createDefaultNode(position: { x: number; y: number }): FlowNode {
  const id = uid('node');
  return {
    id,
    type: 'flow',
    position,
    data: {
      label: '新节点',
      description: '',
      actor: 'machine',
      inputs: [{ id: 'in_1', name: '输入' }],
      outputs: [{ id: 'out_1', name: '输出' }],
    },
  };
}
