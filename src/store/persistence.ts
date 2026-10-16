/**
 * 持久化:示例图、偏好、多文档 localStorage 读写、初始文档构建。
 */
import {
  type FlowNode,
  type FlowEdge,
  type GraphSnapshot,
  type GraphDocument,
  type ViewportState,
  type Artifact,
  type EdgeStyle,
  type ThemeMode,
  type Annotation,
  type Stage,
  type Participant,
  type Organization,
  type ParticipantOrderMode,
  DOCUMENT_COLORS,
  createDefaultNode,
  uid,
} from '../types';
import type { FlowStore } from './types';

export const SAVE_KEY = 'nodeflow:graph:v1';
export const PREFS_KEY = 'nodeflow:prefs:v1';
export const DOCS_KEY = 'nodeflow:docs:v1';
/** 默认文档 id(迁移旧单文档时使用) */
export const LEGACY_DOC_ID = 'doc_default';

/* ------------------------------------------------------------------ */
/* 首次启动时的示例图                                                   */
/* ------------------------------------------------------------------ */
export function buildSeedGraph(): GraphSnapshot {
  const n1 = createDefaultNode({ x: 40, y: 160 });
  n1.id = 'seed_1';
  n1.data = {
    label: '需求收集',
    description: '与客户沟通并整理本次内容创作的需求、目标与素材清单',
    actor: 'human',
    locked: false,
    inputs: [],
    outputs: [{ id: 'out_1', name: '需求文档' }],
  };

  const n2 = createDefaultNode({ x: 360, y: 40 });
  n2.id = 'seed_2';
  n2.data = {
    label: '脚本撰写',
    description: '根据需求文档由大模型生成初版脚本,人工校对润色',
    actor: 'hybrid',
    locked: false,
    inputs: [{ id: 'in_1', name: '需求' }],
    outputs: [{ id: 'out_1', name: '脚本' }, { id: 'out_2', name: '分镜表' }],
  };

  const n3 = createDefaultNode({ x: 720, y: 0 });
  n3.id = 'seed_3';
  n3.data = {
    label: '素材渲染',
    description: '由渲染农场批量生成视频画面,GPU 并行处理',
    actor: 'machine',
    locked: false,
    inputs: [{ id: 'in_1', name: '脚本' }],
    outputs: [{ id: 'out_1', name: '成片' }],
  };

  const n4 = createDefaultNode({ x: 720, y: 300 });
  n4.id = 'seed_4';
  n4.data = {
    label: '人工质检',
    description: '逐帧检查画面质量、字幕与音频同步,不合格退回重渲',
    actor: 'human',
    locked: false,
    inputs: [{ id: 'in_1', name: '待检成片' }],
    outputs: [{ id: 'out_1', name: '合格成片' }],
  };

  const n5 = createDefaultNode({ x: 1080, y: 160 });
  n5.id = 'seed_5';
  n5.data = {
    label: '发布上架',
    description: '多平台分发,配置封面、简介与定时发布',
    actor: 'hybrid',
    locked: false,
    inputs: [{ id: 'in_1', name: '成片' }],
    outputs: [],
  };

  const e1: FlowEdge = {
    id: 'seed_e1',
    source: 'seed_1',
    sourceHandle: 'out_1',
    target: 'seed_2',
    targetHandle: 'in_1',
    type: 'flow',
    data: {
      label: '传递给脚本组',
      artifact: {
        id: 'seed_a1',
        kind: 'document',
        label: '需求说明 v2',
        description: '客户确认后的需求文档,含目标人群与风格参考',
      },
    },
  };

  const e2: FlowEdge = {
    id: 'seed_e2',
    source: 'seed_2',
    sourceHandle: 'out_1',
    target: 'seed_3',
    targetHandle: 'in_1',
    type: 'flow',
    data: {
      label: '送渲染',
      artifact: {
        id: 'seed_a2',
        kind: 'document',
        label: '分镜脚本',
        description: '逐镜头的画面与台词说明',
      },
    },
  };

  const e3: FlowEdge = {
    id: 'seed_e3',
    source: 'seed_3',
    sourceHandle: 'out_1',
    target: 'seed_4',
    targetHandle: 'in_1',
    type: 'flow',
    data: {
      label: '待质检',
      artifact: {
        id: 'seed_a3',
        kind: 'video',
        label: '渲染成片',
        description: '3 分 20 秒,1080P 初版成片',
      },
    },
  };

  const e4: FlowEdge = {
    id: 'seed_e4',
    source: 'seed_4',
    sourceHandle: 'out_1',
    target: 'seed_5',
    targetHandle: 'in_1',
    type: 'flow',
    data: {
      label: '质检通过',
      artifact: {
        id: 'seed_a4',
        kind: 'video',
        label: '终版成片',
        description: '通过质检的最终版本',
      },
    },
  };

  return {
    nodes: [n1, n2, n3, n4, n5],
    edges: [e1, e2, e3, e4],
    viewport: { x: 20, y: 60, zoom: 0.85 },
  };
}

