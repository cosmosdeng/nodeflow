import type { Node, Edge } from '@xyflow/react';

/** 节点执行主体类型 */
export type ActorType = 'human' | 'machine' | 'hybrid';

/** 参与方(流程责任主体)类型 */
export type ParticipantType =
  | 'person'
  | 'role'
  | 'organization'
  | 'department'
  | 'machine'
  | 'software'
  | 'ai-agent';

/** 参与方(流程责任主体) */
export interface Participant {
  id: string;
  name: string;
  type: ParticipantType;
  /** 所属组织 id(可选) */
  organizationId?: string;
}

/** 组织(参与方的语义归属分组) */
export interface Organization {
  id: string;
  name: string;
}

/** 参与方类型显示名 */
export const PARTICIPANT_TYPE_LABELS: Record<ParticipantType, string> = {
  person: '个人',
  role: '角色',
  organization: '组织',
  department: '部门',
  machine: '机器',
  software: '软件',
  'ai-agent': 'AI 智能体',
};

/** 中间产物类型 */
export type ArtifactKind = 'document' | 'image' | 'video' | 'audio' | 'code' | 'data' | 'other';

/** BPMN 网关类型:排他(XOR) / 并行(AND) / 包容(OR) */
export type GatewayType = 'exclusive' | 'parallel' | 'inclusive';

/** 网关节点元数据 */
export interface GatewayMeta {
  /** 网关类型 */
  type: GatewayType;
  /** 默认分支:出口连线 id(排他 / 包容网关的兜底分支) */
  defaultBranch?: string;
}

/** 连线显示风格 */
export type EdgeStyle = 'smoothstep' | 'bezier';

/** 画布配色主题 */
export type ThemeMode = 'dark' | 'light';

export const EDGE_STYLE_LABELS: Record<EdgeStyle, string> = {
  smoothstep: '直角',
  bezier: '弧线',
};

export const THEME_LABELS: Record<ThemeMode, string> = {
  dark: '深色',
  light: '浅色',
};

/** 节点的输入/输出端口描述 */
export interface PortDef {
  id: string;
  name: string;
}

/** 组合节点(Composite Node)元数据:将多个节点聚合为一个节点 */
export interface CompositeMeta {
  /** 是否在主画布上展开:true 显示为虚线框并显示内部节点,false 塌缩为粗边框组合节点 */
  expanded: boolean;
  /** 包含的子节点 id 列表 */
  childIds: string[];
}

/** 节点数据 */
export interface FlowNodeData {
  label: string;
  description: string;
  actor: ActorType;
  /** 是否锁定:锁定后禁止在画布/面板上编辑内容 */
  locked: boolean;
  inputs: PortDef[];
  outputs: PortDef[];
  /** 组合节点元数据(存在即表示该节点是组合节点) */
  composite?: CompositeMeta;
  /** 网关节点元数据(存在即表示该节点是 BPMN 网关) */
  gateway?: GatewayMeta;
  /** 流程参与方 id(可选,指向 Participant.id;仅语义绑定,不影响几何) */
  participantId?: string;
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

/** 注释的归属主体 */
export type AnnotationTarget =
  | { kind: 'canvas'; tabId: string } // 画布归属(tabId: 'main' 或组合 id)
  | { kind: 'node'; nodeId: string } // 节点归属
  | { kind: 'edge'; edgeId: string } // 连线归属
  | { kind: 'artifact'; edgeId: string }; // 连线中间产物归属(定位到具体连线)

/** 注释框 */
export interface Annotation {
  id: string;
  title: string;
  content: string;
  target: AnnotationTarget;
  /** 是否收起(收起时只显示附着在主体上的图标) */
  collapsed: boolean;
  /** 画布归属时的流坐标位置 */
  position?: { x: number; y: number };
}

/** 流程阶段域(Stage):矩形虚线框区域,节点/组合拖入即归属 */
export interface Stage {
  id: string;
  /** 域名称 */
  name: string;
  /** 域的流坐标矩形 */
  x: number;
  y: number;
  width: number;
  height: number;
  /** 归属该域的节点 id 列表 */
  nodeIds: string[];
  /** 是否选中(用于高亮) */
  selected?: boolean;
}

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
  /** 快照创建时的注释 */
  annotations?: Annotation[];
  /** 快照创建时的流程阶段域 */
  stages?: Stage[];
  /** 快照创建时的参与方 */
  participants?: Participant[];
  /** 快照创建时的组织 */
  organizations?: Organization[];
  /** 快照创建时的组合标签页状态(用于撤销/重做时联动恢复) */
  compositeTabs?: string[];
  /** 快照创建时的激活标签页 id */
  activeTabId?: string;
  /** 快照创建时间戳 */
  at?: number;
}

export interface GraphState {
  nodes: FlowNode[];
  edges: FlowEdge[];
  viewport: ViewportState;
}

/** 项目文档颜色(用于多文档标签区分) */
export const DOCUMENT_COLORS = ['#4ea1ff', '#22c55e', '#f59e0b', '#ec4899', '#9d6bff', '#06b6d4'] as const;

/**
 * 一个独立项目文档:包含完整的图数据、内部画布标签状态与各自的历史栈。
 * 多文档模型下,每个文档拥有独立的 nodes / edges / viewport / 撤销历史。
 */
export interface GraphDocument {
  /** 文档唯一 id */
  id: string;
  /** 文档名称 */
  name: string;
  /** 项目标签颜色 */
  color: string;
  nodes: FlowNode[];
  edges: FlowEdge[];
  viewport: ViewportState;
  /** 该文档的注释 */
  annotations: Annotation[];
  /** 该文档的流程阶段域 */
  stages: Stage[];
  /** 该文档的参与方 */
  participants: Participant[];
  /** 该文档的组织 */
  organizations: Organization[];
  /** 该文档内已打开的组合内部画布标签 */
  compositeTabs: string[];
  /** 该文档内当前激活的标签页:'main' 或组合节点 id */
  activeTabId: string;
  /** 该文档自己的撤销历史 */
  past: GraphSnapshot[];
  /** 该文档自己的重做历史 */
  future: GraphSnapshot[];
  lastSavedAt: number | null;
  dirty: boolean;
}

/** 人工 / 机器 / 人机协同 标签的图标与颜色配置 */
export const ACTOR_META: Record<
  ActorType,
  { label: string; color: string; bg: string; frame: string }
> = {
  human: { label: '人工', color: '#e8b028', bg: 'rgba(232,176,40,.14)', frame: '#e8b028' },
  machine: { label: '机器', color: '#4ea1ff', bg: 'rgba(78,161,255,.14)', frame: '#4ea1ff' },
  hybrid: { label: '人机协同', color: '#9d6bff', bg: 'rgba(157,107,255,.14)', frame: '#22c55e' },
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
      locked: false,
      inputs: [{ id: 'in_1', name: '输入' }],
      outputs: [{ id: 'out_1', name: '输出' }],
    },
  };
}