/* ------------------------------------------------------------------ */
/* 持久化                                                              */
/* ------------------------------------------------------------------ */
export function loadSaved(): Partial<GraphSnapshot> | null {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!Array.isArray(data.nodes) || !Array.isArray(data.edges)) return null;
    return data;
  } catch {
    return null;
  }
}

export function loadPrefs(): { edgeStyle: EdgeStyle; theme: ThemeMode } | null {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (data && (data.edgeStyle === 'smoothstep' || data.edgeStyle === 'bezier')) {
      return {
        edgeStyle: data.edgeStyle as EdgeStyle,
        theme: data.theme === 'light' ? 'light' : 'dark',
      };
    }
    return null;
  } catch {
    return null;
  }
}

export function savePrefs(edgeStyle: EdgeStyle, theme: ThemeMode) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify({ edgeStyle, theme }));
  } catch {
    /* 存储失败静默处理 */
  }
}

/* ---------------- 多文档持久化 ---------------- */

interface DocMeta {
  id: string;
  name: string;
  color: string;
  lastSavedAt: number | null;
}
interface DocsIndex {
  docs: DocMeta[];
  activeId: string;
}

export function docKey(id: string): string {
  return `nodeflow:doc:${id}:v1`;
}

/** 保存单个文档数据(仅图数据 + 内部画布标签) */
export function persistDocument(
  doc: Pick<
    GraphDocument,
    | 'id'
    | 'nodes'
    | 'edges'
    | 'viewport'
    | 'annotations'
    | 'stages'
    | 'participants'
    | 'organizations'
    | 'participantOrder'
    | 'participantOrderMode'
    | 'stageOrder'
    | 'arrangePending'
    | 'compositeTabs'
    | 'activeTabId'
  >,
) {
  try {
    // 普通节点(非组合)的 draggable 是编辑文字的临时态,不持久化;保存时强制可拖,避免编辑态卡住导致刷新后无法拖拽
    const nodes = doc.nodes.map((n) => {
      if (n.data?.composite) return n;
      return n.draggable === false ? { ...n, draggable: true } : n;
    });
    localStorage.setItem(
      docKey(doc.id),
      JSON.stringify({
        version: 1, // localStorage 文档数据版本(向后兼容:旧数据无此字段视为 legacy)
        nodes,
        edges: doc.edges,
        viewport: doc.viewport,
        annotations: doc.annotations,
        stages: doc.stages,
        participants: doc.participants,
        organizations: doc.organizations,
        participantOrder: doc.participantOrder,
        participantOrderMode: doc.participantOrderMode,
        stageOrder: doc.stageOrder,
        arrangePending: doc.arrangePending,
        compositeTabs: doc.compositeTabs,
        activeTabId: doc.activeTabId,
      }),
    );
  } catch {
    /* 静默 */
  }
}

/** 加载单个文档数据,返回不含历史/脏标记的图数据(缺省返回空图) */
export function loadPersistedDocument(id: string): Pick<
  GraphDocument,
  | 'nodes'
  | 'edges'
  | 'viewport'
  | 'annotations'
  | 'stages'
  | 'participants'
  | 'organizations'
  | 'participantOrder'
  | 'participantOrderMode'
  | 'stageOrder'
  | 'arrangePending'
  | 'compositeTabs'
  | 'activeTabId'
  > {
  const emptyOrder = {
  nodes: [],
  edges: [],
  viewport: { x: 0, y: 0, zoom: 1 },
  annotations: [],
  stages: [],
  participants: [],
  organizations: [],
  participantOrder: [],
  participantOrderMode: 'auto' as const,
  stageOrder: [],
  arrangePending: false,
  compositeTabs: [],
  activeTabId: 'main',
  };
  try {
    const raw = localStorage.getItem(docKey(id));
    if (!raw) return emptyOrder;
    const data = JSON.parse(raw);
    const rawNodes: FlowNode[] = Array.isArray(data.nodes) ? data.nodes : [];
    // 普通节点(非组合)的 draggable 是编辑临时态,加载时强制可拖(避免旧持久化里的 false 导致不可拖)
    const nodes = rawNodes.map((n) => (n.data?.composite ? n : n.draggable === false ? { ...n, draggable: true } : n));
    const participants: Participant[] = Array.isArray(data.participants) ? data.participants : [];
    const stages: Stage[] = Array.isArray(data.stages) ? data.stages : [];
    return {
      nodes,
      edges: Array.isArray(data.edges) ? data.edges : [],
      viewport: data.viewport ?? { x: 0, y: 0, zoom: 1 },
      annotations: Array.isArray(data.annotations) ? data.annotations : [],
      stages,
      participants,
      organizations: Array.isArray(data.organizations) ? data.organizations : [],
      // legacy localStorage 无 order:按参与方/stage 数组顺序补默认(auto)
      participantOrder: Array.isArray(data.participantOrder)
        ? data.participantOrder
        : participants.map((p) => p.id),
      participantOrderMode:
        data.participantOrderMode === 'user' || data.participantOrderMode === 'auto'
          ? data.participantOrderMode
          : 'auto',
      stageOrder: Array.isArray(data.stageOrder) ? data.stageOrder : stages.map((st) => st.id),
      arrangePending: data.arrangePending === true,
      compositeTabs: Array.isArray(data.compositeTabs) ? data.compositeTabs : [],
      activeTabId: data.activeTabId ?? 'main',
    };
  } catch {
    return emptyOrder;
  }
}

/** 加载文档注册表 */
export function loadDocsIndex(): DocsIndex | null {
  try {
    const raw = localStorage.getItem(DOCS_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!Array.isArray(data.docs)) return null;
    return {
      docs: data.docs as DocMeta[],
      activeId: typeof data.activeId === 'string' ? data.activeId : data.docs[0]?.id ?? '',
    };
  } catch {
    return null;
  }
}

/** 保存文档注册表 */
export function persistDocsIndex(index: DocsIndex) {
  try {
    localStorage.setItem(DOCS_KEY, JSON.stringify(index));
  } catch {
    /* 静默 */
  }
}

/**
 * 启动时构建文档列表:
 * - 有注册表 → 按注册表加载各文档数据
 * - 无注册表 → 迁移旧单文档(SAVE_KEY),作为默认文档
 */
export function buildInitialDocuments(): { docs: GraphDocument[]; activeId: string } {
  const legacy = loadSaved();
  const index = loadDocsIndex();
  if (index && index.docs.length) {
    const docs = index.docs.map((meta) => {
      const data = loadPersistedDocument(meta.id);
      return {
        id: meta.id,
        name: meta.name,
        color: meta.color,
        nodes: data.nodes,
        edges: data.edges,
        viewport: data.viewport,
        annotations: data.annotations,
        stages: data.stages,
        participants: Array.isArray(data.participants) ? data.participants : [],
        organizations: Array.isArray(data.organizations) ? data.organizations : [],
        participantOrder: Array.isArray(data.participantOrder) ? data.participantOrder : [],
        participantOrderMode: data.participantOrderMode ?? 'auto',
        stageOrder: Array.isArray(data.stageOrder) ? data.stageOrder : [],
        arrangePending: data.arrangePending === true,
        compositeTabs: data.compositeTabs,
        activeTabId: data.activeTabId,
        past: [],
        future: [],
        lastSavedAt: meta.lastSavedAt,
        dirty: false,
      } satisfies GraphDocument;
    });
    const activeId = index.docs.some((d) => d.id === index.activeId)
      ? index.activeId
      : index.docs[0].id;
    return { docs, activeId };
  }
  // 迁移旧单文档
  const legacyDoc: GraphDocument = {
    id: LEGACY_DOC_ID,
    name: '我的流程',
    color: DOCUMENT_COLORS[0],
    nodes: legacy?.nodes ?? seedGraph.nodes,
    edges: legacy?.edges ?? seedGraph.edges,
    viewport: legacy?.viewport ?? seedGraph.viewport,
    annotations: Array.isArray(legacy?.annotations) ? legacy.annotations : [],
    stages: [],
    participants: [],
    organizations: [],
    participantOrder: [],
    participantOrderMode: 'auto',
    stageOrder: [],
    arrangePending: false,
    compositeTabs: [],
    activeTabId: 'main',
    past: [],
    future: [],
    lastSavedAt: legacy ? Date.now() : null,
    dirty: false,
  };
  persistDocument(legacyDoc);
  persistDocsIndex({ docs: [{ id: legacyDoc.id, name: legacyDoc.name, color: legacyDoc.color, lastSavedAt: legacyDoc.lastSavedAt }], activeId: legacyDoc.id });
  return { docs: [legacyDoc], activeId: legacyDoc.id };
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;
export const seedGraph = buildSeedGraph();
export const prefs = loadPrefs();
// 启动时构建文档列表(迁移旧单文档或按注册表加载)
export const initialDocs = buildInitialDocuments();
export const initialActiveDoc = initialDocs.docs.find((d) => d.id === initialDocs.activeId) ?? initialDocs.docs[0];
